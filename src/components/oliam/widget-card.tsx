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
import { ChartWidgetBody } from "./chart-widget-body";
import { ExceptionPanelWidgetBody } from "./exception-panel-widget-body";
import { InsightsWidgetBody } from "./insights-widget-body";
import { PivotWidgetBody } from "./pivot-widget-body";
import { RadarWidgetBody } from "./radar-widget-body";
import { RankingWidgetBody } from "./ranking-widget-body";
import { MetricWidgetBody } from "./metric-widget-body";
import { RatingWidgetBody } from "./rating-widget-body";
import { ScheduleHeatmapWidgetBody } from "./schedule-heatmap-widget-body";
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
  // filtro. Usado pelo branch de mapa aqui; os demais tipos que também têm
  // clique-para-filtrar (barra/pizza/linha/área, ranking, insights) já têm
  // sua própria cópia equivalente nos arquivos extraídos.
  const handleGroupClick = (groupKey: string, value: string) => {
    setFilters(toggleClickFilter(filters, groupKey, value));
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
      className="oliam-widget-config-bar flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
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
    return (
      <ExceptionPanelWidgetBody
        widget={w}
        columns={columns}
        exceptions={exceptions}
        exceptionDecisions={exceptionDecisions}
        auditTrail={auditTrail}
        onExceptionDecision={onExceptionDecision}
        onCorrectException={onCorrectException}
        onTraceException={onTraceException}
        dragProps={dragProps}
        sizeControls={sizeControls}
        animationDelay={animationDelay}
      />
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
    return (
      <MetricWidgetBody
        widget={w}
        data={data}
        columns={columns}
        numericCols={numericCols}
        semanticProfiles={semanticProfiles}
        versionDelta={versionDelta}
        onConfigure={onConfigure}
        dragProps={dragProps}
        animationDelay={animationDelay}
      />
    );
  }

  if (w.type === "schedule-heatmap") {
    return (
      <ScheduleHeatmapWidgetBody
        widget={w}
        data={data}
        columns={columns}
        filters={filters}
        setFilters={setFilters}
        onConfigure={onConfigure}
        dragProps={dragProps}
        sizeControls={sizeControls}
        animationDelay={animationDelay}
      />
    );
  }

  if (w.type === "bar" || w.type === "pie" || w.type === "line" || w.type === "area") {
    return (
      <ChartWidgetBody
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

  if (w.type === "radar") {
    return (
      <RadarWidgetBody
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
          className="oliam-widget-config-bar flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
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
