import type { Row, Value } from "@/lib/types";

export type LongScheduleRow = {
  item: Value;
  indicator: string;
  period: string;
  value: Value;
  sourceRow: number;
  sourceColumn: string;
  /** Demais campos da linha, preservados para revisão e widgets ricos. */
  dimensions: Record<string, Value>;
};

export type ScheduleCriterion = {
  kind: "max" | "min" | "range" | "absence";
  min?: number;
  max?: number;
  inclusiveMin: boolean;
  inclusiveMax: boolean;
  label: string;
};

export type ScheduleEvaluation = "within" | "outside" | "not-evaluable";

const PERIOD =
  /^(?:(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[-/ ]?\d{2,4}|\d{1,2}[-/]\d{2,4}|\d{4})$/i;

/** Converte números de planilhas brasileiras sem confundir 0,46 com 46. */
export function parseScheduleNumber(value: Value | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/[-+]?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Interpreta limites comuns de cronogramas e laudos: Máx. 25, <1,1,
 * Até 5 uT, mínimo 0,80, faixas como 6,0 a 9,5 e "Ausência".
 */
export function parseScheduleCriterion(value: Value | undefined): ScheduleCriterion | null {
  if (value === null || value === undefined || value === "") return null;
  const label = String(value).trim();
  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\bausencia\b|\bausente\b/.test(normalized)) {
    return {
      kind: "absence",
      max: 0,
      inclusiveMin: true,
      inclusiveMax: true,
      label,
    };
  }
  const numbers = [...label.matchAll(/[-+]?\d+(?:[.,]\d+)?/g)]
    .map((match) => Number(match[0].replace(",", ".")))
    .filter(Number.isFinite);
  if (!numbers.length) return null;
  const hasRange =
    numbers.length >= 2 &&
    (/\b(?:a|ate|entre)\b/.test(normalized) || /\d\s*[-–—]\s*\d/.test(normalized));
  if (hasRange) {
    const [first = 0, second = 0] = numbers;
    return {
      kind: "range",
      min: Math.min(first, second),
      max: Math.max(first, second),
      inclusiveMin: !/>/.test(label),
      inclusiveMax: !/</.test(label),
      label,
    };
  }
  const limit = numbers[0]!;
  if (/\b(?:min|minimo|maior)\b/.test(normalized) || />/.test(label)) {
    return {
      kind: "min",
      min: limit,
      inclusiveMin: !/>\s*\d/.test(label),
      inclusiveMax: true,
      label,
    };
  }
  return {
    kind: "max",
    max: limit,
    inclusiveMin: true,
    inclusiveMax: !/<\s*\d/.test(label),
    label,
  };
}

export function evaluateScheduleValue(
  value: Value | undefined,
  criterion: ScheduleCriterion | null,
): ScheduleEvaluation {
  if (!criterion) return "not-evaluable";
  const numeric = parseScheduleNumber(value);
  if (numeric === null) return "not-evaluable";
  const aboveMin =
    criterion.min === undefined ||
    (criterion.inclusiveMin ? numeric >= criterion.min : numeric > criterion.min);
  const belowMax =
    criterion.max === undefined ||
    (criterion.inclusiveMax ? numeric <= criterion.max : numeric < criterion.max);
  return aboveMin && belowMax ? "within" : "outside";
}

export function scheduleToLong(rows: Row[]): LongScheduleRow[] {
  const keys = Object.keys(rows[0] ?? {});
  const periods = keys.filter((key) => PERIOD.test(key.trim()));
  if (periods.length < 2) return [];
  const dimensions = keys.filter((key) => !periods.includes(key));
  const itemKey =
    dimensions.find((key) => /ponto|item|local|an[aá]lise|processo|descri[cç][aã]o/i.test(key)) ??
    dimensions[0];
  if (!itemKey) return [];
  const indicatorKey = dimensions.find((key) => key !== itemKey) ?? itemKey;
  return rows.flatMap((row, rowIndex) =>
    periods.map((period) => ({
      item: row[itemKey] ?? null,
      indicator: String(row[indicatorKey] ?? indicatorKey),
      period,
      value: row[period] ?? null,
      sourceRow: rowIndex + 2,
      sourceColumn: period,
      dimensions: Object.fromEntries(dimensions.map((key) => [key, row[key] ?? null])),
    })),
  );
}
