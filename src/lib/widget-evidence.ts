import {
  aggregationLabels,
  relevantAggregationOps,
  semanticAggregationOps,
  type AggregationOp,
} from "@/lib/data-pipeline";
import { sourceRowIndexOf } from "@/lib/data-review";
import { parseNumericValue } from "@/lib/format";
import type { SourceCellProvenance } from "@/lib/cell-provenance";
import type { ColumnSemanticProfile } from "@/lib/spreadsheet-intelligence";
import { numericKinds, type Column, type Row, type Widget, type WidgetType } from "@/lib/types";

export type WidgetEvidence = {
  source: string;
  operation: string;
  validRecords: number;
  visibleRecords: number;
  activeFilters: number;
  unit: string;
  formula: string;
  confidence: number | null;
};

const ANALYTICAL_WIDGETS = new Set<WidgetType>([
  "metric",
  "metric-trend",
  "bar",
  "pie",
  "line",
  "area",
  "ranking",
  "radar",
  "histogram",
  "box-plot",
  "scatter",
  "pareto",
  "rating",
  "map",
  "pivot-table",
  "matrix-heatmap",
]);

function coordinates(address: string) {
  const match = address.replaceAll("$", "").match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1]!.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  return { column, row: Number(match[2]) };
}

function columnLabel(index: number) {
  let current = index;
  let label = "";
  while (current > 0) {
    current -= 1;
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26);
  }
  return label;
}

function sourceRange(
  provenance: SourceCellProvenance[],
  columnKeys: string[],
  rows: Row[],
): string | null {
  const keys = new Set(columnKeys);
  const visibleRows = new Set(
    rows.map(sourceRowIndexOf).filter((row): row is number => row !== null),
  );
  const cells = provenance.filter(
    (cell) => keys.has(cell.columnKey) && (!visibleRows.size || visibleRows.has(cell.rowIndex)),
  );
  const positions = cells
    .map((cell) => coordinates(cell.sourceAddress))
    .filter((cell): cell is NonNullable<ReturnType<typeof coordinates>> => cell !== null);
  if (!positions.length) return null;
  const minColumn = Math.min(...positions.map((cell) => cell.column));
  const maxColumn = Math.max(...positions.map((cell) => cell.column));
  const minRow = Math.min(...positions.map((cell) => cell.row));
  const maxRow = Math.max(...positions.map((cell) => cell.row));
  const start = `${columnLabel(minColumn)}${minRow}`;
  const end = `${columnLabel(maxColumn)}${maxRow}`;
  return start === end ? start : `${start}:${end}`;
}

function inferredUnit(column: Column | undefined, profile: ColumnSemanticProfile | undefined) {
  if (profile?.unit) return profile.unit;
  if (column?.kind === "percentage") return "%";
  if (column?.kind === "currency") return "moeda";
  return "sem unidade declarada";
}

function operationAndFormula({
  widget,
  metric,
  secondMetric,
  group,
}: {
  widget: Widget;
  metric: Column | undefined;
  secondMetric: Column | undefined;
  group: Column | undefined;
}) {
  if (widget.type === "scatter")
    return {
      operation: "Correlação",
      formula: `${secondMetric?.label ?? "Y"} em função de ${metric?.label ?? "X"}`,
    };
  if (widget.type === "histogram")
    return {
      operation: "Distribuição",
      formula: `FREQUÊNCIA(${metric?.label ?? "valor"})`,
    };
  if (widget.type === "box-plot")
    return {
      operation: "Distribuição por quartis",
      formula: `QUARTIS(${metric?.label ?? "valor"}) por ${group?.label ?? "grupo"}`,
    };
  if (widget.type === "rating")
    return {
      operation: "Média",
      formula: `MÉDIA(${metric?.label ?? "avaliação"})`,
    };

  const operation = (widget.op ?? (metric ? "sum" : "count")) as AggregationOp;
  const defaultsToRaw = ["bar", "pie", "line", "area", "ranking"].includes(widget.type);
  if (
    (widget.dataMode === "raw" || (widget.dataMode === undefined && defaultsToRaw)) &&
    operation !== "count"
  )
    return {
      operation: "Sem agregação",
      formula: `${metric?.label ?? "valor"} original por ${group?.label ?? "linha"}`,
    };
  const label = aggregationLabels[operation] ?? "Cálculo";
  return {
    operation: label,
    formula:
      operation === "count"
        ? `CONTAGEM(registros)${group ? ` por ${group.label}` : ""}`
        : `${label.toUpperCase()}(${metric?.label ?? "valor"})${group ? ` por ${group.label}` : ""}`,
  };
}

function resolvedAggregationOp(
  widget: Widget,
  data: Row[],
  metric: Column,
  group: Column | undefined,
  profile: ColumnSemanticProfile | undefined,
): AggregationOp {
  const requested = (widget.op ?? "sum") as AggregationOp;
  const base =
    group &&
    ["bar", "pie", "line", "area", "ranking", "radar", "pareto", "map"].includes(widget.type)
      ? relevantAggregationOps(data, group.key, metric.key)
      : (["sum", "avg", "count", "min", "max"] as AggregationOp[]);
  const operations = semanticAggregationOps(base, metric, profile);
  return operations.includes(requested) ? requested : (operations[0] ?? "count");
}

export function buildWidgetEvidence({
  widget,
  data,
  columns,
  semanticProfiles,
  sourceSheetName,
  sourceCellProvenance,
  activeFilterCount,
}: {
  widget: Widget;
  data: Row[];
  columns: Column[];
  semanticProfiles: ColumnSemanticProfile[];
  sourceSheetName: string;
  sourceCellProvenance: SourceCellProvenance[];
  activeFilterCount: number;
}): WidgetEvidence | null {
  if (!ANALYTICAL_WIDGETS.has(widget.type)) return null;
  const numericColumns = columns.filter((column) => numericKinds.includes(column.kind));
  const groupableColumns = columns.filter((column) => !numericKinds.includes(column.kind));
  const requiresGroup = [
    "bar",
    "pie",
    "line",
    "area",
    "ranking",
    "radar",
    "box-plot",
    "pareto",
    "map",
    "pivot-table",
    "matrix-heatmap",
  ].includes(widget.type);
  const configuredGroup = columns.find((column) => column.key === widget.groupKey);
  const group =
    widget.type === "metric-trend"
      ? (columns.find((column) => column.key === widget.groupKey && column.kind === "date") ??
        columns.find((column) => column.kind === "date"))
      : ["pivot-table", "matrix-heatmap"].includes(widget.type)
        ? (configuredGroup ?? groupableColumns[0])
        : widget.type === "line"
          ? columns.find((column) => column.key === widget.groupKey && column.kind === "date")
          : configuredGroup;
  if (requiresGroup && !group) return null;
  if (
    ["pivot-table", "matrix-heatmap"].includes(widget.type) &&
    !groupableColumns.some((column) => column.key !== group?.key)
  )
    return null;

  const configuredMetricKey =
    widget.type === "metric" || widget.type === "metric-trend" || widget.type === "rating"
      ? widget.metricKey
      : widget.valueKey;
  const configuredMetric = columns.find((column) => column.key === configuredMetricKey);
  const countMode =
    widget.op === "count" ||
    (["pivot-table", "matrix-heatmap"].includes(widget.type) && !numericColumns.length);
  const metric =
    configuredMetric && (countMode || numericKinds.includes(configuredMetric.kind))
      ? configuredMetric
      : countMode
        ? columns[0]
        : numericColumns[0];
  const secondMetric =
    widget.type === "scatter"
      ? (columns.find((column) => column.key === widget.valueKey2) ??
        numericColumns.find((column) => column.key !== metric?.key))
      : undefined;
  if (!metric || (widget.type === "scatter" && !secondMetric)) return null;

  const metricProfile = semanticProfiles.find((profile) => profile.key === metric.key);
  const effectiveOperation = resolvedAggregationOp(widget, data, metric, group, metricProfile);
  const effectiveCountMode = effectiveOperation === "count";
  const relevantColumns = [metric, secondMetric, group].filter(
    (column): column is Column => column !== undefined,
  );
  const validRecords = data.filter((row) => {
    if (group && (row[group.key] === null || row[group.key] === "")) return false;
    if (effectiveCountMode) return true;
    if (parseNumericValue(row[metric.key]) === null) return false;
    if (secondMetric && parseNumericValue(row[secondMetric.key]) === null) return false;
    return true;
  }).length;
  const profiles = [metric, secondMetric]
    .filter((column): column is Column => column !== undefined)
    .map((column) => semanticProfiles.find((profile) => profile.key === column.key))
    .filter((profile): profile is ColumnSemanticProfile => profile !== undefined);
  const confidence = profiles.length
    ? Math.round(Math.min(...profiles.map((profile) => profile.confidence)) * 100)
    : null;
  const range = sourceRange(
    sourceCellProvenance,
    relevantColumns.map((column) => column.key),
    data,
  );
  const calculation = operationAndFormula({
    widget: { ...widget, op: effectiveOperation },
    metric,
    secondMetric,
    group,
  });

  return {
    source: range ? `${sourceSheetName}!${range}` : sourceSheetName,
    operation: calculation.operation,
    validRecords,
    visibleRecords: data.length,
    activeFilters: Math.max(0, activeFilterCount),
    unit: inferredUnit(metric, metricProfile),
    formula: metric.formula
      ? `${calculation.formula}; coluna calculada: ${metric.formula}`
      : calculation.formula,
    confidence,
  };
}
