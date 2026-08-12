import type { ImportDiagnostics } from "@/lib/import-intelligence";
import type { Column, Kind } from "@/lib/types";

const ALLOWED_KINDS = new Set<Kind>([
  "text",
  "number",
  "currency",
  "percentage",
  "date",
  "category",
]);
const SENSITIVE_NAME =
  /(cpf|cnpj|rg|email|e-mail|telefone|celular|phone|endereco|endereço|senha|password|token|secret|api.?key|pix|conta.?banc)/i;
const SENSITIVE_VALUE =
  /(?:\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b|[^\s@]+@[^\s@]+\.[^\s@]+|(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}|\d{4})[-\s]?\d{4})/i;
const INJECTION =
  /ignore\s+(?:all\s+)?previous|ignore\s+(?:todas?\s+)?instru|system\s*(?:prompt|message)|jailbreak|developer\s*(?:message|instruction)|revele?.*(?:chave|segredo|prompt)/i;

export type SmartImportInput = {
  fileName: string;
  sheetName: string;
  rowCount: number;
  columnCount: number;
  confidence: number;
  interpretationScore: number;
  consistencyScore: number;
  header: { row: number; confidence: number };
  columns: Array<{
    key: string;
    label: string;
    kind: Kind;
    filled: number;
    missing: number;
    unique: number;
    examples: string[];
    sensitive: boolean;
  }>;
  regions: Array<{
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
    rows: number;
    columns: number;
    confidence: number;
  }>;
  warnings: string[];
  transformations: string[];
};

export type SmartImportSuggestion = {
  type: "rename-column" | "change-kind" | "ignore-column";
  columnKey: string;
  proposedLabel?: string;
  proposedKind?: Kind;
  confidence: number;
  reason: string;
};

export type SmartImportAnalysis = {
  version: 1;
  purpose: string;
  summary: string;
  confidence: number;
  suggestions: SmartImportSuggestion[];
  warnings: string[];
  generatedBy: "gemini";
};

const cleanText = (value: unknown, max = 160) => {
  const text = String(value ?? "")
    // eslint-disable-next-line no-control-regex -- remove controles de conteúdo não confiável
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
  return INJECTION.test(text) ? "[conteúdo ocultado por segurança]" : text;
};

export function buildSmartImportInput(
  fileName: string,
  sheetName: string,
  columns: Column[],
  diagnostics: ImportDiagnostics,
): SmartImportInput {
  return {
    fileName: cleanText(fileName, 120),
    sheetName: cleanText(sheetName, 120),
    rowCount: diagnostics.rowCount,
    columnCount: diagnostics.columnCount,
    confidence: diagnostics.confidence,
    interpretationScore: diagnostics.interpretationScore ?? diagnostics.confidence,
    consistencyScore: diagnostics.qualityScore,
    header: diagnostics.header,
    columns: columns.slice(0, 120).map((column) => {
      const diagnostic = diagnostics.columns.find((item) => item.key === column.key);
      const sensitive =
        Boolean(diagnostic?.sensitive) || SENSITIVE_NAME.test(`${column.key} ${column.label}`);
      return {
        key: cleanText(column.key),
        label: cleanText(column.label),
        kind: column.kind,
        filled: diagnostic?.filled ?? 0,
        missing: diagnostic?.missing ?? diagnostics.rowCount,
        unique: diagnostic?.unique ?? 0,
        examples: sensitive
          ? []
          : (diagnostic?.examples ?? [])
              .filter((example) => !SENSITIVE_VALUE.test(example))
              .slice(0, 3)
              .map((example) => cleanText(example, 80)),
        sensitive,
      };
    }),
    regions: diagnostics.tableRegions.slice(0, 8).map((region) => ({
      startRow: region.startRow,
      endRow: region.endRow,
      startColumn: region.startColumn,
      endColumn: region.endColumn,
      rows: region.rows,
      columns: region.columns,
      confidence: region.confidence,
    })),
    warnings: diagnostics.warnings.slice(0, 20).map((warning) => cleanText(warning, 240)),
    transformations: diagnostics.transformations.slice(0, 20).map((item) => cleanText(item, 240)),
  };
}

export function validateSmartImportInput(value: unknown): SmartImportInput {
  if (!value || typeof value !== "object") throw new Error("Contexto da importação inválido.");
  const input = value as Partial<SmartImportInput>;
  if (
    typeof input.fileName !== "string" ||
    typeof input.sheetName !== "string" ||
    !Array.isArray(input.columns) ||
    input.columns.length === 0 ||
    input.columns.length > 120 ||
    !Array.isArray(input.regions) ||
    input.regions.length > 8 ||
    !Array.isArray(input.warnings) ||
    !Array.isArray(input.transformations) ||
    !input.header ||
    typeof input.header.row !== "number" ||
    typeof input.header.confidence !== "number"
  )
    throw new Error("Contexto da importação inválido.");
  const safeColumns = input.columns.map((column) => {
    if (
      !column ||
      typeof column.key !== "string" ||
      !column.key ||
      typeof column.label !== "string" ||
      !ALLOWED_KINDS.has(column.kind) ||
      !Array.isArray(column.examples)
    )
      throw new Error("Contexto da importação inválido.");
    const sensitive =
      Boolean(column.sensitive) || SENSITIVE_NAME.test(`${column.key} ${column.label}`);
    return {
      key: cleanText(column.key),
      label: cleanText(column.label),
      kind: column.kind,
      filled: Math.max(0, Math.floor(Number(column.filled) || 0)),
      missing: Math.max(0, Math.floor(Number(column.missing) || 0)),
      unique: Math.max(0, Math.floor(Number(column.unique) || 0)),
      examples: sensitive
        ? []
        : column.examples
            .slice(0, 3)
            .map((example) => cleanText(example, 80))
            .filter((example) => example && !SENSITIVE_VALUE.test(example)),
      sensitive,
    };
  });
  return {
    fileName: cleanText(input.fileName, 120),
    sheetName: cleanText(input.sheetName, 120),
    rowCount: Math.max(0, Math.floor(Number(input.rowCount) || 0)),
    columnCount: Math.max(0, Math.floor(Number(input.columnCount) || 0)),
    confidence: Math.max(0, Math.min(100, Number(input.confidence) || 0)),
    interpretationScore: Math.max(0, Math.min(100, Number(input.interpretationScore) || 0)),
    consistencyScore: Math.max(0, Math.min(100, Number(input.consistencyScore) || 0)),
    header: {
      row: Math.max(1, Math.floor(input.header.row)),
      confidence: Math.max(0, Math.min(1, input.header.confidence)),
    },
    columns: safeColumns,
    regions: input.regions.map((region) => ({
      startRow: Math.max(1, Math.floor(Number(region.startRow) || 1)),
      endRow: Math.max(1, Math.floor(Number(region.endRow) || 1)),
      startColumn: Math.max(1, Math.floor(Number(region.startColumn) || 1)),
      endColumn: Math.max(1, Math.floor(Number(region.endColumn) || 1)),
      rows: Math.max(0, Math.floor(Number(region.rows) || 0)),
      columns: Math.max(0, Math.floor(Number(region.columns) || 0)),
      confidence: Math.max(0, Math.min(1, Number(region.confidence) || 0)),
    })),
    warnings: input.warnings.slice(0, 20).map((warning) => cleanText(warning, 240)),
    transformations: input.transformations.slice(0, 20).map((item) => cleanText(item, 240)),
  };
}

export function parseSmartImportAnalysis(
  text: string,
  input: SmartImportInput,
): SmartImportAnalysis {
  const jsonText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error("A IA retornou uma análise estrutural inválida.");
  }
  if (!raw || typeof raw !== "object")
    throw new Error("A IA retornou uma análise estrutural inválida.");
  const candidate = raw as Record<string, unknown>;
  const validKeys = new Set(input.columns.map((column) => column.key));
  const suggestions = (Array.isArray(candidate["suggestions"]) ? candidate["suggestions"] : [])
    .slice(0, 20)
    .flatMap((entry): SmartImportSuggestion[] => {
      if (!entry || typeof entry !== "object") return [];
      const suggestion = entry as Record<string, unknown>;
      const type = suggestion["type"];
      const columnKey = cleanText(suggestion["columnKey"]);
      if (
        !["rename-column", "change-kind", "ignore-column"].includes(String(type)) ||
        !validKeys.has(columnKey)
      )
        return [];
      const confidence = Math.max(0, Math.min(100, Number(suggestion["confidence"]) || 0));
      const reason = cleanText(suggestion["reason"], 240);
      if (!reason) return [];
      if (type === "rename-column") {
        const proposedLabel = cleanText(suggestion["proposedLabel"]);
        if (!proposedLabel || proposedLabel === columnKey) return [];
        return [{ type, columnKey, proposedLabel, confidence, reason }];
      }
      if (type === "change-kind") {
        const proposedKind = suggestion["proposedKind"] as Kind;
        if (!ALLOWED_KINDS.has(proposedKind)) return [];
        return [{ type, columnKey, proposedKind, confidence, reason }];
      }
      return [{ type: "ignore-column", columnKey, confidence, reason }];
    });
  return {
    version: 1,
    purpose: cleanText(candidate["purpose"], 160) || "Estrutura tabular",
    summary: cleanText(candidate["summary"], 500) || "Análise estrutural concluída.",
    confidence: Math.max(0, Math.min(100, Number(candidate["confidence"]) || 0)),
    suggestions,
    warnings: (Array.isArray(candidate["warnings"]) ? candidate["warnings"] : [])
      .slice(0, 10)
      .map((warning) => cleanText(warning, 240))
      .filter(Boolean),
    generatedBy: "gemini",
  };
}

export function smartImportFingerprint(input: SmartImportInput): string {
  const source = JSON.stringify({
    sheet: input.sheetName,
    columns: input.columns.map(({ key, label, kind, filled, missing, unique }) => ({
      key,
      label,
      kind,
      fillBand: input.rowCount ? Math.round((filled / input.rowCount) * 20) : 0,
      missingBand: input.rowCount ? Math.round((missing / input.rowCount) * 20) : 0,
      uniqueBand: Math.min(20, unique),
    })),
    regions: input.regions,
    header: input.header,
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(36)}`;
}
