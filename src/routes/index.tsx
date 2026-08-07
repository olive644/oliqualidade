import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import html2canvas from "html2canvas-pro";
import { jsPDF } from "jspdf";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
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
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Columns3,
  Copy,
  Download,
  FileImage,
  FileText,
  Filter,
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
  Settings2,
  Sheet as SheetIcon,
  ShieldAlert,
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
  Bookmark,
  Column,
  ConditionalFormatRule,
  Dashboard,
  FilterRule,
  Kind,
  Row,
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
  groupableKinds,
  pickBestGroupColumn,
  spanClass,
  sizeClass,
} from "@/lib/widgets";
import {
  conditionalStyle,
  evalFormula,
  fmt,
  hue,
  infer,
  inferColumns,
  palette,
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
  toggleClickFilter,
  type AggregationOp,
  type QualitySignal,
} from "@/lib/data-pipeline";
import {
  loadDashboards,
  loadGeocodeCache,
  ONBOARDING_KEY,
  saveDashboards,
  saveGeocodeCache,
  TERM_HINTS_KEY,
  THEME_KEY,
  type GeocodeCache,
  type GeoPoint,
  type SaveResult,
} from "@/lib/storage";
import { LARGE_FILE_BYTES, sheetToRows } from "@/lib/import";
import { geocodeMissing } from "@/lib/geocode";
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
  return (
    <span className="oliam-mark" aria-hidden="true">
      <i />
      <b />
    </span>
  );
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
    <Button
      variant="ghost"
      size="icon"
      aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
      onClick={toggle}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
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
          "BI organizado para transformar CSV, XLSX e Google Sheets em relatórios configuráveis, com múltiplos painéis, modo escuro e gráficos interativos.",
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
  const [rows, setRows] = useState<Row[]>([]),
    [columns, setColumns] = useState<Column[]>([]),
    [name, setName] = useState("");
  const [url, setUrl] = useState(""),
    [paste, setPaste] = useState(""),
    [editor, setEditor] = useState(false),
    [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "warning">("idle");
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [importProgressLabel, setImportProgressLabel] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const list = await loadDashboards();
      if (!active) return;
      setDashboards(list);
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
  const prepare = (data: Row[], n: string) => {
    if (data.length) {
      setRows(data);
      setColumns(infer(data));
      setName(n);
      setStage("review");
    }
  };
  const parse = async (file: File) => {
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
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0] ?? ""];
      if (!ws) {
        setImportError("Não encontramos nenhuma aba com dados nesse arquivo.");
        return;
      }
      const { rows, warning } = sheetToRows(ws);
      if (!rows.length) {
        setImportError("Essa planilha está vazia.");
        return;
      }
      setImportWarning(warning);
      prepare(rows, file.name);
    } catch {
      setImportError("Não foi possível ler esse arquivo. Verifique se é um CSV ou XLSX válido.");
    } finally {
      setLoading(false);
      setImportProgressLabel(null);
    }
  };
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
    prepare(rows, "Dados colados");
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
      prepare(rows, "Google Sheets");
    } catch {
      setImportError("A planilha precisa estar publicada para leitura.");
    } finally {
      setLoading(false);
    }
  };

  const confirmReview = () => {
    if (reviewTarget === "new") {
      const dash: Dashboard = {
        id: crypto.randomUUID(),
        name: name.replace(/\.(csv|xlsx|xls)$/i, "") || "Painel sem nome",
        rows,
        columns,
        filters: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
      };
      persist([dash, ...dashboards]);
      setCurrentId(dash.id);
      void navigate({ to: "/painel/$id", params: { id: dash.id } });
    } else {
      persist(
        dashboards.map((d) =>
          d.id === reviewTarget
            ? {
                ...d,
                rows,
                columns,
                filters: [],
                updatedAt: Date.now(),
                // guarda a versão anterior para calcular o delta real de cada métrica
                previousSnapshot: { rows: d.rows, capturedAt: Date.now() },
              }
            : d,
        ),
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
    setReviewTarget("new");
    setStage("empty");
  };
  const startReimport = (id: string) => {
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
          accept=".csv,.xlsx,.xls"
          onChange={(e) => {
            const f = e.target.files?.[0];
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
            onUpload={() => input.current?.click()}
            onDropFile={(f) => void parse(f)}
            onDemo={() => {
              setReviewTarget("new");
              prepare(demo, "vendas_2026.xlsx");
            }}
            url={url}
            setUrl={setUrl}
            sheet={() => void sheet()}
            loading={loading}
            loadingLabel={importProgressLabel}
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
          />
        )}
        {stage === "review" && (
          <Review
            rows={rows}
            columns={columns}
            setColumns={setColumns}
            name={name}
            back={() => setStage(reviewTarget === "new" ? "empty" : "dashboard")}
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
            theme={theme}
            toggleTheme={toggle}
          />
        )}
        {onboardingStep !== null && (
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
    text: "Envie um arquivo CSV ou XLSX, cole uma URL de Google Sheets ou cole os dados diretamente. Tudo fica salvo neste navegador.",
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
      className="fixed bottom-5 left-5 z-50 w-80 overflow-hidden rounded-2xl border border-border bg-card shadow-panel"
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
  const totalRows = p.dashboards.reduce((sum, d) => sum + d.rows.length, 0);
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
              <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
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
                        {d.rows.length} linhas
                      </span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5">
                        {d.columns.length} colunas
                      </span>
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

function Empty(p: {
  onUpload: () => void;
  onDropFile: (file: File) => void;
  onDemo: () => void;
  url: string;
  setUrl: (v: string) => void;
  sheet: () => void;
  loading: boolean;
  loadingLabel: string | null;
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
      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-12">
        <div className="mb-10">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs uppercase tracking-wide text-primary shadow-sm">
            <span className="size-1.5 rounded-full bg-primary" />
            Novo painel
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Solte a planilha,
            <br />
            receba o relatório.
          </h1>
          <p className="mt-5 max-w-xl text-muted-foreground">
            Envie um CSV ou XLSX. O Oli.Qualidade reconhece as colunas, confirma os tipos com você e
            monta um painel pronto para ajustar.
          </p>
        </div>
        <button
          type="button"
          className="oliam-dropzone"
          data-dragging={dragging}
          onClick={p.onUpload}
          disabled={p.loading}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Upload className="size-6" />
          </span>
          <strong className="font-display text-base">
            {p.loading
              ? (p.loadingLabel ?? "Lendo…")
              : dragging
                ? "Solte o arquivo aqui"
                : "Arraste um CSV ou XLSX aqui"}
          </strong>
          {!p.loading && (
            <span className="text-sm text-muted-foreground">
              ou clique para selecionar o arquivo
            </span>
          )}
        </button>
        {p.importError && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" />
            {p.importError}
          </p>
        )}
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Check className="size-3.5 shrink-0 text-secondary-accent" />
          Seus dados são processados no navegador e não são enviados a nenhum servidor.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span>Outras formas de importar:</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(!sheetOpen)}
          >
            Google Sheets
            <ChevronDown className={cn("size-3 transition-transform", sheetOpen && "rotate-180")} />
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            aria-expanded={p.editor}
            onClick={() => p.setEditor(!p.editor)}
          >
            Colar dados
            <ChevronDown className={cn("size-3 transition-transform", p.editor && "rotate-180")} />
          </button>
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={p.onDemo}
          >
            Explorar com dados de exemplo
          </button>
        </div>
        {sheetOpen && (
          <div className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <label className="mb-2 block text-xs font-medium">Google Sheets público</label>
            <div className="flex gap-2">
              <input
                className="oliam-input min-w-0 flex-1"
                placeholder="Cole o link da planilha"
                value={p.url}
                onChange={(e) => p.setUrl(e.target.value)}
              />
              <Button variant="outline" disabled={!p.url || p.loading} onClick={p.sheet}>
                {p.loading ? "Lendo…" : "Conectar"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              A planilha precisa estar publicada para leitura (Arquivo → Compartilhar → Publicar na
              Web).
            </p>
          </div>
        )}
        {p.editor && (
          <div className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <label className="mb-2 block text-xs font-medium">Colar dados</label>
            <textarea
              className="oliam-input min-h-28 w-full font-mono text-xs"
              placeholder="Cole dados separados por tabulação ou vírgula, copiados direto do Excel…"
              value={p.paste}
              onChange={(e) => p.setPaste(e.target.value)}
            />
            <div className="mt-2 text-right">
              <Button disabled={!p.paste} onClick={p.pasteData}>
                Revisar dados
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Review(p: {
  rows: Row[];
  columns: Column[];
  setColumns: (c: Column[]) => void;
  name: string;
  back: () => void;
  confirm: () => void;
  importWarning: string | null;
}) {
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
        <div className="mb-8 flex flex-wrap justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs text-primary shadow-sm">
              <span className="size-1.5 rounded-full bg-primary" />
              ETAPA 1 DE 2 · OBRIGATÓRIA
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">
              Confirme como cada coluna deve ser lida
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              IDs e códigos numéricos devem ser definidos como texto para nunca entrarem em totais.
            </p>
          </div>
          <p className="whitespace-nowrap rounded-2xl border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground shadow-sm">
            {p.name}
            <br />
            {p.rows.length} linhas · {p.columns.length} colunas
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="grid grid-cols-[32px_1.3fr_1fr_1fr] border-b border-border bg-muted/60 px-3 py-2.5 font-mono text-[11px] tracking-wide text-muted-foreground">
            <span />
            <span>COLUNA</span>
            <span>TIPO E FORMATO</span>
            <span>AMOSTRA</span>
          </div>
          {p.columns.map((c, i) => (
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
                      p.columns.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                />
                <select
                  className="oliam-select"
                  value={c.kind}
                  onChange={(e) =>
                    p.setColumns(
                      p.columns.map((x, j) =>
                        j === i ? { ...x, kind: e.target.value as Kind } : x,
                      ),
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
                  {fmt(p.rows[0]?.[c.key] ?? null, c.kind) ?? "–"}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-[32px_1fr] items-center">
                <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <input
                  className="oliam-plain-input text-xs text-muted-foreground"
                  placeholder="Descrição opcional, exibida ao passar o mouse no cabeçalho da tabela"
                  value={c.description}
                  onChange={(e) =>
                    p.setColumns(
                      p.columns.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x,
                      ),
                    )
                  }
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 text-right">
          <Button className="px-6 shadow-sm" onClick={p.confirm}>
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
  theme: string;
  toggleTheme: () => void;
}) {
  const { dashboard: d } = p;
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null),
    [sidebar, setSidebar] = useState(true),
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
  const [bookmarkPanel, setBookmarkPanel] = useState(false);
  const [bookmarkName, setBookmarkName] = useState("");
  const [presentation, setPresentation] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);
  const [intervalSeconds, setIntervalSeconds] = useState(10);
  const [insightOpen, setInsightOpen] = useState(true);
  const [showTermHint, setShowTermHint] = useState(false);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const usesGrouping = (d.widgets ?? []).some((w) =>
      ["bar", "pie", "line", "ranking", "map"].includes(w.type),
    );
    if (usesGrouping && !localStorage.getItem(TERM_HINTS_KEY)) setShowTermHint(true);
  }, [d.widgets]);
  const dismissTermHint = () => {
    localStorage.setItem(TERM_HINTS_KEY, "1");
    setShowTermHint(false);
  };
  const joinInput = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const nums = d.columns.filter((c) => numericKinds.includes(c.kind)),
    catCandidates = d.columns.filter((c) => c.kind === "category" || c.kind === "text"),
    // Evita escolher como padrão uma coluna categórica quase vazia (ex.: uma
    // coluna residual ou mal importada da planilha), o que fazia o ranking
    // da sidebar e outros widgets caírem inteiros em "Não informado".
    cat = pickBestGroupColumn(catCandidates, d.rows),
    dateCol = d.columns.find((c) => c.kind === "date");
  useEffect(() => setDraftName(d.name), [d.id, d.name]);
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
    undo: Array<Pick<Dashboard, "filters" | "columns" | "widgets">>;
    redo: Array<Pick<Dashboard, "filters" | "columns" | "widgets">>;
  }>({ undo: [], redo: [] });
  const [, forceHistoryUpdate] = useState(0);
  useEffect(() => {
    historyRef.current = { undo: [], redo: [] };
    forceHistoryUpdate((t) => t + 1);
  }, [d.id]);
  const dashboardSnapshot = (): Pick<Dashboard, "filters" | "columns" | "widgets"> => ({
    filters: d.filters,
    columns: d.columns,
    widgets: d.widgets ?? buildDefaultWidgets(d.columns, d.chartConfig, d.rows),
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
    p.update(prev);
    forceHistoryUpdate((t) => t + 1);
  };
  const redo = () => {
    const next = historyRef.current.redo.pop();
    if (!next) return;
    historyRef.current.undo.push(dashboardSnapshot());
    p.update(next);
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
    p.update({ filters });
  };
  const setColumns = (columns: Column[]) => {
    recordHistory();
    p.update({ columns });
  };

  // Colunas calculadas recalculam ao vivo antes de qualquer filtro.
  const withCalculated = useMemo(
    () => withCalculatedColumns(d.rows, d.columns),
    [d.rows, d.columns],
  );
  // Regras de dados ausentes (ignorar/zero/interpolar/ocultar linha) rodam em seguida.
  const { rows: rulesApplied, interpolated } = useMemo(
    () => applyMissingRules(withCalculated, d.columns),
    [withCalculated, d.columns],
  );
  const data = useMemo(() => {
    let r = rulesApplied.filter(
      (row) =>
        (!search ||
          d.columns.some((c) =>
            String(row[c.key] ?? "")
              .toLowerCase()
              .includes(search.toLowerCase()),
          )) &&
        d.filters.every((f) => {
          const col = d.columns.find((c) => c.key === f.key);
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
  }, [rulesApplied, d.columns, d.filters, search, sort]);
  const qualitySignals = useMemo(() => detectQualitySignals(data, d.columns), [data, d.columns]);
  const visibleSignals = qualitySignals.filter(
    (s) => !dismissedSignals.has(`${s.kind}-${s.columnKey}`),
  );
  // Delta real vs. a versão anterior dos dados (comparação de reimportação),
  // calculado sobre o total do painel inteiro, sem os filtros da visão atual.
  const versionDelta = useMemo(() => {
    if (!d.previousSnapshot) return null;
    const prevCalculated = withCalculatedColumns(d.previousSnapshot.rows, d.columns);
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
  }, [d.previousSnapshot, d.columns, withCalculated, nums]);
  const primary = nums[0];
  // Colunas candidatas a agrupamento: categoria, texto ou data.
  const groupableCols = d.columns.filter((c) => groupableKinds.includes(c.kind));
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
  const widgets = d.widgets ?? buildDefaultWidgets(d.columns, d.chartConfig, d.rows);
  const setWidgets = (next: Widget[]) => {
    recordHistory();
    p.update({ widgets: next });
  };
  const addWidget = (type: WidgetType) =>
    setWidgets([...widgets, createWidget(type, d.columns, undefined, d.rows)]);
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
    bar: nums.length > 0 && groupableCols.length > 0,
    pie: nums.length > 0 && groupableCols.length > 0,
    line: nums.length > 0 && !!dateCol,
    area: nums.length > 0 && groupableCols.length > 0,
    ranking: nums.length > 0 && groupableCols.length > 0,
    rating: nums.length > 0,
    map: nums.length > 0 && groupableCols.length > 0,
    table: true,
  };

  const slug = d.name.toLowerCase().replaceAll(" ", "-");
  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(data),
      wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório");
    XLSX.writeFile(wb, `${slug}.xlsx`);
  };
  const captureContent = async () => {
    const el = contentRef.current;
    if (!el) return null;
    // O container tem overflow-auto para permitir rolar o painel na tela.
    // Capturando ele desse jeito, o html2canvas corta a imagem no tamanho
    // visível (a "janela" da rolagem), perdendo tudo que só aparece rolando
    // para baixo. Para exportar o painel inteiro, relaxamos overflow/altura
    // só durante a captura e devolvemos ao normal logo em seguida.
    const prevOverflow = el.style.overflow;
    const prevHeight = el.style.height;
    el.style.overflow = "visible";
    el.style.height = "auto";
    try {
      return await html2canvas(el, {
        backgroundColor: null,
        scale: 2,
        height: el.scrollHeight,
        windowHeight: el.scrollHeight,
      });
    } finally {
      el.style.overflow = prevOverflow;
      el.style.height = prevHeight;
    }
  };
  const exportPng = async () => {
    setExporting("png");
    setExportError(null);
    try {
      const canvas = await captureContent();
      if (!canvas) return;
      const link = document.createElement("a");
      link.download = `${slug}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
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
      const canvas = await captureContent();
      if (!canvas) return;
      const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth(),
        pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth,
        imgHeight = (canvas.height * imgWidth) / canvas.width;
      const imgData = canvas.toDataURL("image/png");
      let heightLeft = imgHeight,
        position = 0;
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`${slug}.pdf`);
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

  const parseJoinFile = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0] ?? ""];
      const rows = ws ? XLSX.utils.sheet_to_json<Row>(ws, { defval: null }) : [];
      if (!rows.length) {
        setJoinError("Essa planilha está vazia ou não foi possível lê-la.");
        return;
      }
      setJoinRows(rows);
      setJoinFileName(file.name);
      setJoinOtherKey(Object.keys(rows[0] ?? {})[0] ?? "");
      setJoinBaseKey(d.columns[0]?.key ?? "");
      setJoinError(null);
    } catch {
      setJoinError("Não foi possível ler esse arquivo.");
    }
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
    const existingKeys = d.columns.map((c) => c.key);
    const { rows: joinedRows, addedKeys } = leftJoin(
      d.rows,
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
    p.update({ rows: joinedRows, columns: [...d.columns, ...newColumns] });
    setJoinOpen(false);
    resetJoin();
  };

  // Marcadores: um estado nomeado de filtros, busca e ordenação, salvo dentro
  // do próprio painel para poder voltar a ele com um clique (ou alternar
  // entre eles automaticamente no modo apresentação).
  const bookmarks = d.bookmarks ?? [];
  const saveBookmark = () => {
    const trimmed = bookmarkName.trim();
    if (!trimmed) return;
    const bookmark: Bookmark = {
      id: `bm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed,
      filters: d.filters,
      search,
      sort,
      createdAt: Date.now(),
    };
    p.update({ bookmarks: [...bookmarks, bookmark] });
    setBookmarkName("");
  };
  const removeBookmark = (id: string) =>
    p.update({ bookmarks: bookmarks.filter((b) => b.id !== id) });
  const applyBookmark = (b: Bookmark) => {
    p.update({ filters: b.filters });
    setSearch(b.search);
    setSort(b.sort);
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
        onClick={() => setWidgets(buildDefaultWidgets(d.columns, d.chartConfig, d.rows))}
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
            columns={d.columns}
            numericCols={nums}
            groupableCols={groupableCols}
            interpolated={interpolated}
            sort={sort}
            setSort={setSort}
            versionDelta={versionDelta}
            animationDelay={Math.min(i, 8) * 40}
            filters={d.filters}
            setFilters={setFilters}
            onConfigure={(patch) => updateWidget(w.id, patch)}
            onRemove={() => removeWidget(w.id)}
            onMoveBack={() => moveWidget(w.id, -1)}
            onMoveForward={() => moveWidget(w.id, 1)}
            onDropWidget={(fromId) => reorderWidget(fromId, w.id)}
          />
        ))}
      </div>
    );

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={cn("oliam-sidebar", !sidebar && "w-0 -translate-x-full border-0")}>
        <div className="flex h-16 items-center gap-3 border-b border-border px-4">
          <Mark />
          <strong className="font-display text-lg tracking-tight">Oli.Qualidade</strong>
        </div>
        <div className="flex-1 overflow-auto p-3">
          <button className="oliam-nav-item text-muted-foreground" onClick={p.backHome}>
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
                onClick={() => p.openDash(x.id)}
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
          <button className="oliam-nav-item text-muted-foreground" onClick={p.newDash}>
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
            {d.rows.length} linhas · local
          </p>
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="oliam-dashboard-topbar">
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
                {data.length} de {d.rows.length} linhas
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
                  <FileImage />
                  {exporting === "png" ? "Gerando PNG…" : "Imagem PNG"}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={exporting !== null} onSelect={() => void exportPdf()}>
                  <FileText />
                  {exporting === "pdf" ? "Gerando PDF…" : "PDF do painel (várias páginas)"}
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
                {d.columns
                  .filter((c) => !d.filters.some((f) => f.key === c.key))
                  .map((c) => (
                    <button
                      key={c.key}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        setFilters([...d.filters, { key: c.key, value: "", min: "", max: "" }]);
                        setFilterMenu(false);
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                {d.columns.every((c) => d.filters.some((f) => f.key === c.key)) && (
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
            <DropdownMenuContent align="start">
              {(Object.keys(widgetTypeLabels) as WidgetType[]).map((type) => (
                <DropdownMenuItem
                  key={type}
                  disabled={!canAdd[type]}
                  onSelect={() => addWidget(type)}
                >
                  {widgetTypeLabels[type]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
              <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
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
          <Button
            variant="outline"
            onClick={() => {
              setPresentIndex(0);
              setPresentation(true);
            }}
          >
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
        {d.filters.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b px-5 py-2">
            {d.filters.map((f, i) => {
              const col = d.columns.find((c) => c.key === f.key);
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
                            d.filters.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)),
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
                            d.filters.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)),
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
                          d.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                        )
                      }
                    />
                  )}
                  <button
                    className="rounded-r-full p-1.5 pr-2.5 text-muted-foreground transition-colors hover:text-destructive"
                    aria-label="Remover filtro"
                    onClick={() => setFilters(d.filters.filter((_, j) => j !== i))}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {qualityPanel && (
          <div className="absolute right-4 top-28 z-40 w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
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
          <div className="absolute right-4 top-28 z-40 w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
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
              {d.columns.map((c, i) => (
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
                    const next = [...d.columns];
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
                          d.columns.map((x, j) => (j === i ? { ...x, visible: !x.visible } : x)),
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
                        const next = [...d.columns];
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
                      disabled={i === d.columns.length - 1}
                      onClick={() => {
                        if (i === d.columns.length - 1) return;
                        const next = [...d.columns];
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
                        const availableKeys = d.columns.map((c) => c.key);
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
                          ...d.columns,
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
          <div className="absolute right-4 top-28 z-40 w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
            <div className="flex items-center justify-between border-b p-3">
              <strong className="text-sm">Regras de dados ausentes</strong>
              <Button variant="ghost" size="icon" onClick={() => setMissingPanel(false)}>
                <X />
              </Button>
            </div>
            <div className="max-h-96 overflow-auto p-2">
              {d.columns
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
                            d.columns.map((x) =>
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
          <div className="absolute right-4 top-28 z-40 w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
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
                      d.columns.map((x) =>
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
            {gridContent}
          </div>
          {insightOpen && (
            <aside className="oliam-insight-sidebar hidden shrink-0 overflow-auto lg:block">
              <div className="border-b border-border p-4">
                <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                  Visão geral
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {data.length} de {d.rows.length} linhas na visão atual
                </p>
              </div>
              {nums.length > 0 && (
                <div className="border-b border-border p-4">
                  <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    KPIs
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {nums.slice(0, 4).map((c) => {
                      const total = data.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
                      const delta = versionDelta?.get(c.key) ?? null;
                      return (
                        <div
                          key={c.key}
                          className="rounded-xl border border-border bg-card p-2.5 shadow-sm"
                        >
                          <p className="truncate text-[11px] text-muted-foreground">{c.label}</p>
                          <p className="font-mono text-base font-semibold">{fmt(total, c.kind)}</p>
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
                      const active = d.filters.some((f) => f.key === cat.key && f.value === r.name);
                      return (
                        <button
                          key={r.name}
                          className={cn(
                            "oliam-ranking-row block w-full text-left transition-opacity hover:opacity-90",
                            active && "opacity-100",
                          )}
                          onClick={() => {
                            if (active) {
                              setFilters(d.filters.filter((f) => f.key !== cat.key));
                            } else {
                              setFilters([
                                ...d.filters.filter((f) => f.key !== cat.key),
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
                                background: active ? "var(--primary)" : "var(--secondary-accent)",
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
                    const existing = d.filters.find((f) => f.key === dateCol.key);
                    return (
                      <div className="flex flex-col gap-2">
                        <input
                          className="oliam-input h-9"
                          type="text"
                          placeholder="De, dd/mm/aaaa"
                          value={existing?.min ?? ""}
                          onChange={(e) => {
                            const min = e.target.value;
                            const rest = d.filters.filter((f) => f.key !== dateCol.key);
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
                            const rest = d.filters.filter((f) => f.key !== dateCol.key);
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
            <CommandItem onSelect={p.reimport}>
              <Upload />
              Importar nova versão
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
            <CommandItem
              onSelect={() => {
                setPresentIndex(0);
                setPresentation(true);
              }}
            >
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
              <span className="text-sm text-muted-foreground">CSV ou XLSX</span>
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
                  {d.columns.map((c) => (
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
            accept=".csv,.xlsx,.xls"
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
  onMoveBack?: () => void;
  onMoveForward?: () => void;
  disableBack?: boolean;
  disableForward?: boolean;
}) {
  const interactive = !!(onRemove || onMoveBack || onMoveForward);
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
        <div className="flex shrink-0 items-center gap-0.5">
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
      y={(y ?? 0) + 10}
      textAnchor="middle"
      fontSize={10}
      fontStyle={missing ? "italic" : "normal"}
      fill={missing ? "var(--muted-foreground)" : "var(--foreground)"}
    >
      <title>{value}</title>
      {truncateLabel(value)}
    </text>
  );
}

/**
 * Legenda customizada da pizza. O Recharts não desenha rótulo nenhum nas
 * fatias por padrão neste widget (o espaço é compacto demais), então esta
 * legenda é a única referência textual visível das categorias; por isso
 * também é aqui que "Não informado" precisa do mesmo destaque do eixo.
 */
function PieLegend({
  payload,
}: {
  payload?: { value?: string; color?: string; payload?: { total?: number } }[];
}) {
  if (!payload?.length) return null;
  const sum = payload.reduce((s, entry) => s + (entry.payload?.total ?? 0), 0);
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 px-3 pb-3 text-[11px]">
      {payload.map((entry, i) => {
        const missing = entry.value === NOT_INFORMED;
        const total = entry.payload?.total ?? 0;
        const pct = sum > 0 ? (total / sum) * 100 : 0;
        return (
          <li key={entry.value ?? i} className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: entry.color }} />
            <span className={cn(missing && "italic text-muted-foreground")} title={entry.value}>
              {truncateLabel(entry.value ?? "", 18)}
            </span>
            <span className="font-mono text-muted-foreground">
              {new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(total)} (
              {pct.toFixed(1)}%)
            </span>
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
function MapWidgetBody({
  grouped,
  valueKind,
  onSelect,
}: {
  grouped: { name: string; total: number }[];
  valueKind: Kind;
  onSelect: (name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [cache, setCache] = useState<GeocodeCache>({});
  const [ready, setReady] = useState(false);
  const namesKey = grouped.map((g) => g.name).join("|");

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
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let alive = true;
    void (async () => {
      const mod = await import("leaflet");
      const L = (mod.default ?? mod) as typeof import("leaflet");
      if (!alive || !containerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current).setView([-14, -51], 3);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors",
          maxZoom: 18,
        }).addTo(mapRef.current);
      }
      const map = mapRef.current;
      layerRef.current?.remove();
      const layer = L.layerGroup();
      const resolved = grouped
        .map((g) => ({ ...g, point: cache[g.name] }))
        .filter((g): g is typeof g & { point: GeoPoint } => !!g.point);
      const max = resolved.reduce((m, g) => Math.max(m, Math.abs(g.total)), 0) || 1;
      const sum = resolved.reduce((s, g) => s + g.total, 0);
      resolved.forEach((g) => {
        const radius = 7 + (Math.abs(g.total) / max) * 20;
        const pct = sum > 0 ? (g.total / sum) * 100 : 0;
        const marker = L.circleMarker([g.point.lat, g.point.lng], {
          radius,
          color: "var(--primary)",
          fillColor: "var(--primary)",
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
          document.createTextNode(`${fmt(g.total, valueKind) ?? "–"} (${pct.toFixed(1)}%)`),
        );
        marker.bindPopup(popup);
        marker.on("click", () => onSelect(g.name));
        marker.addTo(layer);
      });
      layer.addTo(map);
      layerRef.current = layer;
      setTimeout(() => map.invalidateSize(), 50);
      if (resolved.length) {
        const bounds = L.latLngBounds(resolved.map((g) => [g.point.lat, g.point.lng]));
        map.fitBounds(bounds.pad(0.3), { maxZoom: 6 });
      }
    })();
    return () => {
      alive = false;
    };
  }, [grouped, cache, onSelect, valueKind]);

  const resolvedCount = grouped.filter((g) => cache[g.name]).length;
  const notFoundCount = grouped.filter((g) => g.name in cache && cache[g.name] === null).length;
  const pending = grouped.length - resolvedCount - notFoundCount;

  return (
    <>
      <div ref={containerRef} className="h-64 w-full" />
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        Localização aproximada a partir do nome do local, via OpenStreetMap Nominatim. O tamanho de
        cada ponto indica o valor agregado.
        {pending > 0 && ` Localizando ${pending} de ${grouped.length}…`}
        {notFoundCount > 0 &&
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
  onSelect,
}: ChartDotProps & {
  r: number;
  groupCol: Column | undefined;
  onSelect: (groupKey: string, value: string) => void;
}) {
  if (cx === undefined || cy === undefined) return null;
  const clickable = !!(groupCol && payload?.name);
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill="var(--primary)"
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
  animationDelay,
  filters,
  setFilters,
  onConfigure,
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
  animationDelay: number;
  filters: FilterRule[];
  setFilters: (filters: FilterRule[]) => void;
  onConfigure: (patch: Partial<Widget>) => void;
  onRemove: () => void;
  onMoveBack: () => void;
  onMoveForward: () => void;
  onDropWidget: (fromId: string) => void;
}) {
  // Cross-filter padronizado: clicar em um valor filtra por aquela coluna
  // sem descartar filtros de outras colunas (ex: clicar num mapa e numa
  // linha do tempo ao mesmo tempo); clicar de novo no mesmo valor remove o
  // filtro. Usado por barra, pizza, linha, área, ranking e mapa.
  const handleGroupClick = (groupKey: string, value: string) => {
    setFilters(toggleClickFilter(filters, groupKey, value));
  };
  // Indicador "filtrado por X" exibido no cabeçalho de controles do widget
  // quando a coluna de agrupamento dele tem um filtro simples ativo,
  // sincronizado com a barra de filtros do topo (mesmo estado, d.filters).
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
    onMoveBack,
    onMoveForward,
    disableBack: index === 0,
    disableForward: index === count - 1,
  };
  const sizeControls = (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2">
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

  if (w.type === "metric" || w.type === "metric-trend") {
    const col = columns.find((c) => c.key === w.metricKey) ?? numericCols[0];
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
    const metricOp: AggregationOp = w.op ?? "sum";
    const total = aggregate(
      data.map((r) => Number(r[col.key])).filter((v) => Number.isFinite(v)),
      metricOp,
    );
    const style = conditionalStyle(total, col.kind, col.conditionalFormat);
    const trendDateCol =
      w.type === "metric-trend"
        ? (columns.find((c) => c.key === w.groupKey && c.kind === "date") ??
          columns.find((c) => c.kind === "date"))
        : undefined;
    const sparkline =
      w.type === "metric-trend" && trendDateCol
        ? [...groupAndAggregate(data, trendDateCol.key, col.key, metricOp)].sort((a, b) =>
            a.name.localeCompare(b.name, "pt-BR"),
          )
        : [];
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
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2">
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
              {Object.entries(aggregationLabels).map(([o, label]) => (
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
            className="font-display text-4xl font-semibold tracking-tight"
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
            <div className="mt-4 h-14">
              {sparkline.length >= 2 ? (
                <ResponsiveContainer>
                  <AreaChart data={sparkline} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                    <defs>
                      <linearGradient id={`spark-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--secondary-accent)" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="var(--secondary-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke="var(--secondary-accent)"
                      strokeWidth={2}
                      fill={`url(#spark-${w.id})`}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
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

  if (w.type === "bar" || w.type === "pie" || w.type === "line" || w.type === "area") {
    const groupCol =
      w.type === "line"
        ? columns.find((c) => c.key === w.groupKey && c.kind === "date")
        : columns.find((c) => c.key === w.groupKey);
    const valueCol = columns.find((c) => c.key === w.valueKey) ?? numericCols[0];
    const op: AggregationOp = w.op ?? "sum";
    const title =
      w.type === "line"
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
        ? [...grouped].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        : grouped;
    const pieSeries = (() => {
      if (w.type !== "pie") return series;
      if (series.length <= 6) return series;
      const sorted = [...series].sort((a, b) => b.total - a.total);
      const top = sorted.slice(0, 5),
        rest = sorted.slice(5).reduce((s, x) => s + x.total, 0);
      return rest ? [...top, { name: "Outros", total: rest }] : top;
    })();
    const insufficient = w.type === "line" ? series.length < 2 : series.length < 1;

    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <WidgetHead title={title} icon={icon} {...dragProps} />
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2">
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
            accepts={numericKinds}
            onDropColumn={(key) => onConfigure({ valueKey: key })}
          >
            <select
              aria-label="Coluna numérica"
              className="oliam-select"
              value={valueCol?.key ?? ""}
              onChange={(e) => onConfigure({ valueKey: e.target.value })}
            >
              {!valueCol && <option value="">Selecione…</option>}
              {numericCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldDropSlot>
          {w.type !== "line" && (
            <select
              aria-label="Agregação"
              className="oliam-select"
              value={op}
              onChange={(e) => onConfigure({ op: e.target.value as AggregationOp })}
            >
              {Object.entries(aggregationLabels).map(([o, label]) => (
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
            <div className="h-56 p-4">
              <ResponsiveContainer>
                <BarChart data={series} margin={{ top: 20, right: 12, left: 4, bottom: 22 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="name"
                    tick={(props) => <AxisTick {...props} />}
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
                      boxShadow:
                        "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
                    }}
                  />
                  <Bar
                    dataKey="total"
                    fill="var(--primary)"
                    radius={[6, 6, 0, 0]}
                    onClick={(pt) => pt?.name && handleGroupClick(groupCol.key, String(pt.name))}
                    cursor="pointer"
                  >
                    <LabelList
                      dataKey="total"
                      position="top"
                      fontSize={10}
                      fill="var(--muted-foreground)"
                      formatter={(v: number) =>
                        new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v)
                      }
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="sr-only">
              Tabela alternativa ao gráfico de barras:{" "}
              {series.map((g) => `${g.name}, ${g.total}`).join("; ")}.
            </p>
          </>
        ) : w.type === "pie" ? (
          <>
            <div className="h-64 p-4">
              <ResponsiveContainer>
                <RPieChart>
                  <ChartTooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                      boxShadow:
                        "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
                    }}
                  />
                  <Pie
                    data={pieSeries}
                    dataKey="total"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={78}
                    paddingAngle={1}
                    onClick={(pt) => pt?.name && handleGroupClick(groupCol.key, String(pt.name))}
                    cursor="pointer"
                  >
                    {pieSeries.map((entry, i) => (
                      <Cell key={entry.name} fill={palette[i % palette.length]} />
                    ))}
                  </Pie>
                  <Legend
                    content={(props) => (
                      <PieLegend
                        payload={
                          props.payload as {
                            value?: string;
                            color?: string;
                            payload?: { total?: number };
                          }[]
                        }
                      />
                    )}
                  />
                </RPieChart>
              </ResponsiveContainer>
            </div>
            <p className="sr-only">
              Tabela alternativa à pizza: {pieSeries.map((g) => `${g.name}, ${g.total}`).join("; ")}
              .
            </p>
          </>
        ) : w.type === "area" ? (
          <>
            <div className="h-56 p-4">
              <ResponsiveContainer>
                <AreaChart data={series} margin={{ top: 20, right: 12, left: 4, bottom: 22 }}>
                  <defs>
                    <linearGradient id={`area-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="name"
                    tick={(props) => <AxisTick {...props} />}
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
                      boxShadow:
                        "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    fill={`url(#area-${w.id})`}
                    dot={(dotProps: ChartDotProps) => (
                      <ChartDot
                        {...dotProps}
                        r={3}
                        groupCol={groupCol}
                        onSelect={handleGroupClick}
                      />
                    )}
                    activeDot={(dotProps: ChartDotProps) => (
                      <ChartDot
                        {...dotProps}
                        r={5}
                        groupCol={groupCol}
                        onSelect={handleGroupClick}
                      />
                    )}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="sr-only">
              Tabela alternativa à área: {series.map((g) => `${g.name}, ${g.total}`).join("; ")}.
            </p>
          </>
        ) : (
          <>
            <div className="h-56 p-4">
              <ResponsiveContainer>
                <LineChart data={series} margin={{ top: 20, right: 12, left: 4, bottom: 22 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="name"
                    tick={(props) => <AxisTick {...props} />}
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
                      boxShadow:
                        "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={(dotProps: ChartDotProps) => (
                      <ChartDot
                        {...dotProps}
                        r={3}
                        groupCol={groupCol}
                        onSelect={handleGroupClick}
                      />
                    )}
                    activeDot={(dotProps: ChartDotProps) => (
                      <ChartDot
                        {...dotProps}
                        r={5}
                        groupCol={groupCol}
                        onSelect={handleGroupClick}
                      />
                    )}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
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
    const valueCol = columns.find((c) => c.key === w.valueKey) ?? numericCols[0];
    const op: AggregationOp = w.op ?? "sum";
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
          title={`Top ${topN} · ${aggregationLabels[op]} de ${valueCol?.label ?? ""} por ${groupCol?.label ?? ""}`}
          icon={<ListOrdered className="size-3.5 shrink-0 text-muted-foreground" />}
          {...dragProps}
        />
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2">
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
            accepts={numericKinds}
            onDropColumn={(key) => onConfigure({ valueKey: key })}
          >
            <select
              aria-label="Coluna numérica"
              className="oliam-select"
              value={valueCol?.key ?? ""}
              onChange={(e) => onConfigure({ valueKey: e.target.value })}
            >
              {!valueCol && <option value="">Selecione…</option>}
              {numericCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldDropSlot>
          <select
            aria-label="Agregação"
            className="oliam-select"
            value={op}
            onChange={(e) => onConfigure({ op: e.target.value as AggregationOp })}
          >
            {Object.entries(aggregationLabels).map(([o, label]) => (
              <option key={o} value={o}>
                {label}
              </option>
            ))}
          </select>
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
                    <span className="font-mono shrink-0">{fmt(g.total, valueCol.kind) ?? "–"}</span>
                  </div>
                  <div className="oliam-ranking-track">
                    <div
                      className="oliam-ranking-fill"
                      style={{ width: `${Math.max(4, (Math.abs(g.total) / max) * 100)}%` }}
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
    const valueCol = columns.find((c) => c.key === w.valueKey) ?? numericCols[0];
    const op: AggregationOp = w.op ?? "sum";
    const grouped =
      groupCol && valueCol ? groupAndAggregate(data, groupCol.key, valueCol.key, op) : [];
    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <WidgetHead
          title={`${aggregationLabels[op]} de ${valueCol?.label ?? ""} por ${groupCol?.label ?? "local"}`}
          icon={<MapPin className="size-3.5 shrink-0 text-muted-foreground" />}
          {...dragProps}
        />
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2">
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
            accepts={numericKinds}
            onDropColumn={(key) => onConfigure({ valueKey: key })}
          >
            <select
              aria-label="Coluna numérica"
              className="oliam-select"
              value={valueCol?.key ?? ""}
              onChange={(e) => onConfigure({ valueKey: e.target.value })}
            >
              {!valueCol && <option value="">Selecione…</option>}
              {numericCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FieldDropSlot>
          <select
            aria-label="Agregação"
            className="oliam-select"
            value={op}
            onChange={(e) => onConfigure({ op: e.target.value as AggregationOp })}
          >
            {Object.entries(aggregationLabels).map(([o, label]) => (
              <option key={o} value={o}>
                {label}
              </option>
            ))}
          </select>
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
            valueKind={valueCol.kind}
            onSelect={(name) => handleGroupClick(groupCol.key, name)}
          />
        )}
      </article>
    );
  }

  if (w.type === "rating") {
    const col = columns.find((c) => c.key === w.metricKey) ?? numericCols[0];
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
    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <WidgetHead
          title={col.label}
          icon={<Star className="size-3.5 shrink-0 text-muted-foreground" />}
          {...dragProps}
        />
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2">
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
          <p className="font-mono text-3xl">
            {values.length ? avg.toFixed(1) : "–"}
            <span className="ml-1 text-sm text-muted-foreground">/ {scaleMax}</span>
          </p>
          {scaleMax === 5 ? (
            <div className="flex gap-1" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={cn(
                    "size-4",
                    i < filled ? "fill-current text-primary" : "text-muted-foreground",
                  )}
                />
              ))}
            </div>
          ) : (
            <div className="oliam-ranking-track w-full max-w-40">
              <div
                className="oliam-ranking-fill"
                style={{ width: `${values.length ? Math.min(100, (avg / scaleMax) * 100) : 0}%` }}
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

  const cancel = () => {
    setAdding(null);
    setValue("");
    setMin("");
    setMax("");
  };
  const addRule = () => {
    if (adding === "threshold") {
      const num = Number(value);
      if (!Number.isFinite(num)) return;
      onChange([
        ...rules,
        { id: crypto.randomUUID(), type: "threshold", operator, value: num, color, background },
      ]);
    } else if (adding === "scale") {
      const mn = Number(min),
        mx = Number(max);
      if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn === mx) return;
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
            <Button size="sm" onClick={addRule}>
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
                    title={isInterpolated ? "Valor estimado por interpolação" : undefined}
                    style={cellStyle ?? undefined}
                    className={cn(
                      "w-44 truncate border-r border-border px-3 py-2 text-xs",
                      numeric && "text-right font-mono",
                      shown === null && "text-muted-foreground",
                      isInterpolated &&
                        "outline outline-1 -outline-offset-1 outline-secondary-accent",
                    )}
                  >
                    <span className={cn(shown === null && !numeric && "italic")}>
                      {shown ?? (numeric ? "–" : NOT_INFORMED)}
                    </span>
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
