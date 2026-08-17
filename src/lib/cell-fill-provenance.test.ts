import { describe, expect, it } from "vitest";
import { resolveSourceCellFills } from "@/lib/cell-fill-provenance";
import type { ImportAudit, SourceGrid } from "@/lib/import";
import type { ImportDiagnostics } from "@/lib/import-intelligence";
import type { Column, Row } from "@/lib/types";

const columns: Column[] = [
  { key: "nivel", label: "Nível", kind: "text", visible: true, description: "" },
  { key: "baixa", label: "Baixa (1)", kind: "number", visible: true, description: "" },
];

const rows: Row[] = [
  { nivel: "Alto (3)", baixa: 3 },
  { nivel: "Médio (2)", baixa: 2 },
];

const cleanAudit: ImportAudit = {
  sourceNonEmptyCells: 4,
  outputNonEmptyCells: 4,
  formulaCellsRecovered: 0,
  mergedCellsExpanded: 0,
  numericCellsConverted: 0,
  rowsAboveHeaderIgnored: 0,
  hiddenRowsIgnored: 0,
  blankRowsIgnored: 0,
  trailingRowsIgnored: 0,
  columnsIgnored: 0,
};

// Cabeçalho na linha 1 (índice 0), dados nas linhas 2-3 (índices 1-2), sem
// nenhuma lacuna — mesma forma da matriz de critério real (seção 79).
const sourceGrid: SourceGrid = {
  startRow: 1,
  startColumn: 1,
  totalRows: 3,
  totalColumns: 2,
  rows: [
    ["Nível", "Baixa (1)"],
    ["Alto (3)", 3],
    ["Médio (2)", 2],
  ],
  truncatedRows: false,
  truncatedColumns: false,
};

const diagnostics = (cellFills: ImportDiagnostics["cellFills"]) =>
  ({
    header: { row: 1, confidence: 1 },
    cellFills,
  }) as ImportDiagnostics;

describe("resolveSourceCellFills", () => {
  it("resolve cor por linha+coluna quando a aba é simples e sem lacuna", () => {
    const resolved = resolveSourceCellFills(
      rows,
      columns,
      diagnostics([
        { address: "B2", color: "#FFFF00" },
        { address: "B3", color: "#00B050" },
      ]),
      cleanAudit,
      sourceGrid,
    );
    expect(resolved).toEqual([
      { rowIndex: 0, columnKey: "baixa", color: "#FFFF00" },
      { rowIndex: 1, columnKey: "baixa", color: "#00B050" },
    ]);
  });

  it("não resolve nada quando alguma linha foi pulada entre o cabeçalho e os dados", () => {
    const resolved = resolveSourceCellFills(
      rows,
      columns,
      diagnostics([{ address: "B2", color: "#FFFF00" }]),
      { ...cleanAudit, hiddenRowsIgnored: 3 },
      sourceGrid,
    );
    expect(resolved).toEqual([]);
  });

  it("não resolve nada quando a grade de origem foi truncada", () => {
    const resolved = resolveSourceCellFills(
      rows,
      columns,
      diagnostics([{ address: "B2", color: "#FFFF00" }]),
      cleanAudit,
      { ...sourceGrid, truncatedRows: true },
    );
    expect(resolved).toEqual([]);
  });

  it("não mapeia uma coluna cujo rótulo bate com mais de uma célula do cabeçalho", () => {
    const ambiguousGrid: SourceGrid = {
      ...sourceGrid,
      rows: [
        ["Baixa (1)", "Baixa (1)"],
        ["Alto (3)", 3],
        ["Médio (2)", 2],
      ],
    };
    const resolved = resolveSourceCellFills(
      rows,
      columns,
      diagnostics([{ address: "B2", color: "#FFFF00" }]),
      cleanAudit,
      ambiguousGrid,
    );
    expect(resolved).toEqual([]);
  });

  it("não resolve nada sem cellFills, audit ou sourceGrid", () => {
    expect(resolveSourceCellFills(rows, columns, diagnostics([]), cleanAudit, sourceGrid)).toEqual(
      [],
    );
    expect(
      resolveSourceCellFills(
        rows,
        columns,
        diagnostics([{ address: "B2", color: "#FFFF00" }]),
        undefined,
        sourceGrid,
      ),
    ).toEqual([]);
  });
});
