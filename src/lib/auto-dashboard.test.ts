import { describe, expect, it } from "vitest";

import {
  buildRecommendedWidgets,
  classifyDashboardColumn,
  generateAutoDashboardPlan,
} from "@/lib/auto-dashboard";
import type { ColumnDiagnostic, ImportDiagnostics } from "@/lib/import-intelligence";
import type { Column, Row } from "@/lib/types";

const column = (key: string, kind: Column["kind"]): Column => ({
  key,
  label: key,
  kind,
  visible: true,
  description: "",
});

const diagnostic = (
  key: string,
  kind: ColumnDiagnostic["kind"],
  options: Partial<ColumnDiagnostic> = {},
): ColumnDiagnostic => ({
  key,
  label: key,
  kind,
  confidence: 0.95,
  filled: 12,
  missing: 0,
  unique: 6,
  duplicate: 6,
  examples: [],
  sensitive: false,
  warnings: [],
  qualityScore: 95,
  ...options,
});

const diagnostics = (columns: ColumnDiagnostic[]): ImportDiagnostics => ({
  confidence: 94,
  qualityScore: 92,
  columns,
  warnings: [],
  rowCount: 12,
  columnCount: columns.length,
  duplicateRows: 0,
  emptyRows: 0,
  formulaCells: 0,
  mergedRanges: 0,
  hiddenRows: 0,
  hiddenColumns: 0,
  hasAutoFilter: false,
  hasTables: false,
  structuredTableNames: [],
  structuredTables: [],
  pivotTables: [],
  calculatedColumns: [],
  autofilterRange: null,
  formulaExamples: [],
  formulaDiagnostics: [],
  tableRegions: [],
  transformations: [],
  suggestedNormalization: [],
  header: { row: 1, confidence: 0.95 },
});

describe("classifyDashboardColumn", () => {
  it("não transforma identificador numérico em métrica", () => {
    const result = classifyDashboardColumn(
      column("numero_pedido", "number"),
      diagnostic("numero_pedido", "integer"),
    );
    expect(result.role).toBe("identifier");
    expect(result.reasons.join(" ")).toContain("não deve ser agregada");
  });

  it("reconhece rótulos Nº como identificadores", () => {
    const result = classifyDashboardColumn(column("Nº 1", "text"), diagnostic("Nº 1", "integer"));
    expect(result.role).toBe("identifier");
  });

  it("prioriza a marcação de dado sensível", () => {
    const result = classifyDashboardColumn(
      column("cpf", "number"),
      diagnostic("cpf", "cpf", { sensitive: true }),
    );
    expect(result.role).toBe("identifier");
    expect(result.confidence).toBeGreaterThan(90);
  });
});

describe("generateAutoDashboardPlan", () => {
  const columns = [
    column("data_venda", "date"),
    column("faturamento", "currency"),
    column("custo", "currency"),
    column("produto", "category"),
    column("cidade", "category"),
    column("id_pedido", "number"),
  ];
  const rows: Row[] = Array.from({ length: 12 }, (_, index) => ({
    data_venda: `2026-${String((index % 6) + 1).padStart(2, "0")}-01`,
    faturamento: 100 + index,
    custo: 50 + index,
    produto: ["A", "B", "C"][index % 3] ?? "A",
    cidade: index % 2 ? "Curitiba" : "São Paulo",
    id_pedido: index + 1,
  }));
  const importDiagnostics = diagnostics([
    diagnostic("data_venda", "date"),
    diagnostic("faturamento", "currency"),
    diagnostic("custo", "currency"),
    diagnostic("produto", "category", { unique: 3 }),
    diagnostic("cidade", "category", { unique: 2 }),
    diagnostic("id_pedido", "id"),
  ]);

  it("recomenda KPIs, série temporal, barras, ranking, mapa e tabela", () => {
    const plan = generateAutoDashboardPlan({ columns, rows, diagnostics: importDiagnostics });
    const types = plan.recommendations.map((item) => item.widgetType);
    expect(types).toContain("metric-trend");
    expect(types).toContain("line");
    expect(types).toContain("bar");
    expect(types).toContain("ranking");
    expect(types).toContain("map");
    expect(types).toContain("table");
    expect(plan.classifications.find((item) => item.key === "id_pedido")?.role).toBe("identifier");
    expect(
      plan.recommendations.every((item) => item.confidence >= 0 && item.confidence <= 100),
    ).toBe(true);
  });

  it("só usa pizza quando a dimensão tem cardinalidade baixa", () => {
    const lowCardinality = generateAutoDashboardPlan({
      columns,
      rows,
      diagnostics: importDiagnostics,
    });
    expect(lowCardinality.recommendations.some((item) => item.widgetType === "pie")).toBe(true);

    const manyRows = Array.from({ length: 50 }, (_, index) => ({
      ...rows[index % rows.length],
      produto: `Produto ${index}`,
    }));
    const highCardinality = generateAutoDashboardPlan({
      columns,
      rows: manyRows,
      diagnostics: importDiagnostics,
    });
    expect(
      highCardinality.recommendations.some(
        (item) => item.widgetType === "pie" && item.groupKey === "produto",
      ),
    ).toBe(false);
  });

  it("reduz confiança e explica dados ausentes", () => {
    const poor = diagnostics([
      diagnostic("faturamento", "currency", { qualityScore: 50, missing: 4, filled: 8 }),
    ]);
    const plan = generateAutoDashboardPlan({
      columns: [column("faturamento", "currency")],
      rows,
      diagnostics: poor,
    });
    const kpi = plan.recommendations.find((item) => item.kind === "kpi");
    expect(kpi?.warnings.join(" ")).toContain("ausente");
    expect(kpi?.confidence).toBeLessThan(90);
  });

  it("converte o plano em widgets usando o motor existente", () => {
    const plan = generateAutoDashboardPlan({ columns, rows, diagnostics: importDiagnostics });
    const widgets = buildRecommendedWidgets(plan, columns, rows);
    expect(widgets).toHaveLength(plan.recommendations.length);
    expect(widgets.find((item) => item.type === "line")?.groupKey).toBe("data_venda");
    expect(widgets.every((item) => Boolean(item.title))).toBe(true);
  });
});
