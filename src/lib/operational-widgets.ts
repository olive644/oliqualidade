import type { Column, Row, WidgetType } from "@/lib/types";
import { parseNumericValue } from "@/lib/format";

const EMPTY_VALUE = /^(?:-|–|—|n\/?a|não informado)$/i;

export function normalizeOperationalHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function columnByPattern(columns: Column[], pattern: RegExp): Column | undefined {
  return columns.find((column) =>
    pattern.test(normalizeOperationalHeader(`${column.key} ${column.label}`)),
  );
}

function hasValue(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return Boolean(text) && !EMPTY_VALUE.test(text);
}

export function detectOperationalWidgetTypes(columns: Column[]): WidgetType[] {
  const names = columns.map((column) =>
    normalizeOperationalHeader(`${column.key} ${column.label}`),
  );
  const has = (pattern: RegExp) => names.some((name) => pattern.test(name));
  const types: WidgetType[] = [];

  if (has(/\bnome\b/) && (has(/\bmatricula\b/) || has(/\bn(?:o|umero)?\b/))) {
    types.push("attendance-overview");
  }
  if (has(/\bhora\b/) && has(/\breferencia\b/) && has(/\baceita\b/) && has(/\brejeita\b/)) {
    types.push("validation-overview");
  }
  const measurementSeries =
    (has(/\bamostra\b/) && has(/\bresultado\b/)) ||
    (has(/\bestatistica\b/) && has(/\bamostra\b/) && has(/\bhora\b/));
  if (measurementSeries && columns.some((column) => column.kind === "number")) {
    types.push("control-chart");
  }
  if (has(/^programado\b/) && has(/^realizado\b/)) {
    types.push("plan-vs-actual");
  }
  return types;
}

export type AttendanceStats = {
  total: number;
  signed: number;
  missingSignatures: number;
  completion: number;
  bySector: Array<{ label: string; value: number }>;
  byShift: Array<{ label: string; value: number }>;
};

function frequency(rows: Row[], column?: Column): Array<{ label: string; value: number }> {
  if (!column) return [];
  const values = new Map<string, number>();
  for (const row of rows) {
    const label = hasValue(row[column.key]) ? String(row[column.key]).trim() : "Não informado";
    values.set(label, (values.get(label) ?? 0) + 1);
  }
  return [...values]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "pt-BR"));
}

export function buildAttendanceStats(columns: Column[], rows: Row[]): AttendanceStats {
  const name = columnByPattern(columns, /\bnome\b/);
  const signature = columnByPattern(columns, /\bassinatura\b/);
  const sector = columnByPattern(columns, /\bsetor\b|\barea\b/);
  const shift = columnByPattern(columns, /\bturno\b/);
  const relevant = name ? rows.filter((row) => hasValue(row[name.key])) : rows;
  const signed = signature ? relevant.filter((row) => hasValue(row[signature.key])).length : 0;
  return {
    total: relevant.length,
    signed,
    missingSignatures: signature ? relevant.length - signed : relevant.length,
    completion: relevant.length ? Math.round((signed / relevant.length) * 100) : 0,
    bySector: frequency(relevant, sector),
    byShift: frequency(relevant, shift),
  };
}

export type ValidationStats = {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  approvalRate: number;
  byInspector: Array<{ label: string; approved: number; rejected: number; pending: number }>;
};

function validationState(row: Row, result?: Column, accepted?: Column, rejected?: Column) {
  const text = normalizeOperationalHeader(String(result ? (row[result.key] ?? "") : ""));
  if (/nao conforme|reprov|rejeit|falha|fora/.test(text)) return "rejected" as const;
  if (/aprov|aceit|conforme|ok/.test(text)) return "approved" as const;
  const acceptedValue = accepted ? parseNumericValue(row[accepted.key]) : null;
  const rejectedValue = rejected ? parseNumericValue(row[rejected.key]) : null;
  if (acceptedValue !== null || rejectedValue !== null) {
    if ((rejectedValue || 0) > (acceptedValue || 0)) return "rejected" as const;
    if ((acceptedValue || 0) > 0) return "approved" as const;
  }
  return "pending" as const;
}

export function buildValidationStats(columns: Column[], rows: Row[]): ValidationStats {
  const result = columnByPattern(columns, /\bresultado\b/);
  const accepted = columnByPattern(columns, /\baceita\b/);
  const rejected = columnByPattern(columns, /\brejeita\b/);
  const inspector = columnByPattern(columns, /\binspetor\b/);
  const summary = new Map<string, { approved: number; rejected: number; pending: number }>();
  let approvedCount = 0;
  let rejectedCount = 0;
  let pendingCount = 0;
  for (const row of rows) {
    const state = validationState(row, result, accepted, rejected);
    if (state === "approved") approvedCount++;
    else if (state === "rejected") rejectedCount++;
    else pendingCount++;
    const label =
      inspector && hasValue(row[inspector.key])
        ? String(row[inspector.key]).trim()
        : "Não informado";
    const counts = summary.get(label) ?? { approved: 0, rejected: 0, pending: 0 };
    counts[state]++;
    summary.set(label, counts);
  }
  return {
    total: rows.length,
    approved: approvedCount,
    rejected: rejectedCount,
    pending: pendingCount,
    approvalRate: rows.length ? Math.round((approvedCount / rows.length) * 100) : 0,
    byInspector: [...summary]
      .map(([label, counts]) => ({ label, ...counts }))
      .sort(
        (a, b) =>
          b.rejected - a.rejected ||
          b.pending - a.pending ||
          a.label.localeCompare(b.label, "pt-BR"),
      ),
  };
}

export type ControlPoint = {
  label: string;
  value: number;
  mean: number;
  upper: number;
  lower: number;
};

export type ControlSeries = {
  metric?: Column;
  points: ControlPoint[];
  mean: number;
  upper: number;
  lower: number;
  outside: number;
};

export function buildControlSeries(columns: Column[], rows: Row[]): ControlSeries {
  const numeric = columns.filter((column) => column.kind === "number");
  const metric =
    numeric.find((column) =>
      /resultado|valor|peso|viscos|medida|diametro|altura|largura|comprimento|espessura/.test(
        normalizeOperationalHeader(`${column.key} ${column.label}`),
      ),
    ) ??
    numeric.find(
      (column) =>
        !/amostra|hora|numero|codigo|matricula|aviso/.test(
          normalizeOperationalHeader(`${column.key} ${column.label}`),
        ),
    );
  if (!metric) return { points: [], mean: 0, upper: 0, lower: 0, outside: 0 };
  const labelColumn = columnByPattern(columns, /\bdata\b|\bhora\b|\bamostra\b|\bidentificacao\b/);
  const raw = rows
    .flatMap((row, index) => {
      const value = parseNumericValue(row[metric.key]);
      if (value === null) return [];
      return [
        {
          label:
            labelColumn && hasValue(row[labelColumn.key])
              ? String(row[labelColumn.key])
              : String(index + 1),
          value,
        },
      ];
    })
    .slice(0, 400);
  if (!raw.length) return { metric, points: [], mean: 0, upper: 0, lower: 0, outside: 0 };
  const mean = raw.reduce((sum, point) => sum + point.value, 0) / raw.length;
  const variance = raw.reduce((sum, point) => sum + (point.value - mean) ** 2, 0) / raw.length;
  const deviation = Math.sqrt(variance);
  const upper = mean + deviation * 3;
  const lower = mean - deviation * 3;
  const points = raw.map((point) => ({ ...point, mean, upper, lower }));
  return {
    metric,
    points,
    mean,
    upper,
    lower,
    outside: points.filter((point) => point.value > upper || point.value < lower).length,
  };
}

export type PlanActualPoint = {
  period: string;
  planned: number;
  actual: number;
  delta: number;
  attainment: number | null;
};

function groupedPeriod(column: Column, group: "programado" | "realizado"): string | null {
  const label = column.label.trim();
  const match = label.match(new RegExp(`^${group}\\s*(?:—|–|-)\\s*(.+)$`, "i"));
  return match?.[1]?.trim() ?? null;
}

export function buildPlanVsActualSeries(columns: Column[], rows: Row[]): PlanActualPoint[] {
  const planned = new Map<string, Column>();
  const actual = new Map<string, Column>();
  for (const column of columns) {
    const plannedPeriod = groupedPeriod(column, "programado");
    const actualPeriod = groupedPeriod(column, "realizado");
    if (plannedPeriod) planned.set(normalizeOperationalHeader(plannedPeriod), column);
    if (actualPeriod) actual.set(normalizeOperationalHeader(actualPeriod), column);
  }
  return [...planned.entries()].flatMap(([key, plannedColumn]) => {
    const actualColumn = actual.get(key);
    if (!actualColumn) return [];
    const sum = (column: Column) =>
      rows.reduce((total, row) => {
        const value = parseNumericValue(row[column.key]);
        return value !== null ? total + value : total;
      }, 0);
    const plannedValue = sum(plannedColumn);
    const actualValue = sum(actualColumn);
    return [
      {
        period: groupedPeriod(plannedColumn, "programado") ?? plannedColumn.label,
        planned: plannedValue,
        actual: actualValue,
        delta: actualValue - plannedValue,
        attainment: plannedValue ? actualValue / plannedValue : null,
      },
    ];
  });
}
