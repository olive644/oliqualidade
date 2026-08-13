import type { Row } from "@/lib/types";

export type StructuralRegionType =
  | "flat-table"
  | "form"
  | "matrix"
  | "schedule"
  | "repeated-blocks"
  | "summary"
  | "notes"
  | "visual-only";

export type StructuralClassification = {
  type: StructuralRegionType;
  confidence: number;
  reasons: string[];
};

const PERIOD = /^(?:(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[-/ ]?\d{2,4}|\d{1,2}[-/]\d{2,4}|\d{4})$/i;
const SUMMARY = /^(?:total|m[eé]dia|resumo|indicador|resultado|meta|acumulado)/i;
const NOTES = /^(?:observa[cç][aã]o|nota|fonte|legenda|instru[cç][aã]o|revis[aã]o)/i;

export function classifyRows(rows: Row[], tableMode?: "single" | "repeated-blocks"): StructuralClassification {
  if (tableMode === "repeated-blocks")
    return { type: "repeated-blocks", confidence: 0.98, reasons: ["blocos de cabeçalho repetidos"] };
  const keys = Object.keys(rows[0] ?? {});
  if (!keys.length || !rows.length)
    return { type: "visual-only", confidence: 0.8, reasons: ["sem grade tabular recuperável"] };
  const periodKeys = keys.filter((key) => PERIOD.test(key.trim()));
  if (periodKeys.length >= 3)
    return {
      type: "schedule",
      confidence: Math.min(0.99, 0.8 + periodKeys.length * 0.02),
      reasons: [`${periodKeys.length} colunas de período`, "itens distribuídos por período"],
    };
  const numericHeaders = keys.filter((key) => Number.isFinite(Number(key))).length;
  if (keys.length >= 4 && numericHeaders / keys.length >= 0.4)
    return { type: "matrix", confidence: 0.82, reasons: ["eixos em linhas e colunas"] };
  const firstValues = rows.slice(0, 20).map((row) => String(row[keys[0]!] ?? ""));
  if (keys.length <= 3 && new Set(firstValues.filter(Boolean)).size >= Math.min(4, rows.length))
    return { type: "form", confidence: 0.72, reasons: ["pares de rótulo e valor"] };
  const joined = `${keys.join(" ")} ${firstValues.join(" ")}`;
  if (NOTES.test(joined)) return { type: "notes", confidence: 0.75, reasons: ["conteúdo textual institucional"] };
  if (SUMMARY.test(joined) && rows.length <= 12)
    return { type: "summary", confidence: 0.76, reasons: ["poucas linhas de indicadores agregados"] };
  return { type: "flat-table", confidence: 0.9, reasons: ["cabeçalho único e registros homogêneos"] };
}
