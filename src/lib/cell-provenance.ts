import { parseNumericValue } from "@/lib/format";
import type { SourceGrid } from "@/lib/import";
import type { ImportDiagnostics } from "@/lib/import-intelligence";
import type { Column, Row, Value } from "@/lib/types";

export type CellProvenanceStatus = "exact" | "inferred" | "unavailable";

type CellTraceDiagnostics = Pick<
  ImportDiagnostics,
  | "columns"
  | "confidence"
  | "confidenceReasons"
  | "header"
  | "sourceCellRepresentations"
  | "tableRegions"
>;

export type CellProvenance = {
  fileName: string;
  sheetName: string;
  section: string;
  outputRow: number;
  outputColumn: string;
  importedValue: Value;
  inferredKind: string;
  columnConfidence: number | null;
  sheetConfidence: number | null;
  warnings: string[];
  status: CellProvenanceStatus;
  mappingConfidence: number;
  reasons: string[];
  sourceAddress: string | null;
  sourceRow: number | null;
  sourceColumn: number | null;
  rawValue: Value;
  displayValue: string | null;
  numberFormat?: string;
  formula?: string;
  normalized: boolean;
};

export type TraceImportedCellInput = {
  fileName: string;
  sheetName: string;
  rows: Row[];
  rowIndex: number;
  column: Pick<Column, "key" | "kind" | "label">;
  sourceGrid?: SourceGrid;
  rowOrigins?: number[];
  diagnostics?: CellTraceDiagnostics;
  mappingInvalidated?: boolean;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameCellValue(left: Value, right: Value): boolean {
  if (Object.is(left, right)) return true;
  const leftNumber = parseNumericValue(left);
  const rightNumber = parseNumericValue(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber === rightNumber;
  return String(left ?? "").trim() === String(right ?? "").trim();
}

function columnLabel(column: number): string {
  let value = column;
  let label = "";
  while (value > 0) {
    value--;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function cellAddress(row: number, column: number): string {
  return columnLabel(column) + row;
}

function headerVariants(column: Pick<Column, "key" | "label">): Set<string> {
  const variants = new Set<string>();
  for (const value of [column.key, column.label]) {
    const normalized = normalizeHeader(value);
    if (normalized) variants.add(normalized);
    for (const part of value.split(/\s+[—›]\s+/)) {
      const segment = normalizeHeader(part);
      if (segment) variants.add(segment);
    }
  }
  return variants;
}

function sectionLabel(
  sheetName: string,
  diagnostics: CellTraceDiagnostics | undefined,
  relativeRow: number,
  relativeColumn: number,
): string {
  const namedSection = sheetName.split(" — ").slice(1).join(" — ").trim();
  if (namedSection) return namedSection;
  const regionIndex =
    diagnostics?.tableRegions.findIndex(
      (region) =>
        relativeRow >= region.startRow &&
        relativeRow <= region.endRow &&
        relativeColumn >= region.startColumn &&
        relativeColumn <= region.endColumn,
    ) ?? -1;
  return regionIndex >= 0 ? "Bloco " + (regionIndex + 1) : "Tabela principal";
}

export function traceImportedCell(input: TraceImportedCellInput): CellProvenance {
  const importedValue = input.rows[input.rowIndex]?.[input.column.key] ?? null;
  const columnDiagnostic = input.diagnostics?.columns.find(
    (column) => column.key === input.column.key,
  );
  const base = {
    fileName: input.fileName,
    sheetName: input.sheetName,
    section: "Tabela principal",
    outputRow: input.rowIndex + 1,
    outputColumn: input.column.label,
    importedValue,
    inferredKind: columnDiagnostic?.kind ?? input.column.kind,
    columnConfidence: columnDiagnostic ? Math.round(columnDiagnostic.confidence * 100) : null,
    sheetConfidence: input.diagnostics?.confidence ?? null,
    warnings: columnDiagnostic?.warnings ?? [],
  };

  const unavailable = (
    reasons: string[],
    sourceRow: number | null = null,
  ): CellProvenance => ({
    ...base,
    status: "unavailable",
    mappingConfidence: 0,
    reasons,
    sourceAddress: null,
    sourceRow,
    sourceColumn: null,
    rawValue: null,
    displayValue: null,
    normalized: false,
  });

  if (input.mappingInvalidated) {
    return unavailable([
      "A seleção manual alterou as linhas da prévia. Desfaça a alteração para recuperar o vínculo original por célula.",
    ]);
  }
  if (!input.sourceGrid) {
    return unavailable(["A grade original não foi preservada para este formato de arquivo."]);
  }
  const origin = input.rowOrigins?.[input.rowIndex];
  if (!Number.isInteger(origin) || origin === undefined || origin < 0) {
    return unavailable(["A linha importada não possui um índice de origem preservado."]);
  }

  const absoluteRow = input.sourceGrid.startRow + origin;
  const sourceRow = input.sourceGrid.rows[origin];
  if (!sourceRow) {
    return unavailable(
      ["A linha original ficou fora do recorte preservado por segurança."],
      absoluteRow,
    );
  }

  const variants = headerVariants(input.column);
  const headerIndex = Math.max(0, (input.diagnostics?.header.row ?? 1) - 1);
  const headerRow = input.sourceGrid.rows[headerIndex] ?? [];
  const headerCandidates = headerRow
    .map((value, index) => ({ index, normalized: normalizeHeader(value) }))
    .filter((candidate) => candidate.normalized && variants.has(candidate.normalized))
    .map((candidate) => candidate.index);

  let sourceColumnIndex: number | null = null;
  let status: CellProvenanceStatus = "unavailable";
  let mappingConfidence = 0;
  const reasons = [
    "Linha associada pelo índice de origem preservado durante a importação.",
  ];

  if (headerCandidates.length === 1) {
    sourceColumnIndex = headerCandidates[0]!;
    status = "exact";
    mappingConfidence = 100;
    reasons.push("Coluna associada pelo cabeçalho original.");
  } else if (headerCandidates.length > 1) {
    const candidatesWithValue = headerCandidates.filter((index) =>
      sameCellValue(sourceRow[index] ?? null, importedValue),
    );
    if (candidatesWithValue.length === 1) {
      sourceColumnIndex = candidatesWithValue[0]!;
      status = "exact";
      mappingConfidence = 95;
      reasons.push("Cabeçalho repetido resolvido pelo valor correspondente na linha original.");
    }
  }

  if (sourceColumnIndex === null) {
    const valueCandidates = sourceRow
      .map((value, index) => ({ index, value: value ?? null }))
      .filter((candidate) => sameCellValue(candidate.value, importedValue))
      .map((candidate) => candidate.index);
    if (valueCandidates.length === 1) {
      sourceColumnIndex = valueCandidates[0]!;
      status = "inferred";
      mappingConfidence = 75;
      reasons.push(
        "Cabeçalho alterado ou combinado; coluna inferida por valor único na linha original.",
      );
    }
  }

  if (sourceColumnIndex === null) {
    return unavailable(
      [
        ...reasons,
        "Não existe correspondência única entre esta célula e as colunas da linha original.",
      ],
      absoluteRow,
    );
  }

  const absoluteColumn = input.sourceGrid.startColumn + sourceColumnIndex;
  const address = cellAddress(absoluteRow, absoluteColumn);
  const representation = input.diagnostics?.sourceCellRepresentations.find(
    (cell) => cell.address.toUpperCase() === address.toUpperCase(),
  );
  const rawValue = representation?.rawValue ?? sourceRow[sourceColumnIndex] ?? null;
  const normalized = !sameCellValue(rawValue, importedValue);
  if (normalized) {
    reasons.push("O valor importado difere do valor bruto e passou por normalização.");
  } else {
    reasons.push("O valor bruto foi preservado na saída importada.");
  }

  return {
    ...base,
    section: sectionLabel(
      input.sheetName,
      input.diagnostics,
      origin + 1,
      sourceColumnIndex + 1,
    ),
    status,
    mappingConfidence,
    reasons,
    sourceAddress: address,
    sourceRow: absoluteRow,
    sourceColumn: absoluteColumn,
    rawValue,
    displayValue:
      representation?.displayValue ?? String(sourceRow[sourceColumnIndex] ?? ""),
    ...(representation?.numberFormat ? { numberFormat: representation.numberFormat } : {}),
    ...(representation?.formula ? { formula: representation.formula } : {}),
    normalized,
  };
}
