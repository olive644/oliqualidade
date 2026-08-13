import type { Row, Value } from "@/lib/types";

export type LongScheduleRow = {
  item: Value;
  indicator: string;
  period: string;
  value: Value;
  sourceRow: number;
  sourceColumn: string;
};

const PERIOD = /^(?:(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[-/ ]?\d{2,4}|\d{1,2}[-/]\d{2,4}|\d{4})$/i;

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
    })),
  );
}
