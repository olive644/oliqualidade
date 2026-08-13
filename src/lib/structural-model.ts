import type { Row } from "@/lib/types";

export type StructuralRegionType =
  | "flat-table"
  | "form"
  | "matrix"
  | "schedule"
  | "repeated-blocks"
  | "summary"
  | "notes"
  | "visual-only"
  | "attendance-roster"
  | "validation-matrix"
  | "laboratory-series"
  | "measurement-series";

export type StructuralClassification = {
  type: StructuralRegionType;
  confidence: number;
  reasons: string[];
};

const PERIOD =
  /^(?:(?:jan(?:eiro)?|fev(?:ereiro)?|mar(?:[cç]o)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)[-/ ]?\d{2,4}|\d{1,2}[-/]\d{2,4}|\d{4})$/i;
const SUMMARY = /^(?:total|m[eé]dia|resumo|indicador|resultado|meta|acumulado)/i;
const NOTES = /^(?:observa[cç][aã]o|nota|fonte|legenda|instru[cç][aã]o|revis[aã]o)/i;

export function classifyRows(
  rows: Row[],
  tableMode?: "single" | "repeated-blocks",
): StructuralClassification {
  if (tableMode === "repeated-blocks")
    return {
      type: "repeated-blocks",
      confidence: 0.98,
      reasons: ["blocos de cabeçalho repetidos"],
    };
  const keys = Object.keys(rows[0] ?? {});
  if (!keys.length || !rows.length)
    return { type: "visual-only", confidence: 0.8, reasons: ["sem grade tabular recuperável"] };
  const normalizedKeys = new Set(
    keys.map((key) =>
      key
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    ),
  );
  if (["hora", "referencia", "aceita", "rejeita"].every((key) => normalizedKeys.has(key)))
    return {
      type: "validation-matrix",
      confidence: 0.99,
      reasons: ["horários com pares aceita/rejeita e resultado operacional"],
    };
  if (["amostra", "ensaio", "identificacao", "resultado"].every((key) => normalizedKeys.has(key)))
    return {
      type: "laboratory-series",
      confidence: 0.99,
      reasons: ["resultados laboratoriais normalizados por amostra e ensaio"],
    };
  if (
    ["categoria", "estatistica", "hora", "amostra", "data"].every((key) => normalizedKeys.has(key))
  )
    return {
      type: "measurement-series",
      confidence: 0.99,
      reasons: ["especificações, estatísticas e medições mantidas em registros distintos"],
    };
  if (
    normalizedKeys.has("nome") &&
    (normalizedKeys.has("matricula") || normalizedKeys.has("n°") || normalizedKeys.has("nº"))
  )
    return {
      type: "attendance-roster",
      confidence: 0.98,
      reasons: ["lista numerada de participantes com identificação e presença"],
    };
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
  if (NOTES.test(joined))
    return { type: "notes", confidence: 0.75, reasons: ["conteúdo textual institucional"] };
  if (SUMMARY.test(joined) && rows.length <= 12)
    return {
      type: "summary",
      confidence: 0.76,
      reasons: ["poucas linhas de indicadores agregados"],
    };
  return {
    type: "flat-table",
    confidence: 0.9,
    reasons: ["cabeçalho único e registros homogêneos"],
  };
}
