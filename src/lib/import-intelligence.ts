import * as XLSX from "xlsx";
import type { Row } from "@/lib/types";
import { analyzeAdvancedQuality, type AdvancedQualityReport } from "@/lib/advanced-quality";
import type { ReaderDivergence } from "@/lib/ooxml-reader";
import { buildAdaptedQualityAudit, type AdaptedQualityAudit } from "@/lib/quality-audit";
import { classifyRows, type StructuralClassification } from "@/lib/structural-model";
import { buildTemporalCellModel, type TemporalCellModel } from "@/lib/temporal-model";
import type {
  DataValidationDiagnostic,
  PivotTableDiagnostic,
  StructuredTableDiagnostic,
  WorkbookCellHyperlink,
  WorkbookDefinedName,
  WorkbookExternalLink,
  WorksheetWithAdvancedMetadata,
} from "@/lib/workbook-metadata";
import { worksheetCellAtAddress } from "@/lib/worksheet-cell";

export type FormulaDiagnostic = {
  address: string;
  formula: string;
  supported: boolean;
  reason?: string;
  referencesOtherSheet: boolean;
  containsRange: boolean;
};

export type DetectedFieldKind =
  | "text"
  | "category"
  | "integer"
  | "number"
  | "currency"
  | "percentage"
  | "date"
  | "datetime"
  | "boolean"
  | "cpf"
  | "cnpj"
  | "email"
  | "phone"
  | "postal-code"
  | "url"
  | "id";

export type ColumnDiagnostic = {
  key: string;
  label: string;
  kind: DetectedFieldKind;
  confidence: number;
  filled: number;
  missing: number;
  unique: number;
  duplicate: number;
  examples: string[];
  sensitive: boolean;
  warnings: string[];
  qualityScore: number;
};

export type TableRegionDiagnostic = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  rows: number;
  columns: number;
  confidence: number;
};

export type SourceCellRepresentation = {
  address: string;
  rawValue: string | number | boolean | null;
  displayValue: string;
  numberFormat?: string;
  formula?: string;
};

export type SourceNote = {
  address: string;
  text: string;
  author?: string;
  kind: "comment" | "observation";
};

export type ImportDiagnostics = {
  formulaDiagnostics: FormulaDiagnostic[];
  confidence: number;
  baseConfidence: number;
  recoveryGain: number;
  confidenceReasons: string[];
  rowCount: number;
  columnCount: number;
  duplicateRows: number;
  emptyRows: number;
  formulaCells: number;
  mergedRanges: number;
  hiddenRows: number;
  hiddenColumns: number;
  hasAutoFilter: boolean;
  hasTables: boolean;
  structuredTableNames: string[];
  structuredTables: StructuredTableDiagnostic[];
  pivotTables: PivotTableDiagnostic[];
  /** Hyperlinks do Excel (endereço, destino e tooltip opcional) preservados por aba. */
  hyperlinks: WorkbookCellHyperlink[];
  /** Nomes definidos (Name Manager) visíveis nesta aba: globais do workbook + locais dela. */
  definedNames: WorkbookDefinedName[];
  /** Referências a outros arquivos externos (workbook.xml `externalReferences`). */
  externalLinks: WorkbookExternalLink[];
  /** Regras de validação de dados do Excel (lista, intervalo numérico, data etc.) por intervalo. */
  dataValidations: DataValidationDiagnostic[];
  /** `xl/vbaProject.bin` presente no pacote. Detectado, nunca executado nem decompilado. */
  hasVbaMacros: boolean;
  calculatedColumns: string[];
  autofilterRange: string | null;
  formulaExamples: string[];
  sourceCellRepresentations: SourceCellRepresentation[];
  /** Comentários/notas do Excel e blocos textuais de observação preservados fora da tabela. */
  sourceNotes: SourceNote[];
  temporalCells?: TemporalCellModel[];
  readerDivergences?: ReaderDivergence[];
  structuralClassification?: StructuralClassification;
  columns: ColumnDiagnostic[];
  tableRegions: TableRegionDiagnostic[];
  transformations: string[];
  warnings: string[];
  qualityScore: number;
  /** Percentual da origem que pôde ser interpretado, sem confundir células vazias com falha. */
  interpretationScore?: number;
  qualityAudit?: AdaptedQualityAudit;
  advancedQuality?: AdvancedQualityReport;
  suggestedNormalization: string[];
  header: { row: number; confidence: number };
};

export type SheetConfidenceLevel = "alta" | "média" | "baixa" | "sem diagnóstico";

export type SheetConfidenceEntry = {
  name: string;
  confidence: number | null;
  level: SheetConfidenceLevel;
  reasons: string[];
  readerDivergenceCount: number;
};

/**
 * Confiança por aba já era computada para toda aba com dado (`sheetsWithData`
 * roda `diagnoseImportedSheet` em todas elas, não só na aba ativa), mas nunca
 * era agregada num único lugar para comparação lado a lado — só a aba
 * selecionada exibia sua própria confiança. Função pura, sem novo cálculo:
 * só lê o que cada `ImportDiagnostics` já expõe.
 */
export function buildSheetConfidenceMatrix(
  sheets: ReadonlyArray<{ name: string; diagnostics?: ImportDiagnostics }>,
): SheetConfidenceEntry[] {
  return sheets.map((sheet) => {
    const diagnostics = sheet.diagnostics;
    if (!diagnostics) {
      return {
        name: sheet.name,
        confidence: null,
        level: "sem diagnóstico",
        reasons: [],
        readerDivergenceCount: 0,
      };
    }
    const level: SheetConfidenceLevel =
      diagnostics.confidence >= 85 ? "alta" : diagnostics.confidence >= 60 ? "média" : "baixa";
    return {
      name: sheet.name,
      confidence: diagnostics.confidence,
      level,
      reasons: diagnostics.confidenceReasons,
      readerDivergenceCount: diagnostics.readerDivergences?.length ?? 0,
    };
  });
}

const SENSITIVE_NAME =
  /(cpf|cnpj|rg|senha|password|token|secret|api[_ -]?key|telefone|celular|phone|email|e-mail|endereco|endereço|address|pix|conta banc)/i;
const CPF = /^\d{11}$/;
const CNPJ = /^\d{14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL = /^https?:\/\//i;
const PHONE = /^(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}|\d{4})[-\s]?\d{4}$/;
const PERIOD_COLUMN_NAME =
  /^(?:(?:jan(?:eiro)?|fev(?:ereiro)?|mar(?:ço)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)(?:[-/ ]?\d{2,4})?|\d{1,2}\/\d{1,2}\/\d{2,4})$/i;
const CEP = /^\d{5}-?\d{3}$/;
const CURRENCY = /^(?:R\$|US\$|€|£|¥|\$)\s*[+-]?[\d.]+(?:,\d+)?\s*$/;
const PERCENTAGE = /^[+-]?(?:\d+(?:[.,]\d+)?)\s*%$/;
const DATE = /^(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})$/;
const DATETIME = /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}.*\d{1,2}:\d{2}/;
const IDENTIFIER_NAME =
  /(^|[\s_-])(id|c[oó]digo|cod|n[º°o]\.?|n[uú]mero|matr[ií]cula|sku|uuid|protocolo)([\s_.-]|\d|$)/i;

function containsSensitiveValues(values: unknown[]): boolean {
  const samples = values.map(normalized).filter(Boolean).slice(0, 200);
  if (samples.length < 2) return false;
  const matches = samples.filter((value) => {
    const compact = value.replace(/\D/g, "");
    return CPF.test(compact) || CNPJ.test(compact) || EMAIL.test(value) || PHONE.test(value);
  }).length;
  return matches / samples.length >= 0.5;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim();
}

function representationFamily(
  value: unknown,
): "number" | "boolean" | "temporal" | "text" | "error" {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  const text = normalized(value);
  if (/^#(?:DIV\/0!|N\/A|REF!|VALUE!|NAME\?|NULL!|NUM!)$/i.test(text)) return "error";
  if (DATE.test(text) || DATETIME.test(text)) return "temporal";
  if (["true", "false", "sim", "não", "nao", "yes", "no"].includes(text.toLowerCase()))
    return "boolean";
  const numeric = text
    .replace(/^R\$\s*/i, "")
    .replace(/%$/, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  if (numeric !== "" && Number.isFinite(Number(numeric))) return "number";
  return "text";
}

function nonEmpty(values: unknown[]): string[] {
  return values.map(normalized).filter(Boolean);
}

function kindFor(
  values: unknown[],
  label: string,
): { kind: DetectedFieldKind; confidence: number } {
  const samples = nonEmpty(values).slice(0, 500);
  if (!samples.length) return { kind: "text", confidence: 0.1 };
  const name = label.toLowerCase();
  if (IDENTIFIER_NAME.test(name)) return { kind: "id", confidence: 0.92 };
  const scores: Array<[DetectedFieldKind, number]> = [
    [
      "cpf",
      samples.filter((v) => CPF.test(v.replace(/\D/g, "")) && v.replace(/\D/g, "").length === 11)
        .length,
    ],
    [
      "cnpj",
      samples.filter((v) => CNPJ.test(v.replace(/\D/g, "")) && v.replace(/\D/g, "").length === 14)
        .length,
    ],
    ["email", samples.filter((v) => EMAIL.test(v)).length],
    ["url", samples.filter((v) => URL.test(v)).length],
    ["postal-code", samples.filter((v) => CEP.test(v)).length],
    ["phone", samples.filter((v) => PHONE.test(v.replace(/[().]/g, ""))).length],
    ["currency", samples.filter((v) => CURRENCY.test(v)).length],
    ["percentage", samples.filter((v) => PERCENTAGE.test(v)).length],
    ["datetime", samples.filter((v) => DATETIME.test(v)).length],
    ["date", samples.filter((v) => DATE.test(v)).length],
  ];
  const [specialKind, specialCount] = scores.sort((a, b) => b[1] - a[1])[0] ?? ["text", 0];
  if (specialCount / samples.length >= 0.8)
    return { kind: specialKind, confidence: specialCount / samples.length };

  const lower = samples.map((v) => v.toLowerCase());
  if (lower.every((v) => ["true", "false", "sim", "não", "nao", "yes", "no"].includes(v))) {
    return { kind: "boolean", confidence: 0.96 };
  }

  const numeric = samples.filter((v) => {
    const s = v
      .replace(/\s/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    return s !== "" && Number.isFinite(Number(s));
  });
  if (numeric.length / samples.length >= 0.9) {
    const integers = numeric.filter((v) =>
      Number.isInteger(Number(v.replace(/\./g, "").replace(",", "."))),
    ).length;
    return {
      kind: integers === numeric.length ? "integer" : "number",
      confidence: numeric.length / samples.length,
    };
  }

  const unique = new Set(samples.map((v) => v.toLowerCase())).size;
  if (unique <= Math.max(20, samples.length * 0.15)) return { kind: "category", confidence: 0.82 };

  return { kind: "text", confidence: 0.75 };
}

function analyzeFormulas(ws: XLSX.WorkSheet): FormulaDiagnostic[] {
  const ref = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  if (!ref) return [];
  const result: FormulaDiagnostic[] = [];
  for (let r = ref.s.r; r <= ref.e.r; r++) {
    for (let c = ref.s.c; c <= ref.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = worksheetCellAtAddress(ws, address);
      if (!cell?.f) continue;
      const formula = String(cell.f);
      const referencesOtherSheet = /(?:'[^']+'|[A-Za-z_][\w .-]*)!/.test(formula);
      const containsRange = /(?:\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+)/i.test(formula);
      let reason: string | undefined;
      let supported = true;
      if (referencesOtherSheet) {
        supported = false;
        reason = "referência a outra aba";
      } else if (
        containsRange &&
        !/(?:SUM|MIN|MAX|AVERAGE|COUNT|SUMIF|COUNTIF)\s*\([^)]*[A-Z]+\d+:[A-Z]+\d+/i.test(formula)
      ) {
        supported = false;
        reason = "intervalo fora de uma função agregadora suportada";
      } else if (/[A-Z]+\s*\(/i.test(formula)) {
        const names = [...formula.matchAll(/([A-Z][A-Z0-9_]*)\s*\(/gi)].map((m) =>
          m[1]!.toUpperCase(),
        );
        const supportedNames = new Set([
          "IFERROR",
          "IF",
          "AND",
          "OR",
          "ROUND",
          "ABS",
          "MIN",
          "MAX",
          "SUM",
          "AVERAGE",
          "COUNT",
          "SUMIF",
          "COUNTIF",
        ]);
        const unsupported = names.find((name) => !supportedNames.has(name));
        if (unsupported) {
          supported = false;
          reason = `função ${unsupported} não suportada pelo resolvedor`;
        }
      }
      result.push({
        address,
        formula: `=${formula}`,
        supported,
        ...(reason ? { reason } : {}),
        referencesOtherSheet,
        containsRange,
      });
      if (result.length >= 200) return result;
    }
  }
  return result;
}

function sheetMeta(ws: XLSX.WorkSheet) {
  const ref = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  let formulaCells = 0;
  const rowsHidden = ref
    ? Array.from(
        { length: ref.e.r - ref.s.r + 1 },
        (_, i) => ws["!rows"]?.[ref.s.r + i]?.hidden === true,
      ).filter(Boolean).length
    : 0;
  const cols = ws["!cols"] ?? [];
  const colsHidden = cols.filter((c) => c?.hidden === true).length;
  const tables = ws["!tables"] as unknown;
  const advanced = (ws as WorksheetWithAdvancedMetadata)["!oliAdvanced"];
  const legacyTableNames = Array.isArray(tables)
    ? tables.map((table) => String((table as { name?: unknown }).name ?? "")).filter(Boolean)
    : [];
  const structuredTables = advanced?.structuredTables ?? [];
  const pivotTables = advanced?.pivotTables ?? [];
  const structuredTableNames = [
    ...new Set([...legacyTableNames, ...structuredTables.map((table) => table.name)]),
  ];
  const calculatedColumns = [
    ...new Set(structuredTables.flatMap((table) => table.calculatedColumns)),
  ];
  const formulaExamples: string[] = [];
  const sourceCellRepresentations: SourceCellRepresentation[] = [];
  const sourceNotes: SourceNote[] = [];
  const temporalCells: TemporalCellModel[] = [];
  if (ref) {
    for (let r = ref.s.r; r <= ref.e.r; r++) {
      for (let c = ref.s.c; c <= ref.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = worksheetCellAtAddress(ws, address);
        if (cell?.f) {
          formulaCells++;
          if (formulaExamples.length < 10) formulaExamples.push(`${address}: =${cell.f}`);
        }
        if (
          cell &&
          sourceCellRepresentations.length < 500 &&
          (cell.f || cell.z || (cell.w != null && cell.w !== String(cell.v ?? "")))
        ) {
          const raw =
            cell.v instanceof Date
              ? cell.v.toISOString()
              : typeof cell.v === "string" ||
                  typeof cell.v === "number" ||
                  typeof cell.v === "boolean"
                ? cell.v
                : null;
          sourceCellRepresentations.push({
            address,
            rawValue: raw,
            displayValue: cell.w ?? String(raw ?? ""),
            ...(cell.z ? { numberFormat: String(cell.z) } : {}),
            ...(cell.f ? { formula: `=${cell.f}` } : {}),
          });
        }
        const comments = (
          cell as
            | (XLSX.CellObject & {
                c?: Array<{ a?: string; t?: string }>;
              })
            | undefined
        )?.c;
        for (const comment of comments ?? []) {
          if (!comment.t || sourceNotes.length >= 500) continue;
          let text = comment.t.trim();
          let author = comment.a?.trim();
          const threaded = text.match(/\bComment:\s*([\s\S]*)$/i);
          if (threaded?.[1]) text = threaded[1].trim();
          const embeddedAuthor = text.match(/^([^:\n]{2,80}):\s*\n([\s\S]+)$/);
          if (embeddedAuthor) {
            if (!author || author === "sheetjsghost") author = embeddedAuthor[1]!.trim();
            text = embeddedAuthor[2]!.trim();
          }
          sourceNotes.push({
            address,
            text,
            ...(author && author !== "sheetjsghost" ? { author } : {}),
            kind: "comment",
          });
        }
        const displayed = cell?.w ?? String(cell?.v ?? "");
        if (
          sourceNotes.length < 500 &&
          typeof displayed === "string" &&
          displayed.trim().length >= 40 &&
          /^observa[cç][oõ]es?\s*:/i.test(displayed.trim())
        ) {
          sourceNotes.push({
            address,
            text: displayed.trim().replace(/^observa[cç][oõ]es?\s*:\s*/i, ""),
            kind: "observation",
          });
        }
        if (cell && temporalCells.length < 2_000) {
          const temporal = buildTemporalCellModel(address, cell);
          if (temporal) temporalCells.push(temporal);
        }
      }
    }
  }
  return {
    formulaCells,
    mergedRanges: ws["!merges"]?.length ?? 0,
    hiddenRows: rowsHidden,
    hiddenColumns: colsHidden,
    hasAutoFilter: Boolean(ws["!autofilter"]),
    hasTables:
      structuredTables.length > 0 || (Array.isArray(tables) ? tables.length > 0 : Boolean(tables)),
    structuredTableNames,
    structuredTables,
    pivotTables,
    hyperlinks: advanced?.hyperlinks ?? [],
    definedNames: advanced?.definedNames ?? [],
    externalLinks: advanced?.externalLinks ?? [],
    dataValidations: advanced?.dataValidations ?? [],
    hasVbaMacros: advanced?.hasVbaMacros ?? false,
    calculatedColumns,
    autofilterRange: ws["!autofilter"]?.ref ?? null,
    formulaExamples,
    sourceCellRepresentations,
    sourceNotes,
    temporalCells,
    readerDivergences:
      (ws as XLSX.WorkSheet & { "!oliReaderDivergences"?: ReaderDivergence[] })[
        "!oliReaderDivergences"
      ] ?? [],
  };
}

function detectTableRegions(ws: XLSX.WorkSheet): TableRegionDiagnostic[] {
  const used = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  const rawAoa = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  });
  const aoa = rawAoa.map((row, index) =>
    used && ws["!rows"]?.[used.s.r + index]?.hidden === true ? [] : row,
  );
  if (!aoa.length) return [];

  const occupiedRows = aoa.map((row) => row.some((v) => v !== null && v !== ""));
  const rowBands: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= occupiedRows.length; i++) {
    const occupied = i < occupiedRows.length && occupiedRows[i];
    if (occupied && start === -1) start = i;
    if (!occupied && start !== -1) {
      if (i - start >= 2) rowBands.push([start, i - 1]);
      start = -1;
    }
  }

  const regions: TableRegionDiagnostic[] = [];
  for (const [startRow, endRow] of rowBands) {
    const columnUsed = new Map<number, number>();
    for (let r = startRow; r <= endRow; r++) {
      for (let c = 0; c < (aoa[r]?.length ?? 0); c++) {
        const value = aoa[r]?.[c];
        if (value !== null && value !== "") columnUsed.set(c, (columnUsed.get(c) ?? 0) + 1);
      }
    }
    const columns = [...columnUsed.keys()].sort((a, b) => a - b);
    if (!columns.length) continue;

    let bandStart = columns[0]!;
    for (let i = 1; i <= columns.length; i++) {
      const prev = columns[i - 1]!;
      const current = columns[i];
      if (current === undefined || current - prev > 1) {
        const bandEnd = prev;
        const width = bandEnd - bandStart + 1;
        const density =
          [...columnUsed.entries()]
            .filter(([c]) => c >= bandStart && c <= bandEnd)
            .reduce((sum, [, count]) => sum + count, 0) /
          Math.max(1, (endRow - startRow + 1) * width);
        if (width >= 2 && density >= 0.12) {
          regions.push({
            startRow: startRow + 1,
            endRow: endRow + 1,
            startColumn: bandStart + 1,
            endColumn: bandEnd + 1,
            rows: endRow - startRow + 1,
            columns: width,
            confidence: Math.round(Math.min(1, 0.55 + density * 0.45) * 100) / 100,
          });
        }
        if (current !== undefined) bandStart = current;
      }
    }
  }

  return regions.slice(0, 24);
}

function detectDateLocaleCandidates(values: unknown[]): string[] {
  const samples = nonEmpty(values).filter((v) => /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(v));
  if (!samples.length) return [];
  const ambiguous = samples.some((v) => {
    const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    return Boolean(m && Number(m[1]) <= 12 && Number(m[2]) <= 12);
  });
  if (!ambiguous) return [];
  return ["DD/MM/AAAA", "MM/DD/AAAA"];
}

function detectHeader(ws: XLSX.WorkSheet): { row: number; confidence: number } {
  const used = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : null;
  const rawAoa = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  });
  const aoa = rawAoa.map((row, index) =>
    used && ws["!rows"]?.[used.s.r + index]?.hidden === true ? [] : row,
  );
  const limit = Math.min(40, aoa.length);
  const width = Math.max(1, ...aoa.slice(0, limit).map((r) => r.length));
  let best = { row: 0, confidence: 0 };
  for (let r = 0; r < limit; r++) {
    const row = aoa[r] ?? [];
    const filled = row.filter((v) => v !== null && v !== "");
    if (filled.length < 2) continue;
    const textRatio =
      filled.filter((v) => typeof v === "string" && !/^[-+]?\d/.test(String(v).trim())).length /
      filled.length;
    const fillRatio = filled.length / width;
    const next = aoa[r + 1] ?? [];
    const nextFilled = next.filter((v) => v !== null && v !== "").length;
    const continuity = nextFilled > 0 ? Math.min(1, nextFilled / filled.length) : 0;
    const uniqueRatio =
      new Set(filled.map((v) => String(v).trim().toLowerCase())).size / filled.length;
    const confidence = Math.min(
      1,
      textRatio * 0.4 + fillRatio * 0.25 + continuity * 0.2 + uniqueRatio * 0.15,
    );
    if (confidence > best.confidence)
      best = { row: r + 1, confidence: Math.round(confidence * 100) / 100 };
  }
  return best;
}

function normalizationSuggestions(values: unknown[], kind: DetectedFieldKind): string[] {
  const samples = nonEmpty(values).slice(0, 200);
  const suggestions: string[] = [];
  if (
    ["currency", "number", "integer"].includes(kind) &&
    samples.some((v) => /\d[.]\d{3},\d/.test(v))
  ) {
    suggestions.push("normalizar separadores numéricos brasileiros");
  }
  if (kind === "percentage" && samples.some((v) => /\d[,.]+\s*%/.test(v))) {
    suggestions.push("normalizar percentuais para valor numérico");
  }
  if (kind === "date" || kind === "datetime") {
    suggestions.push("preservar formato de data e normalizar internamente");
  }
  if (kind === "cpf" || kind === "cnpj" || kind === "postal-code" || kind === "phone") {
    suggestions.push("preservar valor original e usar versão normalizada apenas para validação");
  }
  return suggestions;
}

export function diagnoseImportedSheet(ws: XLSX.WorkSheet, rows: Row[]): ImportDiagnostics {
  const keys = Object.keys(rows[0] ?? {});
  const columns: ColumnDiagnostic[] = keys.map((key) => {
    const values = rows.map((row) => row[key]);
    const filledValues = values.filter((v) => v !== null && v !== "");
    const uniqueValues = new Set(filledValues.map((v) => normalized(v).toLowerCase()));
    const { kind, confidence } = kindFor(filledValues, key);
    const warnings: string[] = [];
    const missing = values.length - filledValues.length;
    const periodColumn = PERIOD_COLUMN_NAME.test(key.trim());
    if (
      filledValues.length > 0 &&
      values.length >= 5 &&
      missing / values.length > 0.2 &&
      !periodColumn
    )
      warnings.push("muitos valores ausentes");
    if (uniqueValues.size === 1 && filledValues.length > 5)
      warnings.push("um único valor domina a coluna");
    const sensitive =
      SENSITIVE_NAME.test(key) ||
      ["cpf", "cnpj", "email", "phone", "postal-code"].includes(kind) ||
      containsSensitiveValues(filledValues);
    // Consistência mede se os valores presentes respeitam a representação
    // detectada. Ausência e repetição são métricas diferentes: em cronogramas,
    // meses futuros vazios e estados repetidos são perfeitamente legítimos.
    const representationCounts = new Map<string, number>();
    for (const value of filledValues) {
      const family = representationFamily(value);
      representationCounts.set(family, (representationCounts.get(family) ?? 0) + 1);
    }
    const representationConsistency = filledValues.length
      ? Math.max(...representationCounts.values()) / filledValues.length
      : 1;
    const excelErrorRatio = filledValues.length
      ? filledValues.filter((value) =>
          /^#(?:DIV\/0!|N\/A|REF!|VALUE!|NAME\?|NULL!|NUM!)$/i.test(normalized(value)),
        ).length / filledValues.length
      : 0;
    const qualityScore = Math.round(
      Math.max(0, Math.min(1, representationConsistency - excelErrorRatio)) * 100,
    );
    if (filledValues.length >= 5 && representationConsistency < 0.9)
      warnings.push("representações de valor misturadas");
    return {
      key,
      label: key.replaceAll("_", " "),
      kind,
      confidence: Math.round(confidence * 100) / 100,
      filled: filledValues.length,
      missing,
      unique: uniqueValues.size,
      duplicate: Math.max(0, filledValues.length - uniqueValues.size),
      examples: [...new Set(filledValues.map((v) => normalized(v)))].slice(0, 3),
      sensitive,
      warnings,
      qualityScore,
    };
  });

  const seenRows = new Set<string>();
  let duplicateRows = 0;
  let emptyRows = 0;
  for (const row of rows) {
    const values = keys.map((key) => row[key]);
    if (values.every((v) => v === null || v === "")) {
      emptyRows++;
      continue;
    }
    const fingerprint = JSON.stringify(values);
    if (seenRows.has(fingerprint)) duplicateRows++;
    seenRows.add(fingerprint);
  }

  const meta = sheetMeta(ws);
  const formulaDiagnostics = analyzeFormulas(ws);
  const tableRegions = detectTableRegions(ws);
  const transformations: string[] = [];
  const warnings: string[] = [];
  if (meta.formulaCells) warnings.push(`${meta.formulaCells} célula(s) com fórmula detectada(s)`);
  const unsupportedFormulaCount = formulaDiagnostics.filter((f) => !f.supported).length;
  if (unsupportedFormulaCount) {
    warnings.push(
      `${unsupportedFormulaCount} fórmula(s) precisam de cálculo pelo Excel/serviço externo ou de suporte adicional`,
    );
  }
  if (meta.mergedRanges)
    warnings.push(`${meta.mergedRanges} intervalo(s) de células mescladas detectado(s)`);
  if (meta.hiddenRows || meta.hiddenColumns) warnings.push("existem linhas ou colunas ocultas");
  if (meta.hasAutoFilter) warnings.push("a planilha possui filtro do Excel");
  if (meta.hasTables)
    warnings.push(
      `uma ou mais tabelas estruturadas do Excel foram detectadas${meta.structuredTableNames.length ? ` (${meta.structuredTableNames.join(", ")})` : ""}`,
    );
  if (meta.pivotTables.length)
    warnings.push(
      `${meta.pivotTables.length} Pivot Table(s) detectada(s); os valores exibidos são preservados, mas a configuração dinâmica não é recalculada no navegador`,
    );
  if (meta.calculatedColumns.length)
    warnings.push(
      `${meta.calculatedColumns.length} coluna(s) calculada(s) de tabela detectada(s): ${meta.calculatedColumns.join(", ")}`,
    );
  if (meta.autofilterRange)
    warnings.push(`filtro do Excel aplicado ao intervalo ${meta.autofilterRange}`);
  if (meta.hyperlinks.length)
    warnings.push(`${meta.hyperlinks.length} hyperlink(s) do Excel preservado(s)`);
  if (meta.definedNames.length)
    warnings.push(`${meta.definedNames.length} nome(s) definido(s) detectado(s)`);
  if (meta.externalLinks.length)
    warnings.push(
      `${meta.externalLinks.length} referência(s) a arquivo(s) externo(s) detectada(s)`,
    );
  if (meta.dataValidations.length)
    warnings.push(
      `${meta.dataValidations.length} regra(s) de validação de dados do Excel detectada(s)`,
    );
  if (meta.hasVbaMacros)
    warnings.push(
      "a planilha contém macros VBA; elas são preservadas no arquivo original, mas não são executadas nem decompiladas",
    );
  if (meta.formulaExamples.length)
    transformations.push(
      `exemplos de fórmulas preservados: ${meta.formulaExamples.slice(0, 3).join(" | ")}`,
    );
  if (formulaDiagnostics.length) {
    const supportedFormulaCount = formulaDiagnostics.filter((f) => f.supported).length;
    transformations.push(
      `${supportedFormulaCount}/${formulaDiagnostics.length} fórmula(s) são compatíveis com o resolvedor local atual`,
    );
  }
  if (tableRegions.length > 1)
    warnings.push(
      `${tableRegions.length} regiões de dados potencialmente independentes foram detectadas; revise antes de combinar tabelas diferentes`,
    );
  if (duplicateRows) warnings.push(`${duplicateRows} linha(s) duplicada(s)`);
  if (columns.some((c) => c.sensitive))
    warnings.push(
      "há colunas potencialmente pessoais ou sensíveis; minimize esses dados antes de enviá-los para IA",
    );
  if (columns.some((c) => c.kind === "date" || c.kind === "datetime")) {
    for (const column of columns.filter((c) => c.kind === "date" || c.kind === "datetime")) {
      const candidates = detectDateLocaleCandidates(rows.map((row) => row[column.key]));
      if (candidates.length)
        warnings.push(
          `a coluna "${column.label}" contém datas ambíguas; confirme o formato ${candidates.join(" ou ")}`,
        );
    }
  }
  if (duplicateRows)
    transformations.push(`${duplicateRows} linha(s) duplicada(s) identificada(s) para revisão`);
  if (meta.hiddenRows) transformations.push(`${meta.hiddenRows} linha(s) oculta(s) detectada(s)`);
  if (meta.hiddenColumns)
    transformations.push(`${meta.hiddenColumns} coluna(s) oculta(s) detectada(s)`);
  if (meta.mergedRanges)
    transformations.push(`${meta.mergedRanges} intervalo(s) mesclado(s) detectado(s)`);
  if (meta.structuredTables.length)
    transformations.push(
      `${meta.structuredTables.length} tabela(s) estruturada(s) preservada(s) como dados tabulares`,
    );
  if (meta.pivotTables.length)
    transformations.push(`${meta.pivotTables.length} Pivot Table(s) identificada(s) para revisão`);

  const avgColumnConfidence = columns.length
    ? columns.reduce((sum, column) => sum + column.confidence, 0) / columns.length
    : 0;
  const completeness = rows.length
    ? columns.length
      ? columns.reduce((sum, column) => sum + column.filled / Math.max(1, rows.length), 0) /
        columns.length
      : 0
    : 0;
  const baseConfidence = Math.round(
    Math.max(0, Math.min(1, avgColumnConfidence * 0.65 + completeness * 0.35)) * 100,
  );
  const qualityScore = Math.round(
    columns.length
      ? columns.reduce((sum, column) => sum + column.qualityScore, 0) / columns.length
      : 0,
  );
  const advancedQuality = analyzeAdvancedQuality(rows, columns);
  if (advancedQuality.totalAnomalies)
    warnings.push(
      `${advancedQuality.totalAnomalies} linha(s) com possível anomalia estatística detectada(s)`,
    );
  const header = detectHeader(ws);
  const filledPerRow = rows.map(
    (row) => keys.filter((key) => row[key] !== null && row[key] !== "").length,
  );
  const sortedFill = [...filledPerRow].sort((a, b) => a - b);
  const medianFill = sortedFill.length ? sortedFill[Math.floor(sortedFill.length / 2)]! : 0;
  const rowStructureConsistency = filledPerRow.length
    ? filledPerRow.reduce(
        (sum, filled) =>
          sum + (1 - Math.min(1, Math.abs(filled - medianFill) / Math.max(1, keys.length))),
        0,
      ) / filledPerRow.length
    : 0;
  const readableRows = rows.length
    ? rows.filter((row) => keys.some((key) => row[key] !== null && row[key] !== "")).length /
      rows.length
    : 0;
  const supportedFormulaRatio = formulaDiagnostics.length
    ? formulaDiagnostics.filter((formula) => formula.supported).length / formulaDiagnostics.length
    : 1;
  const interpretedHeaderRatio = keys.length
    ? keys.filter((key) => !/^coluna_\d+$/i.test(key) && normalized(key) !== "").length /
      keys.length
    : 0;
  const formulaEvidence = formulaDiagnostics.filter((formula) => formula.supported).length;
  // Fórmulas suportadas são evidência positiva de interpretação, não uma
  // obrigação de que todas as fórmulas decorativas/institucionais de uma
  // aba precisem ser calculáveis. Divergências reais entre leitores já são
  // medidas separadamente no eixo de fidelidade.
  const formulaInterpretation = formulaEvidence > 0 ? 1 : formulaDiagnostics.length ? 0.5 : 1;
  const interpretationScore = Math.round(
    Math.max(
      0,
      Math.min(
        1,
        readableRows * 0.5 + interpretedHeaderRatio * 0.25 + formulaInterpretation * 0.25,
      ),
    ) * 100,
  );
  const structuralClassification = classifyRows(rows);
  const unresolvedReaderDivergences = meta.readerDivergences.filter(
    (item) => !item.repaired,
  ).length;
  const reconciledInterpretationScore =
    interpretedHeaderRatio >= 0.5 && unresolvedReaderDivergences === 0
      ? Math.max(90, interpretationScore)
      : interpretationScore;
  const qualityAudit = buildAdaptedQualityAudit({
    rows,
    columnConsistency: columns.map((column) => ({ key: column.key, score: column.qualityScore })),
    duplicateRows,
    interpretationScore: reconciledInterpretationScore,
    unresolvedReaderDivergences,
  });
  const independentRegionPenalty = Math.min(0.16, Math.max(0, tableRegions.length - 1) * 0.08);
  const formulaPenalty = (1 - supportedFormulaRatio) * 0.1;
  const recoveredStructureBonus = Math.min(
    0.08,
    (header.row > 1 ? 0.025 : 0) +
      (meta.mergedRanges ? 0.02 : 0) +
      (meta.structuredTables.length ? 0.02 : 0) +
      (meta.hasAutoFilter ? 0.01 : 0),
  );
  const calibratedConfidence =
    avgColumnConfidence * 0.3 +
    rowStructureConsistency * 0.25 +
    header.confidence * 0.2 +
    completeness * 0.15 +
    readableRows * 0.1 +
    recoveredStructureBonus -
    independentRegionPenalty -
    formulaPenalty;
  const confidence = Math.round(Math.max(0, Math.min(1, calibratedConfidence)) * 100);
  const recoveryGain = Math.max(0, confidence - baseConfidence);
  const confidenceReasons: string[] = [];
  if (readableRows >= 0.98) confidenceReasons.push("todas as linhas úteis foram interpretadas");
  if (rowStructureConsistency >= 0.9)
    confidenceReasons.push("as linhas seguem uma estrutura consistente");
  if (header.confidence >= 0.8)
    confidenceReasons.push(
      header.row > 1
        ? `cabeçalho recuperado com segurança na linha ${header.row}`
        : "cabeçalho identificado com segurança",
    );
  if (meta.mergedRanges) confidenceReasons.push("células mescladas foram reconstruídas");
  if (meta.structuredTables.length)
    confidenceReasons.push("estrutura de tabela do Excel foi reconhecida");
  if (tableRegions.length > 1)
    confidenceReasons.push("há regiões independentes que ainda exigem confirmação");
  if (unsupportedFormulaCount) confidenceReasons.push("há fórmulas sem cálculo local confirmado");
  const suggestedNormalization = columns
    .flatMap((column) =>
      normalizationSuggestions(
        rows.map((row) => row[column.key]),
        column.kind,
      ),
    )
    .filter((v, i, a) => a.indexOf(v) === i);
  if (header.row > 1) transformations.push(`cabeçalho detectado na linha ${header.row}`);
  if (header.confidence < 0.7)
    warnings.push(
      `confiança baixa na identificação do cabeçalho (${Math.round(header.confidence * 100)}%)`,
    );
  if (suggestedNormalization.length)
    transformations.push(...suggestedNormalization.map((item) => `normalização sugerida: ${item}`));

  return {
    confidence,
    baseConfidence,
    recoveryGain,
    confidenceReasons,
    rowCount: rows.length,
    columnCount: keys.length,
    duplicateRows,
    emptyRows,
    ...meta,
    formulaDiagnostics,
    columns,
    tableRegions,
    transformations,
    warnings,
    qualityScore,
    interpretationScore: reconciledInterpretationScore,
    advancedQuality,
    structuralClassification,
    qualityAudit,
    suggestedNormalization,
    header,
  };
}

export type NormalizationResult = {
  value: unknown;
  changed: boolean;
  reason?: string;
};

function parseBrazilianNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(/^R\$/i, "").replace(/^US\$/i, "");
  if (!s) return null;
  const cleaned = s.replace(/\.(?=\d{3}(?:[.,]|$))/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Converte apenas representações inequívocas/fortemente prováveis para valores
 * estruturados. O texto original deve continuar disponível no dado de origem.
 */
export function normalizeImportedValue(
  value: unknown,
  kind: DetectedFieldKind,
): NormalizationResult {
  if (value === null || value === undefined || value === "") return { value, changed: false };
  if (typeof value === "number" || typeof value === "boolean") return { value, changed: false };

  const raw = String(value).trim();
  if (!raw) return { value: raw, changed: false };

  if (["currency", "number", "integer"].includes(kind)) {
    const n = parseBrazilianNumber(raw);
    if (n !== null)
      return {
        value: kind === "integer" ? Math.trunc(n) : n,
        changed: true,
        reason: "número normalizado",
      };
  }

  if (kind === "percentage") {
    const n = parseBrazilianNumber(raw.replace("%", ""));
    if (n !== null) return { value: n / 100, changed: true, reason: "percentual normalizado" };
  }

  if (kind === "cpf" || kind === "cnpj" || kind === "postal-code" || kind === "phone") {
    const digits = raw.replace(/\D/g, "");
    if (digits)
      return {
        value: digits,
        changed: digits !== raw,
        reason: "identificador normalizado apenas para validação",
      };
  }

  if (kind === "boolean") {
    const lower = raw.toLowerCase();
    if (["true", "sim", "yes"].includes(lower))
      return { value: true, changed: true, reason: "booleano normalizado" };
    if (["false", "não", "nao", "no"].includes(lower))
      return { value: false, changed: true, reason: "booleano normalizado" };
  }

  return { value, changed: false };
}

export function normalizeRows(
  rows: Row[],
  columns: Pick<ColumnDiagnostic, "key" | "kind">[],
): { rows: Row[]; changes: number; reasons: string[] } {
  const reasons = new Set<string>();
  let changes = 0;
  const normalizedRows = rows.map((row) => {
    const next: Row = { ...row };
    for (const column of columns) {
      const result = normalizeImportedValue(row[column.key], column.kind);
      if (
        result.changed &&
        (result.value === null ||
          typeof result.value === "string" ||
          typeof result.value === "number" ||
          typeof result.value === "boolean")
      ) {
        next[column.key] = result.value;
        changes++;
        if (result.reason) reasons.add(`${column.key}: ${result.reason}`);
      }
    }
    return next;
  });
  return { rows: normalizedRows, changes, reasons: [...reasons] };
}

export function sanitizeRowsForAi(rows: Row[], columns: ColumnDiagnostic[], maxRows = 100) {
  const sensitiveKeys = new Set(
    columns.filter((column) => column.sensitive).map((column) => column.key),
  );
  return rows.slice(0, maxRows).map((row) => {
    const sanitized: Row = {};
    for (const [key, value] of Object.entries(row)) {
      sanitized[key] = sensitiveKeys.has(key) ? "[DADO_SENSIVEL_REMOVIDO]" : value;
    }
    return sanitized;
  });
}

export function getFormulaSummary(diagnostics: ImportDiagnostics) {
  const supported = diagnostics.formulaDiagnostics.filter((item) => item.supported).length;
  const unsupported = diagnostics.formulaDiagnostics.length - supported;
  const crossSheet = diagnostics.formulaDiagnostics.filter(
    (item) => item.referencesOtherSheet,
  ).length;
  const ranges = diagnostics.formulaDiagnostics.filter((item) => item.containsRange).length;
  return {
    total: diagnostics.formulaDiagnostics.length,
    supported,
    unsupported,
    crossSheet,
    ranges,
  };
}
