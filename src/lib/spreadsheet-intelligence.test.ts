import { describe, expect, it } from "vitest";
import {
  analyzeSpreadsheet,
  buildCanonicalCells,
  buildPivotMatrix,
  detectSpreadsheetExceptions,
  inferSemanticProfile,
  normalizeMeasurement,
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

  it("não contamina a unidade de uma coluna de texto com a palavra de uma única linha", () => {
    // Bug real: coluna "Descrição" que lista nomes de parâmetro de análise
    // ("Temperatura", "pH", "Cloro residual"...) era classificada com
    // unidade "°C" só porque uma das linhas continha a palavra
    // "Temperatura" — a detecção de unidade rodava sobre o conteúdo da
    // coluna mesmo sem ela ser uma medida numérica.
    const descriptionColumn: Column = {
      key: "parametro",
      label: "Descrição",
      kind: "text",
      visible: true,
      description: "",
    };
    const parameterRows: Row[] = [
      { parametro: "Temperatura" },
      { parametro: "pH" },
      { parametro: "Cloro residual" },
    ];
    const profile = inferSemanticProfile(descriptionColumn, parameterRows);
    expect(profile.unitFamily).toBe("unknown");
    expect(profile.unit).toBeNull();
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

  it("detecta anotação com quebra de linha misturada numa coluna de categoria", () => {
    // Bug real: uma nota de rodapé ("Se estiver rodando a mesma
    // gramatura...\nanalisar apenas 1 delas") escrita na mesma coluna dos
    // códigos de produto virava sua própria barra no gráfico de contagem.
    const withNote = [
      ...rows,
      {
        codigo: 4,
        regiao: "Se estiver rodando a mesma gramatura...\nanalisar apenas 1 delas",
        canal: "Loja",
        receita: 40,
        temperatura: 22,
      },
    ];
    const exceptions = detectSpreadsheetExceptions(withNote, columns);
    expect(
      exceptions.some(
        (item) =>
          item.kind === "embedded-note" && item.columnKey === "regiao" && item.rowIndex === 4,
      ),
    ).toBe(true);
  });

  it("permite confirmar manualmente papel e unidade", () => {
    expect(
      inferSemanticProfile(columns[0]!, rows, undefined, {
        role: "quantity",
        unit: "kg",
      }),
    ).toMatchObject({
      role: "quantity",
      unit: "kg",
      unitFamily: "mass",
      aggregable: true,
      confidence: 100,
    });
  });

  it("converte unidades compatíveis antes de agregar", () => {
    expect(normalizeMeasurement("1.500,5 g", "kg")).toBeCloseTo(1.5005);
    expect(normalizeMeasurement("500 mL", "L")).toBe(0.5);
    expect(normalizeMeasurement("2 kg", "L")).toBeNull();
    const measurements: Row[] = [
      { grupo: "A", periodo: "Jan", peso: "1 kg" },
      { grupo: "A", periodo: "Jan", peso: "500 g" },
    ];
    expect(buildPivotMatrix(measurements, "grupo", "periodo", "peso", "sum", "kg")).toMatchObject({
      values: [[1.5]],
      grandTotal: 1.5,
    });
  });

  it("bloqueia famílias de unidade incompatíveis na mesma coluna", () => {
    const measurementColumn: Column = {
      key: "medida",
      label: "Medida",
      kind: "number",
      visible: true,
      description: "",
    };
    const exceptions = detectSpreadsheetExceptions(
      [{ medida: "1 kg" }, { medida: "2 L" }],
      [measurementColumn],
    );
    expect(exceptions).toContainEqual(
      expect.objectContaining({
        kind: "incompatible-unit",
        severity: "critical",
        columnKey: "medida",
      }),
    );
  });

  it("calcula médias e totais ponderados sem somar médias parciais", () => {
    const measurements: Row[] = [
      { grupo: "A", periodo: "Jan", valor: 10 },
      { grupo: "A", periodo: "Jan", valor: 20 },
      { grupo: "A", periodo: "Fev", valor: 90 },
    ];
    const pivot = buildPivotMatrix(measurements, "grupo", "periodo", "valor", "avg");
    expect(pivot.values).toEqual([[15, 90]]);
    expect(pivot.rowTotals).toEqual([40]);
    expect(pivot.grandTotal).toBe(40);
  });

  it("classifica bases financeiras, RH, estoque e laboratório", () => {
    const corpus: Array<[string, Column["kind"], string]> = [
      ["Receita total (R$)", "currency", "total"],
      ["Matrícula do colaborador", "number", "identifier"],
      ["Quantidade em estoque", "number", "quantity"],
      ["Resultado mg/L", "number", "result"],
      ["Data de vencimento", "date", "end-date"],
    ];
    for (const [label, kind, role] of corpus) {
      const column: Column = { key: label, label, kind, visible: true, description: "" };
      expect(inferSemanticProfile(column, []).role, label).toBe(role);
    }
  });

  it("processa cruzamentos grandes em uma única passagem", () => {
    const large = Array.from({ length: 20_000 }, (_, index) => ({
      grupo: `G${index % 50}`,
      periodo: `P${index % 12}`,
      valor: index % 7,
    }));
    const pivot = buildPivotMatrix(large, "grupo", "periodo", "valor", "sum");
    expect(pivot.rows).toHaveLength(50);
    expect(pivot.columns).toHaveLength(12);
    expect(pivot.grandTotal).toBe(59_997);
  });
});
