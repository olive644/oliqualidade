import {
  aggregate,
  aggregationLabels,
  groupAndAggregate,
  relevantAggregationOps,
  sortAllBarCategories,
  type AggregationOp,
} from "@/lib/data-pipeline";
import { fmt, sortChronologically } from "@/lib/format";
import type { FolderMonitorView } from "@/lib/folder-monitor";
import type { Column, FilterRule, Row, Widget, WidgetType } from "@/lib/types";
import { numericKinds, widgetTypeLabels } from "@/lib/types";

export type LiveSeriesItem = {
  label: string;
  value: number;
  formatted: string;
  groupedCategories?: number;
};

export type LiveWidgetSnapshot = {
  id: string;
  type: WidgetType;
  title: string;
  status: "ready" | "empty";
  metric?: { key: string; label: string; kind: string };
  groupBy?: { key: string; label: string; kind: string };
  operation?: { key: AggregationOp; label: string };
  displayedValue?: { value: number; formatted: string };
  trend?: {
    firstPeriod: { label: string; value: number; formatted: string };
    lastPeriod: { label: string; value: number; formatted: string };
    change: number | null;
    formattedChange: string;
    meaning: string;
  };
  previousVersion?: {
    change: number | null;
    formattedChange: string;
    meaning: string;
  };
  series?: {
    items: LiveSeriesItem[];
    totalItems: number;
    truncated: boolean;
  };
  scaleMax?: number;
  rowCount?: number;
};

export type LiveDashboardContext = {
  capturedAt: string;
  source: "current-filtered-view";
  dashboard: string;
  sheet: string;
  totalRows: number;
  visibleRows: number;
  search: string;
  filters: Array<{
    columnKey: string;
    columnLabel: string;
    kind: string;
    value: string;
    min?: string;
    max?: string;
  }>;
  sort: { columnKey: string; columnLabel: string; direction: "asc" | "desc" } | null;
  widgets: LiveWidgetSnapshot[];
};

type BuildLiveDashboardContextInput = {
  dashboardName: string;
  sheetName: string;
  columns: Column[];
  rows: Row[];
  totalRows: number;
  widgets: Widget[];
  filters: FilterRule[];
  search: string;
  sort: { key: string; dir: "asc" | "desc" } | null;
  versionDelta?: ReadonlyMap<string, number | null> | null;
  folderMonitor?: FolderMonitorView;
  now?: Date;
};

const MAX_SERIES_ITEMS = 100;

function percent(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function seriesSnapshot(
  items: Array<{ name: string; total: number; count?: number }>,
  kind: Column["kind"],
) {
  return {
    items: items.slice(0, MAX_SERIES_ITEMS).map((item) => ({
      label: item.name,
      value: item.total,
      formatted: fmt(item.total, kind) ?? String(item.total),
      ...(item.count === undefined ? {} : { groupedCategories: item.count }),
    })),
    totalItems: items.length,
    truncated: items.length > MAX_SERIES_ITEMS,
  };
}

function resolvedValueColumn(widget: Widget, columns: Column[], numericColumns: Column[]) {
  const requested = widget.op ?? "sum";
  const configured = columns.find((column) => column.key === widget.valueKey);
  return (
    (configured && (requested === "count" || numericKinds.includes(configured.kind))
      ? configured
      : undefined) ?? (requested === "count" ? columns[0] : numericColumns[0])
  );
}

function resolvedOperation(widget: Widget, rows: Row[], group: Column, value: Column) {
  const operations = relevantAggregationOps(rows, group.key, value.key);
  const requested = widget.op ?? "sum";
  return operations.includes(requested) ? requested : (operations[0] ?? "sum");
}

function emptyWidget(widget: Widget, title = widgetTypeLabels[widget.type]): LiveWidgetSnapshot {
  return { id: widget.id, type: widget.type, title, status: "empty" };
}

function metricWidget(
  widget: Widget,
  columns: Column[],
  rows: Row[],
  versionDelta?: ReadonlyMap<string, number | null> | null,
): LiveWidgetSnapshot {
  const numericColumns = columns.filter((column) => numericKinds.includes(column.kind));
  const column =
    columns.find(
      (candidate) => candidate.key === widget.metricKey && numericKinds.includes(candidate.kind),
    ) ?? numericColumns[0];
  if (!column) return emptyWidget(widget, "Métrica");
  const metricOperations: AggregationOp[] = ["sum", "avg", "count", "min", "max"];
  const operation = metricOperations.includes(widget.op ?? "sum") ? (widget.op ?? "sum") : "sum";
  const value = aggregate(
    rows.map((row) => Number(row[column.key])).filter((number) => Number.isFinite(number)),
    operation,
  );
  const snapshot: LiveWidgetSnapshot = {
    id: widget.id,
    type: widget.type,
    title: column.label,
    status: "ready",
    metric: { key: column.key, label: column.label, kind: column.kind },
    operation: { key: operation, label: aggregationLabels[operation] },
    displayedValue: { value, formatted: fmt(value, column.kind) ?? String(value) },
  };

  if (versionDelta?.has(column.key)) {
    const change = versionDelta.get(column.key) ?? null;
    snapshot.previousVersion = {
      change,
      formattedChange: change === null ? "sem base para comparar" : percent(change),
      meaning: "Comparação do total atual com a versão anterior importada da planilha.",
    };
  }

  if (widget.type !== "metric-trend") return snapshot;
  const dateColumn =
    columns.find((candidate) => candidate.key === widget.groupKey && candidate.kind === "date") ??
    columns.find((candidate) => candidate.kind === "date");
  if (!dateColumn) return snapshot;
  const trend = sortChronologically(groupAndAggregate(rows, dateColumn.key, column.key, operation));
  snapshot.groupBy = { key: dateColumn.key, label: dateColumn.label, kind: dateColumn.kind };
  snapshot.series = seriesSnapshot(trend, column.kind);
  const first = trend[0];
  const last = trend.at(-1);
  if (!first || !last) return snapshot;
  const change = first.total === 0 ? null : (last.total - first.total) / Math.abs(first.total);
  snapshot.trend = {
    firstPeriod: {
      label: first.name,
      value: first.total,
      formatted: fmt(first.total, column.kind) ?? String(first.total),
    },
    lastPeriod: {
      label: last.name,
      value: last.total,
      formatted: fmt(last.total, column.kind) ?? String(last.total),
    },
    change,
    formattedChange: change === null ? `${trend.length} períodos` : percent(change),
    meaning:
      "Variação exibida no rodapé do sparkline: (último período - primeiro período) / valor absoluto do primeiro período.",
  };
  return snapshot;
}

function groupedWidget(widget: Widget, columns: Column[], rows: Row[]): LiveWidgetSnapshot {
  const numericColumns = columns.filter((column) => numericKinds.includes(column.kind));
  const group = columns.find((column) => column.key === widget.groupKey);
  const value = resolvedValueColumn(widget, columns, numericColumns);
  if (!group || !value) return emptyWidget(widget);
  const operation = resolvedOperation(widget, rows, group, value);
  let grouped: Array<{ name: string; total: number; count?: number }> = groupAndAggregate(
    rows,
    group.key,
    value.key,
    operation,
  );
  if (widget.type === "line" || (widget.type === "area" && group.kind === "date"))
    grouped = sortChronologically(grouped);
  if (widget.type === "bar") grouped = sortAllBarCategories(grouped);
  if (widget.type === "ranking")
    grouped = [...grouped].sort((a, b) => b.total - a.total).slice(0, widget.topN ?? 5);
  if (widget.type === "pie" && grouped.length > 6) {
    const sorted = [...grouped].sort((a, b) => b.total - a.total);
    const rest = sorted.slice(5);
    const restTotal = rest.reduce((sum, item) => sum + item.total, 0);
    grouped = restTotal
      ? [...sorted.slice(0, 5), { name: "Outros", total: restTotal, count: rest.length }]
      : sorted.slice(0, 5);
  }
  const title =
    widget.type === "ranking"
      ? operation === "count"
        ? `Top ${widget.topN ?? 5} · Registros por ${group.label}`
        : `Top ${widget.topN ?? 5} · ${aggregationLabels[operation]} de ${value.label} por ${group.label}`
      : operation === "count"
        ? `Contagem de registros por ${group.label}`
        : widget.type === "line"
          ? `Evolução de ${value.label}`
          : widget.type === "area"
            ? `Evolução de ${value.label} (área)`
            : widget.type === "pie"
              ? "Distribuição"
              : `${aggregationLabels[operation]} de ${value.label} por ${group.label}`;
  return {
    id: widget.id,
    type: widget.type,
    title,
    status: grouped.length ? "ready" : "empty",
    metric: { key: value.key, label: value.label, kind: value.kind },
    groupBy: { key: group.key, label: group.label, kind: group.kind },
    operation: { key: operation, label: aggregationLabels[operation] },
    series: seriesSnapshot(grouped, operation === "count" ? "number" : value.kind),
  };
}

function snapshotWidget(
  widget: Widget,
  columns: Column[],
  rows: Row[],
  versionDelta?: ReadonlyMap<string, number | null> | null,
  folderMonitor?: FolderMonitorView,
): LiveWidgetSnapshot {
  if (widget.type === "metric" || widget.type === "metric-trend")
    return metricWidget(widget, columns, rows, versionDelta);
  if (["bar", "pie", "line", "area", "ranking", "map"].includes(widget.type))
    return groupedWidget(widget, columns, rows);
  if (widget.type === "rating") {
    const numericColumns = columns.filter((column) => numericKinds.includes(column.kind));
    const column =
      columns.find(
        (candidate) => candidate.key === widget.metricKey && numericKinds.includes(candidate.kind),
      ) ?? numericColumns[0];
    if (!column) return emptyWidget(widget, "Avaliação");
    const values = rows.map((row) => Number(row[column.key])).filter(Number.isFinite);
    const value = values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0;
    return {
      id: widget.id,
      type: widget.type,
      title: column.label,
      status: values.length ? "ready" : "empty",
      metric: { key: column.key, label: column.label, kind: column.kind },
      operation: { key: "avg", label: aggregationLabels.avg },
      displayedValue: { value, formatted: value.toFixed(1) },
      scaleMax: widget.scaleMax ?? 5,
    };
  }
  if (widget.type === "folder-files") {
    const files = folderMonitor?.fileNames?.length
      ? folderMonitor.fileNames
      : folderMonitor?.fileName
        ? [folderMonitor.fileName]
        : [];
    const formats = new Map<string, number>();
    for (const file of files) {
      const extension = file.split(".").pop()?.toUpperCase() ?? "OUTRO";
      formats.set(extension, (formats.get(extension) ?? 0) + 1);
    }
    return {
      id: widget.id,
      type: widget.type,
      title: "Planilhas monitoradas",
      status: folderMonitor ? "ready" : "empty",
      displayedValue: { value: files.length, formatted: String(files.length) },
      series: seriesSnapshot(
        [...formats].map(([name, total]) => ({ name, total })),
        "number",
      ),
    };
  }
  if (widget.type === "schedule-heatmap") {
    const group = columns.find((candidate) => candidate.key === widget.groupKey);
    const periods = (widget.periodKeys ?? [])
      .map((key) => columns.find((candidate) => candidate.key === key))
      .filter((column): column is Column => Boolean(column));
    if (!group || !periods.length) return emptyWidget(widget, "Cronograma visual");
    const filled = rows.reduce(
      (total, row) =>
        total +
        periods.filter((period) => row[period.key] !== null && row[period.key] !== "").length,
      0,
    );
    return {
      id: widget.id,
      type: widget.type,
      title: widget.title ?? "Cronograma visual",
      status: "ready",
      groupBy: { key: group.key, label: group.label, kind: group.kind },
      rowCount: rows.length,
      displayedValue: { value: filled, formatted: `${filled.toLocaleString("pt-BR")} marcações` },
    };
  }
  return {
    id: widget.id,
    type: widget.type,
    title: `Base detalhada · ${rows.length} linhas`,
    status: "ready",
    rowCount: rows.length,
  };
}

export function buildLiveDashboardContext(
  input: BuildLiveDashboardContextInput,
): LiveDashboardContext {
  const columnByKey = new Map(input.columns.map((column) => [column.key, column]));
  return {
    capturedAt: (input.now ?? new Date()).toISOString(),
    source: "current-filtered-view",
    dashboard: input.dashboardName,
    sheet: input.sheetName,
    totalRows: input.totalRows,
    visibleRows: input.rows.length,
    search: input.search,
    filters: input.filters.map((filter) => {
      const column = columnByKey.get(filter.key);
      return {
        columnKey: filter.key,
        columnLabel: column?.label ?? filter.key,
        kind: column?.kind ?? "text",
        value: filter.value,
        ...(filter.min === undefined ? {} : { min: filter.min }),
        ...(filter.max === undefined ? {} : { max: filter.max }),
      };
    }),
    sort: input.sort
      ? {
          columnKey: input.sort.key,
          columnLabel: columnByKey.get(input.sort.key)?.label ?? input.sort.key,
          direction: input.sort.dir,
        }
      : null,
    widgets: input.widgets.map((widget) =>
      snapshotWidget(widget, input.columns, input.rows, input.versionDelta, input.folderMonitor),
    ),
  };
}

/** Sugestões curtas que sempre nascem dos dados e widgets visíveis agora. */
export function buildLiveSuggestedPrompts(context: LiveDashboardContext): string[] {
  const prompts: string[] = [];
  const visibleRowLabel = `${context.visibleRows.toLocaleString("pt-BR")} ${
    context.visibleRows === 1 ? "registro" : "registros"
  }`;
  const add = (prompt: string | undefined) => {
    if (prompt && !prompts.includes(prompt) && prompts.length < 4) prompts.push(prompt);
  };
  const readyWidgets = context.widgets.filter((widget) => widget.status === "ready");
  const trend = readyWidgets.find((widget) => widget.trend)?.trend;
  const trendWidget = readyWidgets.find((widget) => widget.trend);
  if (trend && trendWidget)
    add(
      `Explique a variação de ${trend.formattedChange} em ${trendWidget.title}, de ${trend.firstPeriod.label} até ${trend.lastPeriod.label}.`,
    );

  const ranking = readyWidgets.find(
    (widget) => widget.type === "ranking" && (widget.series?.items.length ?? 0) > 1,
  );
  if (ranking) add(`Quem lidera ${ranking.title} e qual é a diferença para o segundo colocado?`);

  const metric = readyWidgets.find(
    (widget) => widget.displayedValue && widget.type !== "folder-files" && !widget.trend,
  );
  if (metric?.displayedValue)
    add(
      `O que o valor ${metric.displayedValue.formatted} de ${metric.title} representa nesta visão?`,
    );

  const chart = readyWidgets.find(
    (widget) =>
      ["bar", "pie", "line", "area", "map"].includes(widget.type) &&
      (widget.series?.items.length ?? 0) > 0,
  );
  if (chart) add(`Quais são os principais destaques de ${chart.title}?`);

  if (context.filters.length || context.search)
    add(`Resuma ${visibleRowLabel} desta visão filtrada.`);
  else add(`Resuma os principais resultados de ${visibleRowLabel} visíveis.`);

  add("Há valores atípicos ou sinais de qualidade que merecem atenção?");
  return prompts;
}
