import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Columns3,
  ClipboardPaste,
  Download,
  FileImage,
  FileText,
  Filter,
  FolderSync,
  GitMerge,
  HelpCircle,
  History,
  LayoutDashboard,
  Maximize2,
  Menu,
  Palette,
  PanelRight,
  Plus,
  Redo2,
  Search,
  Settings2,
  Sheet as SheetIcon,
  ShieldAlert,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table-widget";
import { FolderMonitorWidget } from "@/components/folder-monitor-widget";
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
import { createLatestTaskQueue, type LatestTaskQueue } from "@/lib/latest-task-queue";
import type {
  Column,
  Dashboard,
  FilterRule,
  Kind,
  Row,
  SheetData,
  Widget,
  WidgetType,
} from "@/lib/types";
import { numericKinds, widgetTypeLabels } from "@/lib/types";
import {
  createWidget,
  buildDefaultWidgets,
  groupableKinds,
  pickBestGroupColumn,
  schedulePeriodColumns,
} from "@/lib/widgets";
import { infer, withCalculatedColumns } from "@/lib/format";
import {
  applyMissingRules,
  detectQualitySignals,
  groupAndAggregate,
  matchesRange,
} from "@/lib/data-pipeline";
import { resolveColorGroupLabels, resolveSourceCellFills } from "@/lib/cell-fill-provenance";
import type { ImportDiagnostics, SourceNote } from "@/lib/import-intelligence";
import type {
  WorkbookChartDiagnostic,
  WorkbookImageDiagnostic,
  WorkbookShapeDiagnostic,
} from "@/lib/workbook-metadata";
import { buildRecommendedWidgets, generateAutoDashboardPlan } from "@/lib/auto-dashboard";
import { detectOperationalWidgetTypes } from "@/lib/operational-widgets";
import {
  loadDashboards,
  loadFolderMonitor,
  ONBOARDING_KEY,
  removeFolderMonitor,
  saveDashboards,
  saveFolderMonitor,
  isPrivateMode,
  setPrivateMode,
  type SaveResult,
} from "@/lib/storage";
import {
  LARGE_FILE_BYTES,
  sheetToRows,
  type SheetOption,
  type SourceGrid,
  type ImportAudit,
} from "@/lib/import";
import { mergeReimportedSheets } from "@/lib/dashboard";
import { compareVersions, type VersionDiff } from "@/lib/import-workbench";
import { analyzeSpreadsheet } from "@/lib/spreadsheet-intelligence";
import { readWorkbookFileWithReport } from "@/lib/workbook-reader-client";
import { describeReaderOutcome, workbookFormat } from "@/lib/workbook-reading-engine";
import {
  buildFailedImportMetricEntry,
  buildImportMetricEntry,
  recordImportMetric,
} from "@/lib/import-metrics";
import { WORKBOOK_ACCEPT, WORKBOOK_FORMATS_LABEL } from "@/lib/workbook-reader";
import { buildLiveDashboardContext } from "@/lib/assistant-context";
import { bookmarkView, createBookmark } from "@/lib/bookmarks";
import { markSourceRows } from "@/lib/data-review";
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
import { Mark } from "@/components/oliam/mark";
import { OliLoader } from "@/components/oliam/oli-loader";
import { OliWelcomeScene } from "@/components/oliam/oli-welcome-scene";
import { OliFace } from "@/components/oliam/oli-face";
import { useTheme, ThemeToggle } from "@/components/oliam/theme-toggle";
import { AnimatedNumber } from "@/components/oliam/animated-number";
import { Onboarding } from "@/components/oliam/onboarding";
import { useJoinSheetDialog } from "@/components/oliam/join-sheet-dialog";
import { usePresentationMode } from "@/components/oliam/presentation-mode";
import { BookmarkPanel } from "@/components/oliam/bookmark-panel";
import { GeminiChatPanel } from "@/components/oliam/gemini-chat-panel";
import { Home } from "@/components/oliam/home";
import { Empty } from "@/components/oliam/empty";
import { Review } from "@/components/oliam/review";
import { WidgetPickerIcon, widgetTypeDescriptions } from "@/components/oliam/widget-support";
import { WidgetCard } from "@/components/oliam/widget-card";
import { ImportDiagnosticsDialog } from "@/components/oliam/import-diagnostics-dialog";
import { ShortcutsDialog } from "@/components/oliam/shortcuts-dialog";
import { SourceNotesPanel } from "@/components/oliam/source-notes-panel";
import { SourceVisualsPanel } from "@/components/oliam/source-visuals-panel";
import { VersionDiffBanner } from "@/components/oliam/version-diff-banner";
import { useTermHint } from "@/components/oliam/term-hint-banner";
import { useBackgroundReviewAnalysis } from "@/components/oliam/use-background-review-analysis";
import { useDashboardExport } from "@/components/oliam/use-dashboard-export";
import { useSheetMutations } from "@/components/oliam/use-sheet-mutations";
import { useUndoRedoHistory } from "@/components/oliam/use-undo-redo-history";
import { useWidgetActions } from "@/components/oliam/use-widget-actions";
import { QualitySignalsPanel } from "@/components/oliam/quality-signals-panel";
import { MissingRulesPanel } from "@/components/oliam/missing-rules-panel";
import { FormatPanel } from "@/components/oliam/format-panel";
import { FilterChipsBar } from "@/components/oliam/filter-chips-bar";
import { ColumnPanel } from "@/components/oliam/column-panel";
import { DashboardNavSidebar } from "@/components/oliam/dashboard-nav-sidebar";
import { InsightSidebar } from "@/components/oliam/insight-sidebar";
import { CommandPalette } from "@/components/oliam/command-palette";

// Massa inteiramente sintética e gerada em tempo de execução. Evita manter no
// código uma tabela com aparência de dado empresarial real e ainda exercita
// datas, categorias, números, percentuais, ausências e metas na demonstração.
const demo: Row[] = Array.from({ length: 12 }, (_, index) => ({
  data: `${String(2 + index * 2).padStart(2, "0")}/01/2026`,
  unidade: ["Linha A", "Linha B", "Linha C"][index % 3] ?? "Linha A",
  turno: ["Manhã", "Tarde", "Noite"][index % 3] ?? "Manhã",
  resultado: index === 8 ? null : 91 + ((index * 7) % 11),
  meta: 95,
  amostras: 18 + ((index * 5) % 17),
  conformidade: index === 8 ? null : (91 + ((index * 7) % 11)) / 100,
}));

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
  // Falso na renderização do servidor; vira true só depois que o React conecta
  // os handlers no cliente. Evita que um clique na tela Empty (visível antes
  // da hidratação terminar) seja perdido silenciosamente — ver seção 74 do
  // CURRENT_STATE_AUDIT.md.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
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
      sourceNotes?: SourceNote[];
      sourceImages?: WorkbookImageDiagnostic[];
      sourceShapes?: WorkbookShapeDiagnostic[];
      sourceCharts?: WorkbookChartDiagnostic[];
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
  const dashboardSaveQueue = useRef<LatestTaskQueue<Dashboard[]> | null>(null);
  if (!dashboardSaveQueue.current) {
    dashboardSaveQueue.current = createLatestTaskQueue(saveDashboards, (result: SaveResult) => {
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
  }
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
  // Falso na renderização do servidor (sem localStorage); sincronizado com o
  // valor real só depois que o React conecta no cliente, para não divergir
  // do HTML do servidor quando o usuário já tinha ativado o modo privado
  // numa sessão anterior (bug real de hidratação encontrado em produção).
  const [privateMode, setPrivateModeState] = useState(false);
  useEffect(() => setPrivateModeState(isPrivateMode()), []);

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
    dashboardSaveQueue.current?.push(list);
  };
  const readWorkbook = async (file: File, signal?: AbortSignal) => {
    const labels = {
      decoding: "Identificando formato e codificação…",
      parsing: "Lendo células, fórmulas e formatação…",
      analyzing: "Analisando cabeçalhos e regiões de dados…",
    };
    let result: Awaited<ReturnType<typeof readWorkbookFileWithReport>>;
    try {
      result = await readWorkbookFileWithReport(
        file,
        (progress) => setImportProgressLabel(labels[progress]),
        signal,
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        void recordImportMetric(buildFailedImportMetricEntry(error, workbookFormat(file.name)));
      }
      throw error;
    }
    void recordImportMetric(buildImportMetricEntry(result.report));
    const sheets = result.sheets;
    if (!sheets.length) throw new Error("empty-workbook");
    const readerMessages = describeReaderOutcome(result.report);
    if (readerMessages.length) setImportWarning(readerMessages.join(" "));
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
    // Uma aba sem linha de dado ainda vale a pena mostrar na revisão se
    // tiver gráfico, forma com texto ou imagem nativos do Excel — mesma
    // exceção já aplicada em `sheetsWithData` (import.ts), que só chega até
    // aqui se essa condição também for respeitada neste segundo filtro.
    const nonEmpty = data.filter(
      (s) =>
        s.rows.length > 0 ||
        Boolean(
          s.diagnostics &&
          (s.diagnostics.charts.length ||
            s.diagnostics.shapes.length ||
            s.diagnostics.images.length),
        ),
    );
    if (!nonEmpty.length) return;
    setReviewSheets(
      nonEmpty.map((s) => ({
        name: s.name,
        rows: s.rows,
        columns: infer(s.rows),
        ...(s.diagnostics ? { diagnostics: s.diagnostics } : {}),
        ...(s.sourceGrid ? { sourceGrid: s.sourceGrid } : {}),
        ...(s.audit ? { audit: s.audit } : {}),
        ...(s.diagnostics?.sourceNotes.length ? { sourceNotes: s.diagnostics.sourceNotes } : {}),
        ...(s.diagnostics?.images.length ? { sourceImages: s.diagnostics.images } : {}),
        ...(s.diagnostics?.shapes.length ? { sourceShapes: s.diagnostics.shapes } : {}),
        ...(s.diagnostics?.charts.length ? { sourceCharts: s.diagnostics.charts } : {}),
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
      const intelligence = analyzeSpreadsheet(s.rows, columns, s.diagnostics);
      const sourceCellFills = resolveSourceCellFills(
        s.rows,
        columns,
        s.diagnostics,
        s.audit,
        s.sourceGrid,
      );
      const colorGroupLabels = resolveColorGroupLabels(s.rows, columns, sourceCellFills);
      return {
        name: s.name,
        rows: s.rows,
        columns,
        autoDashboard,
        intelligence,
        widgets: buildRecommendedWidgets(autoDashboard, columns, s.rows),
        ...(s.diagnostics?.sourceNotes.length ? { sourceNotes: s.diagnostics.sourceNotes } : {}),
        ...(s.diagnostics?.images.length ? { sourceImages: s.diagnostics.images } : {}),
        ...(s.diagnostics?.shapes.length ? { sourceShapes: s.diagnostics.shapes } : {}),
        ...(s.diagnostics?.charts.length ? { sourceCharts: s.diagnostics.charts } : {}),
        ...(sourceCellFills.length ? { sourceCellFills } : {}),
        ...(colorGroupLabels.length ? { colorGroupLabels } : {}),
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
  const pasteData = async () => {
    setImportError(null);
    setImportWarning(null);
    const XLSX = await import("xlsx");
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
      const XLSX = await import("xlsx");
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
      const intelligence = analyzeSpreadsheet(s.rows, s.columns, s.diagnostics);
      const sourceCellFills = resolveSourceCellFills(
        s.rows,
        s.columns,
        s.diagnostics,
        s.audit,
        s.sourceGrid,
      );
      const colorGroupLabels = resolveColorGroupLabels(s.rows, s.columns, sourceCellFills);
      return {
        name: s.name,
        rows: s.rows,
        columns: s.columns,
        autoDashboard,
        intelligence,
        widgets: buildRecommendedWidgets(autoDashboard, s.columns, s.rows),
        ...(s.sourceNotes?.length ? { sourceNotes: s.sourceNotes } : {}),
        ...(s.sourceImages?.length ? { sourceImages: s.sourceImages } : {}),
        ...(s.sourceShapes?.length ? { sourceShapes: s.sourceShapes } : {}),
        ...(s.sourceCharts?.length ? { sourceCharts: s.sourceCharts } : {}),
        ...(sourceCellFills.length ? { sourceCellFills } : {}),
        ...(colorGroupLabels.length ? { colorGroupLabels } : {}),
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
        sourceFileName: name,
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
            sourceFileName: name,
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
            hydrated={hydrated}
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
  const [filterMenu, setFilterMenu] = useState(false);
  const [dismissedSignals, setDismissedSignals] = useState<Set<string>>(new Set());
  const [qualityPanel, setQualityPanel] = useState(false);
  const [focusedCell, setFocusedCell] = useState<{
    rowIndex: number;
    columnKey?: string;
    address?: string;
  } | null>(null);
  const [focusedWidgetId, setFocusedWidgetId] = useState<string | null>(null);
  const [formatPanel, setFormatPanel] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [importDiagnostics, setImportDiagnostics] = useState(false);
  const [widgetClipboard, setWidgetClipboard] = useState<Widget | null>(null);
  const [insightOpen, setInsightOpen] = useState(true);
  const { termHintBanner } = useTermHint(sheet.widgets);
  const backupInput = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const exportPdfRef = useRef<() => void>(() => {});
  const { backgroundReview, analysisProgress, cancelAnalysis } = useBackgroundReviewAnalysis(
    sheet.rows,
    sheet.columns,
    sheet.semanticOverrides,
    sheet.previousSnapshot?.rows,
  );
  const effectiveIntelligence = useMemo(
    () =>
      backgroundReview?.intelligence ??
      (sheet.semanticOverrides
        ? analyzeSpreadsheet(sheet.rows, sheet.columns, undefined, sheet.semanticOverrides)
        : (sheet.intelligence ?? analyzeSpreadsheet(sheet.rows, sheet.columns))),
    [backgroundReview, sheet.rows, sheet.columns, sheet.intelligence, sheet.semanticOverrides],
  );
  const semanticProfilesByKey = useMemo(
    () => new Map(effectiveIntelligence.columns.map((profile) => [profile.key, profile])),
    [effectiveIntelligence.columns],
  );
  const nums = sheet.columns.filter(
      (c) =>
        numericKinds.includes(c.kind) && (semanticProfilesByKey.get(c.key)?.aggregable ?? true),
    ),
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
    setFocusedCell(null);
    setFocusedWidgetId(null);
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
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        // Substitui o diálogo de impressão nativo do navegador pelo PDF
        // paginado e assinado do próprio painel — o navegador imprimiria só
        // o que está visível na tela, sem paginação nem os dados completos.
        e.preventDefault();
        exportPdfRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const { canUndo, canRedo, undo, redo, recordHistory } = useUndoRedoHistory(
    sheet,
    d.id,
    activeSheetIndex,
    updateSheet,
  );
  useEffect(() => {
    undoRef.current = undo;
    redoRef.current = redo;
  });
  const {
    setFilters,
    setColumns,
    setSemanticOverride,
    resetSemanticOverride,
    setExceptionDecision,
    correctException,
    editTableCell,
  } = useSheetMutations({ sheet, updateSheet, recordHistory, setFocusedCell });

  // Colunas calculadas recalculam ao vivo antes de qualquer filtro.
  const traceableRows = useMemo(() => markSourceRows(sheet.rows), [sheet.rows]);
  const withCalculated = useMemo(
    () => withCalculatedColumns(traceableRows, sheet.columns),
    [traceableRows, sheet.columns],
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
    () => (sheet.previousSnapshot ? (backgroundReview?.versionDiff ?? null) : null),
    [backgroundReview, sheet.previousSnapshot],
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
  const {
    widgets,
    setWidgets,
    addWidget,
    copyCurrentWidget,
    pasteCopiedWidget,
    updateWidget,
    traceException,
    removeWidget,
    moveWidget,
    reorderWidget,
  } = useWidgetActions({
    sheet,
    updateSheet,
    recordHistory,
    widgetClipboard,
    setWidgetClipboard,
    setSearch,
    setSort,
    setFilters,
    setFocusedCell,
  });
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
        focus: { widgetId: focusedWidgetId, cell: focusedCell },
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
      focusedWidgetId,
      focusedCell,
      p.folderMonitor,
    ],
  );
  const canAdd: Record<WidgetType, boolean> = {
    metric: nums.length > 0,
    "metric-trend": nums.length > 0,
    "folder-files": true,
    bar: nums.length > 0 && groupableCols.length > 0,
    pie: nums.length > 0 && groupableCols.length > 0,
    line: nums.length > 0 && !!dateCol,
    area: nums.length > 0 && groupableCols.length > 0,
    ranking: nums.length > 0 && groupableCols.length > 0,
    radar: nums.length > 0 && groupableCols.length > 0,
    rating: nums.length > 0,
    map: nums.length > 0 && groupableCols.length > 0,
    insights: nums.length > 0 && groupableCols.length > 0,
    "schedule-heatmap": schedulePeriodColumns(sheet.columns).length > 0,
    "attendance-overview": detectOperationalWidgetTypes(sheet.columns).includes(
      "attendance-overview",
    ),
    "validation-overview": detectOperationalWidgetTypes(sheet.columns).includes(
      "validation-overview",
    ),
    "control-chart": detectOperationalWidgetTypes(sheet.columns).includes("control-chart"),
    "plan-vs-actual": detectOperationalWidgetTypes(sheet.columns).includes("plan-vs-actual"),
    "exception-panel": true,
    "pivot-table": groupableCols.length >= 2,
    "matrix-heatmap": groupableCols.length >= 2,
    "version-compare": Boolean(sheet.previousSnapshot),
    table: true,
    image: (sheet.sourceImages?.length ?? 0) > 0,
  };

  const {
    exporting,
    exportError,
    exportXlsx,
    exportAuditCsv,
    exportComparisonCsv,
    exportCorrectedWorkbook,
    exportReviewPdf,
    exportEncryptedBackup,
    restoreEncryptedBackup,
    exportPng,
    exportPdf,
  } = useDashboardExport({
    dashboard: d,
    sheetName: sheet.name,
    data,
    sourceRowCount: sheet.rows.length,
    columns: sheet.columns,
    widgets,
    contentRef,
    onRestore: p.update,
  });
  useEffect(() => {
    exportPdfRef.current = () => void exportPdf();
  });

  const commitName = () => {
    const n = draftName.trim();
    if (n && n !== d.name) p.rename(d.id, n);
    setEditingName(false);
  };

  const { openJoin, dialog: joinDialog } = useJoinSheetDialog(
    sheet.columns,
    sheet.rows,
    updateSheet,
  );

  // Marcadores: um estado nomeado de filtros, busca e ordenação, salvo dentro
  // da própria aba para poder voltar a ele com um clique (ou alternar entre
  // eles automaticamente no modo apresentação).
  const bookmarks = sheet.bookmarks ?? [];
  const saveBookmark = (name: string) => {
    const bookmark = createBookmark(name, sheet.filters, search, sort);
    updateSheet({ bookmarks: [...bookmarks, bookmark] });
  };
  const removeBookmark = (id: string) =>
    updateSheet({ bookmarks: bookmarks.filter((b) => b.id !== id) });
  const applyBookmark = (b: (typeof bookmarks)[number]) => {
    const view = bookmarkView(b, sheet.columns);
    updateSheet({ filters: view.filters });
    setSearch(view.search);
    setSort(view.sort);
  };
  const { presentation, startPresentation, presentationBar } = usePresentationMode(
    d.name,
    bookmarks,
    applyBookmark,
  );

  const sourceNotesPanel = <SourceNotesPanel sourceNotes={sheet.sourceNotes} />;
  const sourceVisualsPanel = (
    <SourceVisualsPanel sourceShapes={sheet.sourceShapes} sourceCharts={sheet.sourceCharts} />
  );

  const focusAssistantCell = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const cell = target.closest<HTMLElement>("[data-assistant-cell]");
    const rowIndex = Number(cell?.dataset["assistantRowIndex"]);
    const columnKey = cell?.dataset["assistantColumnKey"];
    if (!cell || !Number.isFinite(rowIndex) || rowIndex < 1 || !columnKey) return;
    setFocusedCell((current) =>
      current?.rowIndex === rowIndex && current.columnKey === columnKey
        ? current
        : { rowIndex, columnKey },
    );
  };

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
          <div
            key={w.id}
            className="contents"
            data-assistant-widget-id={w.id}
            onPointerEnter={() =>
              setFocusedWidgetId((current) => (current === w.id ? current : w.id))
            }
            onFocusCapture={(event) => {
              setFocusedWidgetId(w.id);
              focusAssistantCell(event.target);
            }}
            onClickCapture={(event) => {
              setFocusedWidgetId(w.id);
              focusAssistantCell(event.target);
            }}
          >
            <WidgetCard
              widget={w}
              index={i}
              count={widgets.length}
              data={data}
              totalRows={rulesApplied.length}
              columns={sheet.columns}
              numericCols={nums}
              groupableCols={groupableCols}
              sourceImages={sheet.sourceImages ?? []}
              sourceCellFills={sheet.sourceCellFills ?? []}
              colorGroupLabels={sheet.colorGroupLabels ?? []}
              interpolated={interpolated}
              sort={sort}
              setSort={setSort}
              versionDelta={versionDelta}
              versionDiff={detailedVersionDiff}
              exceptions={effectiveIntelligence.exceptions}
              semanticProfiles={effectiveIntelligence.columns}
              exceptionDecisions={sheet.exceptionDecisions ?? {}}
              auditTrail={sheet.auditTrail ?? []}
              onExceptionDecision={setExceptionDecision}
              onCorrectException={correctException}
              onEditCell={editTableCell}
              onTraceException={traceException}
              focusedCell={focusedCell}
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
          </div>
        ))}
      </div>
    );

  return (
    <div className="flex h-screen overflow-hidden">
      <DashboardNavSidebar
        open={sidebar}
        onOpenChange={setSidebar}
        dashboards={p.dashboards}
        activeId={d.id}
        openDash={p.openDash}
        backHome={p.backHome}
        newDash={p.newDash}
        rowCount={sheet.rows.length}
        onOpenMissingPanel={() => setMissingPanel(true)}
      />
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
            {analysisProgress && sheet.rows.length > 500 && (
              <div
                className="hidden items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] text-muted-foreground lg:flex"
                role="status"
                aria-live="polite"
              >
                <OliLoader compact />
                Analisando {analysisProgress.percent}%
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-accent"
                  aria-label="Cancelar análise em segundo plano"
                  onClick={cancelAnalysis}
                >
                  <X className="size-3" />
                </button>
              </div>
            )}
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
                <DropdownMenuItem onSelect={exportCorrectedWorkbook}>
                  <SheetIcon />
                  Cópia corrigida (todas as abas)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={exportAuditCsv}>
                  <History />
                  Auditoria CSV
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={exportComparisonCsv}>
                  <GitMerge />
                  Comparação CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={exporting !== null}
                  onSelect={() => void exportReviewPdf()}
                >
                  {exporting === "review" ? <OliLoader compact /> : <FileText />}
                  {exporting === "review" ? "Gerando relatório…" : "Relatório de revisão PDF"}
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
                  {(Object.keys(widgetTypeLabels) as WidgetType[])
                    .filter((type) => type !== "line")
                    .map((type) => (
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
          <Button variant="outline" onClick={openJoin}>
            <GitMerge />
            <span className="hidden sm:inline">Combinar planilha</span>
          </Button>
          <BookmarkPanel
            key={`${d.id}-${activeSheetIndex}`}
            bookmarks={bookmarks}
            onApply={applyBookmark}
            onRemove={removeBookmark}
            onSave={saveBookmark}
          />
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
        {termHintBanner}
        <FilterChipsBar filters={sheet.filters} columns={sheet.columns} setFilters={setFilters} />
        <QualitySignalsPanel
          open={qualityPanel}
          onOpenChange={setQualityPanel}
          visibleSignals={visibleSignals}
          onDismiss={(key) => setDismissedSignals((prev) => new Set(prev).add(key))}
        />
        <ColumnPanel
          open={panel}
          onOpenChange={setPanel}
          columns={sheet.columns}
          setColumns={setColumns}
          semanticProfilesByKey={semanticProfilesByKey}
          semanticOverrides={sheet.semanticOverrides}
          setSemanticOverride={setSemanticOverride}
          resetSemanticOverride={resetSemanticOverride}
        />
        {exportError && (
          <div
            role="status"
            className="absolute right-4 top-20 z-40 flex items-center gap-2 border border-destructive bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
          >
            <AlertTriangle className="size-3.5 shrink-0" />
            {exportError}
          </div>
        )}
        <MissingRulesPanel
          open={missingPanel}
          onOpenChange={setMissingPanel}
          columns={sheet.columns}
          setColumns={setColumns}
        />
        <FormatPanel
          open={formatPanel}
          onOpenChange={setFormatPanel}
          nums={nums}
          columns={sheet.columns}
          setColumns={setColumns}
        />
        <div className="flex min-h-0 flex-1">
          <div ref={contentRef} className="min-w-0 flex-1 overflow-auto bg-canvas p-4 md:p-6">
            <div className="oliam-export-watermark" aria-hidden="true" />
            <div className="oliam-export-header" aria-hidden="true">
              <div>
                <Mark />
                <div className="oliam-export-brand-copy">
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
                    Oli.Qualidade
                  </p>
                  <h1 className="mt-1 font-display text-2xl font-bold">{d.name}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Aba {sheet.name} · {data.length} de {sheet.rows.length} linhas
                  </p>
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>Relatório gerado em</p>
                <p className="mt-1 font-mono text-foreground">
                  {new Date().toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
            <VersionDiffBanner diff={detailedVersionDiff} />
            {sourceNotesPanel}
            {sourceVisualsPanel}
            {gridContent}
            <footer className="oliam-export-footer" aria-hidden="true">
              <div className="oliam-export-signature">
                <Mark />
                <div>
                  <p className="font-display text-sm font-bold text-foreground">
                    Assinatura de origem OliQualidade
                  </p>
                  <p className="mt-0.5 text-[10px]">
                    Relatório gerado pela plataforma a partir da aba {sheet.name}.
                  </p>
                </div>
              </div>
              <div className="oliam-export-license text-right">
                <p className="font-semibold text-foreground">Uso licenciado</p>
                <p className="font-mono">Painel {d.id.slice(0, 8).toUpperCase()}</p>
              </div>
            </footer>
          </div>
          <InsightSidebar
            open={insightOpen}
            data={data}
            rowCount={sheet.rows.length}
            autoDashboard={sheet.autoDashboard}
            nums={nums}
            versionDelta={versionDelta}
            sidebarRanking={sidebarRanking}
            sidebarRankingMax={sidebarRankingMax}
            cat={cat}
            primary={primary}
            dateCol={dateCol}
            filters={sheet.filters}
            setFilters={setFilters}
          />
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
          {presentationBar}
          <div className="flex-1 overflow-auto p-4 md:p-6">
            {sourceNotesPanel}
            {sourceVisualsPanel}
            {gridContent}
          </div>
        </div>
      )}
      <CommandPalette
        open={command}
        onOpenChange={setCommand}
        undo={undo}
        redo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        pasteCopiedWidget={pasteCopiedWidget}
        hasWidgetClipboard={Boolean(widgetClipboard)}
        reimport={p.reimport}
        folderMonitor={p.folderMonitor}
        connectFolder={p.connectFolder}
        disconnectFolder={p.disconnectFolder}
        exportXlsx={exportXlsx}
        exportCorrectedWorkbook={exportCorrectedWorkbook}
        exportAuditCsv={exportAuditCsv}
        exportComparisonCsv={exportComparisonCsv}
        exportReviewPdf={exportReviewPdf}
        exportPng={exportPng}
        exportPdf={exportPdf}
        exportEncryptedBackup={exportEncryptedBackup}
        onRestoreBackup={() => backupInput.current?.click()}
        onOpenFormatPanel={() => setFormatPanel(true)}
        onOpenShortcuts={() => setShortcuts(true)}
        onOpenImportDiagnostics={() => setImportDiagnostics(true)}
        onOpenColumnsPanel={() => setPanel(true)}
        startPresentation={startPresentation}
        openJoin={openJoin}
        theme={p.theme}
        toggleTheme={p.toggleTheme}
        backHome={p.backHome}
      />
      {joinDialog}
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
      <ImportDiagnosticsDialog open={importDiagnostics} onOpenChange={setImportDiagnostics} />
      <GeminiChatPanel dashboard={d} sheet={sheet} liveRows={data} liveView={assistantContext} />
    </div>
  );
}
