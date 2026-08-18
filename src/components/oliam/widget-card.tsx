import { Fragment, lazy, Suspense, useRef, useState } from "react";
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
  Calculator,
  CalendarRange,
  Check,
  Columns3,
  Download,
  FileText,
  Files,
  GitMerge,
  History,
  Image as ImageIcon,
  Info,
  ListOrdered,
  MapPin,
  PieChart as PieIcon,
  ShieldAlert,
  Sparkles,
  Star,
  TrendingUp,
  WandSparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table-widget";
import { FolderMonitorWidget } from "@/components/folder-monitor-widget";
import { cn } from "@/lib/utils";
import {
  kinds,
  numericKinds,
  type Column,
  type ChartDataMode,
  type FilterRule,
  type Kind,
  type Row,
  type SheetData,
  type Widget,
  type WidgetSize,
  type WidgetSpan,
  type WidgetType,
} from "@/lib/types";
import {
  groupableKinds,
  schedulePeriodColumns,
  scheduleItemColumn,
  scheduleSectionColumn,
  scheduleStatusColumn,
  scheduleDetailColumns,
  spanClass,
  sizeClass,
} from "@/lib/widgets";
import {
  scheduleCellState,
  scheduleCriterionForRow,
  summarizeScheduleRows,
  type ScheduleCellState,
} from "@/lib/schedule-normalizer";
import {
  conditionalColor,
  conditionalStyle,
  fmt,
  palette,
  parseDateValue,
  parseNumericValue,
  sortChronologically,
} from "@/lib/format";
import {
  aggregate,
  aggregationLabels,
  chartSeries,
  collapsePieSeries,
  detectQualitySignals,
  groupAndAggregate,
  limitChartSeriesForRendering,
  NOT_INFORMED,
  pieComparisonFor,
  rankingCoverageFor,
  trendSummaryFor,
  pieRoundnessFor,
  relevantAggregationOps,
  semanticAggregationOps,
  sortAllBarCategories,
  barChartPresentation,
  timeSeriesChartPresentation,
  toggleClickFilter,
  type AggregationOp,
} from "@/lib/data-pipeline";
import type { VersionDiff } from "@/lib/import-workbench";
import {
  buildPivotMatrix,
  type ExceptionDecision,
  type ColumnSemanticProfile,
  type SpreadsheetException,
} from "@/lib/spreadsheet-intelligence";
import { parseEditedValue, suggestCorrection, type AuditEntry } from "@/lib/data-review";
import type { FolderMonitorView } from "@/lib/folder-monitor";
import type { ColorGroupLabel, SourceCellFill } from "@/lib/cell-fill-provenance";
import type { WorkbookImageDiagnostic } from "@/lib/workbook-metadata";
import { AnimatedNumber } from "./animated-number";
import { InsightsWidgetBody } from "./insights-widget-body";
import { PivotWidgetBody } from "./pivot-widget-body";
import { RankingWidgetBody } from "./ranking-widget-body";
import { RatingWidgetBody } from "./rating-widget-body";
import { VersionCompareWidgetBody } from "./version-compare-widget-body";
import {
  EmptyWidget,
  FieldDropSlot,
  FilterChip,
  WidgetHead,
  widgetSizeLabels,
  widgetSpanLabels,
  scheduleCellClass,
  truncateLabel,
  BarTooltip,
  AxisTick,
  compactAxisValue,
  exceptionGuidance,
  ChartReadingGuide,
  calculationCopy,
  CalculationButton,
  PieLegend,
  SeriesComparisonPanel,
  TrendSummaryPanel,
  ChartDot,
  type ChartDotProps,
} from "./widget-support";
// Carregado sob demanda: Leaflet só entra no bundle quando um widget de mapa
// é realmente exibido, em vez de pesar no chunk compartilhado por qualquer
// painel (mesmo os que nunca usam mapa). Ver seção 63 do CURRENT_STATE_AUDIT.md.
const MapWidgetBody = lazy(() => import("./map-widget-body"));
// Widgets operacionais (presença, validação, carta de controle, planejado x
// realizado) são recursos de nicho, não recomendados automaticamente — ver
// seção 63 do CURRENT_STATE_AUDIT.md.
const OperationalWidgetBody = lazy(() =>
  import("@/components/operational-widget-body").then((m) => ({
    default: m.OperationalWidgetBody,
  })),
);

export function WidgetCard({
  widget: w,
  index,
  count,
  data,
  totalRows,
  columns,
  numericCols,
  groupableCols,
  sourceImages,
  sourceCellFills,
  colorGroupLabels,
  interpolated,
  sort,
  setSort,
  versionDelta,
  versionDiff,
  exceptions,
  semanticProfiles,
  exceptionDecisions,
  auditTrail,
  onExceptionDecision,
  onCorrectException,
  onEditCell,
  onTraceException,
  focusedCell,
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
  /** Linhas antes de busca/filtros de widget, para a tabela dizer quanto foi filtrado. */
  totalRows: number;
  columns: Column[];
  numericCols: Column[];
  groupableCols: Column[];
  sourceImages: WorkbookImageDiagnostic[];
  sourceCellFills: SourceCellFill[];
  colorGroupLabels: ColorGroupLabel[];
  interpolated: Set<string>;
  sort: { key: string; dir: "asc" | "desc" } | null;
  setSort: (s: { key: string; dir: "asc" | "desc" } | null) => void;
  versionDelta: Map<string, number | null> | null;
  versionDiff: VersionDiff | null;
  exceptions: SpreadsheetException[];
  semanticProfiles: ColumnSemanticProfile[];
  exceptionDecisions: NonNullable<SheetData["exceptionDecisions"]>;
  auditTrail: AuditEntry[];
  onExceptionDecision: (exceptionId: string, status: ExceptionDecision["status"] | null) => void;
  onCorrectException: (exception: SpreadsheetException, value: string, reason: string) => void;
  onEditCell: (sourceRowIndex: number, columnKey: string, value: string, reason: string) => void;
  onTraceException: (exception: SpreadsheetException) => void;
  focusedCell: { rowIndex: number; columnKey?: string; address?: string } | null;
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
  const [selectedPieIndex, setSelectedPieIndex] = useState<number | null>(null);
  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);
  const [exceptionView, setExceptionView] = useState<"pending" | "handled" | "audit">("pending");
  const [editingException, setEditingException] = useState<string | null>(null);
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
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
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    let dragged = false;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (!dragged && Math.abs(delta) > 3) {
        dragged = true;
        // Só captura o ponteiro quando o gesto vira arrasto de verdade. Fazer
        // isso incondicionalmente no pointerdown (como antes) redireciona o
        // alvo de todo evento de ponteiro/clique seguinte para `el`, mesmo
        // sem nenhum arrasto real — um clique parado nunca chegava a disparar
        // o onClick da barra por baixo do cursor, porque o clique "pousava"
        // no container em vez da barra. Bug real, não só o caso de suprimir
        // clique-após-arrasto que o código já tratava abaixo.
        el.setPointerCapture(pointerId);
        el.classList.add("oliam-chart-dragging");
      }
      if (dragged) el.scrollLeft = startScroll - delta;
    };
    const onUp = () => {
      el.classList.remove("oliam-chart-dragging");
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      // Evita que o clique-arrasto dispare o cross-filter da barra por baixo
      // do cursor (onClick da <Bar>) quando o usuário só quis rolar.
      if (dragged) {
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
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

  if (
    w.type === "attendance-overview" ||
    w.type === "validation-overview" ||
    w.type === "control-chart" ||
    w.type === "plan-vs-actual"
  ) {
    const presentation = {
      "attendance-overview": {
        title: "Presença e assinaturas",
        icon: <Check className="size-3.5 shrink-0 text-muted-foreground" />,
      },
      "validation-overview": {
        title: "Validação de inspetores",
        icon: <ShieldAlert className="size-3.5 shrink-0 text-muted-foreground" />,
      },
      "control-chart": {
        title: "Carta de controle",
        icon: <Activity className="size-3.5 shrink-0 text-muted-foreground" />,
      },
      "plan-vs-actual": {
        title: "Planejado × realizado",
        icon: <BarChart3 className="size-3.5 shrink-0 text-muted-foreground" />,
      },
    }[w.type];
    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <WidgetHead title={w.title || presentation.title} icon={presentation.icon} {...dragProps} />
        {sizeControls}
        <Suspense
          fallback={
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              Carregando…
            </div>
          }
        >
          <OperationalWidgetBody type={w.type} columns={columns} rows={data} />
        </Suspense>
      </article>
    );
  }

  if (w.type === "folder-files") {
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
        <FolderMonitorWidget monitor={folderMonitor} />
      </article>
    );
  }

  if (w.type === "image") {
    const image = sourceImages[w.imageIndex ?? 0];
    if (!image) {
      return (
        <EmptyWidget
          {...dragProps}
          title="Imagem embutida"
          span={w.span}
          size={w.size}
          type={w.type}
          animationDelay={animationDelay}
          message="Nenhuma imagem embutida disponível nesta aba."
        />
      );
    }
    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <WidgetHead
          title={w.title || image.name}
          icon={<ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />}
          {...dragProps}
        />
        {sizeControls}
        {image.dataUrl ? (
          <div className="flex justify-center bg-muted/10 p-3">
            <img
              src={image.dataUrl}
              alt={image.name}
              className="max-h-96 max-w-full rounded-lg object-contain"
            />
          </div>
        ) : (
          <p className="p-4 text-xs text-muted-foreground">
            Formato {image.format} não pode ser exibido no navegador
            {image.anchor ? ` (ancorada em ${image.anchor} na planilha original)` : ""}. Abra o
            arquivo original para ver esta imagem.
          </p>
        )}
      </article>
    );
  }

  if (w.type === "exception-panel") {
    const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
    const activeExceptions = exceptions.filter((item) => !exceptionDecisions[item.id]);
    const handledExceptions = exceptions.filter((item) => exceptionDecisions[item.id]);
    const visible = [...(exceptionView === "handled" ? handledExceptions : activeExceptions)]
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
      .slice(0, 100);
    const totals = {
      critical: activeExceptions.filter((item) => item.severity === "critical").length,
      warning: activeExceptions.filter((item) => item.severity === "warning").length,
      info: activeExceptions.filter((item) => item.severity === "info").length,
    };
    const exportExceptions = () => {
      const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const csv = [
        ["prioridade", "tipo", "titulo", "origem", "detalhe"],
        ...activeExceptions.map((item) => [
          item.severity,
          item.kind,
          item.title,
          item.address ?? (item.rowIndex ? `linha ${item.rowIndex}` : (item.columnKey ?? "")),
          item.detail,
        ]),
      ]
        .map((row) => row.map(escape).join(";"))
        .join("\n");
      const url = URL.createObjectURL(
        new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "excecoes-da-planilha.csv";
      link.click();
      URL.revokeObjectURL(url);
    };
    return (
      <article
        className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <WidgetHead
          title={w.title || "Exceções para revisar"}
          icon={<AlertTriangle className="size-3.5 text-amber-600" />}
          {...dragProps}
        />
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/15 px-4 py-2"
          data-export-controls
        >
          <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 text-[11px]">
            <button
              type="button"
              className={cn(
                "rounded-md px-2.5 py-1",
                exceptionView === "pending" && "bg-card font-medium shadow-sm",
              )}
              onClick={() => setExceptionView("pending")}
            >
              Pendentes · {activeExceptions.length}
            </button>
            <button
              type="button"
              className={cn(
                "rounded-md px-2.5 py-1",
                exceptionView === "handled" && "bg-card font-medium shadow-sm",
              )}
              onClick={() => setExceptionView("handled")}
            >
              Tratadas · {handledExceptions.length}
            </button>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1",
                exceptionView === "audit" && "bg-card font-medium shadow-sm",
              )}
              onClick={() => setExceptionView("audit")}
            >
              <History className="size-3" /> Histórico · {auditTrail.length}
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!activeExceptions.length || exceptionView === "audit"}
            onClick={exportExceptions}
          >
            <Download className="size-3.5" /> Exportar pendências
          </Button>
        </div>
        {sizeControls}
        {exceptionView === "audit" ? (
          <div className="max-h-[32rem] overflow-auto">
            {!auditTrail.length ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <History className="size-5" />O histórico será preenchido quando uma exceção for
                corrigida, resolvida ou ignorada.
              </div>
            ) : (
              <table className="w-full min-w-[46rem] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2">Quando</th>
                    <th className="px-4 py-2">Ação</th>
                    <th className="px-4 py-2">Origem</th>
                    <th className="px-4 py-2">Alteração</th>
                    <th className="px-4 py-2">Justificativa</th>
                  </tr>
                </thead>
                <tbody>
                  {[...auditTrail]
                    .reverse()
                    .slice(0, 250)
                    .map((entry) => (
                      <tr key={entry.id} className="border-b border-border/60 align-top">
                        <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                          {new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(entry.timestamp)}
                        </td>
                        <td className="px-4 py-2 font-medium">
                          {entry.action === "cell-correction"
                            ? "Célula corrigida"
                            : entry.action === "exception-ignored"
                              ? "Ignorada"
                              : entry.action === "exception-reopened"
                                ? "Reaberta"
                                : "Resolvida"}
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px]">
                          {entry.address ??
                            (entry.rowIndex ? `linha ${entry.rowIndex}` : (entry.columnKey ?? "—"))}
                        </td>
                        <td className="max-w-64 px-4 py-2">
                          <span className="text-destructive line-through">
                            {String(entry.before ?? "")}
                          </span>
                          {entry.action === "cell-correction" && (
                            <>
                              <span className="mx-1 text-muted-foreground">→</span>
                              <span className="text-emerald-700 dark:text-emerald-300">
                                {String(entry.after ?? "")}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="max-w-80 px-4 py-2 text-muted-foreground">{entry.reason}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <>
            <div className="border-b border-border bg-blue-500/8 px-4 py-3 text-xs leading-relaxed">
              <strong>Como usar:</strong>{" "}
              <span className="text-muted-foreground">
                cada item explica o que foi detectado, o efeito possível nos resultados e a ação
                recomendada. “Resolver” confirma que você revisou; “Ignorar” mantém o dado sem
                alteração; “Corrigir” registra um novo valor e preserva o original no histórico.
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 border-b border-border bg-muted/10 p-3">
              {[
                ["Críticas", totals.critical, "text-destructive"],
                ["Atenção", totals.warning, "text-amber-700 dark:text-amber-300"],
                ["Informativas", totals.info, "text-muted-foreground"],
              ].map(([label, value, className]) => (
                <div key={String(label)} className="rounded-xl border border-border bg-card p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className={cn("mt-1 font-mono text-2xl font-bold", className)}>{value}</p>
                </div>
              ))}
            </div>
            {!visible.length ? (
              <div className="flex min-h-32 items-center justify-center gap-2 p-6 text-sm text-emerald-700 dark:text-emerald-300">
                <Check className="size-4" />
                {exceptionView === "handled"
                  ? "Nenhuma exceção foi tratada ainda."
                  : "Nenhuma exceção pendente encontrada."}
              </div>
            ) : (
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full min-w-[68rem] text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2">Prioridade</th>
                      <th className="px-4 py-2">O que aconteceu</th>
                      <th className="px-4 py-2">Origem</th>
                      <th className="px-4 py-2">Por que importa</th>
                      <th className="px-4 py-2">O que fazer</th>
                      <th className="px-4 py-2 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <Fragment key={item.id}>
                        <tr className="border-b border-border/60 align-top">
                          <td className="px-4 py-2">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                                item.severity === "critical"
                                  ? "bg-destructive/12 text-destructive"
                                  : item.severity === "warning"
                                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                    : "bg-muted text-muted-foreground",
                              )}
                            >
                              {item.severity === "critical"
                                ? "Crítica"
                                : item.severity === "warning"
                                  ? "Atenção"
                                  : "Info"}
                            </span>
                          </td>
                          <td className="max-w-64 px-4 py-2">
                            <button
                              type="button"
                              className="text-left font-medium hover:text-primary hover:underline"
                              onClick={() => onTraceException(item)}
                            >
                              {item.title}
                            </button>
                            <p className="mt-1 leading-relaxed text-muted-foreground">
                              {item.detail}
                            </p>
                          </td>
                          <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">
                            <button
                              type="button"
                              className="hover:text-primary hover:underline"
                              onClick={() => onTraceException(item)}
                            >
                              {item.address ??
                                (item.rowIndex
                                  ? `linha ${item.rowIndex}`
                                  : (item.columnKey ?? "—"))}
                            </button>
                          </td>
                          <td className="max-w-64 px-4 py-2 leading-relaxed text-muted-foreground">
                            {exceptionGuidance(item).impact}
                          </td>
                          <td className="max-w-64 px-4 py-2 leading-relaxed text-muted-foreground">
                            {exceptionGuidance(item).action}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1">
                              {exceptionView === "handled" ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onExceptionDecision(item.id, null)}
                                >
                                  Reabrir
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onTraceException(item)}
                                  >
                                    Ver origem
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onExceptionDecision(item.id, "ignored")}
                                  >
                                    Ignorar
                                  </Button>
                                  {item.columnKey && item.rowIndex && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const suggestion = suggestCorrection(
                                          item,
                                          columns.find((column) => column.key === item.columnKey),
                                        );
                                        setEditingException(item.id);
                                        setCorrectionValue(
                                          suggestion?.value ?? String(item.value ?? ""),
                                        );
                                        setCorrectionReason(suggestion?.reason ?? "");
                                      }}
                                    >
                                      <WandSparkles className="size-3.5" /> Corrigir
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    onClick={() => onExceptionDecision(item.id, "resolved")}
                                  >
                                    Resolver
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {editingException === item.id && exceptionView === "pending" && (
                          <tr className="border-b border-primary/30 bg-tint/40">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="grid gap-3 md:grid-cols-[minmax(10rem,0.7fr)_minmax(16rem,1.3fr)_auto] md:items-end">
                                <label className="grid gap-1 text-[11px] font-medium">
                                  Novo valor
                                  <input
                                    autoFocus
                                    className="oliam-input h-9"
                                    value={correctionValue}
                                    onChange={(event) => setCorrectionValue(event.target.value)}
                                  />
                                </label>
                                <label className="grid gap-1 text-[11px] font-medium">
                                  Justificativa da correção
                                  <input
                                    className="oliam-input h-9"
                                    value={correctionReason}
                                    onChange={(event) => setCorrectionReason(event.target.value)}
                                    placeholder="Explique por que o valor foi alterado"
                                  />
                                </label>
                                <div className="flex gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditingException(null)}
                                  >
                                    Cancelar
                                  </Button>
                                  <Button
                                    size="sm"
                                    disabled={!correctionReason.trim()}
                                    onClick={() => {
                                      onCorrectException(item, correctionValue, correctionReason);
                                      setEditingException(null);
                                    }}
                                  >
                                    Aplicar correção
                                  </Button>
                                </div>
                              </div>
                              <p className="mt-2 text-[11px] text-muted-foreground">
                                Prévia:{" "}
                                <span className="font-mono text-destructive line-through">
                                  {String(item.value ?? "")}
                                </span>{" "}
                                →{" "}
                                <span className="font-mono text-emerald-700 dark:text-emerald-300">
                                  {String(
                                    parseEditedValue(
                                      correctionValue,
                                      columns.find((column) => column.key === item.columnKey),
                                    ) ?? "vazio",
                                  )}
                                </span>
                                . O valor original ficará preservado no histórico.
                              </p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </article>
    );
  }

  if (w.type === "version-compare") {
    return (
      <VersionCompareWidgetBody
        widget={w}
        versionDiff={versionDiff}
        dragProps={dragProps}
        sizeControls={sizeControls}
        animationDelay={animationDelay}
      />
    );
  }

  if (w.type === "pivot-table" || w.type === "matrix-heatmap") {
    return (
      <PivotWidgetBody
        widget={w}
        data={data}
        groupableCols={groupableCols}
        numericCols={numericCols}
        semanticProfiles={semanticProfiles}
        onConfigure={onConfigure}
        dragProps={dragProps}
        sizeControls={sizeControls}
        animationDelay={animationDelay}
      />
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
    const metricOps = semanticAggregationOps(
      ["sum", "avg", "count", "min", "max"],
      col,
      semanticProfiles.find((profile) => profile.key === col.key),
    );
    const requestedMetricOp: AggregationOp = w.op ?? "sum";
    const metricOp: AggregationOp = metricOps.includes(requestedMetricOp)
      ? requestedMetricOp
      : (metricOps[0] ?? "avg");
    const total = aggregate(
      data.map((r) => parseNumericValue(r[col.key])).filter((v): v is number => v !== null),
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
          <CalculationButton
            operation={metricOp}
            operations={metricOps}
            metric={col.label}
            onOperation={(operation) => onConfigure({ op: operation })}
          />
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
        <div className="border-b border-border bg-card px-4 py-2 text-[11px] text-muted-foreground">
          <strong className="text-foreground">Cálculo atual:</strong>{" "}
          {calculationCopy[metricOp].action} para as {data.length.toLocaleString("pt-BR")} linhas
          visíveis. Toque na calculadora para alterar.
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
    const scheduleData =
      w.blockKey && w.blockValue !== undefined
        ? data.filter((row) => String(row[w.blockKey!] ?? "") === w.blockValue)
        : data;
    const labelOptions = columns.filter(
      (column) => !periodKeys.has(column.key) && groupableKinds.includes(column.kind),
    );
    const groupCol =
      columns.find((column) => column.key === w.groupKey && !periodKeys.has(column.key)) ??
      scheduleItemColumn(
        columns,
        periodCols.map((column) => column.key),
        scheduleData,
      );
    const statusCol =
      columns.find((column) => column.key === w.statusKey && !periodKeys.has(column.key)) ??
      scheduleStatusColumn(
        columns,
        periodCols.map((column) => column.key),
      );
    const configuredSection = columns.find(
      (column) =>
        column.key === w.sectionKey &&
        !periodKeys.has(column.key) &&
        column.key !== groupCol?.key &&
        column.key !== statusCol?.key,
    );
    const sectionCol =
      w.sectionKey === ""
        ? undefined
        : (configuredSection ??
          scheduleSectionColumn(
            columns,
            periodCols.map((column) => column.key),
            groupCol?.key,
            statusCol?.key,
          ));
    const allDetailCols = columns.filter(
      (column) =>
        !periodKeys.has(column.key) &&
        column.key !== groupCol?.key &&
        column.key !== statusCol?.key &&
        column.key !== sectionCol?.key &&
        scheduleData.some((row) => row[column.key] !== null && row[column.key] !== ""),
    );
    const defaultDetailCols = scheduleDetailColumns(
      columns,
      periodCols.map((column) => column.key),
      scheduleData,
      groupCol?.key,
      statusCol?.key,
    ).filter((column) => column.key !== sectionCol?.key);
    const detailCols = (
      w.detailKeys === undefined
        ? defaultDetailCols
        : w.detailKeys
            .map((key) => allDetailCols.find((column) => column.key === key))
            .filter((column): column is Column => Boolean(column))
    ).slice(0, 8);
    const detailKeys = new Set(detailCols.map((column) => column.key));
    const isBlankScheduleValue = (value: unknown) =>
      value === null ||
      value === undefined ||
      value === "" ||
      (typeof value === "string" && /^[-–—]$/.test(value.trim()));
    const scheduleRows = scheduleData.filter(
      (row) =>
        groupCol &&
        row[groupCol.key] !== null &&
        row[groupCol.key] !== "" &&
        (periodCols.some((column) => !isBlankScheduleValue(row[column.key])) ||
          (statusCol && row[statusCol.key] !== null && row[statusCol.key] !== "") ||
          allDetailCols.some((column) => row[column.key] !== null && row[column.key] !== "")),
    );
    const observationCols = allDetailCols.filter((column) =>
      /observa|nota|coment|justific|informa[cç][aã]o adicional/i.test(
        `${column.key} ${column.label}`,
      ),
    );
    const scheduleStats = summarizeScheduleRows(
      scheduleRows,
      columns,
      periodCols.map((column) => column.key),
      statusCol?.key,
      observationCols.map((column) => column.key),
    );
    const scheduleObservations = scheduleRows
      .flatMap((row) =>
        observationCols.flatMap((column) => {
          const value = row[column.key];
          if (isBlankScheduleValue(value)) return [];
          return [
            {
              item: groupCol ? String(row[groupCol.key] ?? "Item") : "Item",
              field: column.label,
              text: String(value),
            },
          ];
        }),
      )
      .filter(
        (entry, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.item === entry.item &&
              candidate.field === entry.field &&
              candidate.text === entry.text,
          ) === index,
      )
      .slice(0, 100);
    const scheduleMode: ChartDataMode = w.dataMode ?? "raw";
    // Blocos podem misturar análises e unidades. Somar ou calcular média entre
    // resultados diferentes cria um número sem significado; a visão resumida
    // conta registros preenchidos por período e a visão original preserva cada linha.
    const scheduleOps: AggregationOp[] = ["count"];
    const scheduleOp: AggregationOp = scheduleOps.includes(w.op ?? "count")
      ? (w.op ?? "count")
      : "count";
    const aggregateScheduleRow: Row = groupCol
      ? {
          [groupCol.key]: `${aggregationLabels[scheduleOp]} de todos os itens`,
          ...Object.fromEntries(
            periodCols.map((column) => {
              const values = scheduleRows.flatMap((row) => {
                const value = row[column.key];
                if (scheduleOp === "count") return isBlankScheduleValue(value) ? [] : [1];
                const numeric = parseNumericValue(value);
                return numeric !== null ? [numeric] : [];
              });
              return [column.key, values.length ? aggregate(values, scheduleOp) : null];
            }),
          ),
        }
      : {};
    const visibleRows = (
      scheduleMode === "aggregate" ? [aggregateScheduleRow] : scheduleRows
    ).slice(0, 400);
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
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Seção
            <select
              aria-label="Coluna que separa os blocos do cronograma"
              className="oliam-select h-7 max-w-52"
              value={sectionCol?.key ?? ""}
              onChange={(event) => onConfigure({ sectionKey: event.target.value })}
            >
              <option value="">Sem separar por seção</option>
              {labelOptions
                .filter((column) => column.key !== groupCol?.key && column.key !== statusCol?.key)
                .map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
            </select>
          </label>
          <CalculationButton
            mode={scheduleMode}
            operation={scheduleOp}
            operations={scheduleOps}
            metric="os resultados dos períodos"
            group="período"
            allowRaw
            onRaw={() => onConfigure({ dataMode: "raw" })}
            onOperation={(operation) => onConfigure({ dataMode: "aggregate", op: operation })}
          />
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
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-4 py-1.5 text-[10px] text-muted-foreground">
          <span className="shrink-0 rounded-full bg-muted/40 px-2 py-1">
            <strong className="text-foreground">Métrica</strong> · células por período
          </span>
          <span className="shrink-0 px-1">
            {scheduleMode === "raw"
              ? "linha a linha"
              : `${aggregationLabels[scheduleOp]} por período`}
          </span>
          {w.blockValue && (
            <span
              className="max-w-64 shrink-0 truncate rounded-full bg-primary/8 px-2 py-1 text-foreground"
              title={w.blockValue}
            >
              <strong>Bloco</strong> · {w.blockValue}
            </span>
          )}
        </div>
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
            <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-muted/10 px-3 py-2">
              {[
                ...(scheduleStats.planned
                  ? [
                      {
                        label: "Programados",
                        value: scheduleStats.planned,
                        suffix: "",
                        className: "text-blue-700 dark:text-blue-300",
                      },
                    ]
                  : []),
                {
                  label: "Resultados",
                  value: scheduleStats.results,
                  suffix: "",
                  className: "text-foreground",
                },
                {
                  label: "Cobertura",
                  value: scheduleStats.coverage,
                  suffix: "%",
                  className: "text-primary",
                },
                {
                  label: "Dentro do limite",
                  value: scheduleStats.within,
                  suffix: "",
                  className: "text-emerald-700 dark:text-emerald-300",
                },
                {
                  label: "Fora do limite",
                  value: scheduleStats.outside,
                  suffix: "",
                  className: "text-destructive",
                },
                {
                  label: "Sem registro",
                  value: scheduleStats.planned
                    ? Math.max(0, scheduleStats.planned - scheduleStats.results)
                    : scheduleStats.empty,
                  suffix: "",
                  className: "text-muted-foreground",
                },
                ...(scheduleStats.observations
                  ? [
                      {
                        label: "Observações",
                        value: scheduleStats.observations,
                        suffix: "",
                        className: "text-foreground",
                      },
                    ]
                  : []),
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex min-w-[7.5rem] shrink-0 items-baseline justify-between gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-1.5 shadow-sm"
                >
                  <p className="truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className={cn("shrink-0 font-mono text-sm font-bold", stat.className)}>
                    {stat.value.toLocaleString("pt-BR")}
                    {stat.suffix}
                  </p>
                </div>
              ))}
            </div>
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
                    const section = sectionCol ? String(row[sectionCol.key] ?? "") : "";
                    const previousSection =
                      sectionCol && rowIndex > 0
                        ? String(visibleRows[rowIndex - 1]?.[sectionCol.key] ?? "")
                        : "";
                    const criterion = scheduleCriterionForRow(
                      row,
                      columns,
                      periodCols.map((column) => column.key),
                    );
                    return (
                      <Fragment key={`${section}-${item}-${rowIndex}`}>
                        {section && section !== previousSection && (
                          <tr>
                            <th
                              colSpan={1 + detailCols.length + periodCols.length}
                              className="sticky left-0 rounded-lg border border-primary/20 bg-primary/8 px-3 py-2 text-left font-semibold text-foreground"
                            >
                              <span className="mr-2 text-[10px] uppercase tracking-[0.12em] text-primary">
                                {sectionCol?.label}
                              </span>
                              {section}
                            </th>
                          </tr>
                        )}
                        <tr>
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
                            const empty = isBlankScheduleValue(value);
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
                            const state = scheduleCellState(value, status, criterion);
                            const empty = isBlankScheduleValue(value);
                            const label = empty ? "Sem registro" : String(value);
                            const criterionLabel = criterion ? ` · Limite: ${criterion.label}` : "";
                            return (
                              <td
                                key={column.key}
                                className={cn(
                                  "max-w-32 rounded-lg px-2 py-2 text-center font-semibold transition-transform hover:scale-[1.04]",
                                  scheduleCellClass[state],
                                )}
                                title={`${item} · ${column.label}: ${label}${criterionLabel}${status ? ` · ${String(status)}` : ""}`}
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
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {scheduleObservations.length > 0 && (
              <details className="border-t border-border bg-card">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-[11px] font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="size-3.5 text-primary" /> Observações do bloco
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {scheduleObservations.length}
                  </span>
                </summary>
                <ul className="grid max-h-52 gap-1.5 overflow-auto border-t border-border p-3 sm:grid-cols-2">
                  {scheduleObservations.map((entry, index) => (
                    <li
                      key={`${entry.item}-${entry.field}-${index}`}
                      className="rounded-lg bg-muted/25 px-3 py-2 text-[11px] leading-relaxed"
                    >
                      <span className="block truncate font-medium" title={entry.item}>
                        {entry.item}
                      </span>
                      <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">
                        {entry.field}
                      </span>
                      <span className="whitespace-pre-line">{entry.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2 text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">
                {scheduleRows.length.toLocaleString("pt-BR")} item(ns) · {periodCols.length}{" "}
                período(s)
                {detailCols.length ? ` · ${detailCols.length} informação(ões) extra(s)` : ""}
              </span>
              {[
                ["planned", "Planejado"],
                ["done", "Dentro do limite / conforme"],
                ["warning", "Pendente / atenção"],
                ["failed", "Fora do limite / não conforme"],
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
        ? semanticAggregationOps(
            relevantAggregationOps(data, groupCol.key, valueCol.key),
            valueCol,
            semanticProfiles.find((profile) => profile.key === valueCol.key),
          )
        : (Object.keys(aggregationLabels) as AggregationOp[]);
    const op: AggregationOp = relevantOps.includes(w.op ?? "sum")
      ? (w.op ?? "sum")
      : (relevantOps[0] ?? "sum");
    const dataMode: ChartDataMode = w.dataMode ?? (op === "count" ? "aggregate" : "raw");
    const title =
      dataMode === "raw" && op !== "count"
        ? `${valueCol?.label ?? "Valores"} por linha de ${groupCol?.label ?? "categoria"}`
        : op === "count"
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
        ? chartSeries(data, groupCol.key, valueCol.key, op, dataMode).map((g) => ({
            name: g.name,
            total: g.total,
            ...(g.sourceRow ? { sourceRow: g.sourceRow } : {}),
          }))
        : [];
    const completeSeries =
      w.type === "line" || (w.type === "area" && groupCol?.kind === "date")
        ? sortChronologically(grouped)
        : grouped;
    const orderedSeries =
      w.type === "bar" && dataMode !== "raw"
        ? sortAllBarCategories(completeSeries)
        : completeSeries;
    const renderableSeries =
      w.type === "pie"
        ? { items: orderedSeries, omitted: 0, total: orderedSeries.length }
        : limitChartSeriesForRendering(orderedSeries);
    const series = renderableSeries.items;
    const seriesColor = valueCol
      ? (conditionalColor(
          series.at(-1)?.total ?? null,
          valueCol.kind,
          valueCol.conditionalFormat,
        ) ?? "var(--primary)")
      : "var(--primary)";
    const barSeries = series;
    const barPresentation = barChartPresentation(barSeries.length);
    const timeSeriesPresentation = timeSeriesChartPresentation(series.length);
    const pieSeries = w.type === "pie" ? collapsePieSeries(completeSeries) : series;
    const pieTotal = pieSeries.reduce((s, e) => s + e.total, 0);
    const displayedPieIndex = activePieIndex ?? selectedPieIndex;
    const largestPieIndex = pieSeries.reduce(
      (largest, entry, index, entries) =>
        largest < 0 || entry.total > (entries[largest]?.total ?? Number.NEGATIVE_INFINITY)
          ? index
          : largest,
      -1,
    );
    // A leitura detalhada fica visível desde o início usando a maior fatia;
    // hover/clique apenas troca o foco. O gráfico continua sem escurecer as
    // demais fatias enquanto nenhuma seleção explícita foi feita.
    const summaryPieIndex = displayedPieIndex ?? (largestPieIndex >= 0 ? largestPieIndex : null);
    const selectedPie = summaryPieIndex !== null ? pieSeries[summaryPieIndex] : null;
    const selectedPieComparison =
      summaryPieIndex !== null ? pieComparisonFor(pieSeries, summaryPieIndex) : null;
    // Mesma leitura guiada do pizza, mas sem estado de "seleção" própria: o
    // clique na barra já filtra diretamente (comportamento existente,
    // preservado), então aqui só o hover troca o destaque, com a maior
    // categoria como padrão quando nada está sob o mouse.
    const largestBarIndex = barSeries.reduce(
      (largest, entry, index, entries) =>
        largest < 0 || entry.total > (entries[largest]?.total ?? Number.NEGATIVE_INFINITY)
          ? index
          : largest,
      -1,
    );
    const summaryBarIndex = activeBarIndex ?? (largestBarIndex >= 0 ? largestBarIndex : null);
    const selectedBar = summaryBarIndex !== null ? barSeries[summaryBarIndex] : null;
    const selectedBarComparison =
      summaryBarIndex !== null ? pieComparisonFor(barSeries, summaryBarIndex) : null;
    // Só mostra resumo de tendência quando a série é de fato cronológica —
    // mesma condição usada acima para decidir se `completeSeries` é ordenada
    // por `sortChronologically`. Área agrupada por uma coluna não temporal
    // não tem "início/fim" com sentido de tempo, é uma comparação categórica.
    const trendSummary =
      w.type === "line" || (w.type === "area" && groupCol?.kind === "date")
        ? trendSummaryFor(series)
        : null;
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
          <FilterChip groupKey={groupCol?.key} filters={filters} setFilters={setFilters} />
          <FieldDropSlot
            accepts={w.type === "line" ? (["date"] as Kind[]) : groupableKinds}
            onDropColumn={(key) => onConfigure({ groupKey: key })}
          >
            <label className="flex max-w-56 items-center gap-1 rounded-lg border border-border bg-card pl-1.5 text-[10px] text-muted-foreground">
              <span className="font-mono font-bold text-foreground">X</span>
              <select
                aria-label="Coluna do eixo X"
                className="oliam-select h-7 min-w-0 max-w-48 border-0 bg-transparent px-1.5 shadow-none"
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
            </label>
          </FieldDropSlot>
          <FieldDropSlot
            accepts={op === "count" ? (Object.keys(kinds) as Kind[]) : numericKinds}
            onDropColumn={(key) => onConfigure({ valueKey: key })}
          >
            <label className="flex max-w-56 items-center gap-1 rounded-lg border border-border bg-card pl-1.5 text-[10px] text-muted-foreground">
              <span className="font-mono font-bold text-foreground">Y</span>
              <select
                aria-label={op === "count" ? "Coluna usada para contar" : "Métrica do eixo Y"}
                className="oliam-select h-7 min-w-0 max-w-48 border-0 bg-transparent px-1.5 shadow-none"
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
            </label>
          </FieldDropSlot>
          <CalculationButton
            mode={dataMode}
            operation={op}
            operations={relevantOps}
            metric={op === "count" ? "os registros" : (valueCol?.label ?? "a métrica")}
            group={groupCol?.label}
            allowRaw
            onRaw={() => onConfigure({ dataMode: "raw" })}
            onOperation={(operation) => onConfigure({ dataMode: "aggregate", op: operation })}
          />
        </div>
        {sizeControls}
        {groupCol && valueCol && (
          <ChartReadingGuide
            group={groupCol.label}
            metric={op === "count" ? "Quantidade de linhas" : valueCol.label}
            mode={dataMode}
            operation={`${aggregationLabels[op]} por ${groupCol.label}`}
          />
        )}
        {renderableSeries.omitted > 0 && (
          <p className="border-b border-border bg-secondary-accent/8 px-4 py-2 text-[10px] text-muted-foreground">
            Prévia otimizada: {renderableSeries.items.length.toLocaleString("pt-BR")} de{" "}
            {renderableSeries.total.toLocaleString("pt-BR")} pontos, distribuídos por toda a série.
            Os dados completos e sem amostragem permanecem na tabela detalhada.
          </p>
        )}
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
                      margin={{ top: 20, right: 12, left: 4, bottom: 18 }}
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
                      />
                      <YAxis
                        type="number"
                        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        tickFormatter={(value: number) => compactAxisValue(value, valueCol.kind)}
                      />
                      <ChartTooltip
                        cursor={{ fill: "var(--accent)", fillOpacity: 0.4, radius: 6 }}
                        content={(props) => (
                          <BarTooltip
                            active={props.active}
                            payload={
                              props.payload as {
                                value?: number;
                                payload?: { sourceRow?: number };
                              }[]
                            }
                            label={props.label as string}
                            series={barSeries}
                            kind={valueCol.kind}
                            mode={dataMode}
                          />
                        )}
                      />
                      <Bar
                        dataKey="total"
                        fill={`url(#bar-grad-${w.id})`}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={72}
                        onClick={(_, i) => {
                          // O payload que o Recharts entrega ao onClick de uma
                          // <Bar> com <Cell> filhas não confiavelmente carrega
                          // `.name` (varia por versão/estrutura interna) — o
                          // índice, sim, sempre corresponde à posição em
                          // barSeries (mesmo array usado para renderizar as
                          // Cell logo abaixo). Buscar o nome ali, em vez de
                          // confiar no payload, é o mesmo padrão já usado com
                          // sucesso no <Pie> (onClick={(_, index) => ...}).
                          const entry = barSeries[i];
                          if (entry) handleGroupClick(groupCol.key, entry.name);
                        }}
                        onMouseEnter={(_, i) => setActiveBarIndex(i)}
                        onMouseLeave={() => setActiveBarIndex(null)}
                        cursor="pointer"
                        // O hover chama setActiveBarIndex, que re-renderiza o
                        // widget e recalcula barSeries com identidade nova a
                        // cada passagem do mouse. Sem isso, o Recharts trata
                        // a nova referência como "dado mudou", reinicia a
                        // animação de entrada da barra e recalcula o eixo Y
                        // no processo — piscando os números do eixo a cada
                        // hover. Mesmo ajuste já usado no sparkline (linha
                        // ~1388) para o mesmo tipo de problema.
                        isAnimationActive={false}
                      >
                        {barSeries.map((entry, entryIndex) => (
                          <Cell
                            key={`${entry.name}-${entry.sourceRow ?? entryIndex}`}
                            fill={
                              conditionalColor(
                                entry.total,
                                valueCol.kind,
                                valueCol.conditionalFormat,
                              ) ?? `url(#bar-grad-${w.id})`
                            }
                            opacity={
                              activeBarIndex === null || activeBarIndex === entryIndex ? 1 : 0.45
                            }
                            style={{ transition: "opacity 150ms ease" }}
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
            {selectedBar && (
              <SeriesComparisonPanel
                selected={selectedBar}
                comparison={selectedBarComparison}
                kind={valueCol.kind}
                filterLabel="Filtrar por esta categoria"
                onFilter={() => handleGroupClick(groupCol.key, selectedBar.name)}
              />
            )}
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
                        const share = pieTotal
                          ? (v / pieTotal).toLocaleString("pt-BR", {
                              style: "percent",
                              maximumFractionDigits: 1,
                            })
                          : "participação indisponível";
                        const count = entry?.payload?.count;
                        return [
                          formatted,
                          count
                            ? `${share} do total · ${count.toLocaleString("pt-BR")} categorias agrupadas`
                            : `${share} do total`,
                        ];
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
                      minAngle={4}
                      stroke="var(--card)"
                      strokeWidth={3}
                      onClick={(_, index) => {
                        // Mesmo padrão de clique-para-filtrar já usado em
                        // barra/linha/área/ranking/mapa: clicar filtra na
                        // hora, sem precisar de um botão extra. "Outros" é um
                        // agrupador sintético (não existe como valor real na
                        // planilha), então só seleciona para exibir a
                        // comparação, sem tentar filtrar por ele.
                        setSelectedPieIndex(index);
                        const entry = pieSeries[index];
                        if (entry && entry.name !== "Outros") {
                          handleGroupClick(groupCol.key, entry.name);
                        }
                      }}
                      onMouseEnter={(_, i) => setActivePieIndex(i)}
                      onMouseLeave={() => setActivePieIndex(null)}
                      cursor="pointer"
                      animationDuration={500}
                    >
                      {pieSeries.map((entry, i) => (
                        <Cell
                          key={`${entry.name}-${"sourceRow" in entry ? (entry.sourceRow ?? i) : i}`}
                          fill={pieLegendItems[i]?.color}
                          opacity={displayedPieIndex === null || displayedPieIndex === i ? 1 : 0.45}
                          stroke={displayedPieIndex === i ? "var(--foreground)" : "var(--card)"}
                          strokeWidth={displayedPieIndex === i ? 2 : 3}
                          style={{ transition: "opacity 150ms ease, stroke 150ms ease" }}
                        />
                      ))}
                      <Label
                        position="center"
                        content={({ viewBox }) => {
                          const box = viewBox as { cx?: number; cy?: number } | undefined;
                          if (box?.cx === undefined || box?.cy === undefined) return null;
                          const active =
                            displayedPieIndex !== null ? pieSeries[displayedPieIndex] : null;
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
                                {active && pieTotal > 0 && (
                                  <tspan
                                    x={box.cx}
                                    dy="1.35em"
                                    fontSize={9}
                                    fill="var(--muted-foreground)"
                                  >
                                    {(active.total / pieTotal).toLocaleString("pt-BR", {
                                      style: "percent",
                                      maximumFractionDigits: 1,
                                    })}{" "}
                                    do total
                                  </tspan>
                                )}
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
                activeIndex={displayedPieIndex}
                onHoverIndex={setActivePieIndex}
                onSelectIndex={(i) => {
                  setSelectedPieIndex(i);
                  const entry = pieSeries[i];
                  if (entry && entry.name !== "Outros") {
                    handleGroupClick(groupCol.key, entry.name);
                  }
                }}
              />
            </div>
            {selectedPie && (
              <SeriesComparisonPanel
                selected={selectedPie}
                comparison={selectedPieComparison}
                kind={valueCol.kind}
                filterLabel="Filtrar por esta fatia"
                onFilter={
                  selectedPie.name !== "Outros"
                    ? () => handleGroupClick(groupCol.key, selectedPie.name)
                    : undefined
                }
              />
            )}
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
                    <AreaChart data={series} margin={{ top: 20, right: 12, left: 0, bottom: 14 }}>
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
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        width={52}
                        tickFormatter={(v: number) => compactAxisValue(v, valueCol.kind)}
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
                        dot={(dotProps: ChartDotProps) => {
                          const { key, ...rest } = dotProps as ChartDotProps & {
                            key?: string | number;
                          };
                          return (
                            <ChartDot
                              key={key}
                              {...rest}
                              r={3}
                              groupCol={groupCol}
                              valueCol={valueCol}
                              onSelect={handleGroupClick}
                            />
                          );
                        }}
                        activeDot={(dotProps: ChartDotProps) => {
                          const { key, ...rest } = dotProps as ChartDotProps & {
                            key?: string | number;
                          };
                          return (
                            <ChartDot
                              key={key}
                              {...rest}
                              r={5}
                              groupCol={groupCol}
                              valueCol={valueCol}
                              onSelect={handleGroupClick}
                            />
                          );
                        }}
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
            {trendSummary && <TrendSummaryPanel summary={trendSummary} kind={valueCol.kind} />}
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
                    <LineChart data={series} margin={{ top: 20, right: 12, left: 0, bottom: 14 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="name"
                        tick={(props) => <AxisTick {...props} />}
                        interval={0}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        width={52}
                        tickFormatter={(v: number) => compactAxisValue(v, valueCol.kind)}
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
                        dot={(dotProps: ChartDotProps) => {
                          const { key, ...rest } = dotProps as ChartDotProps & {
                            key?: string | number;
                          };
                          return (
                            <ChartDot
                              key={key}
                              {...rest}
                              r={3}
                              groupCol={groupCol}
                              valueCol={valueCol}
                              onSelect={handleGroupClick}
                            />
                          );
                        }}
                        activeDot={(dotProps: ChartDotProps) => {
                          const { key, ...rest } = dotProps as ChartDotProps & {
                            key?: string | number;
                          };
                          return (
                            <ChartDot
                              key={key}
                              {...rest}
                              r={5}
                              groupCol={groupCol}
                              valueCol={valueCol}
                              onSelect={handleGroupClick}
                            />
                          );
                        }}
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
            {trendSummary && <TrendSummaryPanel summary={trendSummary} kind={valueCol.kind} />}
          </>
        )}
      </article>
    );
  }

  if (w.type === "ranking") {
    return (
      <RankingWidgetBody
        widget={w}
        data={data}
        columns={columns}
        numericCols={numericCols}
        groupableCols={groupableCols}
        semanticProfiles={semanticProfiles}
        filters={filters}
        setFilters={setFilters}
        onConfigure={onConfigure}
        dragProps={dragProps}
        sizeControls={sizeControls}
        animationDelay={animationDelay}
      />
    );
  }

  if (w.type === "insights") {
    return (
      <InsightsWidgetBody
        widget={w}
        data={data}
        columns={columns}
        numericCols={numericCols}
        groupableCols={groupableCols}
        semanticProfiles={semanticProfiles}
        filters={filters}
        setFilters={setFilters}
        onConfigure={onConfigure}
        dragProps={dragProps}
        sizeControls={sizeControls}
        animationDelay={animationDelay}
      />
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
        ? semanticAggregationOps(
            relevantAggregationOps(data, groupCol.key, valueCol.key),
            valueCol,
            semanticProfiles.find((profile) => profile.key === valueCol.key),
          )
        : (Object.keys(aggregationLabels) as AggregationOp[]);
    const op: AggregationOp = relevantOps.includes(w.op ?? "sum")
      ? (w.op ?? "sum")
      : (relevantOps[0] ?? "sum");
    const dataMode: ChartDataMode = w.dataMode ?? (op === "count" ? "aggregate" : "raw");
    const grouped =
      groupCol && valueCol ? chartSeries(data, groupCol.key, valueCol.key, op, dataMode) : [];
    const sortedByTotal = [...grouped].sort((a, b) => b.total - a.total);
    // Painel estático (não depende de hover no mapa): o Leaflet roda num
    // efeito imperativo à parte, então ligar isso ao hover dos marcadores
    // exigiria cruzar a fronteira imperativa/declarativa sem necessidade —
    // sempre mostrar o local líder já dá o mesmo tipo de leitura guiada.
    const leadingLocation = sortedByTotal.length ? pieComparisonFor(sortedByTotal, 0) : null;
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
          <FilterChip groupKey={groupCol?.key} filters={filters} setFilters={setFilters} />
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
          <CalculationButton
            mode={dataMode}
            operation={op}
            operations={relevantOps}
            metric={op === "count" ? "os registros" : (valueCol?.label ?? "a métrica")}
            group={groupCol?.label}
            allowRaw
            onRaw={() => onConfigure({ dataMode: "raw" })}
            onOperation={(operation) => onConfigure({ dataMode: "aggregate", op: operation })}
          />
        </div>
        {sizeControls}
        {groupCol && valueCol && (
          <ChartReadingGuide
            group={groupCol.label}
            metric={op === "count" ? "Quantidade de linhas" : valueCol.label}
            mode={dataMode}
            operation={`${aggregationLabels[op]} por ${groupCol.label}`}
          />
        )}
        {!groupCol || !valueCol ? (
          <p className="p-6 text-center text-xs text-muted-foreground">
            Escolha uma coluna com nome de local (cidade, estado ou país) e uma coluna numérica para
            este widget.
          </p>
        ) : (
          <>
            <Suspense
              fallback={
                <div className="flex h-64 w-full items-center justify-center text-xs text-muted-foreground">
                  Carregando mapa…
                </div>
              }
            >
              <MapWidgetBody
                grouped={grouped}
                valueColumn={valueCol}
                onSelect={(name) => handleGroupClick(groupCol.key, name)}
              />
            </Suspense>
            {leadingLocation && (
              <SeriesComparisonPanel
                selected={leadingLocation.selected}
                comparison={leadingLocation}
                kind={valueCol.kind}
                filterLabel="Filtrar por este local"
                onFilter={() => handleGroupClick(groupCol.key, leadingLocation.selected.name)}
              />
            )}
          </>
        )}
      </article>
    );
  }

  if (w.type === "rating") {
    return (
      <RatingWidgetBody
        widget={w}
        data={data}
        columns={columns}
        numericCols={numericCols}
        onConfigure={onConfigure}
        dragProps={dragProps}
        animationDelay={animationDelay}
      />
    );
  }

  // table
  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span))}
      style={{ animationDelay: `${animationDelay}ms` }}
      data-detailed-table
    >
      <WidgetHead title={`Base detalhada · ${data.length} linhas`} {...dragProps} />
      {totalRows !== data.length && (
        <p className="border-b border-border bg-secondary-accent/8 px-4 py-2 text-[10px] text-muted-foreground">
          Mostrando {data.length.toLocaleString("pt-BR")} de {totalRows.toLocaleString("pt-BR")}{" "}
          linhas · {(totalRows - data.length).toLocaleString("pt-BR")} ocultas por busca ou filtros
          ativos.
        </p>
      )}
      <DataTable
        rows={data}
        columns={columns}
        sort={sort}
        setSort={setSort}
        interpolated={interpolated}
        focusedCell={focusedCell}
        onEditCell={onEditCell}
        sourceCellFills={sourceCellFills}
        colorGroupLabels={colorGroupLabels}
      />
    </article>
  );
}
