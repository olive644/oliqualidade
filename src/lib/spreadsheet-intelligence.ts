import * as XLSX from "xlsx";
import type { ImportDiagnostics } from "@/lib/import-intelligence";
import type { Column, Row, Value } from "@/lib/types";

export type SemanticRole =
  | "identifier"
  | "description"
  | "period"
  | "result"
  | "minimum-limit"
  | "maximum-limit"
  | "target"
  | "unit"
  | "status"
  | "owner"
  | "category"
  | "quantity"
  | "price"
  | "total"
  | "location"
  | "start-date"
  | "end-date"
  | "unknown";

export type UnitFamily =
  | "currency"
  | "percentage"
  | "mass"
  | "volume"
  | "temperature"
  | "time"
  | "length"
  | "count"
  | "concentration"
  | "dimensionless"
  | "unknown";

export type ColumnSemanticProfile = {
  key: string;
  label: string;
  role: SemanticRole;
  unit: string | null;
  unitFamily: UnitFamily;
  aggregable: boolean;
  confidence: number;
  reasons: string[];
  warnings: string[];
};

export type CanonicalCell = {
  sheet: string;
  address: string;
  rowIndex: number;
  columnIndex: number;
  columnKey: string;
  rawValue: Value;
  normalizedValue: Value;
  displayValue: string;
  formula?: string;
  numberFormat?: string;
  semanticRole: SemanticRole;
  unit: string | null;
  confidence: number;
  reasons: string[];
  warnings: string[];
};

export type ClassifiedRegion = {
  id: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  role: "table" | "schedule" | "summary" | "mixed";
  confidence: number;
  reasons: string[];
};

export type SpreadsheetExceptionSeverity = "critical" | "warning" | "info";
export type SpreadsheetException = {
  id: string;
  kind:
    | "duplicate-row"
    | "mixed-type"
    | "outlier"
    | "formula"
    | "reader-divergence"
    | "low-confidence"
    | "incompatible-unit";
  severity: SpreadsheetExceptionSeverity;
  title: string;
  detail: string;
  columnKey?: string;
  rowIndex?: number;
  address?: string;
  value?: Value;
};

export type SpreadsheetIntelligence = {
  columns: ColumnSemanticProfile[];
  regions: ClassifiedRegion[];
  exceptions: SpreadsheetException[];
  confidence: number;
  warnings: string[];
};

const normalized = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const ROLE_RULES: Array<[SemanticRole, RegExp, string]> = [
  ["minimum-limit", /\b(min|minimo|limite inferior|de)\b/, "limite mínimo"],
  ["maximum-limit", /\b(max|maximo|limite superior|ate)\b/, "limite máximo"],
  ["target", /\b(meta|target|objetivo|alvo)\b/, "meta"],
  ["unit", /\b(unidade|unit|uom)\b/, "unidade"],
  ["status", /\b(status|situacao|andamento|resultado final|conformidade)\b/, "status"],
  ["owner", /\b(responsavel|owner|analista|prestador)\b/, "responsável"],
  ["start-date", /\b(data inicio|inicio|start date)\b/, "data inicial"],
  ["end-date", /\b(data fim|fim|end date|vencimento)\b/, "data final"],
  ["period", /\b(data|mes|ano|periodo|semana|trimestre|competencia)\b/, "período"],
  ["price", /\b(preco|custo|valor unitario|tarifa)\b/, "preço"],
  ["total", /\b(total|faturamento|receita|saldo|valor total)\b/, "total"],
  ["quantity", /\b(quantidade|qtd|volume|peso|contagem|numero de)\b/, "quantidade"],
  ["result", /\b(resultado|medicao|leitura|valor observado|ensaio)\b/, "resultado"],
  ["location", /\b(cidade|municipio|estado|uf|regiao|pais|local|unidade fabril)\b/, "localização"],
  ["identifier", /\b(id|codigo|cod|numero|protocolo|sku|matricula|cpf|cnpj)\b/, "identificador"],
  ["description", /\b(descricao|nome|item|produto|analise|parametro|observacao)\b/, "descrição"],
  ["category", /\b(categoria|grupo|tipo|classe|bloco|secao)\b/, "categoria"],
];

const UNIT_RULES: Array<[UnitFamily, string, RegExp]> = [
  ["currency", "BRL", /(?:^|[\s(])(r\$|brl)(?:$|[\s)])/i],
  ["currency", "USD", /(?:^|[\s(])(us\$|usd)(?:$|[\s)])/i],
  ["percentage", "%", /%|percentual|porcentagem/i],
  ["temperature", "°C", /°\s*c|celsius|temperatura/i],
  ["concentration", "mg/L", /mg\s*\/\s*l/i],
  ["concentration", "µg/L", /(?:ug|µg)\s*\/\s*l/i],
  ["concentration", "UFC", /ufc|nmp/i],
  ["mass", "kg", /(?:^|\W)kg(?:$|\W)/i],
  ["mass", "g", /(?:^|\W)(?:mg|g)(?:$|\W)/i],
  ["volume", "L", /(?:^|\W)(?:ml|litro|l)(?:$|\W)/i],
  ["time", "h", /(?:hora|horas|\bh\b|minuto|dia)/i],
  ["length", "m", /(?:^|\W)(?:mm|cm|metro|m)(?:$|\W)/i],
  ["count", "un", /(?:unidade|unidades|un\.|qtd)/i],
];

function detectUnit(
  label: string,
  rows: Row[],
  key: string,
): Pick<ColumnSemanticProfile, "unit" | "unitFamily"> {
  const samples = rows
    .map((row) => row[key])
    .filter((value) => value !== null && value !== "")
    .slice(0, 30)
    .map(String);
  const haystack = [label, ...samples].join(" ");
  for (const [unitFamily, unit, pattern] of UNIT_RULES) {
    if (pattern.test(haystack)) return { unit, unitFamily };
  }
  return { unit: null, unitFamily: "unknown" };
}

export function inferSemanticProfile(
  column: Column,
  rows: Row[],
  diagnostics?: ImportDiagnostics,
): ColumnSemanticProfile {
  const name = normalized(`${column.label} ${column.key}`);
  const reasons: string[] = [];
  const warnings: string[] = [];
  let role: SemanticRole = "unknown";
  let confidence = 58;
  for (const [candidate, pattern, reason] of ROLE_RULES) {
    if (pattern.test(name)) {
      role = candidate;
      confidence = 91;
      reasons.push(`O cabeçalho indica ${reason}.`);
      break;
    }
  }
  if (role === "unknown") {
    if (column.kind === "date") {
      role = "period";
      confidence = 86;
      reasons.push("Os valores foram reconhecidos como datas.");
    } else if (["number", "currency", "percentage"].includes(column.kind)) {
      role = column.kind === "currency" ? "total" : "result";
      confidence = 72;
      reasons.push("A coluna contém uma medida numérica.");
    } else if (column.kind === "category") {
      role = "category";
      confidence = 75;
      reasons.push("A coluna possui valores categóricos repetidos.");
    } else {
      role = "description";
      confidence = 64;
      reasons.push("A coluna contém texto descritivo.");
    }
  }
  const diagnostic = diagnostics?.columns?.find((item) => item.key === column.key);
  if (diagnostic?.kind === "id" && role !== "identifier") {
    role = "identifier";
    confidence = Math.max(confidence, 92);
    reasons.push("O padrão dos valores corresponde a um identificador.");
  }
  if (diagnostic && diagnostic.qualityScore < 70) {
    warnings.push(`Qualidade da coluna: ${diagnostic.qualityScore}%.`);
    confidence -= Math.round((70 - diagnostic.qualityScore) / 3);
  }
  const { unit, unitFamily } = detectUnit(
    `${column.label} ${column.description}`,
    rows,
    column.key,
  );
  const aggregable = ["result", "quantity", "price", "total"].includes(role);
  return {
    key: column.key,
    label: column.label,
    role,
    unit,
    unitFamily:
      unitFamily === "unknown" && column.kind === "percentage" ? "percentage" : unitFamily,
    aggregable,
    confidence: Math.max(0, Math.min(100, confidence)),
    reasons,
    warnings,
  };
}

const valueFamily = (value: Value) => {
  if (value === null || value === "") return "empty";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  const text = String(value).trim();
  if (/^[+-]?[\d.,]+%?$/.test(text)) return "number";
  if (/^(?:\d{1,2}[/-]){2}\d{2,4}$|^\d{4}-\d{2}-\d{2}/.test(text)) return "date";
  return "text";
};

function canonicalAddress(columnIndex: number, rowIndex: number, diagnostics?: ImportDiagnostics) {
  const headerRow = diagnostics?.header.row ?? 1;
  return XLSX.utils.encode_cell({ r: headerRow + rowIndex, c: columnIndex });
}

export function buildCanonicalCells(
  sheet: string,
  rows: Row[],
  columns: Column[],
  diagnostics?: ImportDiagnostics,
): CanonicalCell[] {
  const source = new Map(
    (diagnostics?.sourceCellRepresentations ?? []).map((cell) => [cell.address, cell]),
  );
  const profiles = columns.map((column) => inferSemanticProfile(column, rows, diagnostics));
  return rows.flatMap((row, rowIndex) =>
    columns.map((column, columnIndex) => {
      const address = canonicalAddress(columnIndex, rowIndex, diagnostics);
      const representation = source.get(address);
      const profile = profiles[columnIndex]!;
      const rawValue = row[column.key] ?? null;
      return {
        sheet,
        address,
        rowIndex: rowIndex + 1,
        columnIndex: columnIndex + 1,
        columnKey: column.key,
        rawValue,
        normalizedValue: rawValue,
        displayValue: representation?.displayValue ?? String(rawValue ?? ""),
        ...(representation?.formula ? { formula: representation.formula } : {}),
        ...(representation?.numberFormat ? { numberFormat: representation.numberFormat } : {}),
        semanticRole: profile.role,
        unit: profile.unit,
        confidence: profile.confidence,
        reasons: profile.reasons,
        warnings: profile.warnings,
      };
    }),
  );
}

export function detectSpreadsheetExceptions(
  rows: Row[],
  columns: Column[],
  diagnostics?: ImportDiagnostics,
): SpreadsheetException[] {
  const exceptions: SpreadsheetException[] = [];
  const profiles = columns.map((column) => inferSemanticProfile(column, rows, diagnostics));
  const fingerprints = new Map<string, number>();
  rows.forEach((row, rowIndex) => {
    const fingerprint = columns.map((column) => String(row[column.key] ?? "")).join("¦");
    const first = fingerprints.get(fingerprint);
    if (first !== undefined) {
      exceptions.push({
        id: `duplicate-${rowIndex}`,
        kind: "duplicate-row",
        severity: "warning",
        title: "Linha duplicada",
        detail: `Repete integralmente a linha ${first + 1}.`,
        rowIndex: rowIndex + 1,
      });
    } else fingerprints.set(fingerprint, rowIndex);
  });
  for (const [columnIndex, column] of columns.entries()) {
    const values = rows
      .map((row) => row[column.key] ?? null)
      .filter((value) => value !== null && value !== "");
    const families = new Set(values.map(valueFamily));
    if (families.size > 1) {
      exceptions.push({
        id: `mixed-${column.key}`,
        kind: "mixed-type",
        severity: "warning",
        title: "Tipos misturados",
        detail: `${column.label} mistura ${[...families].join(", ")}.`,
        columnKey: column.key,
      });
    }
    const profile = profiles[columnIndex]!;
    if (profile.confidence < 65) {
      exceptions.push({
        id: `confidence-${column.key}`,
        kind: "low-confidence",
        severity: "info",
        title: "Semântica incerta",
        detail: `Confirme o papel de ${column.label} (${profile.confidence}% de confiança).`,
        columnKey: column.key,
      });
    }
    const numeric = values
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (numeric.length >= 8 && profile.aggregable) {
      const q1 = numeric[Math.floor((numeric.length - 1) * 0.25)]!;
      const q3 = numeric[Math.floor((numeric.length - 1) * 0.75)]!;
      const iqr = q3 - q1;
      if (iqr > 0)
        rows.forEach((row, rowIndex) => {
          const value = Number(row[column.key]);
          if (Number.isFinite(value) && (value < q1 - iqr * 1.5 || value > q3 + iqr * 1.5)) {
            exceptions.push({
              id: `outlier-${column.key}-${rowIndex}`,
              kind: "outlier",
              severity: "info",
              title: "Valor fora do padrão",
              detail: `${column.label} está fora do intervalo estatístico esperado.`,
              columnKey: column.key,
              rowIndex: rowIndex + 1,
              address: canonicalAddress(columnIndex, rowIndex, diagnostics),
              value: row[column.key] ?? null,
            });
          }
        });
    }
  }
  for (const formula of diagnostics?.formulaDiagnostics.filter((item) => !item.supported) ?? []) {
    exceptions.push({
      id: `formula-${formula.address}`,
      kind: "formula",
      severity: "critical",
      title: "Fórmula não recalculada",
      detail: formula.reason ?? "A fórmula precisa ser verificada no arquivo original.",
      address: formula.address,
    });
  }
  for (const [index] of (diagnostics?.readerDivergences ?? []).entries()) {
    exceptions.push({
      id: `reader-${index}`,
      kind: "reader-divergence",
      severity: "critical",
      title: "Divergência de leitura",
      detail: "Dois leitores produziram representações diferentes para esta célula.",
    });
  }
  return exceptions.slice(0, 500);
}

function classifyRegions(columns: Column[], diagnostics?: ImportDiagnostics): ClassifiedRegion[] {
  const source = diagnostics?.tableRegions?.length
    ? diagnostics.tableRegions
    : [
        {
          startRow: 1,
          endRow: Math.max(1, diagnostics?.rowCount ?? 1),
          startColumn: 1,
          endColumn: columns.length,
          confidence: 0.7,
        },
      ];
  const hasPeriods =
    columns.filter((column) => inferSemanticProfile(column, [], diagnostics).role === "period")
      .length >= 2;
  return source.map((region, index) => ({
    id: `region-${index + 1}`,
    startRow: region.startRow,
    endRow: region.endRow,
    startColumn: region.startColumn,
    endColumn: region.endColumn,
    role: hasPeriods ? "schedule" : columns.length <= 3 ? "summary" : "table",
    confidence: Math.round(region.confidence * 100),
    reasons: [
      hasPeriods
        ? "Possui múltiplas dimensões de período."
        : "Estrutura tabular contínua detectada.",
    ],
  }));
}

export function analyzeSpreadsheet(
  rows: Row[],
  columns: Column[],
  diagnostics?: ImportDiagnostics,
): SpreadsheetIntelligence {
  const profiles = columns.map((column) => inferSemanticProfile(column, rows, diagnostics));
  const exceptions = detectSpreadsheetExceptions(rows, columns, diagnostics);
  const warnings: string[] = [];
  const units = new Set(
    profiles
      .filter((profile) => profile.aggregable)
      .map((profile) => profile.unitFamily)
      .filter((unit) => unit !== "unknown"),
  );
  if (units.size > 1)
    warnings.push("Há medidas com unidades incompatíveis; elas não devem ser somadas entre si.");
  return {
    columns: profiles,
    regions: classifyRegions(columns, diagnostics),
    exceptions,
    confidence: profiles.length
      ? Math.round(profiles.reduce((sum, item) => sum + item.confidence, 0) / profiles.length)
      : 0,
    warnings,
  };
}

export type PivotMatrix = {
  rows: string[];
  columns: string[];
  values: number[][];
  rowTotals: number[];
  columnTotals: number[];
  grandTotal: number;
};

export function buildPivotMatrix(
  data: Row[],
  rowKey: string,
  columnKey: string,
  valueKey: string | undefined,
  op: "sum" | "avg" | "count" | "min" | "max" = "sum",
): PivotMatrix {
  const rowLabels = [...new Set(data.map((row) => String(row[rowKey] ?? "Não informado")))];
  const columnLabels = [...new Set(data.map((row) => String(row[columnKey] ?? "Não informado")))];
  const aggregate = (items: Row[]) => {
    if (op === "count") return items.length;
    const values = items
      .map((item) => Number(valueKey ? item[valueKey] : null))
      .filter(Number.isFinite);
    if (!values.length) return 0;
    if (op === "avg") return values.reduce((sum, value) => sum + value, 0) / values.length;
    if (op === "min") return Math.min(...values);
    if (op === "max") return Math.max(...values);
    return values.reduce((sum, value) => sum + value, 0);
  };
  const values = rowLabels.map((rowLabel) =>
    columnLabels.map((columnLabel) =>
      aggregate(
        data.filter(
          (row) =>
            String(row[rowKey] ?? "Não informado") === rowLabel &&
            String(row[columnKey] ?? "Não informado") === columnLabel,
        ),
      ),
    ),
  );
  const rowTotals = values.map((row) => row.reduce((sum, value) => sum + value, 0));
  const columnTotals = columnLabels.map((_, index) =>
    values.reduce((sum, row) => sum + row[index]!, 0),
  );
  return {
    rows: rowLabels,
    columns: columnLabels,
    values,
    rowTotals,
    columnTotals,
    grandTotal: rowTotals.reduce((sum, value) => sum + value, 0),
  };
}
