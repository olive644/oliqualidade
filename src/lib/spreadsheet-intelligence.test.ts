import { describe, expect, it } from "vitest";
import {
  analyzeSpreadsheet,
  buildCanonicalCells,
  buildPivotMatrix,
  detectSpreadsheetExceptions,
  inferSemanticProfile,
} from "@/lib/spreadsheet-intelligence";
import type { Column, Row } from "@/lib/types";

const columns: Column[] = [
  { key: "codigo", label: "Código", kind: "number", visible: true, description: "" },
  { key: "regiao", label: "Região", kind: "category", visible: true, description: "" },
  { key: "canal", label: "Canal", kind: "category", visible: true, description: "" },
  { key: "receita", label: "Receita (R$)", kind: "currency", visible: true, description: "" },
  { key: "temperatura", label: "Temperatura °C", kind: "number", visible: true, description: "" },
];

const rows: Row[] = [
  { codigo: 1, regiao: "Norte", canal: "Loja", receita: 10, temperatura: 20 },
  { codigo: 2, regiao: "Norte", canal: "Web", receita: 20, temperatura: 21 },
  { codigo: 3, regiao: "Sul", canal: "Loja", receita: 30, temperatura: 19 },
];

describe("spreadsheet intelligence", () => {
  it("separa identificadores, medidas e unidades", () => {
    expect(inferSemanticProfile(columns[0]!, rows).role).toBe("identifier");
    expect(inferSemanticProfile(columns[3]!, rows)).toMatchObject({
      role: "total",
      unit: "BRL",
      unitFamily: "currency",
      aggregable: true,
    });
    expect(inferSemanticProfile(columns[4]!, rows).unitFamily).toBe("temperature");
  });

  it("mantém endereço e semântica no modelo canônico", () => {
    const cells = buildCanonicalCells("Vendas", rows, columns, {
      header: { row: 3, confidence: 0.95 },
    } as never);
    expect(cells[0]).toMatchObject({
      sheet: "Vendas",
      address: "A4",
      rowIndex: 1,
      columnKey: "codigo",
      semanticRole: "identifier",
    });
  });

  it("cruza dimensões com totais determinísticos", () => {
    const pivot = buildPivotMatrix(rows, "regiao", "canal", "receita", "sum");
    expect(pivot.grandTotal).toBe(60);
    expect(pivot.rowTotals).toEqual([30, 30]);
    expect(pivot.columnTotals).toEqual([40, 20]);
  });

  it("detecta duplicatas, tipos mistos e unidades incompatíveis", () => {
    const problematic = [
      ...rows,
      { ...rows[0] },
      { codigo: "X", regiao: "Sul", canal: "Web", receita: 1000, temperatura: 80 },
    ];
    const exceptions = detectSpreadsheetExceptions(problematic, columns);
    expect(exceptions.some((item) => item.kind === "duplicate-row")).toBe(true);
    expect(
      exceptions.some((item) => item.kind === "mixed-type" && item.columnKey === "codigo"),
    ).toBe(true);
    expect(analyzeSpreadsheet(problematic, columns).warnings).toContain(
      "Há medidas com unidades incompatíveis; elas não devem ser somadas entre si.",
    );
  });
});
