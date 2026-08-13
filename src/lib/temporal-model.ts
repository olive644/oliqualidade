import type * as XLSX from "xlsx";

export type TemporalGranularity =
  | "year"
  | "quarter"
  | "month"
  | "day"
  | "datetime"
  | "time"
  | "duration";

export type TemporalCellModel = {
  address: string;
  granularity: TemporalGranularity;
  rawValue: string | number | null;
  displayValue: string;
  normalizedValue: string;
  sourceFormat: string;
  year?: number;
  month?: number;
  day?: number;
  timeZoneIndependent: boolean;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  fev: 2,
  feb: 2,
  mar: 3,
  abr: 4,
  apr: 4,
  mai: 5,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  aug: 8,
  set: 9,
  sep: 9,
  out: 10,
  oct: 10,
  nov: 11,
  dez: 12,
  dec: 12,
};

function cleanFormat(format: string): string {
  return format
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, "");
}

export function temporalGranularity(format: string): TemporalGranularity | null {
  const value = cleanFormat(format);
  if (/\[(?:h+|m+|s+)\]/i.test(value)) return "duration";
  const hasYear = /y/i.test(value);
  const hasMonth = /m/i.test(value);
  const hasDay = /d/i.test(value);
  const hasTime = /h|s|am\/pm|a\/p/i.test(value);
  if (hasTime && !hasYear && !hasDay) return "time";
  if (hasTime && (hasYear || hasDay)) return "datetime";
  if (hasYear && hasMonth && !hasDay) return "month";
  if (hasYear && !hasMonth && !hasDay) return "year";
  if (hasYear || hasDay) return "day";
  return null;
}

function displayParts(display: string) {
  const normalized = display.trim().toLowerCase().replaceAll(".", "");
  const namedMonth = /^(jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)[-\s/](\d{2,4})$/i.exec(
    normalized,
  );
  if (namedMonth) {
    const shortYear = Number(namedMonth[2]);
    return {
      year: shortYear < 100 ? 2000 + shortYear : shortYear,
      month: MONTHS[namedMonth[1]!]!,
    };
  }
  const numericMonth = /^(\d{1,2})[-/](\d{2,4})$/.exec(normalized);
  if (numericMonth) {
    const shortYear = Number(numericMonth[2]);
    return {
      year: shortYear < 100 ? 2000 + shortYear : shortYear,
      month: Number(numericMonth[1]),
    };
  }
  const fullDate = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(normalized);
  if (fullDate) {
    const shortYear = Number(fullDate[3]);
    return {
      year: shortYear < 100 ? 2000 + shortYear : shortYear,
      month: Number(fullDate[2]),
      day: Number(fullDate[1]),
    };
  }
  return {};
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function buildTemporalCellModel(
  address: string,
  cell: XLSX.CellObject,
): TemporalCellModel | null {
  const sourceFormat = String(cell.z ?? "");
  const granularity = temporalGranularity(sourceFormat);
  if (!granularity) return null;
  const displayValue = String(cell.w ?? cell.v ?? "");
  const fromDisplay = displayParts(displayValue);
  const date = cell.v instanceof Date && Number.isFinite(cell.v.getTime()) ? cell.v : null;
  const year = fromDisplay.year ?? date?.getUTCFullYear();
  const month = fromDisplay.month ?? (date ? date.getUTCMonth() + 1 : undefined);
  const day = fromDisplay.day ?? date?.getUTCDate();
  let normalizedValue = displayValue;
  if (granularity === "year" && year) normalizedValue = String(year);
  if (granularity === "month" && year && month) normalizedValue = `${year}-${pad(month)}`;
  if ((granularity === "day" || granularity === "datetime") && year && month && day)
    normalizedValue = `${year}-${pad(month)}-${pad(day)}`;
  return {
    address,
    granularity,
    rawValue:
      cell.v instanceof Date
        ? cell.v.toISOString()
        : typeof cell.v === "number" || typeof cell.v === "string"
          ? cell.v
          : null,
    displayValue,
    normalizedValue,
    sourceFormat,
    ...(year ? { year } : {}),
    ...(month ? { month } : {}),
    ...(day ? { day } : {}),
    timeZoneIndependent: granularity === "year" || granularity === "month",
  };
}
