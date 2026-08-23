import { describe, expect, it } from "vitest";
import { markSourceRows } from "@/lib/data-review";
import { buildWidgetEvidence } from "@/lib/widget-evidence";
import type { ColumnSemanticProfile } from "@/lib/spreadsheet-intelligence";
import type { Column, Widget } from "@/lib/types";

const columns: Column[] = [
  {
    key: "setor",
    label: "Setor",
    kind: "category",
    visible: true,
    description: "",
  },
  {
    key: "valor",
    label: "Valor",
    kind: "currency",
    visible: true,
    description: "",
  },
];

const profiles: ColumnSemanticProfile[] = [
  {
    key: "valor",
    label: "Valor",
    role: "total",
    unit: "R$",
    unitFamily: "currency",
    aggregable: true,
    confidence: 0.88,
    reasons: [],
    warnings: [],
  },
];

const widget: Widget = {
  id: "w1",
  type: "bar",
  groupKey: "setor",
  valueKey: "valor",
  op: "avg",
  dataMode: "aggregate",
  span: 1,
  size: "md",
};

describe("evidência analítica dos widgets", () => {
  it("expõe fonte, cálculo, validade, filtros, unidade e confiança no mesmo contrato", () => {
    const data = markSourceRows([
      { setor: "A", valor: 10 },
      { setor: "B", valor: 20 },
      { setor: "C", valor: null },
    ]);
    const evidence = buildWidgetEvidence({
      widget,
      data,
      columns,
      semanticProfiles: profiles,
      sourceSheetName: "Vendas",
      sourceCellProvenance: [
        {
          rowIndex: 0,
          columnKey: "setor",
          sourceAddress: "A2",
          sourceRow: 2,
          sourceColumn: 1,
          rawValue: "A",
          displayValue: "A",
          status: "exact",
          mappingConfidence: 1,
        },
        {
          rowIndex: 0,
          columnKey: "valor",
          sourceAddress: "B2",
          sourceRow: 2,
          sourceColumn: 2,
          rawValue: 10,
          displayValue: "R$ 10,00",
          status: "exact",
          mappingConfidence: 1,
        },
        {
          rowIndex: 1,
          columnKey: "setor",
          sourceAddress: "A3",
          sourceRow: 3,
          sourceColumn: 1,
          rawValue: "B",
          displayValue: "B",
          status: "exact",
          mappingConfidence: 1,
        },
        {
          rowIndex: 1,
          columnKey: "valor",
          sourceAddress: "B3",
          sourceRow: 3,
          sourceColumn: 2,
          rawValue: 20,
          displayValue: "R$ 20,00",
          status: "exact",
          mappingConfidence: 1,
        },
        {
          rowIndex: 2,
          columnKey: "setor",
          sourceAddress: "A4",
          sourceRow: 4,
          sourceColumn: 1,
          rawValue: "C",
          displayValue: "C",
          status: "exact",
          mappingConfidence: 1,
        },
        {
          rowIndex: 2,
          columnKey: "valor",
          sourceAddress: "B4",
          sourceRow: 4,
          sourceColumn: 2,
          rawValue: null,
          displayValue: null,
          status: "exact",
          mappingConfidence: 1,
        },
      ],
      activeFilterCount: 2,
    });

    expect(evidence).toEqual({
      source: "Vendas!A2:B4",
      operation: "Soma",
      validRecords: 2,
      visibleRecords: 3,
      activeFilters: 2,
      unit: "R$",
      formula: "SOMA(Valor) por Setor",
      confidence: 88,
    });
  });

  it("não acrescenta uma faixa analítica a widgets sem cálculo", () => {
    expect(
      buildWidgetEvidence({
        widget: { ...widget, type: "table" },
        data: [],
        columns,
        semanticProfiles: profiles,
        sourceSheetName: "Vendas",
        sourceCellProvenance: [],
        activeFilterCount: 0,
      }),
    ).toBeNull();
  });
});
