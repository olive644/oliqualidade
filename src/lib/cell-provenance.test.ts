import { describe, expect, it } from "vitest";

import { traceImportedCell } from "@/lib/cell-provenance";
import type { SourceGrid } from "@/lib/import";

const sourceGrid: SourceGrid = {
  startRow: 1,
  startColumn: 1,
  totalRows: 3,
  totalColumns: 2,
  rows: [
    ["Produto", "Valor"],
    ["A", "1.234,50"],
    ["B", "900,00"],
  ],
  truncatedRows: false,
  truncatedColumns: false,
};

const diagnostics = {
  header: { row: 1, confidence: 0.98 },
  confidence: 96,
  confidenceReasons: ["Cabeçalho e tipos consistentes."],
  columns: [
    {
      key: "Produto",
      label: "Produto",
      kind: "category" as const,
      confidence: 0.97,
      level: "alta" as const,
      filled: 2,
      missing: 0,
      unique: 2,
      duplicate: 0,
      examples: ["A", "B"],
      sensitive: false,
      warnings: [],
      qualityScore: 100,
    },
    {
      key: "Valor",
      label: "Valor",
      kind: "currency" as const,
      confidence: 0.94,
      level: "alta" as const,
      filled: 2,
      missing: 0,
      unique: 2,
      duplicate: 0,
      examples: ["1.234,50", "900,00"],
      sensitive: false,
      warnings: [],
      qualityScore: 100,
    },
  ],
  sourceCellRepresentations: [
    {
      address: "B2",
      rawValue: 1234.5,
      displayValue: "R$ 1.234,50",
      numberFormat: "R$ #,##0.00",
      formula: "=SUM(B2)",
    },
  ],
  tableRegions: [
    {
      startRow: 1,
      endRow: 3,
      startColumn: 1,
      endColumn: 2,
      rows: 3,
      columns: 2,
      confidence: 0.95,
    },
  ],
};

describe("traceImportedCell", () => {
  it("liga uma célula importada ao endereço e representação OOXML originais", () => {
    const provenance = traceImportedCell({
      fileName: "vendas.xlsx",
      sheetName: "Planilha1",
      rows: [{ Produto: "A", Valor: 1234.5 }],
      rowIndex: 0,
      column: {
        key: "Valor",
        label: "Valor",
        kind: "currency",
      },
      sourceGrid,
      rowOrigins: [1],
      diagnostics,
    });

    expect(provenance).toMatchObject({
      status: "exact",
      mappingConfidence: 100,
      fileName: "vendas.xlsx",
      sheetName: "Planilha1",
      section: "Bloco 1",
      sourceAddress: "B2",
      sourceRow: 2,
      sourceColumn: 2,
      rawValue: 1234.5,
      displayValue: "R$ 1.234,50",
      importedValue: 1234.5,
      inferredKind: "currency",
      columnConfidence: 94,
      sheetConfidence: 96,
      numberFormat: "R$ #,##0.00",
      formula: "=SUM(B2)",
      normalized: false,
    });
  });

  it("informa quando o cabeçalho mudou e localiza a coluna por valor único", () => {
    const provenance = traceImportedCell({
      fileName: "vendas.xlsx",
      sheetName: "Planilha1",
      rows: [{ Total: "900,00" }],
      rowIndex: 0,
      column: {
        key: "Total",
        label: "Total",
        kind: "currency",
      },
      sourceGrid,
      rowOrigins: [2],
      diagnostics,
    });

    expect(provenance.status).toBe("inferred");
    expect(provenance.mappingConfidence).toBe(75);
    expect(provenance.sourceAddress).toBe("B3");
    expect(provenance.reasons.join(" ")).toContain("valor único");
  });

  it("não inventa coluna quando o mesmo valor aparece mais de uma vez", () => {
    const provenance = traceImportedCell({
      fileName: "duplicados.xlsx",
      sheetName: "Dados",
      rows: [{ Resultado: 4 }],
      rowIndex: 0,
      column: {
        key: "Resultado",
        label: "Resultado",
        kind: "number",
      },
      sourceGrid: {
        ...sourceGrid,
        rows: [
          ["A", "B"],
          [4, 4],
        ],
      },
      rowOrigins: [1],
      diagnostics: {
        ...diagnostics,
        columns: [],
        sourceCellRepresentations: [],
        tableRegions: [],
      },
    });

    expect(provenance.status).toBe("unavailable");
    expect(provenance.sourceAddress).toBeNull();
    expect(provenance.reasons.join(" ")).toContain("correspondência única");
  });

  it("recusa o vínculo depois que uma seleção manual muda as linhas", () => {
    const provenance = traceImportedCell({
      fileName: "vendas.xlsx",
      sheetName: "Planilha1",
      rows: [{ Produto: "A" }],
      rowIndex: 0,
      column: {
        key: "Produto",
        label: "Produto",
        kind: "category",
      },
      sourceGrid,
      rowOrigins: [1],
      diagnostics,
      mappingInvalidated: true,
    });

    expect(provenance.status).toBe("unavailable");
    expect(provenance.reasons.join(" ")).toContain("seleção manual");
  });

  it("explica quando a linha de origem não foi preservada", () => {
    const provenance = traceImportedCell({
      fileName: "dados.csv",
      sheetName: "Dados",
      rows: [{ Produto: "A" }],
      rowIndex: 0,
      column: {
        key: "Produto",
        label: "Produto",
        kind: "category",
      },
      sourceGrid,
      diagnostics,
    });

    expect(provenance.status).toBe("unavailable");
    expect(provenance.sourceAddress).toBeNull();
    expect(provenance.reasons.join(" ")).toContain("índice de origem");
  });
});
