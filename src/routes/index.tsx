import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart as RPieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bookmark as BookmarkIcon,
  BookmarkPlus,
  Calculator,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Columns3,
  ClipboardPaste,
  Copy,
  Download,
  FileImage,
  FileText,
  Files,
  Filter,
  FolderSync,
  GitMerge,
  GripVertical,
  HelpCircle,
  Info,
  LayoutDashboard,
  LayoutGrid,
  ListOrdered,
  MapPin,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  Palette,
  Pause,
  PanelRight,
  Pin,
  PieChart as PieIcon,
  Play,
  Plus,
  Redo2,
  Search,
  Send,
  Settings2,
  Sheet as SheetIcon,
  ShieldAlert,
  Sparkles,
  Star,
  Sun,
  Trash2,
  TrendingUp,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  Column,
  ConditionalFormatRule,
  Dashboard,
  FilterRule,
  Kind,
  Row,
  SheetData,
  Widget,
  WidgetSize,
  WidgetSpan,
  WidgetType,
} from "@/lib/types";
import { kinds, numericKinds, widgetTypeLabels } from "@/lib/types";
import {
  createWidget,
  buildDefaultWidgets,
  columnDragType,
  columnDropAccepted,
  draggedColumnKind,
  duplicateWidget,
  groupableKinds,
  pickBestGroupColumn,
  schedulePeriodColumns,
  scheduleItemColumn,
  scheduleStatusColumn,
  scheduleDetailColumns,
  spanClass,
  sizeClass,
} from "@/lib/widgets";
import {
  conditionalColor,
  conditionalStyle,
  evalFormula,
  fmt,
  hue,
  infer,
  inferColumns,
  palette,
  parseDateValue,
  sortChronologically,
  validateFormula,
  withCalculatedColumns,
} from "@/lib/format";
import {
  aggregate,
  aggregationLabels,
  applyMissingRules,
  detectQualitySignals,
  groupAndAggregate,
  leftJoin,
  matchesRange,
  NOT_INFORMED,
  pieRoundnessFor,
  relevantAggregationOps,
  sortAllBarCategories,
  barChartPresentation,
  timeSeriesChartPresentation,
  toggleClickFilter,
  type AggregationOp,
  type QualitySignal,
} from "@/lib/data-pipeline";
import type { ImportDiagnostics } from "@/lib/import-intelligence";
import { buildRecommendedWidgets, generateAutoDashboardPlan } from "@/lib/auto-dashboard";
import {
  loadDashboards,
  loadFolderMonitor,
  loadGeocodeCache,
  ONBOARDING_KEY,
  removeFolderMonitor,
  saveDashboards,
  saveFolderMonitor,
  saveGeocodeCache,
  TERM_HINTS_KEY,
  THEME_KEY,
  isPrivateMode,
  setPrivateMode,
  type GeocodeCache,
  type GeoPoint,
  type SaveResult,
} from "@/lib/storage";
import {
  LARGE_FILE_BYTES,
  preferredSheetIndex,
  sheetToRows,
  type SheetOption,
  type SourceGrid,
  type ImportAudit,
} from "@/lib/import";
import { mergeReimportedSheets } from "@/lib/dashboard";
import {
  decryptDashboardBackup,
  encryptDashboardBackup,
  safeRowsForSpreadsheet,
} from "@/lib/encrypted-backup";
import {
  adaptImportProfile,
  applyImportSelection,
  buildSheetHealth,
  defaultSelection,
  matchingImportProfile,
  saveImportProfile,
  compareVersions,
  type ImportSelection,
} from "@/lib/import-workbench";
import { readWorkbookFile } from "@/lib/workbook-reader-client";
import { WORKBOOK_ACCEPT, WORKBOOK_FORMATS_LABEL } from "@/lib/workbook-reader";
import { geocodeMissing } from "@/lib/geocode";
import { askGemini, type GeminiChatMessage } from "@/lib/gemini-client";
import { analyzeImportWithAi, markSmartImportAutoAnalysis } from "@/lib/smart-import-client";
import {
  buildSmartImportInput,
  smartImportFingerprint,
  type SmartImportAnalysis,
  type SmartImportSuggestion,
} from "@/lib/smart-import";
import {
  buildLiveDashboardContext,
  buildLiveSuggestedPrompts,
  type LiveDashboardContext,
} from "@/lib/assistant-context";
import {
  captureScale,
  EXPORT_SURFACE_WIDTH,
  pdfPageSlices,
  pdfTablePages,
} from "@/lib/export-layout";
import { bookmarkView, createBookmark } from "@/lib/bookmarks";
import {
  FOLDER_MONITOR_INTERVAL_MS,
  fileChanged,
  fingerprint,
  listSupportedWorkbooks,
  pickFolderWorkbook,
  type FileFingerprint,
  type FolderMonitorView,
  type FolderWorkbookSelection,
  type LocalDirectoryHandle,
} from "@/lib/folder-monitor";
import "leaflet/dist/leaflet.css";

const demo: Row[] = [
  {
    data: "02/01/2026",
    região: "Sudeste",
    canal: "Enterprise",
    receita: 284500,
    custo: 171800,
    pedidos: 42,
    margem: 0.396,
  },
  {
    data: "09/01/2026",
    região: "Sul",
    canal: "Direto",
    receita: 176200,
    custo: 108900,
    pedidos: 31,
    margem: 0.382,
  },
  {
    data: "16/01/2026",
    região: "Nordeste",
    canal: "Parceiros",
    receita: 128900,
    custo: 84700,
    pedidos: 27,
    margem: 0.343,
  },
  {
    data: "23/01/2026",
    região: "Sudeste",
    canal: "Direto",
    receita: 232700,
    custo: 139400,
    pedidos: 38,
    margem: 0.401,
  },
  {
    data: "30/01/2026",
    região: "Centro-Oeste",
    canal: "Enterprise",
    receita: 154600,
    custo: 99800,
    pedidos: 22,
    margem: 0.354,
  },
  {
    data: "06/02/2026",
    região: "Sul",
    canal: "Parceiros",
    receita: 198400,
    custo: 121600,
    pedidos: 35,
    margem: 0.387,
  },
  {
    data: "13/02/2026",
    região: "Sudeste",
    canal: "Enterprise",
    receita: 311800,
    custo: 183900,
    pedidos: 49,
    margem: 0.41,
  },
  {
    data: "20/02/2026",
    região: "Nordeste",
    canal: "Direto",
    receita: 141300,
    custo: 93200,
    pedidos: 29,
    margem: 0.34,
  },
  {
    data: "27/02/2026",
    região: "Norte",
    canal: "Parceiros",
    receita: null,
    custo: 74100,
    pedidos: 18,
    margem: null,
  },
  {
    data: "06/03/2026",
    região: "Sul",
    canal: "Enterprise",
    receita: 218900,
    custo: 127500,
    pedidos: 36,
    margem: 0.418,
  },
  {
    data: "13/03/2026",
    região: "Sudeste",
    canal: "Direto",
    receita: 267400,
    custo: 161200,
    pedidos: 44,
    margem: 0.397,
  },
  {
    data: "20/03/2026",
    região: null,
    canal: "Parceiros",
    receita: 119800,
    custo: 80300,
    pedidos: 24,
    margem: 0.33,
  },
];

function Mark() {
  return <img className="oliam-mark" src="/oli-mark.svg" alt="" aria-hidden="true" />;
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    const preferred =
      saved === "dark" || saved === "light"
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setTheme(preferred);
    document.documentElement.classList.toggle("dark", preferred === "dark");
  }, []);
  const toggle = () =>
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      document.documentElement.classList.toggle("dark", next === "dark");
      return next;
    });
  return { theme, toggle };
}

function ThemeToggle({ theme, toggle }: { theme: string; toggle: () => void }) {
  return (
    <label
      className="theme-switch shrink-0"
      title={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
    >
      <input
        type="checkbox"
        className="theme-switch__checkbox"
        checked={theme === "dark"}
        onChange={toggle}
        aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
      />
      <div className="theme-switch__container">
        <div className="theme-switch__clouds" />
        <div className="theme-switch__stars-container">
          <svg viewBox="0 0 55 33.4" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="4.5" r="1.1" />
            <circle cx="16" cy="12" r="0.8" />
            <circle cx="28" cy="3.5" r="1" />
            <circle cx="40.5" cy="13.5" r="0.7" />
            <circle cx="48" cy="5" r="1" />
            <circle cx="10" cy="21" r="0.7" />
            <circle cx="34.5" cy="23.5" r="0.9" />
            <circle cx="22" cy="26" r="0.6" />
          </svg>
        </div>
        <div className="theme-switch__circle-container">
          <div className="theme-switch__sun-moon-container">
            <div className="theme-switch__moon">
              <div className="theme-switch__spot" />
              <div className="theme-switch__spot" />
              <div className="theme-switch__spot" />
            </div>
          </div>
        </div>
      </div>
    </label>
  );
}

function AnimatedNumber({ value, kind }: { value: number; kind: Kind }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current,
      to = value,
      start = performance.now(),
      dur = 480;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{fmt(display, kind) ?? "–"}</>;
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Oli.Qualidade, relatórios precisos a partir de planilhas" },
      {
        name: "description",
        content:
          "BI organizado para transformar Excel, CSV, ODS, Numbers e Google Sheets em relatórios configuráveis, com múltiplos painéis, modo escuro e gráficos interativos.",
      },
      { property: "og:title", content: "Oli.Qualidade, BI para planilhas" },
      {
        property: "og:description",
        content: "Transforme dados brutos em relatórios precisos, em vários painéis interativos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <OliAm />,
});

// Compartilhado com a rota /painel/$id (veja src/routes/painel.$id.tsx).
export function OliAm({ routeId }: { routeId?: string }) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(routeId ?? null);
  const [ready, setReady] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<string | "new">("new");
  const [stage, setStage] = useState<"home" | "empty" | "review" | "dashboard">(
    routeId ? "dashboard" : "empty",
  );
  const [reviewSheets, setReviewSheets] = useState<
    {
      name: string;
      rows: Row[];
      columns: Column[];
      diagnostics?: ImportDiagnostics;
      sourceGrid?: SourceGrid;
      audit?: ImportAudit;
    }[]
  >([]);
  const [reviewSheetIndex, setReviewSheetIndex] = useState(0);
  const [name, setName] = useState("");
  const [url, setUrl] = useState(""),
    [paste, setPaste] = useState(""),
    [editor, setEditor] = useState(false),
    [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const importAbort = useRef<AbortController | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "warning">("idle");
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [importProgressLabel, setImportProgressLabel] = useState<string | null>(null);
  const dashboardsRef = useRef<Dashboard[]>([]);
  const pendingFolderSelection = useRef<FolderWorkbookSelection | null>(null);
  const restoredFolderMonitors = useRef(false);
  const folderRuntimes = useRef(
    new Map<
      string,
      {
        directory: LocalDirectoryHandle;
        fileName: string;
        fingerprint: FileFingerprint | undefined;
        workbookNames: string[];
        lastSyncedAt: number;
        timer: ReturnType<typeof setInterval>;
        syncing: boolean;
        errored: boolean;
        active: boolean;
        check: () => Promise<void>;
      }
    >(),
  );
  const [folderMonitors, setFolderMonitors] = useState<Record<string, FolderMonitorView>>({});
  const [privateMode, setPrivateModeState] = useState(() => isPrivateMode());

  const togglePrivateMode = async () => {
    const next = !privateMode;
    setPrivateMode(next);
    setPrivateModeState(next);
    const list = await loadDashboards();
    dashboardsRef.current = list;
    setDashboards(list);
    setCurrentId(null);
    setStage(list.length ? "home" : "empty");
    toast.success(
      next
        ? "Modo privado ativado: novos painéis somem ao fechar esta aba."
        : "Modo privado desativado: seus painéis persistentes voltaram.",
    );
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      const list = await loadDashboards();
      if (!active) return;
      setDashboards(list);
      dashboardsRef.current = list;
      setFolderMonitors(
        Object.fromEntries(
          list
            .filter((dashboard) => dashboard.folderMonitor)
            .map((dashboard) => [dashboard.id, dashboard.folderMonitor!]),
        ),
      );
      if (routeId) {
        if (list.some((d) => d.id === routeId)) {
          setStage("dashboard");
        } else {
          // Link para um painel que não existe (ou foi excluído): volta para o início.
          setCurrentId(null);
          setStage(list.length ? "home" : "empty");
          void navigate({ to: "/", replace: true });
        }
      } else {
        setStage(list.length ? "home" : "empty");
      }
      setReady(true);
      if (!localStorage.getItem(ONBOARDING_KEY)) setOnboardingStep(0);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      for (const runtime of folderRuntimes.current.values()) clearInterval(runtime.timer);
      folderRuntimes.current.clear();
    },
    [],
  );

  // Abas em segundo plano têm timers reduzidos pelo navegador. Ao voltar,
  // conferir imediatamente evita esperar o próximo intervalo e também cobre
  // um arquivo salvo enquanto o painel estava sem foco.
  useEffect(() => {
    const checkVisibleMonitors = () => {
      if (document.visibilityState === "hidden") return;
      for (const runtime of folderRuntimes.current.values()) void runtime.check();
    };
    window.addEventListener("focus", checkVisibleMonitors);
    window.addEventListener("pageshow", checkVisibleMonitors);
    document.addEventListener("visibilitychange", checkVisibleMonitors);
    return () => {
      window.removeEventListener("focus", checkVisibleMonitors);
      window.removeEventListener("pageshow", checkVisibleMonitors);
      document.removeEventListener("visibilitychange", checkVisibleMonitors);
    };
  }, []);

  // Mantém o painel aberto em sincronia quando a URL muda por fora das próprias
  // ações deste componente: botão voltar/avançar do navegador, ou um link direto.
  useEffect(() => {
    if (!ready || (routeId ?? null) === currentId) return;
    if (routeId) {
      if (dashboards.some((d) => d.id === routeId)) {
        setCurrentId(routeId);
        setStage("dashboard");
      } else {
        setCurrentId(null);
        setStage(dashboards.length ? "home" : "empty");
        void navigate({ to: "/", replace: true });
      }
    } else {
      setCurrentId(null);
      setStage(dashboards.length ? "home" : "empty");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, ready]);
  const dismissOnboarding = () => {
    setOnboardingStep(null);
    localStorage.setItem(ONBOARDING_KEY, "1");
  };
  const persist = (list: Dashboard[]) => {
    dashboardsRef.current = list;
    setDashboards(list);
    void saveDashboards(list).then((result: SaveResult) => {
      if (result.ok) {
        setSaveState("saved");
        setSaveWarning(null);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaveState("idle"), 1800);
      } else {
        setSaveState("warning");
        setSaveWarning(result.reason);
      }
    });
  };
  const readWorkbook = async (file: File, signal?: AbortSignal) => {
    const labels = {
      decoding: "Identificando formato e codificação…",
      parsing: "Lendo células, fórmulas e formatação…",
      analyzing: "Analisando cabeçalhos e regiões de dados…",
    };
    const sheets = await readWorkbookFile(
      file,
      (progress) => setImportProgressLabel(labels[progress]),
      signal,
    );
    if (!sheets.length) throw new Error("empty-workbook");
    return sheets;
  };
  const prepare = (
    data: {
      name: string;
      rows: Row[];
      diagnostics?: ImportDiagnostics;
      sourceGrid?: SourceGrid;
      audit?: ImportAudit;
    }[],
    n: string,
  ) => {
    const nonEmpty = data.filter((s) => s.rows.length > 0);
    if (!nonEmpty.length) return;
    setReviewSheets(
      nonEmpty.map((s) => ({
        name: s.name,
        rows: s.rows,
        columns: infer(s.rows),
        ...(s.diagnostics ? { diagnostics: s.diagnostics } : {}),
        ...(s.sourceGrid ? { sourceGrid: s.sourceGrid } : {}),
        ...(s.audit ? { audit: s.audit } : {}),
      })),
    );
    setReviewSheetIndex(0);
    setName(n);
    setStage("review");
  };
  const parse = async (file: File) => {
    importAbort.current?.abort();
    const controller = new AbortController();
    importAbort.current = controller;
    setLoading(true);
    setImportError(null);
    setImportWarning(null);
    setImportProgressLabel(
      file.size > LARGE_FILE_BYTES ? "Arquivo grande, isso pode levar alguns segundos…" : "Lendo…",
    );
    // Dá um instante para o navegador pintar o indicador de carregamento
    // antes do processamento (síncrono e potencialmente pesado) começar.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const sheets = await readWorkbook(file, controller.signal);
      // Todas as abas com dado entram juntas na importação, uma vez só —
      // sem pedir pra escolher qual aba antes: o painel nasce já com todas
      // elas, prontas pra alternar depois numa barra de abas, como no Excel.
      setImportWarning(sheets.map((s) => s.warning).find((w) => w) ?? null);
      prepare(sheets, file.name);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setImportError("Importação cancelada. O arquivo original não foi alterado.");
        return;
      }
      const message = error instanceof Error ? error.message : "";
      setImportError(
        /password|encrypt|senha/i.test(message)
          ? "Esta planilha é protegida por senha. Remova a proteção ou informe uma cópia desbloqueada."
          : /limite|excede|ultrapassa|milhões de células|mais de \d+ abas/i.test(message)
            ? message
            : `Não foi possível ler esse arquivo. Use um formato válido: ${WORKBOOK_FORMATS_LABEL}.`,
      );
    } finally {
      if (importAbort.current === controller) importAbort.current = null;
      setLoading(false);
      setImportProgressLabel(null);
    }
  };

  const buildImportedSheets = (sheets: SheetOption[]) =>
    sheets.map((s) => {
      const columns = infer(s.rows);
      const autoDashboard = generateAutoDashboardPlan({
        columns,
        rows: s.rows,
        ...(s.diagnostics ? { diagnostics: s.diagnostics } : {}),
      });
      return {
        name: s.name,
        rows: s.rows,
        columns,
        autoDashboard,
        widgets: buildRecommendedWidgets(autoDashboard, columns, s.rows),
      };
    });

  const syncMonitoredFile = async (dashboardId: string, file: File) => {
    const sheets = buildImportedSheets(await readWorkbook(file));
    const currentDashboard = dashboardsRef.current.find((d) => d.id === dashboardId);
    if (!currentDashboard) return;
    const merged = mergeReimportedSheets(currentDashboard.sheets, sheets).map((nextSheet) => {
      const previous = currentDashboard.sheets.find((oldSheet) => oldSheet.name === nextSheet.name);
      return previous ? { ...nextSheet, filters: previous.filters } : nextSheet;
    });
    persist(
      dashboardsRef.current.map((dashboard) =>
        dashboard.id === dashboardId
          ? {
              ...dashboard,
              sheets: merged,
              activeSheetIndex: Math.min(dashboard.activeSheetIndex, merged.length - 1),
              updatedAt: Date.now(),
            }
          : dashboard,
      ),
    );
  };

  const stopFolderMonitor = (dashboardId: string, forget = false) => {
    const runtime = folderRuntimes.current.get(dashboardId);
    if (runtime) {
      runtime.active = false;
      clearInterval(runtime.timer);
    }
    folderRuntimes.current.delete(dashboardId);
    setFolderMonitors((current) => {
      const next = { ...current };
      delete next[dashboardId];
      return next;
    });
    if (forget) {
      void removeFolderMonitor(dashboardId);
      persist(
        dashboardsRef.current.map((dashboard) => {
          if (dashboard.id !== dashboardId) return dashboard;
          const { folderMonitor: _folderMonitor, ...withoutMonitor } = dashboard;
          return { ...withoutMonitor, updatedAt: Date.now() };
        }),
      );
    }
  };

  const startFolderMonitor = (
    dashboardId: string,
    selection: FolderWorkbookSelection,
    resume?: { lastSyncedAt: number; fingerprint?: FileFingerprint },
  ) => {
    stopFolderMonitor(dashboardId);
    const runtime = {
      directory: selection.directory,
      fileName: selection.file.name,
      // Sem fingerprint salvo (registro antigo), fileChanged força uma
      // leitura completa no primeiro ciclo após o F5.
      fingerprint: resume ? resume.fingerprint : fingerprint(selection.file),
      workbookNames: selection.workbookNames,
      lastSyncedAt: resume?.lastSyncedAt ?? Date.now(),
      timer: undefined as unknown as ReturnType<typeof setInterval>,
      syncing: false,
      errored: false,
      active: true,
      check: async () => {},
    };

    const persistSnapshot = (snapshot: FolderMonitorView) => {
      if (!runtime.active) return;
      setFolderMonitors((current) => ({ ...current, [dashboardId]: snapshot }));
      persist(
        dashboardsRef.current.map((dashboard) =>
          dashboard.id === dashboardId
            ? { ...dashboard, folderMonitor: snapshot, updatedAt: Date.now() }
            : dashboard,
        ),
      );
      void saveFolderMonitor(dashboardId, {
        directory: runtime.directory,
        fileName: runtime.fileName,
        snapshot,
        ...(runtime.fingerprint ? { fingerprint: runtime.fingerprint } : {}),
      });
    };
    const snapshot = (status: FolderMonitorView["status"], error?: string): FolderMonitorView => ({
      folderName: runtime.directory.name,
      fileName: runtime.fileName,
      fileCount: runtime.workbookNames.length,
      fileNames: runtime.workbookNames,
      status,
      lastSyncedAt: runtime.lastSyncedAt,
      ...(error ? { error } : {}),
    });

    runtime.check = async () => {
      if (runtime.syncing || !runtime.active) return;
      runtime.syncing = true;
      try {
        const listed = await listSupportedWorkbooks(runtime.directory);
        if (!runtime.active) return;
        const workbookNames = listed.length ? listed : [runtime.fileName];
        const namesChanged = workbookNames.join("\n") !== runtime.workbookNames.join("\n");
        runtime.workbookNames = workbookNames;
        const handle = await runtime.directory.getFileHandle(runtime.fileName);
        const file = await handle.getFile();
        const changed = fileChanged(runtime.fingerprint, file);
        if (changed) {
          setFolderMonitors((current) => ({
            ...current,
            [dashboardId]: { ...(current[dashboardId] ?? snapshot("watching")), status: "syncing" },
          }));
          await syncMonitoredFile(dashboardId, file);
          if (!runtime.active) return;
          runtime.fingerprint = fingerprint(file);
          runtime.lastSyncedAt = Date.now();
        }
        if (changed || namesChanged || runtime.errored) persistSnapshot(snapshot("watching"));
        runtime.errored = false;
        if (changed) toast.success(`${runtime.fileName} foi atualizado automaticamente.`);
      } catch {
        runtime.errored = true;
        persistSnapshot(
          snapshot(
            "error",
            "Não foi possível ler a planilha. Verifique se ela ainda existe na pasta.",
          ),
        );
      } finally {
        runtime.syncing = false;
      }
    };

    persistSnapshot(snapshot("watching"));
    runtime.timer = setInterval(() => void runtime.check(), FOLDER_MONITOR_INTERVAL_MS);
    folderRuntimes.current.set(dashboardId, runtime);
    void runtime.check();
  };

  const ensureFolderFilesWidget = (dashboardId: string) => {
    const list = dashboardsRef.current;
    const dashboard = list.find((item) => item.id === dashboardId);
    if (!dashboard) return;
    const sheetIndex = Math.min(dashboard.activeSheetIndex, dashboard.sheets.length - 1);
    const sheet = dashboard.sheets[sheetIndex];
    if (!sheet) return;
    const widgets =
      sheet.widgets ?? buildDefaultWidgets(sheet.columns, sheet.chartConfig, sheet.rows);
    if (widgets.some((widget) => widget.type === "folder-files")) return;
    persist(
      list.map((item) =>
        item.id === dashboardId
          ? {
              ...item,
              sheets: item.sheets.map((candidate, index) =>
                index === sheetIndex
                  ? { ...candidate, widgets: [...widgets, createWidget("folder-files", [])] }
                  : candidate,
              ),
              updatedAt: Date.now(),
            }
          : item,
      ),
    );
  };

  const connectFolder = async (dashboardId?: string) => {
    setImportError(null);
    try {
      // Depois de um F5, tenta primeiro reutilizar o handle estruturado que
      // já está no IndexedDB. Se o navegador exigir novo consentimento, esta
      // função foi disparada por clique e pode chamar requestPermission sem
      // obrigar o usuário a escolher a pasta e a planilha outra vez.
      if (dashboardId) {
        const stored = await loadFolderMonitor(dashboardId);
        if (stored) {
          try {
            let permission = stored.directory.queryPermission
              ? await stored.directory.queryPermission({ mode: "read" })
              : "granted";
            if (permission !== "granted" && stored.directory.requestPermission) {
              permission = await stored.directory.requestPermission({ mode: "read" });
            }
            if (permission === "granted") {
              const handle = await stored.directory.getFileHandle(stored.fileName);
              const file = await handle.getFile();
              const listed = await listSupportedWorkbooks(stored.directory);
              startFolderMonitor(
                dashboardId,
                {
                  directory: stored.directory,
                  handle,
                  file,
                  workbookNames: listed.length ? listed : stored.snapshot.fileNames,
                },
                {
                  lastSyncedAt: stored.snapshot.lastSyncedAt,
                  ...(stored.fingerprint ? { fingerprint: stored.fingerprint } : {}),
                },
              );
              ensureFolderFilesWidget(dashboardId);
              toast.success("Monitoramento retomado. Conferindo a planilha agora…");
              return;
            }
            const message = "A leitura da pasta não foi autorizada pelo navegador.";
            setFolderMonitors((current) => ({
              ...current,
              [dashboardId]: { ...stored.snapshot, status: "error", error: message },
            }));
            toast.error(message);
            return;
          } catch {
            // Handle antigo indisponível: abre o seletor abaixo para trocar
            // ou reconectar a fonte, preservando o registro se houver cancelamento.
          }
        }
      }
      const selection = await pickFolderWorkbook(window);
      if (dashboardId) {
        setFolderMonitors((current) => ({
          ...current,
          [dashboardId]: {
            folderName: selection.directory.name,
            fileName: selection.file.name,
            fileCount: selection.workbookNames.length,
            fileNames: selection.workbookNames,
            status: "syncing",
            lastSyncedAt: Date.now(),
          },
        }));
        await syncMonitoredFile(dashboardId, selection.file);
        startFolderMonitor(dashboardId, selection);
        ensureFolderFilesWidget(dashboardId);
        toast.success("Pasta conectada. O Oli acompanhará alterações enquanto estiver aberto.");
      } else {
        pendingFolderSelection.current = selection;
        setReviewTarget("new");
        await parse(selection.file);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (dashboardId) stopFolderMonitor(dashboardId, true);
      const message =
        error instanceof Error && error.message === "unsupported"
          ? "O monitoramento de pasta requer Chrome ou Edge atualizado."
          : "Não foi possível conectar essa pasta ou planilha.";
      setImportError(message);
      toast.error(message);
    }
  };

  useEffect(() => {
    if (!ready || restoredFolderMonitors.current) return;
    restoredFolderMonitors.current = true;
    void (async () => {
      for (const dashboard of dashboardsRef.current) {
        const stored = await loadFolderMonitor(dashboard.id);
        if (!stored) {
          if (dashboard.folderMonitor) {
            setFolderMonitors((current) => ({
              ...current,
              [dashboard.id]: {
                ...dashboard.folderMonitor!,
                status: "error",
                error: "Reconecte a pasta uma vez para reativar a leitura automática.",
              },
            }));
          }
          continue;
        }
        try {
          const permission = stored.directory.queryPermission
            ? await stored.directory.queryPermission({ mode: "read" })
            : "granted";
          if (permission !== "granted") {
            setFolderMonitors((current) => ({
              ...current,
              [dashboard.id]: {
                ...stored.snapshot,
                status: "error",
                error: "Autorize novamente a pasta pelo botão Monitorar pasta.",
              },
            }));
            continue;
          }
          const handle = await stored.directory.getFileHandle(stored.fileName);
          const file = await handle.getFile();
          const listed = await listSupportedWorkbooks(stored.directory);
          startFolderMonitor(
            dashboard.id,
            {
              directory: stored.directory,
              handle,
              file,
              workbookNames: listed.length ? listed : stored.snapshot.fileNames,
            },
            {
              lastSyncedAt: stored.snapshot.lastSyncedAt,
              ...(stored.fingerprint ? { fingerprint: stored.fingerprint } : {}),
            },
          );
        } catch {
          setFolderMonitors((current) => ({
            ...current,
            [dashboard.id]: {
              ...stored.snapshot,
              status: "error",
              error: "A pasta não está mais disponível. Conecte-a novamente.",
            },
          }));
        }
      }
    })();
    // A restauração deve ocorrer uma única vez após a carga local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const pasteData = () => {
    setImportError(null);
    setImportWarning(null);
    const wb = XLSX.read(paste, { type: "string" }),
      ws = wb.Sheets[wb.SheetNames[0] ?? ""];
    if (!ws) {
      setImportError("Não encontramos dados nesse texto colado.");
      return;
    }
    const { rows, warning } = sheetToRows(ws);
    if (!rows.length) {
      setImportError("Não encontramos linhas de dados nesse texto colado.");
      return;
    }
    setImportWarning(warning);
    prepare([{ name: "Dados", rows }], "Dados colados");
  };
  const sheet = async () => {
    const id = url.match(/\/d\/([^/]+)/)?.[1];
    if (!id) return;
    setLoading(true);
    setImportError(null);
    setImportWarning(null);
    try {
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`);
      if (!res.ok) throw new Error();
      const text = await res.text(),
        wb = XLSX.read(text, { type: "string" }),
        ws = wb.Sheets[wb.SheetNames[0] ?? ""];
      if (!ws) {
        setImportError("Não encontramos dados nessa planilha.");
        return;
      }
      const { rows, warning } = sheetToRows(ws);
      if (!rows.length) {
        setImportError("Essa planilha está vazia.");
        return;
      }
      setImportWarning(warning);
      prepare([{ name: "Dados", rows }], "Google Sheets");
    } catch {
      setImportError("A planilha precisa estar publicada para leitura.");
    } finally {
      setLoading(false);
    }
  };

  const confirmReview = () => {
    const sheets = reviewSheets.map((s) => {
      const autoDashboard = generateAutoDashboardPlan({
        columns: s.columns,
        rows: s.rows,
        ...(s.diagnostics ? { diagnostics: s.diagnostics } : {}),
      });
      return {
        name: s.name,
        rows: s.rows,
        columns: s.columns,
        autoDashboard,
        widgets: buildRecommendedWidgets(autoDashboard, s.columns, s.rows),
      };
    });
    if (reviewTarget === "new") {
      const dash: Dashboard = {
        id: crypto.randomUUID(),
        name: name.replace(/\.(csv|xlsx|xls)$/i, "") || "Painel sem nome",
        sheets: sheets.map((s) => ({ ...s, filters: [] })),
        activeSheetIndex: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
      };
      persist([dash, ...dashboards]);
      setCurrentId(dash.id);
      if (pendingFolderSelection.current) {
        startFolderMonitor(dash.id, pendingFolderSelection.current);
        ensureFolderFilesWidget(dash.id);
        pendingFolderSelection.current = null;
      }
      void navigate({ to: "/painel/$id", params: { id: dash.id } });
    } else {
      persist(
        dashboards.map((d) => {
          if (d.id !== reviewTarget) return d;
          return {
            ...d,
            sheets: mergeReimportedSheets(d.sheets, sheets),
            activeSheetIndex: 0,
            updatedAt: Date.now(),
          };
        }),
      );
      setCurrentId(reviewTarget);
      void navigate({ to: "/painel/$id", params: { id: reviewTarget } });
    }
    setStage("dashboard");
  };

  const current = dashboards.find((d) => d.id === currentId) ?? null;
  const updateCurrent = (patch: Partial<Dashboard>) => {
    if (!currentId) return;
    persist(
      dashboards.map((d) => (d.id === currentId ? { ...d, ...patch, updatedAt: Date.now() } : d)),
    );
  };
  const openDash = (id: string) => {
    setCurrentId(id);
    setStage("dashboard");
    void navigate({ to: "/painel/$id", params: { id } });
  };
  const startNew = () => {
    pendingFolderSelection.current = null;
    setReviewTarget("new");
    setStage("empty");
  };
  const startReimport = (id: string) => {
    pendingFolderSelection.current = null;
    setReviewTarget(id);
    input.current?.click();
  };
  const backHome = () => {
    setCurrentId(null);
    setStage(dashboards.length ? "home" : "empty");
    void navigate({ to: "/" });
  };
  const duplicateDash = (id: string) => {
    const d = dashboards.find((x) => x.id === id);
    if (!d) return;
    const copy: Dashboard = {
      ...d,
      id: crypto.randomUUID(),
      name: `${d.name} (cópia)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
    };
    persist([copy, ...dashboards]);
  };
  const deleteDash = (id: string) => {
    const list = dashboards.filter((d) => d.id !== id);
    persist(list);
    if (currentId === id) {
      setCurrentId(null);
      setStage(list.length ? "home" : "empty");
      void navigate({ to: "/" });
    }
  };
  const togglePin = (id: string) =>
    persist(dashboards.map((d) => (d.id === id ? { ...d, pinned: !d.pinned } : d)));
  const renameDash = (id: string, newName: string) =>
    persist(
      dashboards.map((d) => (d.id === id ? { ...d, name: newName, updatedAt: Date.now() } : d)),
    );

  return (
    <TooltipProvider delayDuration={200}>
      <main className="min-h-screen bg-background text-foreground">
        <input
          ref={input}
          className="sr-only"
          type="file"
          accept={WORKBOOK_ACCEPT}
          onChange={(e) => {
            const f = e.target.files?.[0];
            pendingFolderSelection.current = null;
            // Sem isso, selecionar o MESMO arquivo de novo (comum ao
            // reimportar) não dispara onChange na segunda vez — o navegador
            // só considera que o valor do input "mudou" se o arquivo for
            // diferente do anterior. Limpar o valor logo após ler o
            // arquivo garante que selecionar o mesmo arquivo sempre reimporte
            // de verdade, em vez de silenciosamente não fazer nada.
            e.target.value = "";
            if (f) void parse(f);
          }}
        />
        {saveState !== "idle" && (
          <div
            role="status"
            className={cn(
              "fixed right-4 top-4 z-50 flex items-center gap-2 border px-3 py-1.5 text-xs font-mono",
              saveState === "warning"
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-secondary-accent bg-background text-secondary-accent",
            )}
          >
            {saveState === "warning" ? (
              <>
                <AlertTriangle className="size-3.5" />
                {saveWarning}
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                Salvo
              </>
            )}
          </div>
        )}
        {stage === "home" && (
          <Home
            dashboards={dashboards}
            openDash={openDash}
            newDash={startNew}
            duplicateDash={duplicateDash}
            deleteDash={deleteDash}
            togglePin={togglePin}
            theme={theme}
            toggleTheme={toggle}
          />
        )}
        {stage === "empty" && (
          <Empty
            onUpload={() => {
              pendingFolderSelection.current = null;
              input.current?.click();
            }}
            onDropFile={(f) => {
              pendingFolderSelection.current = null;
              void parse(f);
            }}
            onFolder={() => void connectFolder()}
            onDemo={() => {
              setReviewTarget("new");
              prepare([{ name: "Dados", rows: demo }], "vendas_2026.xlsx");
            }}
            url={url}
            setUrl={setUrl}
            sheet={() => void sheet()}
            loading={loading}
            loadingLabel={importProgressLabel}
            cancelImport={() => importAbort.current?.abort()}
            editor={editor}
            setEditor={setEditor}
            paste={paste}
            setPaste={setPaste}
            pasteData={pasteData}
            backHome={backHome}
            showBack={dashboards.length > 0}
            theme={theme}
            toggleTheme={toggle}
            importError={importError}
            privateMode={privateMode}
            togglePrivateMode={() => void togglePrivateMode()}
          />
        )}
        {stage === "review" && (
          <Review
            sheets={reviewSheets}
            activeIndex={reviewSheetIndex}
            setActiveIndex={setReviewSheetIndex}
            setColumns={(cols) =>
              setReviewSheets(
                reviewSheets.map((s, i) => (i === reviewSheetIndex ? { ...s, columns: cols } : s)),
              )
            }
            setRows={(rows) =>
              setReviewSheets(
                reviewSheets.map((s, i) =>
                  i === reviewSheetIndex ? { ...s, rows, columns: infer(rows) } : s,
                ),
              )
            }
            name={name}
            back={() => {
              pendingFolderSelection.current = null;
              setStage(reviewTarget === "new" ? "empty" : "dashboard");
            }}
            confirm={confirmReview}
            importWarning={importWarning}
          />
        )}
        {stage === "dashboard" && current && (
          <Dashboard
            dashboard={current}
            dashboards={dashboards}
            openDash={openDash}
            backHome={backHome}
            newDash={startNew}
            update={updateCurrent}
            rename={renameDash}
            reimport={() => startReimport(current.id)}
            folderMonitor={folderMonitors[current.id] ?? current.folderMonitor}
            connectFolder={() => void connectFolder(current.id)}
            disconnectFolder={() => stopFolderMonitor(current.id, true)}
            theme={theme}
            toggleTheme={toggle}
          />
        )}
        {stage === "dashboard" && onboardingStep !== null && (
          <Onboarding
            step={onboardingStep}
            setStep={setOnboardingStep}
            dismiss={dismissOnboarding}
          />
        )}
      </main>
    </TooltipProvider>
  );
}

const onboardingSteps = [
  {
    title: "Importe seus dados",
    text: "Envie Excel, CSV, ODS ou Numbers, cole uma URL de Google Sheets ou os dados diretamente. Tudo fica salvo neste navegador.",
  },
  {
    title: "Revise antes de confirmar",
    text: "Na etapa de revisão você confere o tipo de cada coluna, renomeia o que for preciso e ajusta antes de gerar o painel.",
  },
  {
    title: "Use a paleta de comandos",
    text: "Dentro de um painel, pressione ⌘K ou Ctrl+K a qualquer momento para buscar ações rapidamente, sem tirar as mãos do teclado.",
  },
];

/**
 * Seletor de aba, usado quando um workbook XLSX tem mais de uma aba com
 * dado. Reaproveitado tanto na importação principal (novo painel) quanto no
 * fluxo de "combinar planilha" dentro de um painel existente — ambos só
 * diferem no que fazem com a aba escolhida (`onConfirm`).
 */
function SheetPickerDialog({
  fileName,
  sheets,
  selected,
  onSelectedChange,
  onConfirm,
  onCancel,
}: {
  fileName: string;
  sheets: SheetOption[];
  selected: number;
  onSelectedChange: (i: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Escolher aba para importar</DialogTitle>
          <DialogDescription>
            {fileName} tem {sheets.length} abas com dado. Escolha qual você quer importar — o resto
            fica de fora por enquanto.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              className={cn(
                "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors",
                i === selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
              )}
              onClick={() => onSelectedChange(i)}
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-muted-foreground">{s.rows.length} linhas</span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={onConfirm}>Importar aba selecionada</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Onboarding({
  step,
  setStep,
  dismiss,
}: {
  step: number;
  setStep: (n: number) => void;
  dismiss: () => void;
}) {
  const current = onboardingSteps[step];
  if (!current) return null;
  const last = step === onboardingSteps.length - 1;
  return (
    <div
      role="dialog"
      aria-label="Boas-vindas ao Oli.Qualidade"
      className="fixed bottom-5 left-5 z-50 w-[min(20rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-panel"
    >
      <div className="flex items-center gap-1.5 px-4 pt-4" aria-hidden="true">
        {onboardingSteps.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= step ? "bg-primary" : "bg-muted",
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between px-4 pt-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Passo {step + 1} de {onboardingSteps.length}
        </span>
        <button
          aria-label="Fechar boas-vindas"
          onClick={dismiss}
          className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="p-4 pt-2.5">
        <h2 className="font-display text-sm font-semibold">{current.title}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{current.text}</p>
      </div>
      <div className="flex items-center justify-between border-t border-border bg-canvas/60 p-3">
        <button
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={dismiss}
        >
          Pular
        </button>
        <Button size="sm" onClick={() => (last ? dismiss() : setStep(step + 1))}>
          {last ? "Concluir" : "Próximo"}
        </Button>
      </div>
    </div>
  );
}

function Home(p: {
  dashboards: Dashboard[];
  openDash: (id: string) => void;
  newDash: () => void;
  duplicateDash: (id: string) => void;
  deleteDash: (id: string) => void;
  togglePin: (id: string) => void;
  theme: string;
  toggleTheme: () => void;
}) {
  const sorted = [...p.dashboards].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  );
  const [pendingDelete, setPendingDelete] = useState<Dashboard | null>(null);
  const totalRows = p.dashboards.reduce(
    (sum, d) => sum + d.sheets.reduce((s, sh) => s + sh.rows.length, 0),
    0,
  );
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="oliam-topbar sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Mark />
          <strong className="font-display text-lg tracking-tight">Oli.Qualidade</strong>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle theme={p.theme} toggle={p.toggleTheme} />
          <Button onClick={p.newDash} className="shadow-sm">
            <Plus />
            Novo painel
          </Button>
        </div>
      </header>
      <section className="relative flex-1 overflow-hidden">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 opacity-70"
          style={{
            background:
              "radial-gradient(60% 100% at 15% 0%, color-mix(in oklab, var(--primary) 16%, transparent), transparent), radial-gradient(45% 80% at 85% 10%, color-mix(in oklab, var(--secondary-accent) 14%, transparent), transparent)",
          }}
          aria-hidden="true"
        />
        <div className="mx-auto w-full max-w-6xl px-6 pb-14 pt-12">
          <div className="mb-9 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-primary shadow-sm">
                <span className="size-1.5 rounded-full bg-primary" />
                Seus painéis
              </p>
              <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                Escolha um painel para continuar
              </h1>
              <p className="mt-2.5 max-w-lg text-sm text-muted-foreground">
                Cada painel guarda seus próprios dados, filtros e gráficos, de forma independente.
              </p>
            </div>
            {sorted.length > 0 && (
              <div className="flex shrink-0 gap-3">
                <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
                  <p className="font-display text-xl font-semibold">{p.dashboards.length}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Painéis
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
                  <p className="font-display text-xl font-semibold">{fmt(totalRows, "number")}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Linhas ao todo
                  </p>
                </div>
              </div>
            )}
          </div>
          {sorted.length === 0 ? (
            <button className="oliam-dropzone w-full" onClick={p.newDash}>
              <Plus className="size-6 text-primary" />
              <strong>Criar seu primeiro painel</strong>
              <span className="text-sm text-muted-foreground">Envie uma planilha para começar</span>
            </button>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sorted.map((d, i) => (
                <article
                  key={d.id}
                  className="oliam-widget group relative bg-card"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <span
                    className="absolute inset-x-0 top-0 h-1"
                    style={{ background: hue(d.id) }}
                    aria-hidden="true"
                  />
                  <button
                    className="block w-full p-5 pt-6 text-left"
                    onClick={() => p.openDash(d.id)}
                  >
                    <span className="mb-4 flex items-center gap-2.5">
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-xl font-display text-sm font-semibold text-white"
                        style={{ background: hue(d.id) }}
                        aria-hidden="true"
                      >
                        {d.name.trim().charAt(0).toUpperCase() || "P"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {d.pinned && (
                            <Pin className="size-3 shrink-0 fill-primary text-primary" />
                          )}
                          <span className="truncate font-display text-base font-semibold">
                            {d.name}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          Atualizado em {new Date(d.updatedAt).toLocaleDateString("pt-BR")}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-2 border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
                      <span className="rounded-md bg-muted px-1.5 py-0.5">
                        {d.sheets.reduce((s, sh) => s + sh.rows.length, 0)} linhas
                      </span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5">
                        {d.sheets.reduce((s, sh) => s + sh.columns.length, 0)} colunas
                      </span>
                      {d.sheets.length > 1 && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5">
                          {d.sheets.length} abas
                        </span>
                      )}
                    </span>
                  </button>
                  <div className="absolute right-2 top-3.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 bg-card/80 backdrop-blur-sm"
                      aria-label={d.pinned ? "Desafixar painel" : "Fixar painel"}
                      onClick={() => p.togglePin(d.id)}
                    >
                      <Pin className={cn("size-3.5", d.pinned && "fill-primary text-primary")} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 bg-card/80 backdrop-blur-sm"
                      aria-label="Duplicar painel"
                      onClick={() => p.duplicateDash(d.id)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 bg-card/80 backdrop-blur-sm"
                      aria-label="Excluir painel"
                      onClick={() => setPendingDelete(d)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação não pode ser desfeita. Os dados, filtros e gráficos desse painel serão
              apagados permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) p.deleteDash(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Excluir painel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OliLoader({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn("oliam-loader-wrap", compact && "is-compact")}
      role="status"
      aria-label="Carregando"
    >
      <div className="oli-typewriter" aria-hidden="true">
        <span className="oli-typewriter-slide">
          <i />
        </span>
        <span className="oli-typewriter-paper" />
        <span className="oli-typewriter-keyboard" />
      </div>
    </div>
  );
}

function OliWelcomeScene({ busy }: { busy: boolean }) {
  return (
    <div
      className="oli-welcome-scene oli-welcome-wordmark"
      data-busy={busy || undefined}
      role="img"
      aria-label="Oli.Qualidade"
    >
      <span className="oli-wordmark-ball" aria-hidden="true">
        <svg viewBox="0 0 440 420" focusable="false">
          <path
            className="oli-wordmark-outline"
            d="M58 210C53 129 106 60 198 45C286 30 365 75 383 160C403 253 369 330 289 365C210 399 113 374 76 308C59 278 54 244 58 210Z"
          />
          <path className="oli-wordmark-eye" d="M143 137C149 166 163 176 177 143" />
          <path className="oli-wordmark-eye" d="M215 126C219 158 235 168 248 132" />
          <path className="oli-wordmark-smile" d="M121 195C167 234 248 240 300 188" />
        </svg>
      </span>
      <span className="oli-wordmark-name" aria-hidden="true">
        li.Qualidade
      </span>
    </div>
  );
}

function Empty(p: {
  onUpload: () => void;
  onDropFile: (file: File) => void;
  onFolder: () => void;
  onDemo: () => void;
  url: string;
  setUrl: (v: string) => void;
  sheet: () => void;
  loading: boolean;
  loadingLabel: string | null;
  cancelImport: () => void;
  editor: boolean;
  setEditor: (v: boolean) => void;
  paste: string;
  setPaste: (v: string) => void;
  pasteData: () => void;
  backHome: () => void;
  showBack: boolean;
  theme: string;
  toggleTheme: () => void;
  importError: string | null;
  privateMode: boolean;
  togglePrivateMode: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (p.loading) return;
    dragCounter.current += 1;
    setDragging(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (p.loading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) p.onDropFile(file);
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-canvas">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] opacity-70"
        style={{
          background:
            "radial-gradient(50% 90% at 20% 0%, color-mix(in oklab, var(--primary) 16%, transparent), transparent), radial-gradient(40% 70% at 90% 15%, color-mix(in oklab, var(--secondary-accent) 14%, transparent), transparent)",
        }}
        aria-hidden="true"
      />
      <header className="oliam-topbar">
        <div className="flex items-center gap-3">
          {p.showBack && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Voltar aos painéis"
              onClick={p.backHome}
            >
              <ChevronLeft />
            </Button>
          )}
          <Mark />
          <strong className="font-display text-lg tracking-tight">Oli.Qualidade</strong>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            BI para dados que precisam fechar
          </span>
          <ThemeToggle theme={p.theme} toggle={p.toggleTheme} />
        </div>
      </header>
      <main className="oli-welcome">
        <section className="oli-welcome-hero">
          <div className="oli-welcome-copy">
            <p className="oli-welcome-badge">Novo painel</p>
            <h1 className="sr-only">Oli.Qualidade</h1>
            <OliWelcomeScene busy={p.loading} />
            <p className="oli-welcome-lead">
              Importe uma planilha e transforme as informações em um painel simples de acompanhar.
            </p>
          </div>
        </section>

        <section className="oli-import-shell">
          <div className="oli-import-heading">
            <div>
              <span className="oli-import-kicker">Importar dados</span>
              <h2>Escolha uma planilha</h2>
            </div>
            <div className="oli-file-types" aria-label="Formatos aceitos">
              <span>XLSX</span>
              <span>CSV</span>
              <span>XLS</span>
              <span>ODS</span>
              <span>XLSB</span>
            </div>
          </div>
          <button
            type="button"
            className="oli-welcome-dropzone"
            data-dragging={dragging}
            onClick={p.onUpload}
            disabled={p.loading}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {p.loading ? (
              <>
                <OliLoader />
                <span className="oli-dropzone-copy">
                  <strong>{p.loadingLabel ?? "Lendo sua planilha…"}</strong>
                  <small>Preparando seus dados.</small>
                </span>
              </>
            ) : (
              <>
                <span className="oli-upload-orbit">
                  <Upload />
                  <i />
                </span>
                <span className="oli-dropzone-copy">
                  <strong>{dragging ? "Solte o arquivo aqui" : "Arraste sua planilha aqui"}</strong>
                  <small>ou clique para escolher um arquivo no computador</small>
                </span>
                <span className="oli-dropzone-action">Escolher arquivo</span>
              </>
            )}
          </button>
          {p.loading && (
            <div className="mt-3 flex justify-center">
              <Button type="button" variant="outline" size="sm" onClick={p.cancelImport}>
                Cancelar importação
              </Button>
            </div>
          )}
          {p.importError && (
            <p className="oli-import-error">
              <AlertTriangle />
              {p.importError}
            </p>
          )}
          <div className="oli-import-privacy">
            <ShieldAlert />
            <span>
              <strong>Seus dados ficam com você.</strong> O processamento acontece no navegador.
              <button
                type="button"
                className="ml-2 underline underline-offset-2"
                onClick={p.togglePrivateMode}
              >
                {p.privateMode ? "Modo privado ligado" : "Ativar modo privado"}
              </button>
            </span>
          </div>

          <div className="oli-import-divider">
            <span>ou importe de outro jeito</span>
          </div>
          <div className="oli-import-options">
            <button
              type="button"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(!sheetOpen)}
            >
              <span>
                <SheetIcon />
              </span>
              <div>
                <strong>Google Sheets</strong>
                <small>Conecte uma planilha pública</small>
              </div>
              <ChevronDown className={cn(sheetOpen && "rotate-180")} />
            </button>
            <button type="button" aria-expanded={p.editor} onClick={() => p.setEditor(!p.editor)}>
              <span>
                <ClipboardPaste />
              </span>
              <div>
                <strong>Colar dados</strong>
                <small>Copie direto do Excel</small>
              </div>
              <ChevronDown className={cn(p.editor && "rotate-180")} />
            </button>
            <button type="button" onClick={p.onFolder}>
              <span>
                <FolderSync />
              </span>
              <div>
                <strong>Pasta monitorada</strong>
                <small>Atualização automática</small>
              </div>
              <ArrowRight />
            </button>
            <button type="button" onClick={p.onDemo}>
              <span>
                <Play />
              </span>
              <div>
                <strong>Ver demonstração</strong>
                <small>Explore dados de exemplo</small>
              </div>
              <ArrowRight />
            </button>
          </div>
          {sheetOpen && (
            <div className="oli-import-expand">
              <label>Link público do Google Sheets</label>
              <div>
                <input
                  className="oliam-input"
                  placeholder="Cole o link da planilha"
                  value={p.url}
                  onChange={(e) => p.setUrl(e.target.value)}
                />
                <Button variant="outline" disabled={!p.url || p.loading} onClick={p.sheet}>
                  {p.loading ? "Lendo…" : "Conectar"}
                </Button>
              </div>
              <p>A planilha precisa estar publicada para leitura na Web.</p>
            </div>
          )}
          {p.editor && (
            <div className="oli-import-expand">
              <label>Dados copiados</label>
              <textarea
                className="oliam-input"
                placeholder="Cole dados separados por tabulação ou vírgula, copiados direto do Excel…"
                value={p.paste}
                onChange={(e) => p.setPaste(e.target.value)}
              />
              <div className="text-right">
                <Button disabled={!p.paste} onClick={p.pasteData}>
                  Revisar dados
                </Button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function ImportWorkbench({
  rows,
  columns,
  diagnostics,
  sourceGrid,
  audit,
  selection,
  setSelection,
  apply,
  undo,
  canUndo,
  saveProfile,
}: {
  rows: Row[];
  columns: Column[];
  diagnostics?: ImportDiagnostics;
  sourceGrid?: SourceGrid;
  audit?: ImportAudit;
  selection: ImportSelection;
  setSelection: (selection: ImportSelection) => void;
  apply: () => void;
  undo: () => void;
  canUndo: boolean;
  saveProfile: () => void;
}) {
  const [tab, setTab] = useState<"preview" | "health">("preview");
  const previewRows = rows.slice(0, 30);
  const previewColumns = columns.slice(0, 12);
  const sourceSelection = selection.source;
  const sourceRows = sourceGrid?.rows.slice(0, 30) ?? [];
  const sourceColumnCount = Math.min(12, sourceGrid?.rows[0]?.length ?? 0);
  const health = diagnostics ? buildSheetHealth(diagnostics) : null;
  const columnDiagnostic = (key: string) => diagnostics?.columns.find((item) => item.key === key);
  const ignored = new Set(selection.ignoredColumns);
  const toggleColumn = (key: string) =>
    setSelection({
      ...selection,
      ignoredColumns: ignored.has(key)
        ? selection.ignoredColumns.filter((item) => item !== key)
        : [...selection.ignoredColumns, key],
    });
  const columnLetter = (column: number) => {
    let value = column;
    let label = "";
    while (value > 0) {
      value--;
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }
    return label;
  };
  const enableSourceSelection = () => {
    if (!sourceGrid) return;
    const headerRow = Math.min(
      sourceGrid.startRow + sourceGrid.rows.length - 1,
      sourceGrid.startRow + Math.max(0, (diagnostics?.header.row ?? 1) - 1),
    );
    setSelection({
      ...selection,
      startRow: 1,
      endRow: Math.max(1, sourceGrid.rows.length - 1),
      ignoredColumns: [],
      source: {
        headerRow,
        startRow: Math.min(headerRow + 1, sourceGrid.startRow + sourceGrid.rows.length - 1),
        endRow: sourceGrid.startRow + sourceGrid.rows.length - 1,
        startColumn: sourceGrid.startColumn,
        endColumn: sourceGrid.startColumn + Math.max(0, sourceColumnCount - 1),
      },
    });
  };

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2 font-medium text-sm">
            <SheetIcon className="size-4 text-primary" /> Bancada de importação
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Veja o que foi interpretado e corrija a região antes de criar o relatório.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <Button
            size="sm"
            variant={tab === "preview" ? "default" : "ghost"}
            onClick={() => setTab("preview")}
          >
            Prévia visual
          </Button>
          <Button
            size="sm"
            variant={tab === "health" ? "default" : "ghost"}
            onClick={() => setTab("health")}
            disabled={!health}
          >
            Saúde da planilha
          </Button>
        </div>
      </div>
      {tab === "preview" ? (
        <div className="p-4">
          <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span>
              <i className="mr-1 inline-block size-2.5 rounded-sm bg-blue-500" />
              cabeçalho
            </span>
            <span>
              <i className="mr-1 inline-block size-2.5 rounded-sm bg-emerald-500" />
              válido
            </span>
            <span>
              <i className="mr-1 inline-block size-2.5 rounded-sm bg-amber-400" />
              revisar
            </span>
            <span>
              <i className="mr-1 inline-block size-2.5 rounded-sm bg-red-500" />
              possível perda
            </span>
            <span>
              <i className="mr-1 inline-block size-2.5 rounded-sm bg-slate-400" />
              ignorado
            </span>
          </div>
          <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]">
            {sourceGrid && (
              <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={sourceSelection ? "default" : "outline"}
                  onClick={
                    sourceSelection
                      ? () => setSelection(defaultSelection(rows))
                      : enableSourceSelection
                  }
                >
                  {sourceSelection ? "Voltar à leitura automática" : "Selecionar na grade original"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Origem: {sourceGrid.totalRows} linhas × {sourceGrid.totalColumns} colunas
                  {(sourceGrid.truncatedRows || sourceGrid.truncatedColumns) &&
                    " · a prévia foi limitada por segurança"}
                </span>
              </div>
            )}
            {sourceSelection ? (
              <>
                {(
                  [
                    ["Cabeçalho", "headerRow"],
                    ["Primeira linha de dados", "startRow"],
                    ["Última linha de dados", "endRow"],
                    ["Primeira coluna", "startColumn"],
                    ["Última coluna", "endColumn"],
                  ] as const
                ).map(([label, key]) => (
                  <label key={key} className="text-xs text-muted-foreground">
                    {label}
                    <input
                      className="oliam-input mt-1"
                      type="number"
                      value={sourceSelection[key]}
                      onChange={(event) =>
                        setSelection({
                          ...selection,
                          source: {
                            ...sourceSelection,
                            [key]: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </>
            ) : (
              <>
                <label className="text-xs text-muted-foreground">
                  Primeira linha
                  <input
                    className="oliam-input mt-1"
                    type="number"
                    min={1}
                    max={rows.length}
                    value={selection.startRow}
                    onChange={(event) =>
                      setSelection({ ...selection, startRow: Number(event.target.value) || 1 })
                    }
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Última linha
                  <input
                    className="oliam-input mt-1"
                    type="number"
                    min={selection.startRow}
                    max={rows.length}
                    value={selection.endRow}
                    onChange={(event) =>
                      setSelection({
                        ...selection,
                        endRow: Number(event.target.value) || rows.length,
                      })
                    }
                  />
                </label>
              </>
            )}
            <Button className="self-end" variant="outline" onClick={saveProfile}>
              Salvar perfil
            </Button>
            <div className="flex self-end gap-2">
              <Button variant="ghost" onClick={undo} disabled={!canUndo}>
                <Undo2 className="size-4" /> Desfazer
              </Button>
              <Button onClick={apply}>
                <Check className="size-4" /> Aplicar seleção
              </Button>
            </div>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            {sourceSelection
              ? "Ajuste as coordenadas para escolher exatamente o cabeçalho e a tabela original."
              : "Clique no nome de uma coluna para incluí-la ou ignorá-la."}
          </p>
          <div className="max-h-[25rem] w-full overflow-auto rounded-xl border border-border">
            <table className="min-w-max border-collapse text-xs">
              {sourceSelection && sourceGrid ? (
                <>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="border border-blue-300 bg-blue-600 px-2 py-2 text-white">#</th>
                      {Array.from({ length: sourceColumnCount }, (_, index) => {
                        const absoluteColumn = sourceGrid.startColumn + index;
                        const selected =
                          absoluteColumn >= sourceSelection.startColumn &&
                          absoluteColumn <= sourceSelection.endColumn;
                        return (
                          <th
                            key={absoluteColumn}
                            className={cn(
                              "border px-3 py-2 text-white",
                              selected
                                ? "border-blue-300 bg-blue-600"
                                : "border-slate-400 bg-slate-500",
                            )}
                          >
                            {columnLetter(absoluteColumn)}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sourceRows.map((row, index) => {
                      const absoluteRow = sourceGrid.startRow + index;
                      const isHeader = absoluteRow === sourceSelection.headerRow;
                      const selectedRow =
                        absoluteRow >= sourceSelection.startRow &&
                        absoluteRow <= sourceSelection.endRow;
                      return (
                        <tr key={absoluteRow}>
                          <th
                            className={cn(
                              "border px-2 py-1.5 font-mono",
                              isHeader
                                ? "border-blue-300 bg-blue-600 text-white"
                                : selectedRow
                                  ? "border-border bg-muted"
                                  : "border-border bg-slate-200 text-slate-500 dark:bg-slate-800",
                            )}
                          >
                            {absoluteRow}
                          </th>
                          {Array.from({ length: sourceColumnCount }, (_, columnIndex) => {
                            const absoluteColumn = sourceGrid.startColumn + columnIndex;
                            const selectedColumn =
                              absoluteColumn >= sourceSelection.startColumn &&
                              absoluteColumn <= sourceSelection.endColumn;
                            return (
                              <td
                                key={absoluteColumn}
                                className={cn(
                                  "max-w-56 truncate border border-border px-3 py-1.5",
                                  isHeader && selectedColumn
                                    ? "bg-blue-500/20 font-medium"
                                    : selectedRow && selectedColumn
                                      ? "bg-emerald-500/10"
                                      : "bg-slate-100 text-slate-400 dark:bg-slate-900",
                                )}
                                title={String(row[columnIndex] ?? "")}
                              >
                                {String(row[columnIndex] ?? "") || "—"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </>
              ) : (
                <>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="border border-blue-300 bg-blue-600 px-2 py-2 text-white">#</th>
                      {previewColumns.map((column) => (
                        <th
                          key={column.key}
                          className={cn(
                            "border px-3 py-2 text-left text-white",
                            ignored.has(column.key)
                              ? "border-slate-400 bg-slate-500"
                              : "border-blue-300 bg-blue-600",
                          )}
                        >
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() => toggleColumn(column.key)}
                          >
                            {column.label}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, rowIndex) => {
                      const outside =
                        rowIndex + 1 < selection.startRow || rowIndex + 1 > selection.endRow;
                      return (
                        <tr key={rowIndex}>
                          <th
                            className={cn(
                              "border border-border px-2 py-1.5 font-mono",
                              outside
                                ? "bg-slate-200 text-slate-500 dark:bg-slate-800"
                                : "bg-muted",
                            )}
                          >
                            {rowIndex + 1}
                          </th>
                          {previewColumns.map((column) => {
                            const value = row[column.key];
                            const diagnostic = columnDiagnostic(column.key);
                            const problem =
                              value == null || value === "" || Boolean(diagnostic?.warnings.length);
                            const danger = (diagnostic?.qualityScore ?? 100) < 50;
                            return (
                              <td
                                key={column.key}
                                className={cn(
                                  "max-w-56 truncate border border-border px-3 py-1.5",
                                  outside || ignored.has(column.key)
                                    ? "bg-slate-100 text-slate-400 dark:bg-slate-900"
                                    : danger
                                      ? "bg-red-500/15"
                                      : problem
                                        ? "bg-amber-400/15"
                                        : "bg-emerald-500/10",
                                )}
                                title={String(value ?? "")}
                              >
                                {fmt(value ?? null, column.kind) ?? "—"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </>
              )}
            </table>
          </div>
          {(rows.length > 30 || columns.length > 12) && (
            <p className="mt-2 text-xs text-muted-foreground">
              Prévia limitada a 30 linhas e 12 colunas para manter a navegação rápida. A seleção é
              aplicada ao arquivo completo.
            </p>
          )}
        </div>
      ) : health ? (
        <div className="p-4">
          {diagnostics && (
            <div className="mb-4 grid gap-3 md:grid-cols-[1.2fr_1fr]">
              <div className="rounded-xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">Leitura estrutural</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      O Oli mostra a interpretação e os pontos que ainda exigem confirmação.
                    </p>
                  </div>
                  <span className="rounded-full border border-primary/25 bg-primary/8 px-2.5 py-1 text-xs font-medium text-primary">
                    {diagnostics.structuralClassification?.type ?? "tabela"} ·{" "}
                    {diagnostics.interpretationScore ?? diagnostics.confidence}%
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-muted/50 p-2">
                    <strong className="block text-base">
                      {diagnostics.readerDivergences?.length ?? 0}
                    </strong>
                    divergências
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <strong className="block text-base">{diagnostics.formulaCells}</strong>
                    fórmulas
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <strong className="block text-base">
                      {diagnostics.qualityAudit?.intentionalBlankCells ?? 0}
                    </strong>
                    vazios legítimos
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-background p-4">
                <div className="text-sm font-medium">Decisão da importação</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {diagnostics.confidence >= 85 && !(diagnostics.readerDivergences?.length ?? 0)
                    ? "Estrutura consistente. Você pode confirmar ou revisar a grade original."
                    : "Há pontos de atenção. Revise as células marcadas antes de confirmar."}
                </p>
                {diagnostics.formulaDiagnostics.length > 0 && (
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {diagnostics.formulaDiagnostics.slice(0, 3).map((formula, index) => (
                      <li key={`${formula.address}-${index}`}>
                        • {formula.address}: {formula.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          {audit && (
            <div className="mb-4 rounded-xl border border-border bg-background p-4">
              <div className="text-sm font-medium">Balanço verificável da importação</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Contagens objetivas do arquivo, sem tratar expansões ou cabeçalhos como perda.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Células preenchidas na origem", audit.sourceNonEmptyCells],
                  ["Células preenchidas na saída", audit.outputNonEmptyCells],
                  ["Fórmulas recuperadas", audit.formulaCellsRecovered],
                  ["Mesclagens expandidas", audit.mergedCellsExpanded],
                  ["Números convertidos", audit.numericCellsConverted],
                  ["Linhas acima do cabeçalho", audit.rowsAboveHeaderIgnored],
                  ["Linhas vazias ignoradas", audit.blankRowsIgnored],
                  ["Rodapés/colunas ignorados", audit.trailingRowsIgnored + audit.columnsIgnored],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg border border-border px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <strong className="font-display text-lg">{value}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Compatibilidade", health.compatibility],
              ["Confiança estrutural", health.structuralConfidence],
              ["Qualidade", health.dataQuality],
              ["Completude", health.completeness],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-xl border border-border bg-background p-3"
              >
                <div className="text-xs text-muted-foreground">{label}</div>
                <strong className="font-display text-2xl">{value}%</strong>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border p-3 text-sm">
              <strong>{health.duplicateRows}</strong>
              <span className="ml-2 text-muted-foreground">duplicações</span>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm">
              <strong>{health.brokenFormulas}</strong>
              <span className="ml-2 text-muted-foreground">fórmulas incompatíveis</span>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm">
              <strong>{health.anomalies}</strong>
              <span className="ml-2 text-muted-foreground">anomalias</span>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-border bg-background p-4">
            <div className="text-sm font-medium">Recomendações para o arquivo original</div>
            {health.recommendations.length ? (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {health.recommendations.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-emerald-600">
                Nenhuma correção estrutural urgente foi encontrada.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Review(p: {
  sheets: {
    name: string;
    rows: Row[];
    columns: Column[];
    diagnostics?: ImportDiagnostics;
    sourceGrid?: SourceGrid;
    audit?: ImportAudit;
  }[];
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  setColumns: (c: Column[]) => void;
  setRows: (rows: Row[]) => void;
  name: string;
  back: () => void;
  confirm: () => void;
  importWarning: string | null;
}) {
  const [lowConfidenceConfirmed, setLowConfidenceConfirmed] = useState(false);
  const active = p.sheets[p.activeIndex] ?? p.sheets[0];
  const rows = useMemo(() => active?.rows ?? [], [active]);
  const columns = useMemo(() => active?.columns ?? [], [active?.columns]);
  const [selection, setSelection] = useState<ImportSelection>(() => defaultSelection(rows));
  const [undoRows, setUndoRows] = useState<Row[] | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [smartAnalysis, setSmartAnalysis] = useState<SmartImportAnalysis | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartError, setSmartError] = useState<string | null>(null);
  const [smartCached, setSmartCached] = useState(false);
  const [appliedSmartSuggestions, setAppliedSmartSuggestions] = useState<Set<string>>(new Set());
  const autoAnalyzedSheets = useRef(new Set<string>());
  const smartInput = useMemo(
    () =>
      active?.diagnostics
        ? buildSmartImportInput(p.name, active.name, columns, active.diagnostics)
        : null,
    [active?.diagnostics, active?.name, columns, p.name],
  );
  const runSmartAnalysis = useCallback(
    async (force = false) => {
      if (!smartInput || smartLoading) return;
      setSmartLoading(true);
      setSmartError(null);
      try {
        const result = await analyzeImportWithAi(smartInput, { force });
        setSmartAnalysis(result.analysis);
        setSmartCached(result.cached);
      } catch (error) {
        setSmartError(error instanceof Error ? error.message : "Análise inteligente indisponível.");
      } finally {
        setSmartLoading(false);
      }
    },
    [smartInput, smartLoading],
  );
  useEffect(() => {
    setSmartAnalysis(null);
    setSmartError(null);
    setSmartCached(false);
    setAppliedSmartSuggestions(new Set());
  }, [p.activeIndex]);
  useEffect(() => {
    if (!active?.diagnostics || !smartInput) return;
    const needsAiHelp =
      active.diagnostics.confidence < 80 ||
      active.diagnostics.header.confidence < 0.75 ||
      active.diagnostics.tableRegions.length > 1;
    const sheetKey = `${p.activeIndex}:${active.name}`;
    if (!needsAiHelp || autoAnalyzedSheets.current.has(sheetKey)) return;
    const fingerprint = smartImportFingerprint(smartInput);
    autoAnalyzedSheets.current.add(sheetKey);
    if (markSmartImportAutoAnalysis(fingerprint)) void runSmartAnalysis();
  }, [active?.diagnostics, active?.name, p.activeIndex, runSmartAnalysis, smartInput]);
  useEffect(() => {
    const match = matchingImportProfile(rows, p.name, active?.sourceGrid);
    setSelection(match?.selection ?? defaultSelection(rows));
    if (!match) setProfileNotice(null);
    else if (match.exact) setProfileNotice(`Perfil "${match.profile.name}" reaplicado.`);
    else {
      const renamed = match.changes.renamedColumns
        .map((column) => `"${column.before}" → "${column.after}"`)
        .join(", ");
      setProfileNotice(
        `O modelo do arquivo mudou. O perfil "${match.profile.name}" foi adaptado com ${match.confidence}% de confiança${renamed ? `: ${renamed}` : ""}. Revise antes de confirmar.`,
      );
    }
    setUndoRows(null);
  }, [p.activeIndex, p.name, rows, active?.sourceGrid]);
  const needsConfirmation =
    Boolean(active?.diagnostics) &&
    ((active?.diagnostics?.confidence ?? 100) < 70 ||
      (active?.diagnostics?.header.confidence ?? 1) < 0.7 ||
      (active?.diagnostics?.tableRegions.length ?? 0) > 1);
  const suggestionKey = (suggestion: SmartImportSuggestion) =>
    `${suggestion.type}:${suggestion.columnKey}:${suggestion.proposedLabel ?? suggestion.proposedKind ?? ""}`;
  const applySmartSuggestion = (suggestion: SmartImportSuggestion) => {
    if (suggestion.type === "rename-column" && suggestion.proposedLabel) {
      p.setColumns(
        columns.map((column) =>
          column.key === suggestion.columnKey
            ? { ...column, label: suggestion.proposedLabel! }
            : column,
        ),
      );
    } else if (suggestion.type === "change-kind" && suggestion.proposedKind) {
      p.setColumns(
        columns.map((column) =>
          column.key === suggestion.columnKey
            ? { ...column, kind: suggestion.proposedKind! }
            : column,
        ),
      );
    } else if (suggestion.type === "ignore-column") {
      setSelection((current) => ({
        ...current,
        ignoredColumns: current.ignoredColumns.includes(suggestion.columnKey)
          ? current.ignoredColumns
          : [...current.ignoredColumns, suggestion.columnKey],
      }));
    }
    setAppliedSmartSuggestions((current) => new Set(current).add(suggestionKey(suggestion)));
    toast.success("Sugestão da análise inteligente aplicada.");
  };
  const applySafeSmartSuggestions = () => {
    const safe =
      smartAnalysis?.suggestions.filter(
        (suggestion) => suggestion.confidence >= 90 && suggestion.type !== "ignore-column",
      ) ?? [];
    if (!safe.length) {
      toast.info("Não há sugestões automáticas com confiança mínima de 90%.");
      return;
    }
    p.setColumns(
      columns.map((column) => {
        const rename = safe.find(
          (suggestion) =>
            suggestion.columnKey === column.key && suggestion.type === "rename-column",
        );
        const kind = safe.find(
          (suggestion) => suggestion.columnKey === column.key && suggestion.type === "change-kind",
        );
        return {
          ...column,
          ...(rename?.proposedLabel ? { label: rename.proposedLabel } : {}),
          ...(kind?.proposedKind ? { kind: kind.proposedKind } : {}),
        };
      }),
    );
    setAppliedSmartSuggestions((current) => {
      const next = new Set(current);
      safe.forEach((suggestion) => next.add(suggestionKey(suggestion)));
      return next;
    });
    toast.success(`${safe.length} sugestão(ões) segura(s) aplicada(s).`);
  };
  return (
    <div className="min-h-screen bg-canvas">
      <header className="oliam-topbar">
        <div className="flex items-center gap-3">
          <Mark />
          <strong className="font-display text-lg tracking-tight">Oli.Qualidade</strong>
          <span className="text-muted-foreground">/ Revisão de estrutura</span>
        </div>
        <Button variant="ghost" onClick={p.back}>
          Cancelar
        </Button>
      </header>
      <div className="mx-auto max-w-5xl px-5 py-10">
        {p.importWarning && (
          <p className="mb-6 flex items-center gap-2 rounded-xl border border-primary/30 bg-tint px-3 py-2.5 text-xs text-foreground">
            <AlertTriangle className="size-3.5 shrink-0 text-primary" />
            {p.importWarning}
          </p>
        )}
        {profileNotice && (
          <p className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5 text-xs text-foreground">
            <Info className="size-3.5 shrink-0 text-emerald-600" />
            {profileNotice}
          </p>
        )}
        <div className="mb-8 flex flex-wrap justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs text-primary shadow-sm">
              <span className="size-1.5 rounded-full bg-primary" />
              ETAPA 1 DE 2 · OBRIGATÓRIA
            </p>
            <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight">
              Confirme como cada coluna deve ser lida
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              IDs e códigos numéricos devem ser definidos como texto para nunca entrarem em totais.
              {p.sheets.length > 1 &&
                " Cada aba ou região independente da planilha original vira uma aba do painel."}
            </p>
          </div>
          <p className="whitespace-nowrap rounded-2xl border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground shadow-sm">
            {p.name}
            <br />
            {rows.length} linhas · {columns.length} colunas
          </p>
        </div>
        <section className="mb-5 overflow-hidden rounded-2xl border border-violet-500/25 bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-violet-500/5 px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-violet-600 dark:text-violet-400" />
                Análise inteligente
                {smartCached && (
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                    resultado reutilizado
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                O Oli analisa somente estrutura, contagens e exemplos não sensíveis. Você decide o
                que aplicar, e nenhum valor ausente é inventado.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!smartInput || smartLoading}
              onClick={() => void runSmartAnalysis(Boolean(smartAnalysis))}
            >
              {smartLoading ? <OliLoader compact /> : <Sparkles className="size-3.5" />}
              {smartAnalysis ? "Analisar novamente" : "Analisar estrutura"}
            </Button>
          </div>
          {smartLoading && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Comparando cabeçalhos, tipos e regiões da planilha…
            </div>
          )}
          {smartError && (
            <div className="flex items-start gap-2 border-t border-border px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{smartError} A leitura normal permanece disponível.</span>
            </div>
          )}
          {smartAnalysis && !smartLoading && (
            <div className="border-t border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{smartAnalysis.purpose}</div>
                  <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                    {smartAnalysis.summary}
                  </p>
                </div>
                <span className="rounded-full border border-violet-500/25 bg-violet-500/5 px-2.5 py-1 text-xs text-violet-700 dark:text-violet-300">
                  {smartAnalysis.confidence}% de confiança
                </span>
              </div>
              {smartAnalysis.suggestions.length ? (
                <div className="mt-4 space-y-2">
                  {smartAnalysis.suggestions.map((suggestion) => {
                    const key = suggestionKey(suggestion);
                    const applied = appliedSmartSuggestions.has(key);
                    const action =
                      suggestion.type === "rename-column"
                        ? `Renomear “${suggestion.columnKey}” para “${suggestion.proposedLabel}”`
                        : suggestion.type === "change-kind"
                          ? `Ler “${suggestion.columnKey}” como ${kinds[suggestion.proposedKind!]}`
                          : `Ignorar a coluna “${suggestion.columnKey}”`;
                    return (
                      <div
                        key={key}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium">{action}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {suggestion.reason} · {suggestion.confidence}%
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={applied ? "ghost" : "outline"}
                          disabled={applied}
                          onClick={() => applySmartSuggestion(suggestion)}
                        >
                          {applied ? (
                            <Check className="size-3.5" />
                          ) : (
                            <Sparkles className="size-3.5" />
                          )}
                          {applied ? "Aplicada" : "Aplicar"}
                        </Button>
                      </div>
                    );
                  })}
                  <div className="pt-1 text-right">
                    <Button size="sm" variant="secondary" onClick={applySafeSmartSuggestions}>
                      Aplicar sugestões seguras (≥90%)
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                  O Oli analisou a estrutura e não encontrou ajustes seguros necessários.
                </p>
              )}
              {smartAnalysis.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                  {smartAnalysis.warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
        {active?.diagnostics && (
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Confiança da importação
              </div>
              <div className="mt-1 flex items-end gap-2">
                <strong className="font-display text-2xl">{active.diagnostics.confidence}%</strong>
                <span className="pb-0.5 text-xs text-muted-foreground">estrutura detectada</span>
              </div>
              {active.diagnostics.recoveryGain > 0 && (
                <div className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  +{active.diagnostics.recoveryGain} pontos após recuperação
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Dados
              </div>
              <div className="mt-1 font-display text-2xl">
                {active.diagnostics.rowCount.toLocaleString("pt-BR")}
              </div>
              <div className="text-xs text-muted-foreground">
                linhas · {active.diagnostics.columnCount} colunas
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Integridade
              </div>
              <div className="mt-1 font-display text-2xl">{active.diagnostics.duplicateRows}</div>
              <div className="text-xs text-muted-foreground">linhas duplicadas detectadas</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Estrutura
              </div>
              <div className="mt-1 font-display text-2xl">
                {active.diagnostics.formulaCells + active.diagnostics.mergedRanges}
              </div>
              <div className="text-xs text-muted-foreground">fórmulas + mesclagens</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Leitura
              </div>
              <div className="mt-1 font-display text-2xl">
                {active.diagnostics.interpretationScore ?? active.diagnostics.confidence}%
              </div>
              <div className="text-xs text-muted-foreground">células úteis interpretadas</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Consistência
              </div>
              <div className="mt-1 font-display text-2xl">{active.diagnostics.qualityScore}%</div>
              <div className="text-xs text-muted-foreground">
                valores presentes
                {active.diagnostics.advancedQuality &&
                  ` · robusta ${active.diagnostics.advancedQuality.tableScore}%`}
              </div>
            </div>
          </div>
        )}
        {active?.diagnostics && (
          <div className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Info className="size-4 text-primary" />
                  Leitura estrutural
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cabeçalho provável na linha {active.diagnostics.header.row}, com{" "}
                  {Math.round(active.diagnostics.header.confidence * 100)}% de confiança.
                </p>
              </div>
              {active.diagnostics.suggestedNormalization.length > 0 && (
                <span className="rounded-full border border-primary/25 bg-tint px-2.5 py-1 text-xs text-primary">
                  {active.diagnostics.suggestedNormalization.length} normalização(ões) sugerida(s)
                </span>
              )}
            </div>
            {active.diagnostics.confidenceReasons.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                {active.diagnostics.confidenceReasons.map((reason) => (
                  <span
                    key={reason}
                    className="rounded-full border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300"
                  >
                    {reason}
                  </span>
                ))}
              </div>
            )}
            {(active.diagnostics.structuredTables.length > 0 ||
              active.diagnostics.pivotTables.length > 0 ||
              active.diagnostics.calculatedColumns.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                {active.diagnostics.structuredTables.map((table) => (
                  <span
                    key={`${table.name}-${table.range}`}
                    className="rounded-full border border-primary/25 bg-tint px-2.5 py-1 text-xs text-primary"
                  >
                    Tabela {table.name}
                    {table.range ? ` · ${table.range}` : ""}
                  </span>
                ))}
                {active.diagnostics.pivotTables.map((table) => (
                  <span
                    key={`${table.name}-${table.range}`}
                    className="rounded-full border border-secondary-accent/30 bg-secondary-accent/10 px-2.5 py-1 text-xs text-foreground"
                  >
                    Pivot {table.name}
                    {table.range ? ` · ${table.range}` : ""}
                  </span>
                ))}
                {active.diagnostics.calculatedColumns.length > 0 && (
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                    Colunas calculadas: {active.diagnostics.calculatedColumns.join(", ")}
                  </span>
                )}
              </div>
            )}
            {active.diagnostics.advancedQuality?.columns.length ? (
              <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
                {active.diagnostics.advancedQuality.columns.map((column) => (
                  <div
                    key={column.key}
                    className="rounded-xl border border-border bg-background p-3 text-xs"
                  >
                    <div className="font-medium">
                      {column.key} · score {column.score}%
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      IQR {column.iqr?.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? "—"}
                      {" · "}MAD{" "}
                      {column.mad?.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? "—"}
                    </div>
                    <div className="text-muted-foreground">
                      IQR {column.iqrOutliers} · MAD {column.madOutliers} · Z-score{" "}
                      {column.zScoreOutliers} · temporal {column.temporalAnomalies}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
        {active?.diagnostics?.warnings.length ? (
          <div className="mb-5 rounded-2xl border border-primary/25 bg-tint p-4">
            <div className="flex items-center gap-2 font-medium text-sm">
              <AlertTriangle className="size-4 text-primary" />
              Diagnóstico da planilha
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {active.diagnostics.warnings.map((warning) => (
                <span
                  key={warning}
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {warning}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {active?.diagnostics?.tableRegions && active.diagnostics.tableRegions.length > 1 && (
          <div className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Columns3 className="size-4 text-primary" />
              Regiões de dados detectadas
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Encontramos áreas potencialmente independentes nesta aba. Elas não serão combinadas
              automaticamente sem confirmação.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {active.diagnostics.tableRegions.map((region, index) => (
                <div
                  key={`${region.startRow}-${region.startColumn}-${index}`}
                  className="rounded-xl border border-border bg-background p-3 text-xs"
                >
                  <div className="font-medium">Região {index + 1}</div>
                  <div className="mt-1 font-mono text-muted-foreground">
                    L{region.startRow}:L{region.endRow} · C{region.startColumn}:C{region.endColumn}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {region.rows} linhas · {region.columns} colunas ·{" "}
                    {Math.round(region.confidence * 100)}% confiança
                  </div>
                  {active.sourceGrid && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        const rowOffset = active.sourceGrid!.startRow - 1;
                        const columnOffset = active.sourceGrid!.startColumn - 1;
                        const headerRow = Math.max(
                          region.startRow,
                          active.diagnostics?.header.row ?? region.startRow,
                        );
                        setSelection({
                          startRow: 1,
                          endRow: Math.max(1, region.endRow - headerRow),
                          ignoredColumns: [],
                          source: {
                            headerRow: headerRow + rowOffset,
                            startRow: headerRow + rowOffset + 1,
                            endRow: region.endRow + rowOffset,
                            startColumn: region.startColumn + columnOffset,
                            endColumn: region.endColumn + columnOffset,
                          },
                        });
                      }}
                    >
                      Usar esta região
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {active?.diagnostics?.transformations.length ? (
          <div className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitMerge className="size-4 text-primary" />
              Transformações e pontos para revisão
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {active.diagnostics.transformations.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {needsConfirmation && (
          <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={lowConfidenceConfirmed}
              onChange={(event) => setLowConfidenceConfirmed(event.target.checked)}
            />
            <span>
              <strong className="font-medium">Confirmar leitura ambígua</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                Revise o cabeçalho, as regiões detectadas e a prévia abaixo. O relatório só será
                criado depois da sua confirmação para evitar uma interpretação silenciosamente
                incorreta.
              </span>
            </span>
          </label>
        )}
        {active?.diagnostics?.columns.some((c) => c.sensitive) && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <strong className="font-medium">Dados potencialmente sensíveis detectados.</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                O importador marcou {active.diagnostics.columns.filter((c) => c.sensitive).length}{" "}
                coluna(s) como potencialmente pessoal(is). Esses campos não devem ser enviados para
                IA sem necessidade.
              </p>
            </div>
          </div>
        )}
        <ImportWorkbench
          rows={rows}
          columns={columns}
          {...(active?.diagnostics ? { diagnostics: active.diagnostics } : {})}
          {...(active?.sourceGrid ? { sourceGrid: active.sourceGrid } : {})}
          {...(active?.audit ? { audit: active.audit } : {})}
          selection={selection}
          setSelection={setSelection}
          canUndo={Boolean(undoRows)}
          apply={() => {
            const next = applyImportSelection(rows, selection, active?.sourceGrid);
            if (!next.length || !Object.keys(next[0] ?? {}).length) {
              toast.error("A seleção precisa manter ao menos uma linha e uma coluna.");
              return;
            }
            setUndoRows(rows);
            p.setRows(next);
            setSelection(defaultSelection(next));
            toast.success("Seleção aplicada. Você ainda pode desfazer esta reparação.");
          }}
          undo={() => {
            if (!undoRows) return;
            p.setRows(undoRows);
            setSelection(defaultSelection(undoRows));
            setUndoRows(null);
          }}
          saveProfile={() => {
            const profileName = window.prompt(
              "Nome do perfil de importação",
              p.name.replace(/\.[^.]+$/, ""),
            );
            if (!profileName) return;
            const now = Date.now();
            saveImportProfile(
              adaptImportProfile(
                {
                  id: crypto.randomUUID(),
                  name: profileName,
                  signature: "",
                  selection,
                  createdAt: now,
                  updatedAt: now,
                },
                rows,
                p.name,
                active?.sourceGrid,
              ),
            );
            toast.success("Perfil salvo para planilhas com esta mesma estrutura.");
          }}
        />
        {p.sheets.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Abas da planilha">
            {p.sheets.map((s, i) => (
              <button
                key={s.name + i}
                role="tab"
                aria-selected={i === p.activeIndex}
                onClick={() => p.setActiveIndex(i)}
                className={cn(
                  "rounded-t-lg border border-b-0 px-3.5 py-2 text-sm font-medium transition-colors",
                  i === p.activeIndex
                    ? "border-border bg-card text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground hover:bg-accent",
                )}
              >
                {s.name}
                <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                  {s.rows.length}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="grid grid-cols-[32px_1.3fr_1fr_1fr] border-b border-border bg-muted/60 px-3 py-2.5 font-mono text-[11px] tracking-wide text-muted-foreground">
            <span />
            <span>COLUNA</span>
            <span>TIPO E FORMATO</span>
            <span>AMOSTRA</span>
          </div>
          {columns.map((c, i) => (
            <div
              key={c.key}
              className="border-b border-border px-3 py-3 transition-colors last:border-0 hover:bg-accent/40"
            >
              <div className="grid grid-cols-[32px_1.3fr_1fr_1fr] items-center">
                <GripVertical className="size-4 text-muted-foreground" />
                <input
                  className="oliam-plain-input font-medium"
                  value={c.label}
                  onChange={(e) =>
                    p.setColumns(
                      columns.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                />
                <select
                  className="oliam-select"
                  value={c.kind}
                  onChange={(e) =>
                    p.setColumns(
                      columns.map((x, j) => (j === i ? { ...x, kind: e.target.value as Kind } : x)),
                    )
                  }
                >
                  {Object.entries(kinds).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <span
                  className={cn(
                    "truncate text-sm",
                    ["number", "currency", "percentage"].includes(c.kind) && "font-mono",
                  )}
                >
                  {fmt(rows[0]?.[c.key] ?? null, c.kind) ?? "–"}
                </span>
              </div>
              {active?.diagnostics?.columns.find((d) => d.key === c.key) && (
                <div className="mt-2 flex items-center gap-2 pl-8 text-[11px] text-muted-foreground">
                  <span>
                    Qualidade:{" "}
                    {active?.diagnostics?.columns.find((d) => d.key === c.key)?.qualityScore}%
                  </span>
                  <span>·</span>
                  <span>
                    {active?.diagnostics?.columns.find((d) => d.key === c.key)?.missing ?? 0}{" "}
                    ausentes
                  </span>
                  {active?.diagnostics?.columns.find((d) => d.key === c.key)?.sensitive && (
                    <span className="text-amber-600">· sensível</span>
                  )}
                </div>
              )}
              <div className="mt-2 grid grid-cols-[32px_1fr] items-center">
                <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <input
                  className="oliam-plain-input text-xs text-muted-foreground"
                  placeholder="Descrição opcional, exibida ao passar o mouse no cabeçalho da tabela"
                  value={c.description}
                  onChange={(e) =>
                    p.setColumns(
                      columns.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                    )
                  }
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 text-right">
          <Button
            className="px-6 shadow-sm"
            onClick={p.confirm}
            disabled={needsConfirmation && !lowConfidenceConfirmed}
          >
            Gerar relatório
          </Button>
        </div>
      </div>
    </div>
  );
}

function Dashboard(p: {
  dashboard: Dashboard;
  dashboards: Dashboard[];
  openDash: (id: string) => void;
  backHome: () => void;
  newDash: () => void;
  update: (patch: Partial<Dashboard>) => void;
  rename: (id: string, name: string) => void;
  reimport: () => void;
  folderMonitor: FolderMonitorView | undefined;
  connectFolder: () => void;
  disconnectFolder: () => void;
  theme: string;
  toggleTheme: () => void;
}) {
  const { dashboard: d } = p;
  const activeSheetIndex = Math.min(Math.max(d.activeSheetIndex, 0), d.sheets.length - 1);
  const sheet = d.sheets[activeSheetIndex]!;
  const updateSheet = (patch: Partial<SheetData>) => {
    p.update({
      sheets: d.sheets.map((s, i) => (i === activeSheetIndex ? { ...s, ...patch } : s)),
    });
  };
  const switchSheet = (index: number) => {
    if (index === activeSheetIndex) return;
    p.update({ activeSheetIndex: index });
  };
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null),
    [sidebar, setSidebar] = useState(() =>
      typeof window === "undefined" ? true : window.matchMedia("(min-width: 701px)").matches,
    ),
    [command, setCommand] = useState(false),
    [panel, setPanel] = useState(false),
    [editingName, setEditingName] = useState(false),
    [draftName, setDraftName] = useState(d.name);
  const [missingPanel, setMissingPanel] = useState(false);
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => {
    if (!exportError) return;
    const id = setTimeout(() => setExportError(null), 5000);
    return () => clearTimeout(id);
  }, [exportError]);
  const [filterMenu, setFilterMenu] = useState(false);
  const [dismissedSignals, setDismissedSignals] = useState<Set<string>>(new Set());
  const [qualityPanel, setQualityPanel] = useState(false);
  const [addingFormula, setAddingFormula] = useState(false);
  const [formulaLabel, setFormulaLabel] = useState("");
  const [formulaText, setFormulaText] = useState("");
  const [formulaError, setFormulaError] = useState<string | null>(null);
  const [formatPanel, setFormatPanel] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinRows, setJoinRows] = useState<Row[] | null>(null);
  const [joinFileName, setJoinFileName] = useState("");
  const [joinDragging, setJoinDragging] = useState(false);
  const [joinBaseKey, setJoinBaseKey] = useState("");
  const [joinOtherKey, setJoinOtherKey] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSheetPicker, setJoinSheetPicker] = useState<{
    fileName: string;
    sheets: SheetOption[];
  } | null>(null);
  const [joinSheetPickerIndex, setJoinSheetPickerIndex] = useState(0);
  const [bookmarkPanel, setBookmarkPanel] = useState(false);
  const [bookmarkName, setBookmarkName] = useState("");
  const [widgetClipboard, setWidgetClipboard] = useState<Widget | null>(null);
  const [presentation, setPresentation] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);
  const [intervalSeconds, setIntervalSeconds] = useState(10);
  const [insightOpen, setInsightOpen] = useState(true);
  const [showTermHint, setShowTermHint] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const usesGrouping = (sheet.widgets ?? []).some((w) =>
      ["bar", "pie", "line", "ranking", "map"].includes(w.type),
    );
    if (usesGrouping && !localStorage.getItem(TERM_HINTS_KEY)) setShowTermHint(true);
  }, [sheet.widgets]);
  const dismissTermHint = () => {
    localStorage.setItem(TERM_HINTS_KEY, "1");
    setShowTermHint(false);
  };
  const joinInput = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const nums = sheet.columns.filter((c) => numericKinds.includes(c.kind)),
    catCandidates = sheet.columns.filter((c) => c.kind === "category" || c.kind === "text"),
    // Evita escolher como padrão uma coluna categórica quase vazia (ex.: uma
    // coluna residual ou mal importada da planilha), o que fazia o ranking
    // da sidebar e outros widgets caírem inteiros em "Não informado".
    cat = pickBestGroupColumn(catCandidates, sheet.rows),
    dateCol = sheet.columns.find((c) => c.kind === "date");
  useEffect(() => setDraftName(d.name), [d.id, d.name]);
  useEffect(() => {
    setSearch("");
    setSort(null);
    setBookmarkPanel(false);
    setWidgetClipboard(null);
  }, [d.id, activeSheetIndex]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommand((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShortcuts((v) => !v);
      } else if (e.key === "?" && !typing) {
        e.preventDefault();
        setShortcuts((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // Pilha de desfazer/refazer, com escopo no painel atual: cobre filtros,
  // ordem/config de colunas (inclui regras de formatação) e widgets (posição,
  // tamanho, configuração). Reinicia sempre que o painel muda.
  const historyRef = useRef<{
    undo: Array<Pick<SheetData, "filters" | "columns" | "widgets">>;
    redo: Array<Pick<SheetData, "filters" | "columns" | "widgets">>;
  }>({ undo: [], redo: [] });
  const [, forceHistoryUpdate] = useState(0);
  useEffect(() => {
    historyRef.current = { undo: [], redo: [] };
    forceHistoryUpdate((t) => t + 1);
  }, [d.id]);
  const dashboardSnapshot = (): Pick<SheetData, "filters" | "columns" | "widgets"> => ({
    filters: sheet.filters,
    columns: sheet.columns,
    widgets: sheet.widgets ?? buildDefaultWidgets(sheet.columns, sheet.chartConfig, sheet.rows),
  });
  const recordHistory = () => {
    historyRef.current.undo.push(dashboardSnapshot());
    if (historyRef.current.undo.length > 50) historyRef.current.undo.shift();
    historyRef.current.redo = [];
    forceHistoryUpdate((t) => t + 1);
  };
  const undo = () => {
    const prev = historyRef.current.undo.pop();
    if (!prev) return;
    historyRef.current.redo.push(dashboardSnapshot());
    updateSheet(prev);
    forceHistoryUpdate((t) => t + 1);
  };
  const redo = () => {
    const next = historyRef.current.redo.pop();
    if (!next) return;
    historyRef.current.undo.push(dashboardSnapshot());
    updateSheet(next);
    forceHistoryUpdate((t) => t + 1);
  };
  useEffect(() => {
    undoRef.current = undo;
    redoRef.current = redo;
  });
  const canUndo = historyRef.current.undo.length > 0;
  const canRedo = historyRef.current.redo.length > 0;
  const setFilters = (filters: FilterRule[]) => {
    recordHistory();
    updateSheet({ filters });
  };
  const setColumns = (columns: Column[]) => {
    recordHistory();
    updateSheet({ columns });
  };

  // Colunas calculadas recalculam ao vivo antes de qualquer filtro.
  const withCalculated = useMemo(
    () => withCalculatedColumns(sheet.rows, sheet.columns),
    [sheet.rows, sheet.columns],
  );
  // Regras de dados ausentes (ignorar/zero/interpolar/ocultar linha) rodam em seguida.
  const { rows: rulesApplied, interpolated } = useMemo(
    () => applyMissingRules(withCalculated, sheet.columns),
    [withCalculated, sheet.columns],
  );
  const data = useMemo(() => {
    let r = rulesApplied.filter(
      (row) =>
        (!search ||
          sheet.columns.some((c) =>
            String(row[c.key] ?? "")
              .toLowerCase()
              .includes(search.toLowerCase()),
          )) &&
        sheet.filters.every((f) => {
          const col = sheet.columns.find((c) => c.key === f.key);
          if (col && (numericKinds.includes(col.kind) || col.kind === "date")) {
            return matchesRange(row[f.key], f.min, f.max, col.kind === "date");
          }
          return String(row[f.key] ?? "")
            .toLowerCase()
            .includes(f.value.toLowerCase());
        }),
    );
    if (sort)
      r = [...r].sort(
        (a, b) =>
          String(a[sort.key] ?? "").localeCompare(String(b[sort.key] ?? ""), "pt-BR", {
            numeric: true,
          }) * (sort.dir === "asc" ? 1 : -1),
      );
    return r;
  }, [rulesApplied, sheet.columns, sheet.filters, search, sort]);
  const qualitySignals = useMemo(
    () => detectQualitySignals(data, sheet.columns),
    [data, sheet.columns],
  );
  const visibleSignals = qualitySignals.filter(
    (s) => !dismissedSignals.has(`${s.kind}-${s.columnKey}`),
  );
  // Delta real vs. a versão anterior dos dados (comparação de reimportação),
  // calculado sobre o total do painel inteiro, sem os filtros da visão atual.
  const versionDelta = useMemo(() => {
    if (!sheet.previousSnapshot) return null;
    const prevCalculated = withCalculatedColumns(sheet.previousSnapshot.rows, sheet.columns);
    const deltas = new Map<string, number | null>();
    for (const c of nums) {
      const currentTotal = withCalculated.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      const previousTotal = prevCalculated.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      deltas.set(
        c.key,
        previousTotal === 0 ? null : (currentTotal - previousTotal) / previousTotal,
      );
    }
    return deltas;
  }, [sheet.previousSnapshot, sheet.columns, withCalculated, nums]);
  const detailedVersionDiff = useMemo(
    () =>
      sheet.previousSnapshot ? compareVersions(sheet.previousSnapshot.rows, sheet.rows) : null,
    [sheet.previousSnapshot, sheet.rows],
  );
  const primary = nums[0];
  // Colunas candidatas a agrupamento: categoria, texto ou data.
  const groupableCols = sheet.columns.filter((c) => groupableKinds.includes(c.kind));
  // Dados da sidebar fixa de visão geral: KPIs (mesmas colunas numéricas dos
  // cartões de métrica) e um ranking rápido por categoria, sempre a partir
  // da coluna categórica e numérica mais relevantes do painel.
  const sidebarRanking = useMemo(() => {
    if (!cat || !primary) return [];
    return groupAndAggregate(data, cat.key, primary.key, "sum")
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [data, cat, primary]);
  const sidebarRankingMax = Math.max(1, ...sidebarRanking.map((r) => Math.abs(r.total)));

  // Modelo de widgets: painéis salvos antes desse recurso existir ainda não
  // têm "widgets" persistido, então reproduzimos o layout fixo antigo até o
  // usuário mexer em algo (a primeira alteração já grava a lista completa).
  const widgets =
    sheet.widgets ?? buildDefaultWidgets(sheet.columns, sheet.chartConfig, sheet.rows);
  const assistantContext = useMemo(
    () =>
      buildLiveDashboardContext({
        dashboardName: d.name,
        sheetName: sheet.name,
        columns: sheet.columns,
        rows: data,
        totalRows: sheet.rows.length,
        widgets,
        filters: sheet.filters,
        search,
        sort,
        versionDelta,
        ...(p.folderMonitor ? { folderMonitor: p.folderMonitor } : {}),
      }),
    [
      d.name,
      sheet.name,
      sheet.columns,
      sheet.rows.length,
      sheet.filters,
      data,
      widgets,
      search,
      sort,
      versionDelta,
      p.folderMonitor,
    ],
  );
  const setWidgets = (next: Widget[]) => {
    recordHistory();
    updateSheet({ widgets: next });
  };
  const addWidget = (type: WidgetType) =>
    setWidgets([...widgets, createWidget(type, sheet.columns, undefined, sheet.rows)]);
  const copyCurrentWidget = (widget: Widget) => {
    setWidgetClipboard({ ...widget });
    toast.success("Widget copiado. Agora é só colar onde quiser.");
  };
  const pasteCopiedWidget = (afterId?: string) => {
    if (!widgetClipboard) return;
    const copy = duplicateWidget(widgetClipboard);
    const next = [...widgets];
    const afterIndex = afterId ? next.findIndex((widget) => widget.id === afterId) : -1;
    next.splice(afterIndex >= 0 ? afterIndex + 1 : next.length, 0, copy);
    setWidgets(next);
    toast.success("Cópia do widget adicionada ao painel.");
  };
  const updateWidget = (id: string, patch: Partial<Widget>) =>
    setWidgets(widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const removeWidget = (id: string) => setWidgets(widgets.filter((w) => w.id !== id));
  const moveWidget = (id: string, dir: -1 | 1) => {
    const i = widgets.findIndex((w) => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    const a = next[i],
      b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    setWidgets(next);
  };
  const reorderWidget = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = widgets.findIndex((w) => w.id === fromId);
    const to = widgets.findIndex((w) => w.id === toId);
    if (from < 0 || to < 0) return;
    const next = [...widgets];
    const moved = next.splice(from, 1)[0];
    if (!moved) return;
    next.splice(to, 0, moved);
    setWidgets(next);
  };
  const canAdd: Record<WidgetType, boolean> = {
    metric: nums.length > 0,
    "metric-trend": nums.length > 0,
    "folder-files": true,
    bar: nums.length > 0 && groupableCols.length > 0,
    pie: nums.length > 0 && groupableCols.length > 0,
    line: nums.length > 0 && !!dateCol,
    area: nums.length > 0 && groupableCols.length > 0,
    ranking: nums.length > 0 && groupableCols.length > 0,
    rating: nums.length > 0,
    map: nums.length > 0 && groupableCols.length > 0,
    "schedule-heatmap": schedulePeriodColumns(sheet.columns).length > 0,
    table: true,
  };

  const slug = d.name.toLowerCase().replaceAll(" ", "-");
  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(safeRowsForSpreadsheet(data)),
      wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório");
    XLSX.writeFile(wb, `${slug}.xlsx`);
  };
  const exportEncryptedBackup = async () => {
    const password = window.prompt(
      "Crie uma senha para proteger este backup (mínimo 12 caracteres)",
    );
    if (!password) return;
    try {
      const content = await encryptDashboardBackup(d, password);
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug}.oli-backup`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Backup criptografado criado. Guarde a senha separadamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o backup.");
    }
  };
  const restoreEncryptedBackup = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      toast.error("O backup excede o limite de 50 MB.");
      return;
    }
    const password = window.prompt("Digite a senha deste backup");
    if (!password) return;
    try {
      const restored = await decryptDashboardBackup(await file.text(), password);
      const copy = {
        ...restored,
        id: d.id,
        name: `${restored.name} (restaurado)`,
        createdAt: d.createdAt,
        updatedAt: Date.now(),
      };
      p.update(copy);
      toast.success(`Backup “${copy.name}” restaurado neste painel.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível restaurar o backup.");
    }
  };
  const settleExportLayout = async () => {
    await document.fonts?.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 120));
  };
  const exportBreakpoints = (el: HTMLElement) => {
    const rootTop = el.getBoundingClientRect().top;
    const rows = new Map<number, number>();
    for (const widget of el.querySelectorAll<HTMLElement>(".oliam-widget")) {
      const rect = widget.getBoundingClientRect();
      const rowTop = Math.round(rect.top - rootTop);
      rows.set(rowTop, Math.max(rows.get(rowTop) ?? 0, rect.bottom - rootTop + 12));
    }
    return [...rows.values()].sort((a, b) => a - b);
  };
  const captureContent = async () => {
    const el = contentRef.current;
    if (!el) return null;
    const previousScroll = { left: el.scrollLeft, top: el.scrollTop };
    el.classList.add("oliam-export-mode");
    el.scrollTo(0, 0);
    try {
      await settleExportLayout();
      window.dispatchEvent(new Event("resize"));
      await settleExportLayout();
      // `scrollWidth` também inclui SVGs responsivos que ainda conservam a
      // largura anterior por alguns frames, criando uma faixa vazia à direita.
      // A superfície possui largura fixa; o retângulo renderizado é a fonte
      // correta para cortar o canvas exatamente no fim do relatório.
      const cssWidth = Math.ceil(el.getBoundingClientRect().width);
      const cssHeight = el.scrollHeight;
      const cleanBreakpoints = exportBreakpoints(el);
      const { default: html2canvas } = await import("html2canvas-pro");
      const canvas = await html2canvas(el, {
        backgroundColor: getComputedStyle(el).backgroundColor,
        scale: captureScale(cssWidth, cssHeight),
        width: cssWidth,
        height: cssHeight,
        windowWidth: EXPORT_SURFACE_WIDTH,
        windowHeight: cssHeight,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        allowTaint: false,
        imageTimeout: 12_000,
        logging: false,
        onclone: (clonedDocument, clonedElement) => {
          clonedElement.classList.add("oliam-export-mode");
          clonedDocument
            .querySelectorAll("[data-export-controls]")
            .forEach((node) => node.remove());
        },
      });
      const renderedScale = canvas.width / cssWidth;
      return {
        canvas,
        breakpoints: cleanBreakpoints.map((point) => Math.round(point * renderedScale)),
      };
    } finally {
      el.classList.remove("oliam-export-mode");
      el.scrollTo(previousScroll.left, previousScroll.top);
    }
  };
  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = fileName;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  };
  const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("canvas-blob-failed"))),
        type,
        quality,
      ),
    );
  const exportPng = async () => {
    setExporting("png");
    setExportError(null);
    try {
      const capture = await captureContent();
      if (!capture) return;
      downloadBlob(await canvasBlob(capture.canvas, "image/png"), `${slug}.png`);
    } catch (err) {
      console.error("Falha ao exportar PNG:", err);
      setExportError("Não foi possível gerar o PNG. Tente novamente.");
    } finally {
      setExporting(null);
    }
  };
  const exportPdf = async () => {
    setExporting("pdf");
    setExportError(null);
    try {
      const capture = await captureContent();
      if (!capture) return;
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth(),
        pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 28,
        headerHeight = 28,
        footerHeight = 18,
        contentWidth = pageWidth - margin * 2,
        contentHeight = pageHeight - margin * 2 - headerHeight - footerHeight;
      const slices = pdfPageSlices(
        capture.canvas.width,
        capture.canvas.height,
        contentWidth,
        contentHeight,
        capture.breakpoints,
      );
      // A visão do painel continua nas primeiras páginas. Se houver widget
      // de tabela, acrescenta uma versão completa em páginas dedicadas,
      // dividida por linhas e colunas; assim nenhuma célula depende do
      // viewport virtualizado nem é cortada no meio por uma fatia do canvas.
      const tableColumns = widgets.some((widget) => widget.type === "table")
        ? sheet.columns.filter((column) => column.visible)
        : [];
      const tablePages = pdfTablePages(
        data.length,
        tableColumns.length,
        contentWidth,
        contentHeight,
        {
          minColumnWidthPt: 92,
          rowHeightPt: 18,
          tableHeaderHeightPt: 24,
          titleHeightPt: 24,
        },
      );
      const totalPages = slices.length + tablePages.length;
      const drawPageChrome = (index: number, detail: string) => {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(12);
        pdf.setTextColor(30, 41, 59);
        pdf.text(d.name, margin, margin + 12);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.text(
          `${detail} · ${new Date().toLocaleString("pt-BR")}`,
          pageWidth - margin,
          margin + 12,
          { align: "right" },
        );
        pdf.setDrawColor(203, 213, 225);
        pdf.line(margin, pageHeight - margin - 8, pageWidth - margin, pageHeight - margin - 8);
        pdf.text(
          `Oli.Qualidade · página ${index + 1} de ${totalPages}`,
          pageWidth - margin,
          pageHeight - margin + 4,
          { align: "right" },
        );
      };
      const fitPdfText = (value: string, maxWidth: number) => {
        if (pdf.getTextWidth(value) <= maxWidth) return value;
        let low = 0;
        let high = value.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (pdf.getTextWidth(`${value.slice(0, middle)}…`) <= maxWidth) low = middle;
          else high = middle - 1;
        }
        return `${value.slice(0, low)}…`;
      };
      const hexRgb = (color: string): [number, number, number] | null => {
        const match = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
        return match
          ? [
              Number.parseInt(match[1]!, 16),
              Number.parseInt(match[2]!, 16),
              Number.parseInt(match[3]!, 16),
            ]
          : null;
      };
      for (const [index, slice] of slices.entries()) {
        if (index > 0) pdf.addPage();
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = capture.canvas.width;
        pageCanvas.height = slice.height;
        const context = pageCanvas.getContext("2d");
        if (!context) throw new Error("pdf-canvas-context");
        context.drawImage(
          capture.canvas,
          0,
          slice.start,
          capture.canvas.width,
          slice.height,
          0,
          0,
          pageCanvas.width,
          pageCanvas.height,
        );
        const imageHeight = (slice.height * contentWidth) / capture.canvas.width;
        drawPageChrome(index, `${data.length} linhas na visão atual`);
        pdf.addImage(
          pageCanvas.toDataURL("image/jpeg", 0.94),
          "JPEG",
          margin,
          margin + headerHeight,
          contentWidth,
          imageHeight,
          undefined,
          "FAST",
        );
        pageCanvas.width = 1;
        pageCanvas.height = 1;
      }
      for (const [tableIndex, plan] of tablePages.entries()) {
        const pageIndex = slices.length + tableIndex;
        if (pageIndex > 0) pdf.addPage();
        const columnsOnPage = tableColumns.slice(plan.columnStart, plan.columnEnd);
        const columnWidth = contentWidth / columnsOnPage.length;
        const contentTop = margin + headerHeight;
        drawPageChrome(pageIndex, `${data.length} linhas na tabela completa`);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.setTextColor(30, 41, 59);
        const rowRange =
          plan.rowEnd > plan.rowStart ? `linhas ${plan.rowStart + 1}–${plan.rowEnd}` : "sem linhas";
        pdf.text(
          `Base detalhada · ${rowRange} · colunas ${plan.columnStart + 1}–${plan.columnEnd}`,
          margin,
          contentTop + 15,
        );
        const headerY = contentTop + 24;
        pdf.setFillColor(241, 245, 249);
        pdf.setDrawColor(203, 213, 225);
        pdf.rect(margin, headerY, contentWidth, 24, "FD");
        pdf.setFontSize(7.5);
        columnsOnPage.forEach((column, columnIndex) => {
          const x = margin + columnIndex * columnWidth;
          if (columnIndex > 0) pdf.line(x, headerY, x, headerY + 24);
          pdf.text(fitPdfText(column.label, columnWidth - 10), x + 5, headerY + 15);
        });
        data.slice(plan.rowStart, plan.rowEnd).forEach((row, rowOffset) => {
          const y = headerY + 24 + rowOffset * 18;
          if ((plan.rowStart + rowOffset) % 2 === 1) {
            pdf.setFillColor(248, 250, 252);
            pdf.rect(margin, y, contentWidth, 18, "F");
          }
          pdf.setDrawColor(226, 232, 240);
          pdf.line(margin, y + 18, margin + contentWidth, y + 18);
          columnsOnPage.forEach((column, columnIndex) => {
            const x = margin + columnIndex * columnWidth;
            if (columnIndex > 0) pdf.line(x, y, x, y + 18);
            const raw = row[column.key] ?? null;
            const shown = fmt(raw, column.kind) ?? "—";
            const style = conditionalStyle(raw, column.kind, column.conditionalFormat);
            const textColor = style?.color ? hexRgb(style.color) : null;
            if (textColor) pdf.setTextColor(...textColor);
            else pdf.setTextColor(30, 41, 59);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(7.5);
            pdf.text(fitPdfText(shown, columnWidth - 10), x + 5, y + 12);
          });
        });
      }
      downloadBlob(pdf.output("blob"), `${slug}.pdf`);
    } catch (err) {
      console.error("Falha ao exportar PDF:", err);
      setExportError("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setExporting(null);
    }
  };
  const commitName = () => {
    const n = draftName.trim();
    if (n && n !== d.name) p.rename(d.id, n);
    setEditingName(false);
  };

  const applyJoinSheet = (rows: Row[], fileName: string) => {
    setJoinRows(rows);
    setJoinFileName(fileName);
    setJoinOtherKey(Object.keys(rows[0] ?? {})[0] ?? "");
    setJoinBaseKey(sheet.columns[0]?.key ?? "");
    setJoinError(null);
  };
  const parseJoinFile = async (file: File) => {
    try {
      const sheets = await readWorkbookFile(file);
      if (!sheets.length) {
        setJoinError("Essa planilha está vazia ou não foi possível lê-la.");
        return;
      }
      if (sheets.length === 1) {
        applyJoinSheet(sheets[0]!.rows, file.name);
        return;
      }
      // Mais de uma aba com dado: deixa o usuário escolher, em vez de
      // combinar direto com a primeira e descartar o resto silenciosamente.
      setJoinSheetPicker({ fileName: file.name, sheets });
      setJoinSheetPickerIndex(preferredSheetIndex(sheets));
    } catch {
      setJoinError(
        `Não foi possível ler esse arquivo. Formatos aceitos: ${WORKBOOK_FORMATS_LABEL}.`,
      );
    }
  };
  const confirmJoinSheetPicker = () => {
    if (!joinSheetPicker) return;
    const chosen = joinSheetPicker.sheets[joinSheetPickerIndex];
    if (!chosen) return;
    applyJoinSheet(chosen.rows, joinSheetPicker.fileName);
    setJoinSheetPicker(null);
  };
  const resetJoin = () => {
    setJoinRows(null);
    setJoinFileName("");
    setJoinBaseKey("");
    setJoinOtherKey("");
    setJoinError(null);
    if (joinInput.current) joinInput.current.value = "";
  };
  const combineJoin = () => {
    if (!joinRows || !joinBaseKey || !joinOtherKey) return;
    const existingKeys = sheet.columns.map((c) => c.key);
    const { rows: joinedRows, addedKeys } = leftJoin(
      sheet.rows,
      joinBaseKey,
      joinRows,
      joinOtherKey,
      existingKeys,
    );
    if (!addedKeys.length) {
      setJoinError("A segunda planilha não tem colunas novas para combinar.");
      return;
    }
    const newColumns = inferColumns(joinedRows, addedKeys);
    updateSheet({ rows: joinedRows, columns: [...sheet.columns, ...newColumns] });
    setJoinOpen(false);
    resetJoin();
  };

  // Marcadores: um estado nomeado de filtros, busca e ordenação, salvo dentro
  // da própria aba para poder voltar a ele com um clique (ou alternar entre
  // eles automaticamente no modo apresentação).
  const bookmarks = sheet.bookmarks ?? [];
  const saveBookmark = () => {
    const trimmed = bookmarkName.trim();
    if (!trimmed) return;
    const bookmark = createBookmark(trimmed, sheet.filters, search, sort);
    updateSheet({ bookmarks: [...bookmarks, bookmark] });
    setBookmarkName("");
  };
  const removeBookmark = (id: string) =>
    updateSheet({ bookmarks: bookmarks.filter((b) => b.id !== id) });
  const applyBookmark = (b: (typeof bookmarks)[number]) => {
    const view = bookmarkView(b, sheet.columns);
    updateSheet({ filters: view.filters });
    setSearch(view.search);
    setSort(view.sort);
  };
  const startPresentation = () => {
    setPresentIndex(0);
    const first = bookmarks[0];
    if (first) applyBookmark(first);
    setPresentation(true);
  };

  // Modo apresentação: reaproveita a mesma grade de widgets em tela cheia,
  // sem sidebar nem barras de ferramentas, com opção de alternar sozinho
  // entre os marcadores salvos a cada N segundos.
  useEffect(() => {
    if (!presentation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresentation(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentation]);
  useEffect(() => {
    if (!presentation || !autoPlay || bookmarks.length === 0) return;
    const id = setInterval(() => {
      setPresentIndex((i) => {
        const next = (i + 1) % bookmarks.length;
        const bm = bookmarks[next];
        if (bm) applyBookmark(bm);
        return next;
      });
    }, intervalSeconds * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentation, autoPlay, intervalSeconds, bookmarks.length]);

  const gridContent =
    widgets.length === 0 ? (
      <button
        className="oliam-dropzone w-full"
        onClick={() =>
          setWidgets(buildDefaultWidgets(sheet.columns, sheet.chartConfig, sheet.rows))
        }
      >
        <LayoutDashboard className="size-6 text-primary" />
        <strong>Nenhum widget neste painel</strong>
        <span className="text-sm text-muted-foreground">
          Adicione um widget pelo botão "Widget" na barra de ferramentas
        </span>
      </button>
    ) : (
      <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-3">
        {widgets.map((w, i) => (
          <WidgetCard
            key={w.id}
            widget={w}
            index={i}
            count={widgets.length}
            data={data}
            columns={sheet.columns}
            numericCols={nums}
            groupableCols={groupableCols}
            interpolated={interpolated}
            sort={sort}
            setSort={setSort}
            versionDelta={versionDelta}
            folderMonitor={p.folderMonitor}
            animationDelay={Math.min(i, 8) * 40}
            filters={sheet.filters}
            setFilters={setFilters}
            onConfigure={(patch) => updateWidget(w.id, patch)}
            onCopy={() => copyCurrentWidget(w)}
            onPaste={() => pasteCopiedWidget(w.id)}
            canPaste={Boolean(widgetClipboard)}
            onRemove={() => removeWidget(w.id)}
            onMoveBack={() => moveWidget(w.id, -1)}
            onMoveForward={() => moveWidget(w.id, 1)}
            onDropWidget={(fromId) => reorderWidget(fromId, w.id)}
          />
        ))}
      </div>
    );

  const closeSidebarOnMobile = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches) {
      setSidebar(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebar && (
        <div
          className="oliam-sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={cn("oliam-sidebar", !sidebar && "w-0 -translate-x-full border-0")}>
        <div className="flex h-16 items-center gap-3 border-b border-border px-4">
          <Mark />
          <strong className="font-display text-lg tracking-tight">Oli.Qualidade</strong>
        </div>
        <div className="flex-1 overflow-auto p-3">
          <button
            className="oliam-nav-item text-muted-foreground"
            onClick={() => {
              p.backHome();
              closeSidebarOnMobile();
            }}
          >
            <ChevronLeft className="size-4" />
            Todos os painéis
          </button>
          <p className="px-2 pb-1.5 pt-4 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Painéis
          </p>
          {[...p.dashboards]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((x) => (
              <button
                key={x.id}
                className={cn("oliam-nav-item", x.id === d.id && "active")}
                onClick={() => {
                  p.openDash(x.id);
                  closeSidebarOnMobile();
                }}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: x.id === d.id ? "currentColor" : hue(x.id) }}
                />
                <span className="truncate">{x.name}</span>
                {x.pinned && (
                  <Pin
                    className={cn(
                      "ml-auto size-3 shrink-0",
                      x.id === d.id ? "fill-current" : "fill-primary text-primary",
                    )}
                  />
                )}
              </button>
            ))}
          <button
            className="oliam-nav-item text-muted-foreground"
            onClick={() => {
              p.newDash();
              closeSidebarOnMobile();
            }}
          >
            <Plus className="size-4" />
            Novo painel
          </button>
        </div>
        <div className="border-t border-border p-3">
          <button className="oliam-nav-item" onClick={() => setMissingPanel(true)}>
            <Settings2 className="size-4" />
            Regras de dados ausentes
          </button>
          <p className="mt-2 px-2 font-mono text-[10px] text-muted-foreground">
            {sheet.rows.length} linhas · local
          </p>
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="oliam-dashboard-topbar">
          <input
            ref={backupInput}
            type="file"
            accept=".oli-backup,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void restoreEncryptedBackup(file);
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Alternar navegação"
              onClick={() => setSidebar(!sidebar)}
            >
              <Menu />
            </Button>
            <div>
              {editingName ? (
                <input
                  autoFocus
                  className="oliam-plain-input font-display text-sm font-medium"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => e.key === "Enter" && commitName()}
                />
              ) : (
                <h1
                  className="cursor-text font-display text-sm font-medium"
                  onClick={() => setEditingName(true)}
                >
                  {d.name}
                </h1>
              )}
              <p className="font-mono text-[10px] text-muted-foreground">
                {data.length} de {sheet.rows.length} linhas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle theme={p.theme} toggle={p.toggleTheme} />
            <Button
              variant="ghost"
              size="icon"
              aria-label={insightOpen ? "Ocultar visão geral" : "Mostrar visão geral"}
              aria-pressed={insightOpen}
              className={cn(insightOpen && "bg-accent text-primary")}
              onClick={() => setInsightOpen((v) => !v)}
            >
              <PanelRight />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Desfazer"
              disabled={!canUndo}
              onClick={undo}
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refazer"
              disabled={!canRedo}
              onClick={redo}
            >
              <Redo2 />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hidden md:flex"
              onClick={() => setCommand(true)}
            >
              ⌘K Comandos
            </Button>
            <Button variant="outline" size="sm" onClick={p.reimport}>
              <Upload />
              <span className="hidden sm:inline">Nova versão</span>
            </Button>
            {p.folderMonitor ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "max-w-48",
                      p.folderMonitor.status === "error" && "border-destructive text-destructive",
                    )}
                    onClick={
                      p.folderMonitor.status === "error" ? p.connectFolder : p.disconnectFolder
                    }
                    aria-label={
                      p.folderMonitor.status === "error"
                        ? `Retomar pasta monitorada: ${p.folderMonitor.fileName}`
                        : `Desconectar pasta monitorada: ${p.folderMonitor.fileName}`
                    }
                  >
                    {p.folderMonitor.status === "syncing" ? (
                      <OliLoader compact />
                    ) : (
                      <FolderSync className="size-4" />
                    )}
                    <span className="hidden truncate lg:inline">
                      {p.folderMonitor.status === "error"
                        ? "Falha na pasta"
                        : p.folderMonitor.fileName}
                    </span>
                    {p.folderMonitor.status !== "error" && <X className="size-3" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {p.folderMonitor.status === "error"
                      ? p.folderMonitor.error
                      : `Monitorando ${p.folderMonitor.folderName}/${p.folderMonitor.fileName}`}
                  </p>
                  <p className="text-[10px] opacity-75">
                    Última leitura:{" "}
                    {new Date(p.folderMonitor.lastSyncedAt).toLocaleTimeString("pt-BR")}
                  </p>
                  <p className="text-[10px] opacity-75">
                    {p.folderMonitor.status === "error"
                      ? "Clique para autorizar e retomar sem escolher tudo de novo."
                      : "Clique para desconectar."}
                  </p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="hidden lg:flex"
                onClick={p.connectFolder}
              >
                <FolderSync />
                Monitorar pasta
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Download />
                  <span className="hidden sm:inline">Exportar</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={exportXlsx}>
                  <SheetIcon />
                  Planilha XLSX
                </DropdownMenuItem>
                <DropdownMenuItem disabled={exporting !== null} onSelect={() => void exportPng()}>
                  {exporting === "png" ? <OliLoader compact /> : <FileImage />}
                  {exporting === "png" ? "Gerando PNG…" : "Imagem PNG"}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={exporting !== null} onSelect={() => void exportPdf()}>
                  {exporting === "pdf" ? <OliLoader compact /> : <FileText />}
                  {exporting === "pdf" ? "Gerando PDF…" : "PDF do painel (tabelas completas)"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportEncryptedBackup()}>
                  <ShieldAlert />
                  Backup criptografado
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => backupInput.current?.click()}>
                  <Upload />
                  Restaurar backup protegido
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="oliam-toolbar">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input
              className="oliam-input h-9 w-full pl-9"
              placeholder="Buscar em todas as colunas…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="relative">
            <Button variant="outline" onClick={() => setFilterMenu((v) => !v)}>
              <Filter />
              Filtrar
            </Button>
            {filterMenu && (
              <div className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
                {sheet.columns
                  .filter((c) => !sheet.filters.some((f) => f.key === c.key))
                  .map((c) => (
                    <button
                      key={c.key}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        setFilters([...sheet.filters, { key: c.key, value: "", min: "", max: "" }]);
                        setFilterMenu(false);
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                {sheet.columns.every((c) => sheet.filters.some((f) => f.key === c.key)) && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    Todas as colunas já têm filtro.
                  </p>
                )}
              </div>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Plus />
                Widget
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 p-2 sm:w-60">
              <p className="px-1 pb-2 text-[11px] font-medium text-muted-foreground">
                <span className="sm:hidden">Escolha o widget</span>
                <span className="hidden sm:inline">Escolha pelo ícone</span>
              </p>
              <TooltipProvider delayDuration={180}>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-4 sm:gap-1.5">
                  {(Object.keys(widgetTypeLabels) as WidgetType[]).map((type) => (
                    <Tooltip key={type}>
                      <TooltipTrigger asChild>
                        <DropdownMenuItem
                          disabled={!canAdd[type]}
                          onSelect={() => addWidget(type)}
                          aria-label={`${widgetTypeLabels[type]}. ${widgetTypeDescriptions[type]}`}
                          className="flex h-11 w-full cursor-pointer items-center justify-start gap-3 rounded-xl border border-transparent px-3 text-muted-foreground hover:border-border hover:text-foreground focus:border-primary focus:text-primary sm:size-11 sm:justify-center sm:p-0"
                        >
                          <WidgetPickerIcon type={type} />
                          <span className="text-sm font-medium sm:sr-only">
                            {widgetTypeLabels[type]}
                          </span>
                        </DropdownMenuItem>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-64">
                        <p className="font-semibold">{widgetTypeLabels[type]}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {canAdd[type]
                            ? widgetTypeDescriptions[type]
                            : "Este widget precisa de colunas compatíveis nesta aba."}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </TooltipProvider>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            disabled={!widgetClipboard}
            onClick={() => pasteCopiedWidget()}
            title={
              widgetClipboard ? "Colar uma cópia no fim do painel" : "Copie um widget primeiro"
            }
          >
            <ClipboardPaste />
            <span className="hidden sm:inline">Colar widget</span>
          </Button>
          <Button variant="outline" onClick={() => setPanel(!panel)}>
            <Columns3 />
            Colunas
          </Button>
          <Button
            variant="outline"
            className="relative"
            onClick={() => setQualityPanel(!qualityPanel)}
          >
            <ShieldAlert />
            <span className="hidden sm:inline">Qualidade dos dados</span>
            {visibleSignals.length > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                {visibleSignals.length}
              </span>
            )}
          </Button>
          <Button variant="outline" onClick={() => setMissingPanel(!missingPanel)}>
            <Settings2 />
            <span className="hidden sm:inline">Dados ausentes</span>
          </Button>
          <Button variant="outline" onClick={() => setFormatPanel(!formatPanel)}>
            <Palette />
            <span className="hidden sm:inline">Formatação</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              resetJoin();
              setJoinOpen(true);
            }}
          >
            <GitMerge />
            <span className="hidden sm:inline">Combinar planilha</span>
          </Button>
          <div className="relative">
            <Button variant="outline" onClick={() => setBookmarkPanel((v) => !v)}>
              <BookmarkIcon />
              <span className="hidden sm:inline">Marcadores</span>
            </Button>
            {bookmarkPanel && (
              <div className="absolute right-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
                <div className="flex items-center justify-between border-b p-3">
                  <strong className="text-sm">Marcadores</strong>
                  <Button variant="ghost" size="icon" onClick={() => setBookmarkPanel(false)}>
                    <X />
                  </Button>
                </div>
                <div className="max-h-72 overflow-auto p-2">
                  {bookmarks.length === 0 && (
                    <p className="p-2 text-xs text-muted-foreground">
                      Nenhum marcador salvo ainda. Ajuste os filtros e salve o estado atual abaixo.
                    </p>
                  )}
                  {bookmarks.map((b) => (
                    <div key={b.id} className="flex items-center gap-1 p-1">
                      <button
                        className="flex-1 truncate px-2 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          applyBookmark(b);
                          setBookmarkPanel(false);
                        }}
                      >
                        {b.name}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label={`Excluir marcador ${b.name}`}
                        onClick={() => removeBookmark(b.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 border-t p-3">
                  <input
                    className="oliam-input h-9 flex-1"
                    placeholder="Nome do marcador…"
                    value={bookmarkName}
                    onChange={(e) => setBookmarkName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveBookmark()}
                  />
                  <Button
                    size="icon"
                    aria-label="Salvar estado atual como marcador"
                    disabled={!bookmarkName.trim()}
                    onClick={saveBookmark}
                  >
                    <BookmarkPlus />
                  </Button>
                </div>
              </div>
            )}
          </div>
          <Button variant="outline" onClick={startPresentation}>
            <Maximize2 />
            <span className="hidden sm:inline">Apresentação</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Atalhos de teclado"
            onClick={() => setShortcuts(true)}
          >
            <HelpCircle />
          </Button>
        </div>
        {showTermHint && (
          <div className="flex items-start gap-3 border-b border-border bg-tint px-5 py-3">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="flex-1 text-xs text-foreground">
              <strong>Agrupamento</strong> organiza os dados por uma coluna, como categoria ou data.{" "}
              <strong>Agregação</strong> combina os valores dentro de cada grupo: soma, média,
              contagem, mínimo ou máximo.
            </p>
            <button
              className="shrink-0 text-xs font-medium text-primary hover:underline"
              onClick={dismissTermHint}
            >
              Entendi
            </button>
            <button className="shrink-0" aria-label="Dispensar dica" onClick={dismissTermHint}>
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {sheet.filters.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b px-5 py-2">
            {sheet.filters.map((f, i) => {
              const col = sheet.columns.find((c) => c.key === f.key);
              const isRange = col && (numericKinds.includes(col.kind) || col.kind === "date");
              return (
                <div
                  className="flex items-center rounded-full border border-border bg-accent text-xs"
                  key={i}
                >
                  <span className="px-2 text-muted-foreground">{col?.label}</span>
                  {isRange ? (
                    <>
                      <input
                        autoFocus
                        type={col.kind === "date" ? "text" : "number"}
                        className="w-20 bg-transparent py-1 outline-none"
                        placeholder={col.kind === "date" ? "dd/mm/aaaa" : "mín"}
                        value={f.min ?? ""}
                        onChange={(e) =>
                          setFilters(
                            sheet.filters.map((x, j) =>
                              j === i ? { ...x, min: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <span className="text-muted-foreground">–</span>
                      <input
                        type={col.kind === "date" ? "text" : "number"}
                        className="w-20 bg-transparent py-1 outline-none"
                        placeholder={col.kind === "date" ? "dd/mm/aaaa" : "máx"}
                        value={f.max ?? ""}
                        onChange={(e) =>
                          setFilters(
                            sheet.filters.map((x, j) =>
                              j === i ? { ...x, max: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </>
                  ) : (
                    <input
                      autoFocus
                      className="w-24 bg-transparent py-1 outline-none"
                      placeholder="valor…"
                      value={f.value}
                      onChange={(e) =>
                        setFilters(
                          sheet.filters.map((x, j) =>
                            j === i ? { ...x, value: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  )}
                  <button
                    className="rounded-r-full p-1.5 pr-2.5 text-muted-foreground transition-colors hover:text-destructive"
                    aria-label="Remover filtro"
                    onClick={() => setFilters(sheet.filters.filter((_, j) => j !== i))}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {qualityPanel && (
          <div className="absolute inset-x-4 top-28 z-40 w-auto max-w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-panel sm:inset-x-auto sm:right-4 sm:w-96">
            <div className="flex items-center justify-between border-b p-3">
              <strong className="text-sm">Qualidade dos dados</strong>
              <Button variant="ghost" size="icon" onClick={() => setQualityPanel(false)}>
                <X />
              </Button>
            </div>
            {visibleSignals.length === 0 ? (
              <p className="p-4 text-[12px] text-muted-foreground">
                Nenhum problema encontrado nos dados atuais.
              </p>
            ) : (
              <div className="max-h-96 overflow-auto p-2">
                {visibleSignals.map((s) => (
                  <div
                    key={`${s.kind}-${s.columnKey}`}
                    className="flex items-start gap-2 border-b p-2 text-[12px] last:border-b-0"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    <p className="flex-1 leading-relaxed">{s.message}</p>
                    <button
                      className="shrink-0 p-0.5"
                      aria-label="Dispensar aviso"
                      onClick={() =>
                        setDismissedSignals((prev) => new Set(prev).add(`${s.kind}-${s.columnKey}`))
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {panel && (
          <div className="absolute inset-x-4 top-28 z-40 w-auto max-w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-panel sm:inset-x-auto sm:right-4 sm:w-96">
            <div className="flex items-center justify-between border-b p-3">
              <strong className="text-sm">Colunas visíveis</strong>
              <Button variant="ghost" size="icon" onClick={() => setPanel(false)}>
                <X />
              </Button>
            </div>
            <p className="px-2 pb-2 text-[11px] text-muted-foreground">
              Arraste uma coluna direto para o campo de um gráfico, ou solte aqui para reordenar.
            </p>
            <div className="max-h-96 overflow-auto p-2">
              {sheet.columns.map((c, i) => (
                <div
                  key={c.key}
                  draggable
                  onDragStart={(e) => {
                    // Reordenar dentro desta lista (texto = índice de origem).
                    e.dataTransfer.setData("text/plain", String(i));
                    // Arrastar para um slot de campo de gráfico fora da lista
                    // (tipo MIME sintético que já embute o Kind da coluna,
                    // ver columnDragType em src/lib/widgets.ts).
                    e.dataTransfer.setData(columnDragType(c.kind), c.key);
                    e.dataTransfer.effectAllowed = "all";
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = Number(e.dataTransfer.getData("text/plain"));
                    if (Number.isNaN(from) || from === i) return;
                    const next = [...sheet.columns];
                    const moved = next.splice(from, 1)[0];
                    if (!moved) return;
                    next.splice(i, 0, moved);
                    setColumns(next);
                  }}
                  className="flex items-center gap-2 p-2 text-sm hover:bg-accent"
                >
                  <label className="flex flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={c.visible}
                      onChange={() =>
                        setColumns(
                          sheet.columns.map((x, j) =>
                            j === i ? { ...x, visible: !x.visible } : x,
                          ),
                        )
                      }
                    />
                    <GripVertical
                      className="size-4 shrink-0 cursor-grab text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {c.label}
                      {c.formula && (
                        <Calculator
                          className="ml-1 inline size-3 text-secondary-accent"
                          aria-label="Coluna calculada"
                        />
                      )}
                    </span>
                    {c.description && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="size-3 shrink-0 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>{c.description}</TooltipContent>
                      </Tooltip>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {kinds[c.kind]}
                    </span>
                  </label>
                  <div className="flex shrink-0 flex-col">
                    <button
                      className="disabled:opacity-30"
                      aria-label={`Mover ${c.label} para cima`}
                      disabled={i === 0}
                      onClick={() => {
                        if (i === 0) return;
                        const next = [...sheet.columns];
                        const a = next[i - 1],
                          b = next[i];
                        if (!a || !b) return;
                        next[i - 1] = b;
                        next[i] = a;
                        setColumns(next);
                      }}
                    >
                      <ChevronUp className="size-3" />
                    </button>
                    <button
                      className="disabled:opacity-30"
                      aria-label={`Mover ${c.label} para baixo`}
                      disabled={i === sheet.columns.length - 1}
                      onClick={() => {
                        if (i === sheet.columns.length - 1) return;
                        const next = [...sheet.columns];
                        const a = next[i],
                          b = next[i + 1];
                        if (!a || !b) return;
                        next[i] = b;
                        next[i + 1] = a;
                        setColumns(next);
                      }}
                    >
                      <ChevronDown className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t p-3">
              {addingFormula ? (
                <div className="space-y-2">
                  <input
                    className="oliam-input w-full"
                    placeholder="Nome da coluna, ex: Lucro"
                    value={formulaLabel}
                    onChange={(e) => setFormulaLabel(e.target.value)}
                  />
                  <input
                    className="oliam-input w-full font-mono text-xs"
                    placeholder="Fórmula, ex: receita - custo"
                    value={formulaText}
                    onChange={(e) => setFormulaText(e.target.value)}
                  />
                  {formulaError && <p className="text-xs text-destructive">{formulaError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAddingFormula(false);
                        setFormulaError(null);
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        const availableKeys = sheet.columns.map((c) => c.key);
                        const error = validateFormula(formulaText, availableKeys);
                        if (error) {
                          setFormulaError(error);
                          return;
                        }
                        const label = formulaLabel.trim() || "Coluna calculada";
                        const key = `calc_${label
                          .toLowerCase()
                          .replaceAll(/[^a-z0-9]+/g, "_")}_${Date.now().toString(36)}`;
                        setColumns([
                          ...sheet.columns,
                          {
                            key,
                            label,
                            kind: "number",
                            visible: true,
                            description: `Calculada a partir de: ${formulaText}`,
                            formula: formulaText,
                          },
                        ]);
                        setAddingFormula(false);
                        setFormulaLabel("");
                        setFormulaText("");
                        setFormulaError(null);
                      }}
                    >
                      Criar coluna
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" className="w-full" onClick={() => setAddingFormula(true)}>
                  <Calculator className="size-4" />
                  Nova coluna calculada
                </Button>
              )}
            </div>
          </div>
        )}
        {exportError && (
          <div
            role="status"
            className="absolute right-4 top-20 z-40 flex items-center gap-2 border border-destructive bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
          >
            <AlertTriangle className="size-3.5 shrink-0" />
            {exportError}
          </div>
        )}
        {missingPanel && (
          <div className="absolute inset-x-4 top-28 z-40 w-auto max-w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-panel sm:inset-x-auto sm:right-4 sm:w-96">
            <div className="flex items-center justify-between border-b p-3">
              <strong className="text-sm">Regras de dados ausentes</strong>
              <Button variant="ghost" size="icon" onClick={() => setMissingPanel(false)}>
                <X />
              </Button>
            </div>
            <div className="max-h-96 overflow-auto p-2">
              {sheet.columns
                .filter((c) => !c.formula)
                .map((c) => {
                  const isNumeric = numericKinds.includes(c.kind);
                  return (
                    <div
                      key={c.key}
                      className="flex items-center justify-between gap-3 p-2 text-sm"
                    >
                      <span className="truncate">{c.label}</span>
                      <select
                        className="oliam-select w-44 shrink-0"
                        value={c.missingRule ?? "ignore"}
                        onChange={(e) => {
                          const value = e.target.value as NonNullable<Column["missingRule"]>;
                          setColumns(
                            sheet.columns.map((x) =>
                              x.key === c.key ? { ...x, missingRule: value } : x,
                            ),
                          );
                        }}
                      >
                        {isNumeric ? (
                          <>
                            <option value="ignore">Ignorar nos totais</option>
                            <option value="zero">Tratar como zero</option>
                            <option value="interpolate">Interpolação linear</option>
                            <option value="hide-row">Ocultar linha</option>
                          </>
                        ) : (
                          <>
                            <option value="ignore">Exibir "Não informado"</option>
                            <option value="hide-row">Ocultar linha</option>
                          </>
                        )}
                      </select>
                    </div>
                  );
                })}
              <p className="p-2 text-xs text-muted-foreground">
                Valores estimados por interpolação aparecem com um contorno fino na tabela.
              </p>
            </div>
          </div>
        )}
        {formatPanel && (
          <div className="absolute inset-x-4 top-28 z-40 w-auto max-w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-panel sm:inset-x-auto sm:right-4 sm:w-96">
            <div className="flex items-center justify-between border-b p-3">
              <strong className="text-sm">Formatação condicional</strong>
              <Button variant="ghost" size="icon" onClick={() => setFormatPanel(false)}>
                <X />
              </Button>
            </div>
            <div className="max-h-96 overflow-auto p-2">
              {nums.length === 0 && (
                <p className="p-2 text-xs text-muted-foreground">
                  Nenhuma coluna numérica disponível para formatar.
                </p>
              )}
              {nums.map((c) => (
                <FormatRulesEditor
                  key={c.key}
                  column={c}
                  onChange={(rules) =>
                    setColumns(
                      sheet.columns.map((x) =>
                        x.key === c.key ? { ...x, conditionalFormat: rules } : x,
                      ),
                    )
                  }
                />
              ))}
              <p className="p-2 text-xs text-muted-foreground">
                Regras de limite colorem o valor quando ele cruza um número. Regras de escala pintam
                o fundo em degradê entre um mínimo e um máximo, estilo heatmap.
              </p>
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div ref={contentRef} className="min-w-0 flex-1 overflow-auto bg-canvas p-4 md:p-6">
            <div className="oliam-export-header" aria-hidden="true">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
                  Oli.Qualidade
                </p>
                <h1 className="mt-1 font-display text-2xl font-bold">{d.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Aba {sheet.name} · {data.length} de {sheet.rows.length} linhas
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>Relatório gerado em</p>
                <p className="mt-1 font-mono text-foreground">
                  {new Date().toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
            {detailedVersionDiff && (
              <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <GitMerge className="size-4 text-primary" /> Comparação com a versão anterior
                </div>
                {detailedVersionDiff.reason && (
                  <p
                    className={cn(
                      "mt-3 rounded-xl border px-3 py-2 text-xs",
                      detailedVersionDiff.status === "incompatible"
                        ? "border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-300"
                        : "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300",
                    )}
                  >
                    {detailedVersionDiff.reason}
                  </p>
                )}
                {detailedVersionDiff.status !== "incompatible" && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <span className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                      +{detailedVersionDiff.added} linhas adicionadas
                    </span>
                    <span className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                      −{detailedVersionDiff.removed} linhas removidas
                    </span>
                    <span className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                      {detailedVersionDiff.changed} linhas alteradas
                    </span>
                  </div>
                )}
                {(detailedVersionDiff.addedColumns.length > 0 ||
                  detailedVersionDiff.removedColumns.length > 0 ||
                  detailedVersionDiff.typeChanges.length > 0) && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                    {detailedVersionDiff.addedColumns.map((column) => (
                      <span key={`add-${column}`} className="rounded-full border px-2.5 py-1">
                        Nova coluna: {column}
                      </span>
                    ))}
                    {detailedVersionDiff.removedColumns.map((column) => (
                      <span key={`remove-${column}`} className="rounded-full border px-2.5 py-1">
                        Coluna não reconhecida na nova versão: {column}
                      </span>
                    ))}
                    {detailedVersionDiff.typeChanges.map((change) => (
                      <span
                        key={`type-${change.column}`}
                        className="rounded-full border px-2.5 py-1"
                      >
                        {change.column}: {change.before} → {change.after}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {gridContent}
          </div>
          {insightOpen && (
            <aside className="oliam-insight-sidebar hidden shrink-0 overflow-auto lg:block">
              <div className="border-b border-border p-4">
                <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                  Visão geral
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {data.length} de {sheet.rows.length} linhas na visão atual
                </p>
              </div>
              {sheet.autoDashboard && (
                <div className="border-b border-border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                      Dashboard sugerido
                    </p>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                      {sheet.autoDashboard.confidence}% confiança
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Criado automaticamente a partir dos tipos, preenchimento e qualidade das
                    colunas.
                  </p>
                  <div className="mt-3 space-y-2">
                    {sheet.autoDashboard.recommendations.slice(0, 5).map((item) => (
                      <div key={item.id} className="rounded-xl border border-border bg-card p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium leading-snug">{item.title}</p>
                          <span className="shrink-0 font-mono text-[10px] text-primary">
                            {item.confidence}%
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          {item.reasons[0]}
                        </p>
                        {item.warnings[0] && (
                          <p className="mt-1 text-[11px] leading-relaxed text-amber-600">
                            {item.warnings[0]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {nums.length > 0 && (
                <div className="border-b border-border p-4">
                  <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    KPIs
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {nums.slice(0, 4).map((c) => {
                      const total = data.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
                      const delta = versionDelta?.get(c.key) ?? null;
                      const style = conditionalStyle(total, c.kind, c.conditionalFormat);
                      return (
                        <div
                          key={c.key}
                          className="rounded-xl border border-border bg-card p-2.5 shadow-sm"
                          style={style ?? undefined}
                        >
                          <p className="truncate text-[11px] text-muted-foreground">{c.label}</p>
                          <p
                            className="font-mono text-base font-semibold"
                            style={{ color: style?.color }}
                          >
                            {fmt(total, c.kind)}
                          </p>
                          {delta !== null && (
                            <p
                              className={cn(
                                "font-mono text-[10px]",
                                delta >= 0 ? "text-secondary-accent" : "text-destructive",
                              )}
                            >
                              {delta >= 0 ? "+" : ""}
                              {new Intl.NumberFormat("pt-BR", {
                                style: "percent",
                                maximumFractionDigits: 1,
                              }).format(delta)}{" "}
                              vs. anterior
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {sidebarRanking.length > 0 && cat && primary && (
                <div className="border-b border-border p-4">
                  <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    Ranking por {cat.label}
                  </p>
                  <div className="space-y-0.5">
                    {sidebarRanking.map((r) => {
                      const active = sheet.filters.some(
                        (f) => f.key === cat.key && f.value === r.name,
                      );
                      return (
                        <button
                          key={r.name}
                          className={cn(
                            "oliam-ranking-row block w-full text-left transition-opacity hover:opacity-90",
                            active && "opacity-100",
                          )}
                          onClick={() => {
                            if (active) {
                              setFilters(sheet.filters.filter((f) => f.key !== cat.key));
                            } else {
                              setFilters([
                                ...sheet.filters.filter((f) => f.key !== cat.key),
                                { key: cat.key, value: r.name, min: "", max: "" },
                              ]);
                            }
                          }}
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="truncate text-xs">{r.name || "Não informado"}</span>
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                              {fmt(r.total, primary.kind)}
                            </span>
                          </div>
                          <div className="oliam-ranking-track">
                            <div
                              className="oliam-ranking-fill"
                              style={{
                                width: `${Math.max(4, (Math.abs(r.total) / sidebarRankingMax) * 100)}%`,
                                background:
                                  conditionalColor(
                                    r.total,
                                    primary.kind,
                                    primary.conditionalFormat,
                                  ) ?? (active ? "var(--primary)" : "var(--secondary-accent)"),
                              }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {dateCol && (
                <div className="p-4">
                  <p className="mb-3 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Filtrar por {dateCol.label}
                  </p>
                  {(() => {
                    const existing = sheet.filters.find((f) => f.key === dateCol.key);
                    return (
                      <div className="flex flex-col gap-2">
                        <input
                          className="oliam-input h-9"
                          type="text"
                          placeholder="De, dd/mm/aaaa"
                          value={existing?.min ?? ""}
                          onChange={(e) => {
                            const min = e.target.value;
                            const rest = sheet.filters.filter((f) => f.key !== dateCol.key);
                            setFilters([
                              ...rest,
                              { key: dateCol.key, value: "", min, max: existing?.max ?? "" },
                            ]);
                          }}
                        />
                        <input
                          className="oliam-input h-9"
                          type="text"
                          placeholder="Até, dd/mm/aaaa"
                          value={existing?.max ?? ""}
                          onChange={(e) => {
                            const max = e.target.value;
                            const rest = sheet.filters.filter((f) => f.key !== dateCol.key);
                            setFilters([
                              ...rest,
                              { key: dateCol.key, value: "", min: existing?.min ?? "", max },
                            ]);
                          }}
                        />
                      </div>
                    );
                  })()}
                </div>
              )}
            </aside>
          )}
        </div>
        {d.sheets.length > 1 && (
          <div
            className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-t border-border bg-muted/30 px-2 py-1.5"
            role="tablist"
            aria-label="Abas do painel"
          >
            {d.sheets.map((s, i) => (
              <button
                key={s.name + i}
                role="tab"
                aria-selected={i === activeSheetIndex}
                onClick={() => switchSheet(i)}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  i === activeSheetIndex
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                title={`${s.name} · ${s.rows.length} linhas`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </section>
      {presentation && (
        <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Mark />
              <span className="font-display text-sm font-medium text-foreground">{d.name}</span>
              {bookmarks.length > 0 && (
                <span className="font-mono">
                  · marcador {presentIndex + 1}/{bookmarks.length}
                  {bookmarks[presentIndex] ? `: ${bookmarks[presentIndex].name}` : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {bookmarks.length > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      autoPlay ? "Pausar alternância automática" : "Alternar automaticamente"
                    }
                    onClick={() => setAutoPlay((v) => !v)}
                  >
                    {autoPlay ? <Pause /> : <Play />}
                  </Button>
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    a cada
                    <input
                      type="number"
                      min={3}
                      className="oliam-input h-8 w-14 text-center"
                      value={intervalSeconds}
                      onChange={(e) => setIntervalSeconds(Math.max(3, Number(e.target.value) || 3))}
                    />
                    s
                  </label>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAutoPlay(false);
                  setPresentation(false);
                }}
              >
                <Minimize2 />
                Sair (Esc)
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4 md:p-6">{gridContent}</div>
        </div>
      )}
      <CommandDialog open={command} onOpenChange={setCommand}>
        <CommandInput placeholder="Filtrar, trocar painel ou exportar…" />
        <CommandList>
          <CommandEmpty>Nenhum comando encontrado.</CommandEmpty>
          <CommandGroup heading="Ações">
            <CommandItem onSelect={undo} disabled={!canUndo}>
              <Undo2 />
              Desfazer
            </CommandItem>
            <CommandItem onSelect={redo} disabled={!canRedo}>
              <Redo2 />
              Refazer
            </CommandItem>
            <CommandItem onSelect={() => pasteCopiedWidget()} disabled={!widgetClipboard}>
              <ClipboardPaste />
              Colar widget copiado
            </CommandItem>
            <CommandItem onSelect={p.reimport}>
              <Upload />
              Importar nova versão
            </CommandItem>
            <CommandItem
              onSelect={
                p.folderMonitor?.status === "error" || !p.folderMonitor
                  ? p.connectFolder
                  : p.disconnectFolder
              }
            >
              <FolderSync />
              {p.folderMonitor?.status === "error"
                ? "Reconectar pasta monitorada"
                : p.folderMonitor
                  ? "Desconectar pasta monitorada"
                  : "Monitorar pasta local"}
            </CommandItem>
            <CommandItem onSelect={exportXlsx}>
              <Download />
              Exportar XLSX
            </CommandItem>
            <CommandItem onSelect={() => void exportPng()}>
              <FileImage />
              Exportar PNG
            </CommandItem>
            <CommandItem onSelect={() => void exportPdf()}>
              <FileText />
              Exportar PDF do painel
            </CommandItem>
            <CommandItem onSelect={() => void exportEncryptedBackup()}>
              <ShieldAlert />
              Criar backup criptografado
            </CommandItem>
            <CommandItem onSelect={() => backupInput.current?.click()}>
              <Upload />
              Restaurar backup protegido
            </CommandItem>
            <CommandItem onSelect={() => setFormatPanel(true)}>
              <Palette />
              Formatação condicional
            </CommandItem>
            <CommandItem onSelect={() => setShortcuts(true)}>
              <HelpCircle />
              Atalhos de teclado
            </CommandItem>
            <CommandItem onSelect={() => setPanel(true)}>
              <Columns3 />
              Configurar colunas
            </CommandItem>
            <CommandItem onSelect={startPresentation}>
              <Maximize2 />
              Modo apresentação
            </CommandItem>
            <CommandItem
              onSelect={() => {
                resetJoin();
                setJoinOpen(true);
              }}
            >
              <GitMerge />
              Combinar planilha
            </CommandItem>
            <CommandItem onSelect={p.toggleTheme}>
              {p.theme === "dark" ? <Sun /> : <Moon />}Alternar modo escuro
            </CommandItem>
            <CommandItem onSelect={p.backHome}>
              <LayoutGrid />
              Ver todos os painéis
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <Dialog
        open={joinOpen}
        onOpenChange={(open) => {
          setJoinOpen(open);
          if (!open) resetJoin();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Combinar planilha</DialogTitle>
            <DialogDescription>
              Importe uma segunda planilha e combine com o painel atual por uma coluna em comum
              (left join: todas as linhas do painel são mantidas, e os campos da segunda planilha
              entram como colunas novas).
            </DialogDescription>
          </DialogHeader>
          {!joinRows ? (
            <button
              className="oliam-dropzone w-full"
              data-dragging={joinDragging}
              onClick={() => joinInput.current?.click()}
              type="button"
              onDragEnter={(e) => {
                e.preventDefault();
                setJoinDragging(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => {
                e.preventDefault();
                setJoinDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setJoinDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void parseJoinFile(file);
              }}
            >
              <Upload className="size-6 text-primary" />
              <strong>{joinDragging ? "Solte o arquivo aqui" : "Enviar segunda planilha"}</strong>
              <span className="text-sm text-muted-foreground">Excel, CSV, ODS ou Numbers</span>
            </button>
          ) : (
            <div className="space-y-3">
              <p className="font-mono text-xs text-muted-foreground">
                {joinFileName} · {joinRows.length} linhas
              </p>
              <label className="block text-sm">
                Coluna de correspondência no painel atual
                <select
                  className="oliam-select mt-1 w-full max-w-none"
                  value={joinBaseKey}
                  onChange={(e) => setJoinBaseKey(e.target.value)}
                >
                  {sheet.columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Coluna de correspondência na nova planilha
                <select
                  className="oliam-select mt-1 w-full max-w-none"
                  value={joinOtherKey}
                  onChange={(e) => setJoinOtherKey(e.target.value)}
                >
                  {Object.keys(joinRows[0] ?? {}).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                Linhas do painel sem correspondência na nova planilha ficam com essas novas colunas
                em branco.
              </p>
            </div>
          )}
          {joinError && <p className="text-xs text-destructive">{joinError}</p>}
          <input
            ref={joinInput}
            type="file"
            accept={WORKBOOK_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void parseJoinFile(file);
            }}
          />
          {joinRows && (
            <DialogFooter>
              <Button variant="ghost" onClick={resetJoin}>
                Trocar arquivo
              </Button>
              <Button onClick={combineJoin}>
                <GitMerge />
                Combinar
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {joinSheetPicker && (
        <SheetPickerDialog
          fileName={joinSheetPicker.fileName}
          sheets={joinSheetPicker.sheets}
          selected={joinSheetPickerIndex}
          onSelectedChange={setJoinSheetPickerIndex}
          onConfirm={confirmJoinSheetPicker}
          onCancel={() => setJoinSheetPicker(null)}
        />
      )}
      <Dialog open={shortcuts} onOpenChange={setShortcuts}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Atalhos de teclado</DialogTitle>
            <DialogDescription>Ações rápidas disponíveis dentro de um painel.</DialogDescription>
          </DialogHeader>
          <ul className="divide-y">
            {[
              { keys: "⌘K / Ctrl+K", label: "Abrir a paleta de comandos" },
              { keys: "? ou ⌘/ / Ctrl+/", label: "Abrir esta referência de atalhos" },
              { keys: "Clique numa barra ou fatia", label: "Filtrar a base pelo grupo clicado" },
              { keys: "Arrastar ou ↑ / ↓", label: "Reordenar colunas no painel de colunas" },
              {
                keys: "Arrastar o cabeçalho ou ← / →",
                label: "Reordenar widgets no painel",
              },
              { keys: "⌘Z / Ctrl+Z", label: "Desfazer a última alteração no painel" },
              { keys: "⇧⌘Z / Ctrl+Shift+Z", label: "Refazer a alteração desfeita" },
              { keys: "Esc", label: "Sair do modo apresentação" },
              { keys: "Enter", label: "Confirmar edição de nome do painel ou de coluna" },
            ].map((s) => (
              <li key={s.keys} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="text-muted-foreground">{s.label}</span>
                <kbd className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11px]">
                  {s.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <GeminiChatPanel dashboard={d} sheet={sheet} liveRows={data} liveView={assistantContext} />
    </div>
  );
}

function OliFace({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cn("oli-face", compact && "oli-face-compact")} aria-hidden="true">
      <svg viewBox="0 0 440 420" focusable="false">
        <path
          className="oli-face-outline"
          d="M58 210C53 129 106 60 198 45C286 30 365 75 383 160C403 253 369 330 289 365C210 399 113 374 76 308C59 278 54 244 58 210Z"
        />
        <path className="oli-face-eye" d="M143 137C149 166 163 176 177 143" />
        <path className="oli-face-eye" d="M215 126C219 158 235 168 248 132" />
        <path className="oli-face-smile" d="M121 195C167 234 248 240 300 188" />
      </svg>
    </span>
  );
}

function GeminiChatPanel({
  dashboard,
  sheet,
  liveRows,
  liveView,
}: {
  dashboard: Dashboard;
  sheet: SheetData;
  liveRows: Row[];
  liveView: LiveDashboardContext;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<GeminiChatMessage[]>([]);
  const suggestedPrompts = useMemo(() => buildLiveSuggestedPrompts(liveView), [liveView]);

  useEffect(() => setMessages([]), [dashboard.id, sheet.name]);

  const submit = async (suggestedMessage?: string) => {
    const message = (suggestedMessage ?? draft).trim();
    if (!message || loading) return;
    setDraft("");
    setMessages((current) => [...current, { role: "user", text: message }]);
    setLoading(true);
    try {
      const answer = await askGemini(message, dashboard, sheet, liveRows, liveView, messages);
      setMessages((current) => [...current, { role: "assistant", text: answer }]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: error instanceof Error ? error.message : "Não foi possível responder.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="oli-assistant-shell">
      {open && (
        <section className="oli-chat-panel" aria-label="Conversa com o assistente Oli">
          <header className="oli-chat-header">
            <div className="oli-chat-identity">
              <span className="oli-chat-avatar">
                <OliFace compact />
              </span>
              <div>
                <strong>Oli</strong>
                <p>
                  {sheet.name} · {liveView.visibleRows} linhas
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
              aria-label="Fechar assistente"
              className="oli-chat-close"
            >
              <X className="size-4" />
            </Button>
          </header>
          <div className="oli-chat-content" aria-live="polite">
            {!messages.length && (
              <div className="oli-chat-welcome">
                <strong>O que você quer entender neste painel?</strong>
                <span>Use uma sugestão ou escreva sua pergunta.</span>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={cn("oli-chat-message", `oli-chat-message-${message.role}`)}
              >
                {message.text}
              </div>
            ))}
            {loading && (
              <div className="oli-chat-loading" role="status">
                <OliLoader compact />
                <span>Analisando o painel…</span>
              </div>
            )}
          </div>
          <div className="oli-chat-suggestions" aria-label="Perguntas sugeridas para esta visão">
            {suggestedPrompts.slice(0, 2).map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={loading}
                onClick={() => void submit(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
          <form
            className="oli-chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={2000}
              placeholder="Pergunte sobre este painel…"
              aria-label="Mensagem para o assistente"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!draft.trim() || loading}
              aria-label="Enviar mensagem"
            >
              <Send className="size-4" />
            </Button>
          </form>
        </section>
      )}
      <div className="oli-mascot-group" data-open={open || undefined}>
        <span className="oli-chat-invite" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 9h8" />
            <path d="M8 13h6" />
            <path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12z" />
          </svg>
          <strong>{open ? "Fechar conversa" : "Converse comigo!"}</strong>
        </span>
        <button
          type="button"
          className="oli-mascot"
          data-state={loading ? "thinking" : open ? "chatting" : "idle"}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? "Fechar conversa com Oli" : "Conversar com Oli"}
        >
          <OliFace />
          <span className="oli-mascot-name">Oli</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Envolve um campo de configuração de widget (select de "Agrupar por" ou
 * "Coluna numérica") como zona de soltar, para permitir arrastar uma coluna
 * do painel "Colunas visíveis" diretamente para o campo, como alternativa
 * ao select (que continua funcionando normalmente por teclado). O destaque
 * visual (contorno tracejado) só aparece quando o item arrastado é uma
 * coluna de um tipo aceito por esse campo específico (ex: campo numérico
 * não aceita colunas de texto).
 */
function FieldDropSlot({
  accepts,
  onDropColumn,
  children,
}: {
  accepts: readonly Kind[];
  onDropColumn: (key: string) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const warned = useRef(false);
  return (
    <div
      className={cn(
        "rounded-sm outline-offset-2 transition-[outline-color]",
        over ? "outline outline-2 outline-dashed outline-primary" : "outline-none",
      )}
      onDragOver={(e) => {
        if (columnDropAccepted(e.dataTransfer.types, accepts)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!over) setOver(true);
          warned.current = false;
          return;
        }
        // Coluna de um tipo que este campo não aceita (ex.: texto solto
        // sobre o campo "Coluna numérica"): avisa uma única vez por gesto
        // de arraste, já que dragover dispara várias vezes por segundo
        // enquanto o cursor fica parado sobre o slot.
        const draggedKind = draggedColumnKind(e.dataTransfer.types);
        if (draggedKind && !warned.current) {
          warned.current = true;
          toast.error(`Este campo não aceita colunas do tipo ${kinds[draggedKind]}.`, {
            description: `Tipos aceitos aqui: ${accepts.map((k) => kinds[k]).join(", ")}.`,
          });
        }
      }}
      onDragLeave={(e) => {
        // dragenter/dragleave disparam para cada elemento filho (o texto do
        // rótulo, o <select>), então sem essa checagem o contorno pisca ao
        // arrastar sobre o conteúdo interno em vez de ficar estável durante
        // todo o hover sobre o slot.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
        warned.current = false;
      }}
      onDrop={(e) => {
        if (!columnDropAccepted(e.dataTransfer.types, accepts)) return;
        e.preventDefault();
        setOver(false);
        for (const k of accepts) {
          const key = e.dataTransfer.getData(columnDragType(k));
          if (key) {
            onDropColumn(key);
            return;
          }
        }
      }}
    >
      {children}
    </div>
  );
}

function GroupAggHint() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label="O que são agrupamento e agregação"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-56">
        Agrupamento organiza os dados por uma coluna. Agregação combina os valores de cada grupo:
        soma, média, contagem, mínimo ou máximo.
      </TooltipContent>
    </Tooltip>
  );
}
function WidgetHead({
  title,
  icon,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onRemove,
  onCopy,
  onPaste,
  canPaste,
  onMoveBack,
  onMoveForward,
  disableBack,
  disableForward,
}: {
  title: string;
  icon?: React.ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onRemove?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  canPaste?: boolean;
  onMoveBack?: () => void;
  onMoveForward?: () => void;
  disableBack?: boolean;
  disableForward?: boolean;
}) {
  const interactive = !!(onRemove || onCopy || onPaste || onMoveBack || onMoveForward);
  return (
    <div
      className="flex h-12 flex-wrap items-center justify-between gap-1 border-b border-border bg-muted/30 px-3"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex min-w-0 items-center gap-2 px-1">
        <GripVertical
          data-export-controls
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground",
            draggable && "cursor-grab",
          )}
          aria-hidden="true"
        />
        {icon && <span className="shrink-0 text-primary [&_svg]:size-4">{icon}</span>}
        <h2 className="truncate font-display text-[13px] font-semibold tracking-tight">{title}</h2>
      </div>
      {interactive && (
        <div className="flex shrink-0 items-center gap-0.5" data-export-controls>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Copiar ${title}`}
            title="Copiar widget"
            onClick={onCopy}
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Colar widget após ${title}`}
            title={canPaste ? "Colar widget após este" : "Copie um widget primeiro"}
            disabled={!canPaste}
            onClick={onPaste}
          >
            <ClipboardPaste className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Mover ${title} para trás`}
            disabled={disableBack}
            onClick={onMoveBack}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`Mover ${title} para frente`}
            disabled={disableForward}
            onClick={onMoveForward}
          >
            <ArrowRight className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Remover ${title}`}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

const widgetSizeLabels: Record<WidgetSize, string> = { sm: "Baixo", md: "Médio", lg: "Alto" };
const widgetSpanLabels: Record<WidgetSpan, string> = { 1: "1/3", 2: "2/3", 3: "Cheio" };

const widgetTypeDescriptions: Record<WidgetType, string> = {
  metric: "Resume uma coluna numérica em um único indicador.",
  "metric-trend": "Mostra um indicador e sua evolução ao longo do tempo.",
  "folder-files": "Conta e acompanha as planilhas de uma pasta monitorada.",
  bar: "Compara valores entre categorias usando barras.",
  pie: "Mostra a participação de cada categoria no total.",
  line: "Exibe a evolução dos valores por data.",
  area: "Destaca volume e evolução ao longo de um período.",
  ranking: "Ordena e exibe os maiores resultados.",
  rating: "Transforma uma média numérica em uma nota visual.",
  map: "Distribui os resultados por cidade, estado ou país.",
  "schedule-heatmap": "Cruza itens e períodos, colorindo o andamento do cronograma.",
  table: "Exibe os registros detalhados da base.",
};

function WidgetPickerIcon({ type }: { type: WidgetType }) {
  const className = "size-5";
  if (type === "metric") return <Calculator className={className} />;
  if (type === "metric-trend" || type === "line") return <TrendingUp className={className} />;
  if (type === "folder-files") return <Files className={className} />;
  if (type === "bar") return <BarChart3 className={className} />;
  if (type === "pie") return <PieIcon className={className} />;
  if (type === "area") return <Activity className={className} />;
  if (type === "ranking") return <ListOrdered className={className} />;
  if (type === "rating") return <Star className={className} />;
  if (type === "map") return <MapPin className={className} />;
  if (type === "schedule-heatmap") return <CalendarRange className={className} />;
  return <LayoutGrid className={className} />;
}

type ScheduleCellState = "empty" | "planned" | "done" | "warning" | "failed" | "neutral";

function scheduleCellState(value: unknown, rowStatus: unknown): ScheduleCellState {
  const text = String(value ?? "").trim();
  const context = `${String(rowStatus ?? "")} ${text}`.toLocaleLowerCase("pt-BR");
  if (!text) return "empty";
  if (/\b(?:nc|n[aã]o conforme|reprovad[oa]|atrasad[oa]|cancelad[oa]|falha)\b/i.test(context))
    return "failed";
  if (/\b(?:pendente|aten[cç][aã]o|em andamento|parcial|aguardando)\b/i.test(context))
    return "warning";
  if (
    /\b(?:executad[oa]|conclu[ií]d[oa]|realizad[oa]|aprovad[oa]|conforme|ok)\b/i.test(context) ||
    /^c$/i.test(text)
  )
    return "done";
  if (
    /\b(?:planejad[oa]|programad[oa]|previst[oa])\b/i.test(context) ||
    /^(?:d|s|m|t|a|sm)$/i.test(text)
  )
    return "planned";
  return "neutral";
}

const scheduleCellClass: Record<ScheduleCellState, string> = {
  empty: "bg-muted/35 text-muted-foreground",
  planned: "bg-blue-500/18 text-blue-700 dark:text-blue-300",
  done: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/22 text-amber-800 dark:text-amber-300",
  failed: "bg-destructive/20 text-destructive",
  neutral: "bg-primary/12 text-foreground",
};

/**
 * Tick customizado para o eixo X dos gráficos de barra, área e linha.
 * Aplica cor e tipografia consistentes com o tema (inclusive no modo
 * escuro, onde o texto padrão do Recharts não se adapta sozinho) e destaca
 * a categoria "Não informado" em itálico e tom mais claro, para o usuário
 * distinguir dado ausente de um valor real na primeira olhada.
 */
/** Trunca um rótulo comprido com reticências, mantendo o texto completo
 * disponível via <title> (tooltip nativo do navegador ao passar o mouse),
 * em vez de deixar o SVG quebrar ou sobrepor letras entre rótulos vizinhos. */
function truncateLabel(value: string, max = 14): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Tooltip do gráfico de barras: mostra o valor do período junto com a
 * variação percentual em relação ao item anterior da série (na ordem em
 * que aparece no eixo), com uma cápsula colorida de alta/baixa — mesma
 * ideia do tooltip de "Revenue" de referência que o usuário mandou.
 * "Anterior" aqui é sempre o item anterior na ordem exibida, não
 * necessariamente uma data — pra grupos não cronológicos (ex.: por
 * vendedor) ainda funciona como "comparado à barra à esquerda".
 */
function BarTooltip({
  active,
  payload,
  label,
  series,
  kind,
}: {
  active: boolean | undefined;
  payload: { value?: number }[] | undefined;
  label: string | undefined;
  series: { name: string; total: number }[];
  kind: Kind;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  if (typeof value !== "number") return null;
  const idx = series.findIndex((s) => s.name === label);
  const prevTotal = idx > 0 ? series[idx - 1]?.total : undefined;
  const pct =
    idx > 0 && typeof prevTotal === "number" && prevTotal !== 0
      ? ((value - prevTotal) / Math.abs(prevTotal)) * 100
      : null;
  const up = (pct ?? 0) >= 0;
  return (
    <div
      style={{
        background: "var(--popover)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        fontSize: 12,
        padding: "8px 12px",
        boxShadow: "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
      }}
    >
      <div style={{ color: "var(--popover-foreground)", fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--popover-foreground)" }}>{fmt(value, kind) ?? value}</span>
        {pct !== null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 11,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 999,
              color: up ? "var(--chart-2)" : "var(--destructive)",
              background: `color-mix(in oklab, ${up ? "var(--chart-2)" : "var(--destructive)"} 18%, transparent)`,
            }}
          >
            {up ? "↑" : "↓"} {Math.abs(pct).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

function AxisTick({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
}) {
  const value = String(payload?.value ?? "");
  const missing = value === NOT_INFORMED;
  return (
    <text
      x={x}
      y={(y ?? 0) + 12}
      textAnchor="middle"
      fontSize={11}
      fontStyle={missing ? "italic" : "normal"}
      fill={missing ? "var(--muted-foreground)" : "var(--foreground)"}
    >
      <title>{value}</title>
      {truncateLabel(value)}
    </text>
  );
}

function compactAxisValue(value: number, kind: Kind) {
  const options: Intl.NumberFormatOptions = {
    notation: "compact",
    maximumFractionDigits: 1,
  };
  if (kind === "currency") {
    options.style = "currency";
    options.currency = "BRL";
  }
  if (kind === "percentage") {
    options.style = "percent";
    options.maximumFractionDigits = 0;
  }
  return new Intl.NumberFormat("pt-BR", options).format(value);
}

/**
 * Legenda externa da pizza. Mantê-la fora do SVG impede que o Recharts
 * comprima ou corte o gráfico quando os nomes e valores ocupam mais espaço.
 * Também é aqui que "Não informado" recebe o mesmo destaque do eixo.
 */
function PieLegend({
  items,
  kind,
  activeIndex,
  onHoverIndex,
  onSelectIndex,
}: {
  items: { name: string; total: number; count?: number; color: string }[];
  kind?: Kind;
  activeIndex?: number | null;
  onHoverIndex?: (i: number | null) => void;
  onSelectIndex?: (i: number) => void;
}) {
  if (!items.length) return null;
  const sum = items.reduce((s, entry) => s + entry.total, 0);
  return (
    <ul
      className="flex max-h-52 min-w-0 flex-col gap-1 overflow-y-auto rounded-xl bg-muted/20 p-2 text-[11px]"
      aria-label="Legenda do gráfico de pizza"
    >
      {items.map((entry, i) => {
        const missing = entry.name === NOT_INFORMED;
        const pct = sum > 0 ? (entry.total / sum) * 100 : 0;
        const dimmed = activeIndex !== null && activeIndex !== undefined && activeIndex !== i;
        return (
          <li
            key={`${entry.name}-${i}`}
            className={cn(
              "rounded-lg transition-all duration-150",
              dimmed ? "opacity-45" : "opacity-100",
              activeIndex === i && "bg-accent",
            )}
            onMouseEnter={() => onHoverIndex?.(i)}
            onMouseLeave={() => onHoverIndex?.(null)}
          >
            <button
              type="button"
              className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-1.5 text-left"
              onClick={() => onSelectIndex?.(i)}
              title={`Filtrar por ${entry.name}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: entry.color }}
                />
                <span
                  className={cn(
                    "truncate",
                    missing && "italic text-muted-foreground",
                    activeIndex === i && "font-semibold text-foreground",
                  )}
                  title={entry.name}
                >
                  {entry.name}
                </span>
              </span>
              <span className="whitespace-nowrap text-right font-mono text-muted-foreground">
                <span className="block">{fmt(entry.total, kind ?? "number") ?? entry.total}</span>
                <span className="block text-[9px]">{pct.toFixed(1)}%</span>
              </span>
              {entry.count ? (
                <span className="col-span-2 pl-[18px] text-[9px] text-muted-foreground">
                  {entry.count.toLocaleString("pt-BR")} categorias agrupadas
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Um widget do painel: cartão de métrica, gráfico ou tabela. Cada widget
 * calcula seus próprios dados a partir de sua configuração (metricKey ou
 * groupKey/valueKey/op), de forma independente dos demais widgets. A ordem
 * no array de widgets do painel determina a posição na grade; arrastar pelo
 * cabeçalho (ou usar as setas) reordena, e os seletores de largura/altura
 * redimensionam.
 */
/**
 * Corpo do widget de mapa: geocodifica os nomes de local do agrupamento
 * (usando o cache compartilhado em lib/storage.ts e lib/geocode.ts) e
 * desenha um marcador por local resolvido num mapa Leaflet com tiles do
 * OpenStreetMap, com raio proporcional ao valor agregado. O Leaflet só é
 * carregado no navegador (import dinâmico dentro do efeito), nunca durante
 * a renderização no servidor.
 */
// Tiles CARTO (grátis, sem chave de API, atribuição exigida só em texto) nos
// estilos "Positron" (claro) e "Dark Matter" (escuro) — bem mais discretos
// em cinza/azul do que os tiles coloridos padrão do OpenStreetMap, e casam
// com o tema claro/escuro do próprio site em vez de destoar dele. Trocar
// pra um provedor com estilo 100% customizável (Mapbox/MapTiler, cores
// exatas da paleta do site) exigiria criar conta e chave de API — não dá
// pra fazer isso pelo usuário sem as credenciais dele.
const MAP_TILE_URL = {
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const MAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>';

function MapWidgetBody({
  grouped,
  valueColumn,
  onSelect,
}: {
  grouped: { name: string; total: number }[];
  valueColumn: Column;
  onSelect: (name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const tileLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const [cache, setCache] = useState<GeocodeCache>({});
  const [ready, setReady] = useState(false);
  // Segue o mesmo tema (claro/escuro) do resto do site: o toggle de tema
  // alterna a classe "dark" em <html> (ver useTheme), então observar essa
  // classe aqui evita ter que passar o tema por várias camadas de props só
  // pra chegar nesse widget.
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const namesKey = grouped.map((g) => g.name).join("|");

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(el.classList.contains("dark")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    loadGeocodeCache().then((c) => {
      if (alive) {
        setCache(c);
        setReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const names = namesKey ? namesKey.split("|") : [];
    void (async () => {
      const updates: GeocodeCache = {};
      await geocodeMissing(names, cache, (name, point) => {
        updates[name] = point;
      });
      if (!alive || !Object.keys(updates).length) return;
      setCache((prev) => {
        const next = { ...prev, ...updates };
        void saveGeocodeCache(next);
        return next;
      });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, namesKey]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let alive = true;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const mod = await import("leaflet");
      const L = (mod.default ?? mod) as typeof import("leaflet");
      if (!alive || !containerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current).setView([-14, -51], 3);
      }
      const map = mapRef.current;
      if (!tileLayerRef.current) {
        tileLayerRef.current = L.tileLayer(MAP_TILE_URL[isDark ? "dark" : "light"], {
          attribution: MAP_ATTRIBUTION,
          maxZoom: 20,
        }).addTo(map);
      } else {
        tileLayerRef.current.setUrl(MAP_TILE_URL[isDark ? "dark" : "light"]);
      }
      layerRef.current?.remove();
      const layer = L.layerGroup();
      const resolved = grouped
        .map((g) => ({ ...g, point: cache[g.name] }))
        .filter((g): g is typeof g & { point: GeoPoint } => !!g.point);
      const max = resolved.reduce((m, g) => Math.max(m, Math.abs(g.total)), 0) || 1;
      const sum = resolved.reduce((s, g) => s + g.total, 0);
      // Resolvido aqui (não como string "var(--primary)" fixa) porque o
      // Leaflet grava isso como atributo SVG (stroke/fill) via JS, e nem
      // todo navegador/webview resolve custom property CSS num atributo de
      // presentation attribute setado assim — resolver o valor de verdade
      // é mais confiável. Refeito a cada troca de tema (isDark é dependência
      // deste efeito) pra continuar acompanhando claro/escuro.
      const primaryColor =
        getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() ||
        "#0ea5e9";
      const colorProbe = document.createElement("span");
      colorProbe.hidden = true;
      document.body.appendChild(colorProbe);
      resolved.forEach((g) => {
        const radius = 7 + (Math.abs(g.total) / max) * 20;
        const pct = sum > 0 ? (g.total / sum) * 100 : 0;
        const formattedColor = conditionalColor(
          g.total,
          valueColumn.kind,
          valueColumn.conditionalFormat,
        );
        colorProbe.style.color = formattedColor ?? primaryColor;
        const markerColor = getComputedStyle(colorProbe).color || primaryColor;
        const marker = L.circleMarker([g.point.lat, g.point.lng], {
          radius,
          color: markerColor,
          fillColor: markerColor,
          fillOpacity: 0.45,
          weight: 2,
        });
        const popup = document.createElement("div");
        popup.className = "text-xs";
        const strong = document.createElement("strong");
        strong.textContent = g.name;
        popup.appendChild(strong);
        popup.appendChild(document.createElement("br"));
        popup.appendChild(
          document.createTextNode(`${fmt(g.total, valueColumn.kind) ?? "–"} (${pct.toFixed(1)}%)`),
        );
        marker.bindPopup(popup);
        marker.on("click", () => onSelect(g.name));
        marker.addTo(layer);
      });
      colorProbe.remove();
      layer.addTo(map);
      layerRef.current = layer;
      resizeTimer = setTimeout(() => {
        if (alive && mapRef.current === map) map.invalidateSize();
      }, 50);
      if (resolved.length) {
        const bounds = L.latLngBounds(resolved.map((g) => [g.point.lat, g.point.lng]));
        map.fitBounds(bounds.pad(0.3), { maxZoom: 6 });
      }
    })();
    return () => {
      alive = false;
      clearTimeout(resizeTimer);
    };
  }, [grouped, cache, onSelect, valueColumn, isDark]);

  const resolvedCount = grouped.filter((g) => cache[g.name]).length;
  const notFoundCount = grouped.filter((g) => g.name in cache && cache[g.name] === null).length;
  const pending = grouped.length - resolvedCount - notFoundCount;
  // Quando nenhum nome vira marcador, o mapa fica só com os tiles de fundo
  // e nenhum ponto — sem esse aviso maior, a única pista era um texto
  // pequeno no rodapé, fácil de não notar (parece "o mapa não funciona",
  // quando na prática é a coluna escolhida que não tem nome de local de
  // verdade, ex: nome de vendedor em vez de cidade).
  const allUnresolved = !pending && grouped.length > 0 && resolvedCount === 0;

  return (
    <>
      <div className="relative">
        <div ref={containerRef} className="h-64 w-full" />
        {pending > 0 && (
          <div className="oliam-map-loading" role="status">
            <OliLoader compact />
            <span>Localizando {pending}…</span>
          </div>
        )}
      </div>
      {allUnresolved && (
        <p className="border-t bg-destructive/10 px-4 py-2 text-[11px] text-destructive">
          Nenhum dos {grouped.length} valores dessa coluna foi reconhecido como local (cidade,
          estado ou país) pelo OpenStreetMap. Troque a coluna de agrupamento acima por uma que tenha
          nome de local de verdade.
        </p>
      )}
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        Localização aproximada a partir do nome do local, via OpenStreetMap Nominatim. O tamanho de
        cada ponto indica o valor agregado.
        {pending > 0 && ` Localizando ${pending} de ${grouped.length}…`}
        {notFoundCount > 0 &&
          !allUnresolved &&
          ` ${notFoundCount} local(is) não encontrado(s) e sem marcador no mapa.`}
      </p>
      <p className="sr-only">
        Tabela alternativa ao mapa: {grouped.map((g) => `${g.name}, ${g.total}`).join("; ")}.
      </p>
    </>
  );
}

/**
 * Ponto (dot) de gráfico de linha/área clicável, para cross-filter
 * consistente com barra/pizza/ranking/mapa: clicar em um ponto filtra pelo
 * valor do eixo X daquele ponto (ex: um mês específico), mantendo os
 * filtros de outras colunas (ver toggleClickFilter).
 */
type ChartDotProps = { cx?: number; cy?: number; payload?: { name?: string; total?: number } };
function ChartDot({
  cx,
  cy,
  r,
  payload,
  groupCol,
  valueCol,
  onSelect,
}: ChartDotProps & {
  r: number;
  groupCol: Column | undefined;
  valueCol: Column | undefined;
  onSelect: (groupKey: string, value: string) => void;
}) {
  if (cx === undefined || cy === undefined) return null;
  const clickable = !!(groupCol && payload?.name);
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={
        conditionalColor(
          payload?.total ?? null,
          valueCol?.kind ?? "text",
          valueCol?.conditionalFormat,
        ) ?? "var(--primary)"
      }
      style={clickable ? { cursor: "pointer" } : undefined}
      onClick={() => clickable && onSelect(groupCol!.key, String(payload!.name))}
    />
  );
}

function WidgetCard({
  widget: w,
  index,
  count,
  data,
  columns,
  numericCols,
  groupableCols,
  interpolated,
  sort,
  setSort,
  versionDelta,
  folderMonitor,
  animationDelay,
  filters,
  setFilters,
  onConfigure,
  onCopy,
  onPaste,
  canPaste,
  onRemove,
  onMoveBack,
  onMoveForward,
  onDropWidget,
}: {
  widget: Widget;
  index: number;
  count: number;
  data: Row[];
  columns: Column[];
  numericCols: Column[];
  groupableCols: Column[];
  interpolated: Set<string>;
  sort: { key: string; dir: "asc" | "desc" } | null;
  setSort: (s: { key: string; dir: "asc" | "desc" } | null) => void;
  versionDelta: Map<string, number | null> | null;
  folderMonitor: FolderMonitorView | undefined;
  animationDelay: number;
  filters: FilterRule[];
  setFilters: (filters: FilterRule[]) => void;
  onConfigure: (patch: Partial<Widget>) => void;
  onCopy: () => void;
  onPaste: () => void;
  canPaste: boolean;
  onRemove: () => void;
  onMoveBack: () => void;
  onMoveForward: () => void;
  onDropWidget: (fromId: string) => void;
}) {
  // Cross-filter padronizado: clicar em um valor filtra por aquela coluna
  // sem descartar filtros de outras colunas (ex: clicar num mapa e numa
  // linha do tempo ao mesmo tempo); clicar de novo no mesmo valor remove o
  // filtro. Usado por barra, pizza, linha, área, ranking e mapa.
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null);
  const handleGroupClick = (groupKey: string, value: string) => {
    setFilters(toggleClickFilter(filters, groupKey, value));
  };
  // Gráfico de barras com muitas categorias: permite arrastar com o mouse
  // pra rolar na horizontal (touch já rola nativamente via overflow-x-auto,
  // isso só cobre o caso de clicar-e-arrastar com o mouse).
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const handleChartScrollPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = chartScrollRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    let dragged = false;
    el.setPointerCapture(e.pointerId);
    el.classList.add("oliam-chart-dragging");
    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (Math.abs(delta) > 3) dragged = true;
      el.scrollLeft = startScroll - delta;
    };
    const onUp = () => {
      el.classList.remove("oliam-chart-dragging");
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      // Evita que o clique-arrasto dispare o cross-filter da barra por baixo
      // do cursor (onClick da <Bar>) quando o usuário só quis rolar.
      if (dragged) {
        const suppress = (evt: MouseEvent) => evt.stopPropagation();
        el.addEventListener("click", suppress, { capture: true, once: true });
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };
  const scrollChart = (direction: -1 | 1) => {
    const el = chartScrollRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(el.clientWidth * 0.75, 240),
      behavior: "smooth",
    });
  };
  const ChartScrollButtons = ({ label, compact = false }: { label: string; compact?: boolean }) => (
    <div
      className={cn("absolute z-10 flex gap-1", compact ? "right-1 top-1" : "right-5 top-5")}
      data-export-controls
      aria-label={`Navegação horizontal do ${label}`}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn(
          "rounded-full bg-card/90 shadow-sm backdrop-blur",
          compact ? "size-7" : "size-8",
        )}
        onClick={() => scrollChart(-1)}
        aria-label={`Rolar ${label} para a esquerda`}
        title="Rolar para a esquerda"
      >
        <ArrowLeft className={compact ? "size-3.5" : "size-4"} />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn(
          "rounded-full bg-card/90 shadow-sm backdrop-blur",
          compact ? "size-7" : "size-8",
        )}
        onClick={() => scrollChart(1)}
        aria-label={`Rolar ${label} para a direita`}
        title="Rolar para a direita"
      >
        <ArrowRight className={compact ? "size-3.5" : "size-4"} />
      </Button>
    </div>
  );
  // Indicador "filtrado por X" exibido no cabeçalho de controles do widget
  // quando a coluna de agrupamento dele tem um filtro simples ativo,
  // sincronizado com a barra de filtros do topo (mesmo estado, sheet.filters).
  const activeGroupFilter = (groupKey: string | undefined) =>
    groupKey ? filters.find((f) => f.key === groupKey && !f.min && !f.max) : undefined;
  const FilterChip = ({ groupKey }: { groupKey: string | undefined }) => {
    const active = activeGroupFilter(groupKey);
    if (!active || !groupKey) return null;
    return (
      <button
        type="button"
        className="flex items-center gap-1 rounded-full border border-primary/40 bg-tint px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary"
        onClick={() => setFilters(filters.filter((f) => f.key !== groupKey))}
        aria-label={`Remover filtro: filtrado por ${active.value}`}
      >
        Filtrado por: {active.value}
        <X className="size-3" />
      </button>
    );
  };
  const dragProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", w.id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      onDropWidget(e.dataTransfer.getData("text/plain"));
    },
    onRemove,
    onCopy,
    onPaste,
    canPaste,
    onMoveBack,
    onMoveForward,
    disableBack: index === 0,
    disableForward: index === count - 1,
  };
  const sizeControls = (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
      data-export-controls
    >
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        Largura
        <select
          aria-label="Largura do widget"
          className="oliam-select h-7"
          value={w.span}
          onChange={(e) => onConfigure({ span: Number(e.target.value) as WidgetSpan })}
        >
          {([1, 2, 3] as WidgetSpan[]).map((s) => (
            <option key={s} value={s}>
              {widgetSpanLabels[s]}
            </option>
          ))}
        </select>
      </label>
      {w.type !== "table" && (
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Altura
          <select
            aria-label="Altura do widget"
            className="oliam-select h-7"
            value={w.size}
            onChange={(e) => onConfigure({ size: e.target.value as WidgetSize })}
          >
            {(["sm", "md", "lg"] as WidgetSize[]).map((s) => (
              <option key={s} value={s}>
                {widgetSizeLabels[s]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );

  if (w.type === "folder-files") {
    const monitoredFiles = folderMonitor?.fileNames?.length
      ? folderMonitor.fileNames
      : folderMonitor?.fileName
        ? [folderMonitor.fileName]
        : [];
    const monitoredCount = monitoredFiles.length;
    const formats = new Map<string, number>();
    for (const fileName of monitoredFiles) {
      const extension = fileName.split(".").pop()?.toUpperCase() ?? "OUTRO";
      formats.set(extension, (formats.get(extension) ?? 0) + 1);
    }
    const formatSeries = [...formats].map(([name, total]) => ({ name, total }));
    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <WidgetHead
          title="Planilhas monitoradas"
          icon={<Files className="size-3.5 shrink-0 text-muted-foreground" />}
          {...dragProps}
        />
        {sizeControls}
        <div className="grid min-h-40 grid-cols-[auto_1fr] items-center gap-5 p-5">
          <div>
            <p className="font-display text-5xl font-extrabold tracking-tight text-primary">
              {monitoredCount}
            </p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {monitoredCount === 1 ? "planilha compatível" : "planilhas compatíveis"}
            </p>
            <p className="mt-3 max-w-32 truncate font-mono text-[10px] text-muted-foreground">
              {folderMonitor ? folderMonitor.folderName : "Nenhuma pasta conectada"}
            </p>
          </div>
          {formatSeries.length ? (
            <div className="h-28 min-w-0" aria-label="Arquivos por formato">
              <ResponsiveContainer>
                <BarChart data={formatSeries} margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis hide allowDecimals={false} />
                  <ChartTooltip
                    cursor={{ fill: "var(--accent)", fillOpacity: 0.35 }}
                    formatter={(value: number) => [
                      `${value} arquivo${value === 1 ? "" : "s"}`,
                      "Total",
                    ]}
                  />
                  <Bar dataKey="total" fill="var(--primary)" radius={[6, 6, 2, 2]}>
                    <LabelList
                      dataKey="total"
                      position="top"
                      fontSize={10}
                      fill="var(--foreground)"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Use “Monitorar pasta” para contar automaticamente arquivos Excel, ODS e CSV.
            </p>
          )}
        </div>
      </article>
    );
  }

  if (w.type === "metric" || w.type === "metric-trend") {
    const col =
      columns.find((c) => c.key === w.metricKey && numericKinds.includes(c.kind)) ?? numericCols[0];
    if (!col) {
      return (
        <EmptyWidget
          {...dragProps}
          title="Métrica"
          span={w.span}
          size={w.size}
          type={w.type}
          animationDelay={animationDelay}
          message="Nenhuma coluna numérica disponível."
        />
      );
    }
    const metricOps: AggregationOp[] = ["sum", "avg", "count", "min", "max"];
    const metricOp: AggregationOp = metricOps.includes(w.op ?? "sum") ? (w.op ?? "sum") : "sum";
    const total = aggregate(
      data.map((r) => Number(r[col.key])).filter((v) => Number.isFinite(v)),
      metricOp,
    );
    const style = conditionalStyle(total, col.kind, col.conditionalFormat);
    const formattedChartColor =
      conditionalColor(total, col.kind, col.conditionalFormat) ?? "var(--secondary-accent)";
    const trendDateCol =
      w.type === "metric-trend"
        ? (columns.find((c) => c.key === w.groupKey && c.kind === "date") ??
          columns.find((c) => c.kind === "date"))
        : undefined;
    const sparkline =
      w.type === "metric-trend" && trendDateCol
        ? [...groupAndAggregate(data, trendDateCol.key, col.key, metricOp)].sort(
            (a, b) =>
              (parseDateValue(a.name) ?? Number.MAX_SAFE_INTEGER) -
              (parseDateValue(b.name) ?? Number.MAX_SAFE_INTEGER),
          )
        : [];
    const sparkPresentation = timeSeriesChartPresentation(sparkline.length, true);
    const sparkStart = sparkline[0]?.total;
    const sparkEnd = sparkline.at(-1)?.total;
    const sparkChange =
      sparkStart !== undefined && sparkEnd !== undefined && sparkStart !== 0
        ? (sparkEnd - sparkStart) / Math.abs(sparkStart)
        : null;
    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms`, ...(style ?? {}) }}
      >
        <WidgetHead
          title={col.label}
          icon={
            w.type === "metric-trend" ? (
              <TrendingUp className="size-3.5 shrink-0 text-muted-foreground" />
            ) : undefined
          }
          {...dragProps}
        />
        <div
          className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
          data-export-controls
        >
          <FieldDropSlot
            accepts={numericKinds}
            onDropColumn={(key) => onConfigure({ metricKey: key })}
          >
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Coluna
              <select
                aria-label="Coluna da métrica"
                className="oliam-select h-7"
                value={col.key}
                onChange={(e) => onConfigure({ metricKey: e.target.value })}
              >
                {numericCols.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </FieldDropSlot>
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Operação
            <select
              aria-label="Operação de agregação"
              className="oliam-select h-7"
              value={metricOp}
              onChange={(e) => onConfigure({ op: e.target.value as AggregationOp })}
            >
              {Object.entries(aggregationLabels)
                .filter(([o]) => metricOps.includes(o as AggregationOp))
                .map(([o, label]) => (
                  <option key={o} value={o}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          {w.type === "metric-trend" && columns.some((c) => c.kind === "date") && (
            <FieldDropSlot
              accepts={["date"]}
              onDropColumn={(key) => onConfigure({ groupKey: key })}
            >
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                Sparkline por
                <select
                  aria-label="Coluna de data do sparkline"
                  className="oliam-select h-7"
                  value={trendDateCol?.key ?? ""}
                  onChange={(e) => onConfigure({ groupKey: e.target.value })}
                >
                  {columns
                    .filter((c) => c.kind === "date")
                    .map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                </select>
              </label>
            </FieldDropSlot>
          )}
        </div>
        <div className="p-5">
          <p
            className="font-display text-4xl font-extrabold tracking-tight"
            style={style ? { color: style.color } : undefined}
          >
            <AnimatedNumber value={total} kind={col.kind} />
          </p>
          {versionDelta && (
            <p
              className={cn(
                "mt-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium",
                (versionDelta.get(col.key) ?? 0) >= 0
                  ? "bg-secondary-accent/12 text-secondary-accent"
                  : "bg-destructive/12 text-destructive",
              )}
            >
              {versionDelta.get(col.key) === null ? (
                "sem base para comparar"
              ) : (
                <>
                  {(versionDelta.get(col.key) as number) >= 0 ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowDown className="size-3" />
                  )}
                  {new Intl.NumberFormat("pt-BR", {
                    style: "percent",
                    maximumFractionDigits: 1,
                  }).format(Math.abs(versionDelta.get(col.key) as number))}{" "}
                  vs. anterior
                </>
              )}
            </p>
          )}
          {w.type === "metric-trend" && (
            <div className="mt-4">
              {sparkline.length >= 2 ? (
                <>
                  <div className="relative">
                    <div
                      ref={sparkPresentation.scrollable ? chartScrollRef : undefined}
                      className={cn(
                        "h-16 overflow-x-auto overflow-y-hidden",
                        sparkPresentation.scrollable && "oliam-chart-drag-scroll",
                      )}
                      onPointerDown={
                        sparkPresentation.scrollable ? handleChartScrollPointerDown : undefined
                      }
                    >
                      <div
                        style={{
                          height: "100%",
                          width: sparkPresentation.scrollable
                            ? sparkPresentation.contentWidth
                            : "100%",
                          minWidth: "100%",
                        }}
                      >
                        <ResponsiveContainer>
                          <AreaChart
                            data={sparkline}
                            margin={{ top: 3, right: 3, left: 3, bottom: 3 }}
                          >
                            <defs>
                              <linearGradient id={`spark-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                                <stop
                                  offset="0%"
                                  stopColor={formattedChartColor}
                                  stopOpacity={0.5}
                                />
                                <stop
                                  offset="100%"
                                  stopColor={formattedChartColor}
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            </defs>
                            <ChartTooltip
                              contentStyle={{
                                background: "var(--popover)",
                                border: "1px solid var(--border)",
                                borderRadius: 10,
                                fontSize: 11,
                              }}
                              formatter={(value: number) => [
                                fmt(value, col.kind) ?? String(value),
                                col.label,
                              ]}
                            />
                            <Area
                              type="monotone"
                              dataKey="total"
                              stroke={formattedChartColor}
                              strokeWidth={2}
                              fill={`url(#spark-${w.id})`}
                              dot={false}
                              activeDot={{ r: 3, fill: formattedChartColor }}
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    {sparkPresentation.scrollable && (
                      <ChartScrollButtons label="tendência da métrica" compact />
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                    <span>{sparkline[0]?.name}</span>
                    <span
                      className={cn(
                        "font-semibold",
                        (sparkChange ?? 0) >= 0 ? "text-secondary-accent" : "text-destructive",
                      )}
                    >
                      {sparkChange === null
                        ? `${sparkline.length} períodos`
                        : new Intl.NumberFormat("pt-BR", {
                            style: "percent",
                            maximumFractionDigits: 1,
                          }).format(sparkChange)}
                    </span>
                    <span>{sparkline.at(-1)?.name}</span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sem coluna de data suficiente para o sparkline.
                </p>
              )}
            </div>
          )}
        </div>
      </article>
    );
  }

  if (w.type === "schedule-heatmap") {
    const detectedPeriods = schedulePeriodColumns(columns);
    const configuredPeriods = (w.periodKeys ?? [])
      .map((key) => columns.find((column) => column.key === key))
      .filter((column): column is Column => Boolean(column));
    const periodCols = configuredPeriods.length ? configuredPeriods : detectedPeriods;
    const periodKeys = new Set(periodCols.map((column) => column.key));
    const labelOptions = columns.filter(
      (column) => !periodKeys.has(column.key) && groupableKinds.includes(column.kind),
    );
    const groupCol =
      columns.find((column) => column.key === w.groupKey && !periodKeys.has(column.key)) ??
      scheduleItemColumn(
        columns,
        periodCols.map((column) => column.key),
        data,
      );
    const statusCol =
      columns.find((column) => column.key === w.statusKey && !periodKeys.has(column.key)) ??
      scheduleStatusColumn(
        columns,
        periodCols.map((column) => column.key),
      );
    const allDetailCols = columns.filter(
      (column) =>
        !periodKeys.has(column.key) &&
        column.key !== groupCol?.key &&
        column.key !== statusCol?.key &&
        data.some((row) => row[column.key] !== null && row[column.key] !== ""),
    );
    const defaultDetailCols = scheduleDetailColumns(
      columns,
      periodCols.map((column) => column.key),
      data,
      groupCol?.key,
      statusCol?.key,
    );
    const detailCols = (
      w.detailKeys === undefined
        ? defaultDetailCols
        : w.detailKeys
            .map((key) => allDetailCols.find((column) => column.key === key))
            .filter((column): column is Column => Boolean(column))
    ).slice(0, 8);
    const detailKeys = new Set(detailCols.map((column) => column.key));
    const scheduleRows = data.filter(
      (row) =>
        groupCol &&
        row[groupCol.key] !== null &&
        row[groupCol.key] !== "" &&
        (periodCols.some((column) => row[column.key] !== null && row[column.key] !== "") ||
          (statusCol && row[statusCol.key] !== null && row[statusCol.key] !== "") ||
          allDetailCols.some((column) => row[column.key] !== null && row[column.key] !== "")),
    );
    const visibleRows = scheduleRows.slice(0, 400);
    const togglePeriod = (key: string) => {
      const selected = new Set(periodCols.map((column) => column.key));
      if (selected.has(key) && selected.size > 1) selected.delete(key);
      else selected.add(key);
      onConfigure({
        periodKeys: detectedPeriods
          .filter((column) => selected.has(column.key))
          .map((column) => column.key),
      });
    };
    const toggleDetail = (key: string) => {
      const selected = new Set(detailCols.map((column) => column.key));
      if (selected.has(key)) selected.delete(key);
      else if (selected.size < 8) selected.add(key);
      onConfigure({
        detailKeys: allDetailCols
          .filter((column) => selected.has(column.key))
          .map((column) => column.key),
      });
    };

    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <WidgetHead
          title={w.title || "Cronograma visual"}
          icon={<CalendarRange className="size-3.5 shrink-0 text-muted-foreground" />}
          {...dragProps}
        />
        <div
          className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
          data-export-controls
        >
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Item
            <select
              aria-label="Coluna dos itens do cronograma"
              className="oliam-select h-7 max-w-44"
              value={groupCol?.key ?? ""}
              onChange={(event) => onConfigure({ groupKey: event.target.value })}
            >
              {labelOptions.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Situação
            <select
              aria-label="Coluna de situação do cronograma"
              className="oliam-select h-7 max-w-44"
              value={statusCol?.key ?? ""}
              onChange={(event) => onConfigure({ statusKey: event.target.value })}
            >
              <option value="">Sem coluna de situação</option>
              {labelOptions
                .filter((column) => column.key !== groupCol?.key)
                .map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
            </select>
          </label>
          <div
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            aria-label="Períodos visíveis"
          >
            {detectedPeriods.map((column) => {
              const selected = periodKeys.has(column.key);
              return (
                <button
                  key={column.key}
                  type="button"
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors",
                    selected
                      ? "border-primary/40 bg-primary/12 text-primary"
                      : "border-border bg-card text-muted-foreground",
                  )}
                  aria-pressed={selected}
                  onClick={() => togglePeriod(column.key)}
                >
                  {column.label}
                </button>
              );
            })}
          </div>
          {allDetailCols.length > 0 && (
            <div className="flex basis-full items-center gap-2 border-t border-border/60 pt-2">
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Informações extras
              </span>
              <div
                className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
                aria-label="Informações extras visíveis"
              >
                {allDetailCols.map((column) => {
                  const selected = detailKeys.has(column.key);
                  return (
                    <button
                      key={column.key}
                      type="button"
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors",
                        selected
                          ? "border-secondary-accent/45 bg-secondary-accent/12 text-foreground"
                          : "border-border bg-card text-muted-foreground",
                      )}
                      aria-pressed={selected}
                      onClick={() => toggleDetail(column.key)}
                      title={selected ? `Ocultar ${column.label}` : `Mostrar ${column.label}`}
                    >
                      {column.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {sizeControls}
        {!groupCol || !periodCols.length ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            Não encontrei colunas de mês ou data. Escolha uma planilha de cronograma com períodos no
            cabeçalho.
          </p>
        ) : !visibleRows.length ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            Nenhuma marcação encontrada nos períodos selecionados.
          </p>
        ) : (
          <>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-max min-w-full border-separate border-spacing-1 p-3 text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 min-w-52 rounded-lg bg-card px-3 py-2 text-left font-semibold shadow-[1px_1px_0_var(--border)]">
                      {groupCol.label}
                    </th>
                    {detailCols.map((column) => (
                      <th
                        key={column.key}
                        className="sticky top-0 z-10 min-w-28 max-w-48 rounded-lg bg-card px-3 py-2 text-left font-semibold shadow-[0_1px_0_var(--border)]"
                      >
                        {column.label}
                      </th>
                    ))}
                    {periodCols.map((column) => (
                      <th
                        key={column.key}
                        className="sticky top-0 z-10 min-w-20 rounded-lg bg-card px-2 py-2 text-center font-semibold shadow-[0_1px_0_var(--border)]"
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, rowIndex) => {
                    const item = String(row[groupCol.key]);
                    const status = statusCol ? row[statusCol.key] : null;
                    return (
                      <tr key={`${item}-${rowIndex}`}>
                        <th className="sticky left-0 z-10 max-w-64 rounded-lg bg-card px-3 py-2 text-left font-medium shadow-[1px_0_0_var(--border)]">
                          <button
                            type="button"
                            className="w-full text-left hover:text-primary"
                            onClick={() => handleGroupClick(groupCol.key, item)}
                            title={`Filtrar por ${item}`}
                          >
                            <span className="block truncate">{item}</span>
                            {status !== null && status !== "" && (
                              <span className="block truncate text-[10px] font-normal text-muted-foreground">
                                {String(status)}
                              </span>
                            )}
                          </button>
                        </th>
                        {detailCols.map((column) => {
                          const value = row[column.key];
                          const empty = value === null || value === "";
                          const label = empty
                            ? "—"
                            : (fmt(value ?? null, column.kind) ?? String(value));
                          return (
                            <td
                              key={column.key}
                              className="max-w-48 rounded-lg bg-muted/30 px-3 py-2 text-left text-[11px] text-foreground"
                              title={`${column.label}: ${label}`}
                            >
                              <span
                                className={cn(
                                  "block",
                                  empty ? "text-muted-foreground" : "break-words",
                                )}
                              >
                                {label}
                              </span>
                            </td>
                          );
                        })}
                        {periodCols.map((column) => {
                          const value = row[column.key];
                          const state = scheduleCellState(value, status);
                          const empty = value === null || value === "";
                          const label = empty ? "Sem registro" : String(value);
                          return (
                            <td
                              key={column.key}
                              className={cn(
                                "max-w-32 rounded-lg px-2 py-2 text-center font-semibold transition-transform hover:scale-[1.04]",
                                scheduleCellClass[state],
                              )}
                              title={`${item} · ${column.label}: ${label}${status ? ` · ${String(status)}` : ""}`}
                            >
                              {empty ? (
                                <span className="block min-h-4" aria-label="Sem registro" />
                              ) : (
                                <span className="block truncate">{label}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2 text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">
                {scheduleRows.length.toLocaleString("pt-BR")} item(ns) · {periodCols.length}{" "}
                período(s)
                {detailCols.length ? ` · ${detailCols.length} informação(ões) extra(s)` : ""}
              </span>
              {[
                ["planned", "Planejado"],
                ["done", "Executado / conforme"],
                ["warning", "Pendente / atenção"],
                ["failed", "Não conforme / atrasado"],
                ["empty", "Sem registro"],
              ].map(([state, label]) => (
                <span key={state} className="inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      "size-2.5 rounded-sm",
                      scheduleCellClass[state as ScheduleCellState],
                    )}
                  />
                  {label}
                </span>
              ))}
              {scheduleRows.length > visibleRows.length && (
                <span>Mostrando 400 de {scheduleRows.length.toLocaleString("pt-BR")} linhas.</span>
              )}
            </div>
          </>
        )}
      </article>
    );
  }

  if (w.type === "bar" || w.type === "pie" || w.type === "line" || w.type === "area") {
    const groupCol =
      w.type === "line"
        ? columns.find((c) => c.key === w.groupKey && c.kind === "date")
        : columns.find((c) => c.key === w.groupKey);
    const requestedOp = w.op ?? "sum";
    const configuredValueCol = columns.find((c) => c.key === w.valueKey);
    const valueCol =
      (configuredValueCol &&
      (requestedOp === "count" || numericKinds.includes(configuredValueCol.kind))
        ? configuredValueCol
        : undefined) ?? (requestedOp === "count" ? columns[0] : numericCols[0]);
    const relevantOps =
      groupCol && valueCol
        ? relevantAggregationOps(data, groupCol.key, valueCol.key)
        : (Object.keys(aggregationLabels) as AggregationOp[]);
    const op: AggregationOp = relevantOps.includes(w.op ?? "sum")
      ? (w.op ?? "sum")
      : (relevantOps[0] ?? "sum");
    const title =
      op === "count"
        ? w.type === "pie"
          ? `Distribuição de registros por ${groupCol?.label ?? ""}`
          : `Contagem de registros por ${groupCol?.label ?? ""}`
        : w.type === "line"
          ? `Evolução de ${valueCol?.label ?? ""}`
          : w.type === "area"
            ? `Evolução de ${valueCol?.label ?? ""} (área)`
            : w.type === "pie"
              ? "Distribuição"
              : `${aggregationLabels[op]} de ${valueCol?.label ?? ""} por ${groupCol?.label ?? ""}`;
    const icon =
      w.type === "line" ? (
        <TrendingUp className="size-3.5 shrink-0 text-muted-foreground" />
      ) : w.type === "area" ? (
        <Activity className="size-3.5 shrink-0 text-muted-foreground" />
      ) : w.type === "pie" ? (
        <PieIcon className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <BarChart3 className="size-3.5 shrink-0 text-muted-foreground" />
      );
    const groupOptions =
      w.type === "line" ? columns.filter((c) => c.kind === "date") : groupableCols;
    const grouped =
      groupCol && valueCol
        ? groupAndAggregate(data, groupCol.key, valueCol.key, op).map((g) => ({
            name: g.name,
            total: g.total,
          }))
        : [];
    const series =
      w.type === "line" || (w.type === "area" && groupCol?.kind === "date")
        ? sortChronologically(grouped)
        : grouped;
    const seriesColor = valueCol
      ? (conditionalColor(
          series.at(-1)?.total ?? null,
          valueCol.kind,
          valueCol.conditionalFormat,
        ) ?? "var(--primary)")
      : "var(--primary)";
    const barSeries = w.type === "bar" ? sortAllBarCategories(series) : series;
    const barPresentation = barChartPresentation(barSeries.length);
    const timeSeriesPresentation = timeSeriesChartPresentation(series.length);
    const pieSeries = (() => {
      if (w.type !== "pie") return series;
      if (series.length <= 6) return series;
      const sorted = [...series].sort((a, b) => b.total - a.total);
      const top = sorted.slice(0, 5),
        restItems = sorted.slice(5),
        rest = restItems.reduce((s, x) => s + x.total, 0);
      // "Outros" carrega quantas categorias foram agrupadas ali dentro
      // (`count`), pra não virar uma fatia grande e muda: aparece no tooltip
      // e na legenda, ex. "Outros: 445 (94.7%) · 490 categorias".
      return rest ? [...top, { name: "Outros", total: rest, count: restItems.length }] : top;
    })();
    const pieTotal = pieSeries.reduce((s, e) => s + e.total, 0);
    const pieLegendItems = pieSeries.map((entry, i) => ({
      ...entry,
      color:
        conditionalColor(entry.total, valueCol?.kind ?? "number", valueCol?.conditionalFormat) ??
        palette[i % palette.length] ??
        "var(--primary)",
    }));
    const { cornerRadius: pieCornerRadius, paddingAngle: piePaddingAngle } =
      pieRoundnessFor(pieSeries);
    const insufficient = w.type === "line" ? series.length < 2 : series.length < 1;

    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <WidgetHead title={title} icon={icon} {...dragProps} />
        <div
          className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
          data-export-controls
        >
          <GroupAggHint />
          <FilterChip groupKey={groupCol?.key} />
          <FieldDropSlot
            accepts={w.type === "line" ? (["date"] as Kind[]) : groupableKinds}
            onDropColumn={(key) => onConfigure({ groupKey: key })}
          >
            <select
              aria-label="Agrupar por"
              className="oliam-select"
              value={groupCol?.key ?? ""}
              onChange={(e) => onConfigure({ groupKey: e.target.value })}
            >
              {!groupCol && <option value="">Selecione…</option>}
              {groupOptions.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldDropSlot>
          <FieldDropSlot
            accepts={op === "count" ? (Object.keys(kinds) as Kind[]) : numericKinds}
            onDropColumn={(key) => onConfigure({ valueKey: key })}
          >
            <select
              aria-label={op === "count" ? "Coluna usada para contar" : "Coluna numérica"}
              className="oliam-select"
              value={valueCol?.key ?? ""}
              onChange={(e) => onConfigure({ valueKey: e.target.value })}
            >
              {!valueCol && <option value="">Selecione…</option>}
              {(op === "count" ? columns : numericCols).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldDropSlot>
          {w.type !== "line" && relevantOps.length > 1 && (
            <select
              aria-label="Agregação"
              className="oliam-select"
              value={op}
              onChange={(e) => onConfigure({ op: e.target.value as AggregationOp })}
            >
              {Object.entries(aggregationLabels)
                .filter(([o]) => relevantOps.includes(o as AggregationOp))
                .map(([o, label]) => (
                  <option key={o} value={o}>
                    {label}
                  </option>
                ))}
            </select>
          )}
        </div>
        {sizeControls}
        {insufficient || !groupCol || !valueCol ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            {!groupCol || !valueCol
              ? "Escolha uma coluna de agrupamento e uma numérica para este widget."
              : "Dados insuficientes para este gráfico."}
          </p>
        ) : w.type === "bar" ? (
          <>
            <div className="relative">
              <div
                ref={barPresentation.scrollable ? chartScrollRef : undefined}
                className={cn(
                  "h-64 overflow-x-auto overflow-y-hidden p-4",
                  barPresentation.scrollable && "oliam-chart-drag-scroll",
                )}
                onPointerDown={
                  barPresentation.scrollable ? handleChartScrollPointerDown : undefined
                }
              >
                <div
                  style={{
                    height: "100%",
                    width: barPresentation.scrollable ? barPresentation.contentWidth : "100%",
                    minWidth: "100%",
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={barSeries}
                      margin={{ top: 20, right: 16, left: 12, bottom: 26 }}
                      barCategoryGap={barSeries.length > 10 ? "34%" : "18%"}
                    >
                      <defs>
                        <linearGradient id={`bar-grad-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--primary)" stopOpacity={1} />
                          <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.55} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        vertical={false}
                        horizontal
                        stroke="var(--border)"
                        strokeOpacity={0.6}
                      />
                      <XAxis
                        type="category"
                        dataKey="name"
                        tick={(props) => <AxisTick {...props} />}
                        tickLine={false}
                        axisLine={{ stroke: "var(--border)" }}
                        interval={0}
                        label={{
                          value: groupCol.label,
                          position: "insideBottom",
                          offset: -16,
                          fontSize: 11,
                          fontWeight: 600,
                          fill: "var(--muted-foreground)",
                        }}
                      />
                      <YAxis
                        type="number"
                        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        width={66}
                        tickFormatter={(value: number) => compactAxisValue(value, valueCol.kind)}
                      />
                      <ChartTooltip
                        cursor={{ fill: "var(--accent)", fillOpacity: 0.4, radius: 6 }}
                        content={(props) => (
                          <BarTooltip
                            active={props.active}
                            payload={props.payload as { value?: number }[]}
                            label={props.label as string}
                            series={barSeries}
                            kind={valueCol.kind}
                          />
                        )}
                      />
                      <Bar
                        dataKey="total"
                        fill={`url(#bar-grad-${w.id})`}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={72}
                        onClick={(pt) =>
                          pt?.name && handleGroupClick(groupCol.key, String(pt.name))
                        }
                        cursor="pointer"
                        animationDuration={500}
                      >
                        {barSeries.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={
                              conditionalColor(
                                entry.total,
                                valueCol.kind,
                                valueCol.conditionalFormat,
                              ) ?? `url(#bar-grad-${w.id})`
                            }
                          />
                        ))}
                        <LabelList
                          dataKey="total"
                          position="top"
                          fontSize={10}
                          fill="var(--muted-foreground)"
                          formatter={(v: number) => fmt(v, valueCol.kind) ?? String(v)}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {barPresentation.scrollable && <ChartScrollButtons label="gráfico de barras" />}
            </div>
            {barPresentation.scrollable && (
              <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
                {barSeries.length.toLocaleString("pt-BR")} categorias · use as setas, arraste ou
                role para os lados para ver todas
              </p>
            )}
            <p className="sr-only">
              Tabela alternativa ao gráfico de barras:{" "}
              {barSeries.map((g) => `${g.name}, ${g.total}`).join("; ")}.
            </p>
          </>
        ) : w.type === "pie" ? (
          <>
            <div
              className={cn(
                "grid min-w-0 items-center gap-3 p-4",
                w.span > 1 && "md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,0.9fr)]",
              )}
            >
              <div className="h-52 min-w-0 overflow-visible">
                <ResponsiveContainer width="100%" height="100%">
                  <RPieChart margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
                    <ChartTooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        fontSize: 12,
                        padding: "8px 12px",
                        boxShadow:
                          "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
                      }}
                      labelStyle={{
                        color: "var(--popover-foreground)",
                        fontWeight: 600,
                        marginBottom: 2,
                      }}
                      itemStyle={{ color: "var(--popover-foreground)", padding: 0 }}
                      formatter={(
                        v: number,
                        _name: string,
                        entry: { payload?: { count?: number } },
                      ) => {
                        const formatted = fmt(v, valueCol.kind) ?? String(v);
                        const count = entry?.payload?.count;
                        return count
                          ? `${formatted} · ${count.toLocaleString("pt-BR")} categorias agrupadas`
                          : formatted;
                      }}
                    />
                    <Pie
                      data={pieSeries}
                      dataKey="total"
                      nameKey="name"
                      innerRadius="48%"
                      outerRadius="76%"
                      paddingAngle={piePaddingAngle}
                      cornerRadius={pieCornerRadius}
                      stroke="var(--card)"
                      strokeWidth={3}
                      onClick={(pt) => pt?.name && handleGroupClick(groupCol.key, String(pt.name))}
                      onMouseEnter={(_, i) => setActivePieIndex(i)}
                      onMouseLeave={() => setActivePieIndex(null)}
                      cursor="pointer"
                      animationDuration={500}
                    >
                      {pieSeries.map((entry, i) => (
                        <Cell
                          key={entry.name}
                          fill={pieLegendItems[i]?.color}
                          opacity={activePieIndex === null || activePieIndex === i ? 1 : 0.45}
                          stroke={activePieIndex === i ? "var(--foreground)" : "var(--card)"}
                          strokeWidth={activePieIndex === i ? 2 : 3}
                          style={{ transition: "opacity 150ms ease, stroke 150ms ease" }}
                        />
                      ))}
                      <Label
                        position="center"
                        content={({ viewBox }) => {
                          const box = viewBox as { cx?: number; cy?: number } | undefined;
                          if (box?.cx === undefined || box?.cy === undefined) return null;
                          const active = activePieIndex !== null ? pieSeries[activePieIndex] : null;
                          const label = active ? truncateLabel(active.name, 12) : "Total";
                          const value = fmt(active ? active.total : pieTotal, valueCol.kind) ?? "–";
                          return (
                            <g style={{ pointerEvents: "none" }}>
                              <text
                                x={box.cx}
                                y={box.cy}
                                textAnchor="middle"
                                dominantBaseline="central"
                              >
                                <tspan
                                  x={box.cx}
                                  dy="-0.35em"
                                  fontFamily="var(--font-display)"
                                  fontSize={17}
                                  fontWeight={800}
                                  fill="var(--foreground)"
                                >
                                  {value}
                                </tspan>
                                <tspan
                                  x={box.cx}
                                  dy="1.4em"
                                  fontSize={10}
                                  fill="var(--muted-foreground)"
                                >
                                  {label}
                                </tspan>
                              </text>
                            </g>
                          );
                        }}
                      />
                    </Pie>
                  </RPieChart>
                </ResponsiveContainer>
              </div>
              <PieLegend
                items={pieLegendItems}
                kind={valueCol.kind}
                activeIndex={activePieIndex}
                onHoverIndex={setActivePieIndex}
                onSelectIndex={(i) => {
                  const item = pieSeries[i];
                  if (item) handleGroupClick(groupCol.key, item.name);
                }}
              />
            </div>
            <p className="sr-only">
              Tabela alternativa à pizza:{" "}
              {pieSeries
                .map((g) =>
                  "count" in g && g.count
                    ? `${g.name} (${g.count} categorias agrupadas), ${g.total}`
                    : `${g.name}, ${g.total}`,
                )
                .join("; ")}
              .
            </p>
          </>
        ) : w.type === "area" ? (
          <>
            <div className="relative">
              <div
                ref={timeSeriesPresentation.scrollable ? chartScrollRef : undefined}
                className={cn(
                  "h-56 overflow-x-auto overflow-y-hidden p-4",
                  timeSeriesPresentation.scrollable && "oliam-chart-drag-scroll",
                )}
                onPointerDown={
                  timeSeriesPresentation.scrollable ? handleChartScrollPointerDown : undefined
                }
              >
                <div
                  style={{
                    height: "100%",
                    width: timeSeriesPresentation.scrollable
                      ? timeSeriesPresentation.contentWidth
                      : "100%",
                    minWidth: "100%",
                  }}
                >
                  <ResponsiveContainer>
                    <AreaChart data={series} margin={{ top: 20, right: 12, left: 4, bottom: 22 }}>
                      <defs>
                        <linearGradient id={`area-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={seriesColor} stopOpacity={0.45} />
                          <stop offset="100%" stopColor={seriesColor} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="name"
                        tick={(props) => <AxisTick {...props} />}
                        interval={0}
                        label={{
                          value: groupCol.label,
                          position: "insideBottom",
                          offset: -14,
                          fontSize: 11,
                          fill: "var(--muted-foreground)",
                        }}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v: number) => fmt(v, valueCol.kind) ?? String(v)}
                        label={{
                          value: `${aggregationLabels[op]} de ${valueCol.label}`,
                          angle: -90,
                          position: "insideLeft",
                          fontSize: 11,
                          fill: "var(--muted-foreground)",
                        }}
                      />
                      <ChartTooltip
                        contentStyle={{
                          background: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          fontSize: 12,
                          padding: "8px 12px",
                          boxShadow:
                            "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
                        }}
                        labelStyle={{
                          color: "var(--popover-foreground)",
                          fontWeight: 600,
                          marginBottom: 2,
                        }}
                        itemStyle={{ color: "var(--popover-foreground)", padding: 0 }}
                        formatter={(v: number) => fmt(v, valueCol.kind) ?? String(v)}
                      />
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke={seriesColor}
                        strokeWidth={2}
                        fill={`url(#area-${w.id})`}
                        dot={(dotProps: ChartDotProps) => (
                          <ChartDot
                            {...dotProps}
                            r={3}
                            groupCol={groupCol}
                            valueCol={valueCol}
                            onSelect={handleGroupClick}
                          />
                        )}
                        activeDot={(dotProps: ChartDotProps) => (
                          <ChartDot
                            {...dotProps}
                            r={5}
                            groupCol={groupCol}
                            valueCol={valueCol}
                            onSelect={handleGroupClick}
                          />
                        )}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {timeSeriesPresentation.scrollable && <ChartScrollButtons label="gráfico de área" />}
            </div>
            {timeSeriesPresentation.scrollable && (
              <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
                {series.length.toLocaleString("pt-BR")} períodos · use as setas, arraste ou role
                para os lados
              </p>
            )}
            <p className="sr-only">
              Tabela alternativa à área: {series.map((g) => `${g.name}, ${g.total}`).join("; ")}.
            </p>
          </>
        ) : (
          <>
            <div className="relative">
              <div
                ref={timeSeriesPresentation.scrollable ? chartScrollRef : undefined}
                className={cn(
                  "h-56 overflow-x-auto overflow-y-hidden p-4",
                  timeSeriesPresentation.scrollable && "oliam-chart-drag-scroll",
                )}
                onPointerDown={
                  timeSeriesPresentation.scrollable ? handleChartScrollPointerDown : undefined
                }
              >
                <div
                  style={{
                    height: "100%",
                    width: timeSeriesPresentation.scrollable
                      ? timeSeriesPresentation.contentWidth
                      : "100%",
                    minWidth: "100%",
                  }}
                >
                  <ResponsiveContainer>
                    <LineChart data={series} margin={{ top: 20, right: 12, left: 4, bottom: 22 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="name"
                        tick={(props) => <AxisTick {...props} />}
                        interval={0}
                        label={{
                          value: groupCol.label,
                          position: "insideBottom",
                          offset: -14,
                          fontSize: 11,
                          fill: "var(--muted-foreground)",
                        }}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v: number) => fmt(v, valueCol.kind) ?? String(v)}
                        label={{
                          value: `${aggregationLabels[op]} de ${valueCol.label}`,
                          angle: -90,
                          position: "insideLeft",
                          fontSize: 11,
                          fill: "var(--muted-foreground)",
                        }}
                      />
                      <ChartTooltip
                        contentStyle={{
                          background: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          fontSize: 12,
                          padding: "8px 12px",
                          boxShadow:
                            "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
                        }}
                        labelStyle={{
                          color: "var(--popover-foreground)",
                          fontWeight: 600,
                          marginBottom: 2,
                        }}
                        itemStyle={{ color: "var(--popover-foreground)", padding: 0 }}
                        formatter={(v: number) => fmt(v, valueCol.kind) ?? String(v)}
                      />
                      <Line
                        type="monotone"
                        dataKey="total"
                        stroke={seriesColor}
                        strokeWidth={2}
                        dot={(dotProps: ChartDotProps) => (
                          <ChartDot
                            {...dotProps}
                            r={3}
                            groupCol={groupCol}
                            valueCol={valueCol}
                            onSelect={handleGroupClick}
                          />
                        )}
                        activeDot={(dotProps: ChartDotProps) => (
                          <ChartDot
                            {...dotProps}
                            r={5}
                            groupCol={groupCol}
                            valueCol={valueCol}
                            onSelect={handleGroupClick}
                          />
                        )}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {timeSeriesPresentation.scrollable && <ChartScrollButtons label="linha do tempo" />}
            </div>
            {timeSeriesPresentation.scrollable && (
              <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
                {series.length.toLocaleString("pt-BR")} períodos · use as setas, arraste ou role
                para os lados
              </p>
            )}
            <p className="sr-only">
              Tabela alternativa à evolução: {series.map((g) => `${g.name}, ${g.total}`).join("; ")}
              .
            </p>
          </>
        )}
      </article>
    );
  }

  if (w.type === "ranking") {
    const groupCol = columns.find((c) => c.key === w.groupKey);
    const requestedOp = w.op ?? "sum";
    const configuredValueCol = columns.find((c) => c.key === w.valueKey);
    const valueCol =
      (configuredValueCol &&
      (requestedOp === "count" || numericKinds.includes(configuredValueCol.kind))
        ? configuredValueCol
        : undefined) ?? (requestedOp === "count" ? columns[0] : numericCols[0]);
    const relevantOps =
      groupCol && valueCol
        ? relevantAggregationOps(data, groupCol.key, valueCol.key)
        : (Object.keys(aggregationLabels) as AggregationOp[]);
    const op: AggregationOp = relevantOps.includes(w.op ?? "sum")
      ? (w.op ?? "sum")
      : (relevantOps[0] ?? "sum");
    const topN = w.topN ?? 5;
    const grouped =
      groupCol && valueCol ? groupAndAggregate(data, groupCol.key, valueCol.key, op) : [];
    const ranked = [...grouped].sort((a, b) => b.total - a.total).slice(0, topN);
    const max = ranked.reduce((m, g) => Math.max(m, Math.abs(g.total)), 0) || 1;
    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <WidgetHead
          title={
            op === "count"
              ? `Top ${topN} · Registros por ${groupCol?.label ?? ""}`
              : `Top ${topN} · ${aggregationLabels[op]} de ${valueCol?.label ?? ""} por ${groupCol?.label ?? ""}`
          }
          icon={<ListOrdered className="size-3.5 shrink-0 text-muted-foreground" />}
          {...dragProps}
        />
        <div
          className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
          data-export-controls
        >
          <GroupAggHint />
          <FilterChip groupKey={groupCol?.key} />
          <FieldDropSlot
            accepts={groupableKinds}
            onDropColumn={(key) => onConfigure({ groupKey: key })}
          >
            <select
              aria-label="Agrupar por"
              className="oliam-select"
              value={groupCol?.key ?? ""}
              onChange={(e) => onConfigure({ groupKey: e.target.value })}
            >
              {!groupCol && <option value="">Selecione…</option>}
              {groupableCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldDropSlot>
          <FieldDropSlot
            accepts={op === "count" ? (Object.keys(kinds) as Kind[]) : numericKinds}
            onDropColumn={(key) => onConfigure({ valueKey: key })}
          >
            <select
              aria-label={op === "count" ? "Coluna usada para contar" : "Coluna numérica"}
              className="oliam-select"
              value={valueCol?.key ?? ""}
              onChange={(e) => onConfigure({ valueKey: e.target.value })}
            >
              {!valueCol && <option value="">Selecione…</option>}
              {(op === "count" ? columns : numericCols).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldDropSlot>
          {relevantOps.length > 1 && (
            <select
              aria-label="Agregação"
              className="oliam-select"
              value={op}
              onChange={(e) => onConfigure({ op: e.target.value as AggregationOp })}
            >
              {Object.entries(aggregationLabels)
                .filter(([o]) => relevantOps.includes(o as AggregationOp))
                .map(([o, label]) => (
                  <option key={o} value={o}>
                    {label}
                  </option>
                ))}
            </select>
          )}
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Itens
            <select
              aria-label="Quantidade de itens no ranking"
              className="oliam-select h-7"
              value={topN}
              onChange={(e) => onConfigure({ topN: Number(e.target.value) })}
            >
              {[3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        {sizeControls}
        {!groupCol || !valueCol || ranked.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            {!groupCol || !valueCol
              ? "Escolha uma coluna de agrupamento e uma numérica para este widget."
              : "Dados insuficientes para este ranking."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2 p-4">
            {ranked.map((g, i) => (
              <li key={g.name}>
                <button
                  type="button"
                  className="oliam-ranking-row w-full text-left"
                  onClick={() => handleGroupClick(groupCol.key, String(g.name))}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">
                      <span className="font-mono text-muted-foreground">{i + 1}.</span>{" "}
                      <span
                        className={cn(g.name === NOT_INFORMED && "italic text-muted-foreground")}
                      >
                        {g.name}
                      </span>
                    </span>
                    <span
                      className="font-mono shrink-0"
                      style={{
                        color:
                          conditionalColor(g.total, valueCol.kind, valueCol.conditionalFormat) ??
                          undefined,
                      }}
                    >
                      {fmt(g.total, valueCol.kind) ?? "–"}
                    </span>
                  </div>
                  <div className="oliam-ranking-track">
                    <div
                      className="oliam-ranking-fill"
                      style={{
                        width: `${Math.max(4, (Math.abs(g.total) / max) * 100)}%`,
                        background:
                          conditionalColor(g.total, valueCol.kind, valueCol.conditionalFormat) ??
                          undefined,
                      }}
                    />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
    );
  }

  if (w.type === "map") {
    const groupCol = columns.find((c) => c.key === w.groupKey);
    const requestedOp = w.op ?? "sum";
    const configuredValueCol = columns.find((c) => c.key === w.valueKey);
    const valueCol =
      (configuredValueCol &&
      (requestedOp === "count" || numericKinds.includes(configuredValueCol.kind))
        ? configuredValueCol
        : undefined) ?? (requestedOp === "count" ? columns[0] : numericCols[0]);
    const relevantOps =
      groupCol && valueCol
        ? relevantAggregationOps(data, groupCol.key, valueCol.key)
        : (Object.keys(aggregationLabels) as AggregationOp[]);
    const op: AggregationOp = relevantOps.includes(w.op ?? "sum")
      ? (w.op ?? "sum")
      : (relevantOps[0] ?? "sum");
    const grouped =
      groupCol && valueCol ? groupAndAggregate(data, groupCol.key, valueCol.key, op) : [];
    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <WidgetHead
          title={
            op === "count"
              ? `Contagem de registros por ${groupCol?.label ?? "local"}`
              : `${aggregationLabels[op]} de ${valueCol?.label ?? ""} por ${groupCol?.label ?? "local"}`
          }
          icon={<MapPin className="size-3.5 shrink-0 text-muted-foreground" />}
          {...dragProps}
        />
        <div
          className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
          data-export-controls
        >
          <GroupAggHint />
          <FilterChip groupKey={groupCol?.key} />
          <FieldDropSlot
            accepts={groupableKinds}
            onDropColumn={(key) => onConfigure({ groupKey: key })}
          >
            <select
              aria-label="Coluna de local"
              className="oliam-select"
              value={groupCol?.key ?? ""}
              onChange={(e) => onConfigure({ groupKey: e.target.value })}
            >
              {!groupCol && <option value="">Selecione…</option>}
              {groupableCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldDropSlot>
          <FieldDropSlot
            accepts={op === "count" ? (Object.keys(kinds) as Kind[]) : numericKinds}
            onDropColumn={(key) => onConfigure({ valueKey: key })}
          >
            <select
              aria-label={op === "count" ? "Coluna usada para contar" : "Coluna numérica"}
              className="oliam-select"
              value={valueCol?.key ?? ""}
              onChange={(e) => onConfigure({ valueKey: e.target.value })}
            >
              {!valueCol && <option value="">Selecione…</option>}
              {(op === "count" ? columns : numericCols).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldDropSlot>
          {relevantOps.length > 1 && (
            <select
              aria-label="Agregação"
              className="oliam-select"
              value={op}
              onChange={(e) => onConfigure({ op: e.target.value as AggregationOp })}
            >
              {Object.entries(aggregationLabels)
                .filter(([o]) => relevantOps.includes(o as AggregationOp))
                .map(([o, label]) => (
                  <option key={o} value={o}>
                    {label}
                  </option>
                ))}
            </select>
          )}
        </div>
        {sizeControls}
        {!groupCol || !valueCol ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            Escolha uma coluna com nome de local (cidade, estado ou país) e uma coluna numérica para
            este widget.
          </p>
        ) : (
          <MapWidgetBody
            grouped={grouped}
            valueColumn={valueCol}
            onSelect={(name) => handleGroupClick(groupCol.key, name)}
          />
        )}
      </article>
    );
  }

  if (w.type === "rating") {
    const col =
      columns.find((c) => c.key === w.metricKey && numericKinds.includes(c.kind)) ?? numericCols[0];
    const scaleMax = w.scaleMax ?? 5;
    if (!col) {
      return (
        <EmptyWidget
          {...dragProps}
          title="Avaliação"
          span={w.span}
          size={w.size}
          type={w.type}
          animationDelay={animationDelay}
          message="Nenhuma coluna numérica disponível."
        />
      );
    }
    const values = data.map((r) => Number(r[col.key])).filter((v) => Number.isFinite(v));
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const filled = Math.round(avg);
    const ratingStyle = conditionalStyle(avg, col.kind, col.conditionalFormat);
    const ratingColor = conditionalColor(avg, col.kind, col.conditionalFormat) ?? "var(--primary)";
    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms`, ...(ratingStyle ?? {}) }}
      >
        <WidgetHead
          title={col.label}
          icon={<Star className="size-3.5 shrink-0 text-muted-foreground" />}
          {...dragProps}
        />
        <div
          className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
          data-export-controls
        >
          <FieldDropSlot
            accepts={numericKinds}
            onDropColumn={(key) => onConfigure({ metricKey: key })}
          >
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Coluna
              <select
                aria-label="Coluna da avaliação"
                className="oliam-select h-7"
                value={col.key}
                onChange={(e) => onConfigure({ metricKey: e.target.value })}
              >
                {numericCols.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </FieldDropSlot>
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Escala até
            <select
              aria-label="Nota máxima da escala"
              className="oliam-select h-7"
              value={scaleMax}
              onChange={(e) => onConfigure({ scaleMax: Number(e.target.value) })}
            >
              {[5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-col items-start gap-2 p-5">
          <p className="font-mono text-3xl" style={{ color: ratingStyle?.color }}>
            {values.length ? avg.toFixed(1) : "–"}
            <span className="ml-1 text-sm text-muted-foreground">/ {scaleMax}</span>
          </p>
          {scaleMax === 5 ? (
            <div className="flex gap-1" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={cn("size-4", i < filled ? "fill-current" : "text-muted-foreground")}
                  style={i < filled ? { color: ratingColor } : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="oliam-ranking-track w-full max-w-40">
              <div
                className="oliam-ranking-fill"
                style={{
                  width: `${values.length ? Math.min(100, (avg / scaleMax) * 100) : 0}%`,
                  background: ratingColor,
                }}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {values.length
              ? `${values.length.toLocaleString("pt-BR")} avaliações consideradas`
              : "Nenhum valor numérico disponível."}
          </p>
        </div>
      </article>
    );
  }

  // table
  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead title={`Base detalhada · ${data.length} linhas`} {...dragProps} />
      <DataTable
        rows={data}
        columns={columns}
        sort={sort}
        setSort={setSort}
        interpolated={interpolated}
      />
    </article>
  );
}

function EmptyWidget({
  title,
  span,
  size,
  type,
  animationDelay,
  message,
  ...dragProps
}: {
  title: string;
  span: WidgetSpan;
  size: WidgetSize;
  type: WidgetType;
  animationDelay: number;
  message: string;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onRemove?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  canPaste?: boolean;
  onMoveBack?: () => void;
  onMoveForward?: () => void;
  disableBack?: boolean;
  disableForward?: boolean;
}) {
  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(span), sizeClass(size, type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead title={title} {...dragProps} />
      <p className="p-6 text-center text-xs text-muted-foreground">{message}</p>
    </article>
  );
}
const thresholdOperatorLabel: Record<string, string> = {
  lt: "menor que",
  lte: "menor ou igual a",
  gt: "maior que",
  gte: "maior ou igual a",
};

function FormatRulesEditor({
  column,
  onChange,
}: {
  column: Column;
  onChange: (rules: ConditionalFormatRule[]) => void;
}) {
  const [adding, setAdding] = useState<"threshold" | "scale" | null>(null);
  const [operator, setOperator] = useState<"lt" | "lte" | "gt" | "gte">("lt");
  const [value, setValue] = useState("");
  const [color, setColor] = useState("#c0392b");
  const [background, setBackground] = useState(false);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [minColor, setMinColor] = useState("#dbeafe");
  const [maxColor, setMaxColor] = useState("#1d4ed8");
  const rules = column.conditionalFormat ?? [];
  const canAddRule =
    adding === "threshold"
      ? value.trim() !== "" && Number.isFinite(Number(value))
      : adding === "scale"
        ? min.trim() !== "" &&
          max.trim() !== "" &&
          Number.isFinite(Number(min)) &&
          Number.isFinite(Number(max)) &&
          Number(max) > Number(min)
        : false;

  const cancel = () => {
    setAdding(null);
    setValue("");
    setMin("");
    setMax("");
  };
  const addRule = () => {
    if (adding === "threshold") {
      const num = Number(value);
      if (!value.trim() || !Number.isFinite(num)) return;
      onChange([
        ...rules,
        { id: crypto.randomUUID(), type: "threshold", operator, value: num, color, background },
      ]);
    } else if (adding === "scale") {
      const mn = Number(min),
        mx = Number(max);
      if (!min.trim() || !max.trim() || !Number.isFinite(mn) || !Number.isFinite(mx) || mx <= mn)
        return;
      onChange([
        ...rules,
        { id: crypto.randomUUID(), type: "scale", min: mn, max: mx, minColor, maxColor },
      ]);
    }
    cancel();
  };

  return (
    <div className="border-b p-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="truncate">{column.label}</span>
        {adding === null && (
          <button
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Adicionar regra de formatação para ${column.label}`}
            onClick={() => setAdding("threshold")}
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
      {rules.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
            >
              <span className="flex items-center gap-1.5 truncate">
                <span
                  className="inline-block size-2.5 shrink-0 border"
                  style={{
                    background:
                      r.type === "threshold"
                        ? r.color
                        : `linear-gradient(90deg, ${r.minColor}, ${r.maxColor})`,
                  }}
                />
                {r.type === "threshold"
                  ? `${thresholdOperatorLabel[r.operator ?? "lt"]} ${r.value}${r.background ? ", fundo" : ""}`
                  : `escala de ${r.min} a ${r.max}`}
              </span>
              <button
                aria-label="Remover regra"
                onClick={() => onChange(rules.filter((x) => x.id !== r.id))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="mt-2 space-y-2 border bg-accent/40 p-2">
          <div className="flex gap-2">
            <button
              className={cn("oliam-select flex-1", adding === "threshold" && "border-primary")}
              onClick={() => setAdding("threshold")}
            >
              Limite
            </button>
            <button
              className={cn("oliam-select flex-1", adding === "scale" && "border-primary")}
              onClick={() => setAdding("scale")}
            >
              Escala
            </button>
          </div>
          {adding === "threshold" ? (
            <>
              <div className="flex gap-2">
                <select
                  className="oliam-select flex-1"
                  value={operator}
                  onChange={(e) => setOperator(e.target.value as typeof operator)}
                >
                  <option value="lt">menor que</option>
                  <option value="lte">menor ou igual a</option>
                  <option value="gt">maior que</option>
                  <option value="gte">maior ou igual a</option>
                </select>
                <input
                  className="oliam-input w-20"
                  type="number"
                  placeholder="valor"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                Cor
                <span className="ml-auto flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={background}
                    onChange={(e) => setBackground(e.target.checked)}
                  />
                  aplicar no fundo
                </span>
              </label>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  className="oliam-input w-full"
                  type="number"
                  placeholder="mínimo"
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                />
                <input
                  className="oliam-input w-full"
                  type="number"
                  placeholder="máximo"
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={minColor}
                    onChange={(e) => setMinColor(e.target.value)}
                  />
                  cor mínima
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={maxColor}
                    onChange={(e) => setMaxColor(e.target.value)}
                  />
                  cor máxima
                </label>
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={cancel}>
              Cancelar
            </Button>
            <Button size="sm" disabled={!canAddRule} onClick={addRule}>
              Adicionar regra
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DataTable({
  rows,
  columns,
  sort,
  setSort,
  interpolated,
}: {
  rows: Row[];
  columns: Column[];
  sort: { key: string; dir: "asc" | "desc" } | null;
  setSort: (s: { key: string; dir: "asc" | "desc" }) => void;
  interpolated?: Set<string>;
}) {
  const parent = useRef<HTMLDivElement>(null),
    visible = columns.filter((c) => c.visible),
    v = useVirtualizer({
      count: rows.length,
      getScrollElement: () => parent.current,
      estimateSize: () => 36,
      overscan: 8,
    });
  return (
    <div ref={parent} className="h-[360px] overflow-auto">
      <div className="sticky top-0 z-10 flex min-w-max border-b border-border bg-muted/60 backdrop-blur-sm">
        {visible.map((c) => {
          const header = (
            <button
              key={c.key}
              className="flex w-44 items-center gap-2 border-r border-border px-3 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() =>
                setSort({
                  key: c.key,
                  dir: sort?.key === c.key && sort.dir === "asc" ? "desc" : "asc",
                })
              }
            >
              <span className="truncate">{c.label}</span>
              {c.formula && (
                <Calculator className="size-3 shrink-0 text-secondary-accent" aria-hidden="true" />
              )}
              {sort?.key === c.key &&
                (sort.dir === "asc" ? (
                  <ArrowUp className="size-3 shrink-0 text-primary" />
                ) : (
                  <ArrowDown className="size-3 shrink-0 text-primary" />
                ))}
            </button>
          );
          if (!c.description) return header;
          return (
            <Tooltip key={c.key}>
              <TooltipTrigger asChild>{header}</TooltipTrigger>
              <TooltipContent>{c.description}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="relative min-w-max" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((item) => {
          const row = rows[item.index] ?? {};
          return (
            <div
              key={item.key}
              className={cn(
                "absolute left-0 flex border-b border-border transition-colors hover:bg-accent/60",
                item.index % 2 === 1 && "bg-muted/25",
              )}
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
            >
              {visible.map((c) => {
                const shown = fmt(row[c.key] ?? null, c.kind),
                  numeric = numericKinds.includes(c.kind),
                  isInterpolated = interpolated?.has(`${item.index}-${c.key}`),
                  cellStyle = conditionalStyle(row[c.key] ?? null, c.kind, c.conditionalFormat);
                return (
                  <div
                    key={c.key}
                    title={
                      isInterpolated ? "Valor estimado por interpolação" : (shown ?? undefined)
                    }
                    style={cellStyle ?? undefined}
                    className={cn(
                      "w-44 truncate border-r border-border px-3 py-2 text-xs",
                      numeric && "text-right font-mono",
                      shown === null && "text-muted-foreground",
                      isInterpolated &&
                        "outline outline-1 -outline-offset-1 outline-secondary-accent",
                    )}
                  >
                    <span>{shown ?? "—"}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
