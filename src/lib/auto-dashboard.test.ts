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
  baseConfidence: 94,
  recoveryGain: 0,
  confidenceReasons: [],
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
  sourceCellRepresentations: [],
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

  it("gera categorias por contagem quando a base só possui códigos e textos", () => {
    const controlColumns = [
      column("Código", "text"),
      column("Data G", "date"),
      column("Responsável", "category"),
      column("Status", "category"),
    ];
    const controlRows: Row[] = [
      { Código: "A1", "Data G": "01/08/2026", Responsável: "Ana", Status: "Enviado" },
      { Código: "A2", "Data G": "02/08/2026", Responsável: "Beto", Status: "Pendente" },
      { Código: "A3", "Data G": "02/08/2026", Responsável: "Ana", Status: "Enviado" },
    ];
    const controlDiagnostics = diagnostics([
      diagnostic("Código", "id"),
      diagnostic("Data G", "date"),
      diagnostic("Responsável", "category"),
      diagnostic("Status", "category"),
    ]);
    const plan = generateAutoDashboardPlan({
      columns: controlColumns,
      rows: controlRows,
      diagnostics: controlDiagnostics,
    });
    const categoryCharts = plan.recommendations.filter(
      (item) => item.op === "count" && item.groupKey === "Responsável",
    );
    expect(categoryCharts.some((item) => item.widgetType === "bar")).toBe(true);
    expect(categoryCharts.every((item) => item.valueKey === "Código")).toBe(true);
    expect(
      plan.recommendations.some((item) => item.widgetType === "line" && item.op === "count"),
    ).toBe(true);
    expect(plan.recommendations.some((item) => item.kind === "kpi")).toBe(false);
  });

  it("recomenda cronograma visual para uma tabela larga com meses", () => {
    const scheduleColumns = [
      column("Ponto", "category"),
      column("Situação", "category"),
      column("jan", "category"),
      column("fev", "category"),
      column("mar", "category"),
      column("abr", "category"),
    ];
    const scheduleRows: Row[] = [
      { Ponto: "Poço", Situação: "Planejado", jan: "M", fev: null, mar: "T", abr: null },
      { Ponto: "Poço", Situação: "Executado", jan: "C", fev: null, mar: null, abr: null },
    ];
    const plan = generateAutoDashboardPlan({ columns: scheduleColumns, rows: scheduleRows });
    const recommendation = plan.recommendations.find(
      (item) => item.widgetType === "schedule-heatmap",
    );
    expect(recommendation?.groupKey).toBe("Ponto");
    const widget = buildRecommendedWidgets(plan, scheduleColumns, scheduleRows).find(
      (item) => item.type === "schedule-heatmap",
    );
    expect(widget).toMatchObject({
      groupKey: "Ponto",
      statusKey: "Situação",
      periodKeys: ["jan", "fev", "mar", "abr"],
    });
    expect(plan.recommendations.some((item) => item.kind === "kpi")).toBe(false);
  });

  it("em cronogramas por bloco cria um cronograma visual separado para cada bloco", () => {
    const scheduleColumns = [
      column("Bloco", "category"),
      column("Ponto / Item", "category"),
      column("jun/2025", "number"),
      column("set/2025", "number"),
      column("dez/2025", "number"),
      column("Máx.", "number"),
    ];
    const scheduleRows: Row[] = [
      {
        Bloco: "Bolores",
        "Ponto / Item": "Injetora 1",
        "jun/2025": 4,
        "set/2025": null,
        "dez/2025": null,
        "Máx.": 25,
      },
      {
        Bloco: "Mesófilos",
        "Ponto / Item": "Injetora 1",
        "jun/2025": 2,
        "set/2025": null,
        "dez/2025": null,
        "Máx.": 50,
      },
    ];
    const plan = generateAutoDashboardPlan({ columns: scheduleColumns, rows: scheduleRows });
    expect(plan.recommendations.map((item) => item.widgetType)).toEqual([
      "schedule-heatmap",
      "schedule-heatmap",
      "table",
    ]);
    expect(
      plan.recommendations
        .filter((item) => item.widgetType === "schedule-heatmap")
        .map((item) => ({
          title: item.title,
          blockKey: item.blockKey,
          blockValue: item.blockValue,
        })),
    ).toEqual([
      { title: "Bolores", blockKey: "Bloco", blockValue: "Bolores" },
      { title: "Mesófilos", blockKey: "Bloco", blockValue: "Mesófilos" },
    ]);
    expect(
      buildRecommendedWidgets(plan, scheduleColumns, scheduleRows)
        .filter((item) => item.type === "schedule-heatmap")
        .map((item) => ({
          title: item.title,
          blockKey: item.blockKey,
          blockValue: item.blockValue,
          sectionKey: item.sectionKey,
        })),
    ).toEqual([
      { title: "Bolores", blockKey: "Bloco", blockValue: "Bolores", sectionKey: "" },
      { title: "Mesófilos", blockKey: "Bloco", blockValue: "Mesófilos", sectionKey: "" },
    ]);
    expect(plan.recommendations.some((item) => item.op === "sum")).toBe(false);
  });

  it("não transforma subcolunas de máquina, gramatura, amostras e análise em períodos", () => {
    const columns = [
      column("1° coleta - Março — Produto — Máquina", "category"),
      column("1° coleta - Março — Produto — Gramatura", "text"),
      column("1° coleta - Março — Produto — N° de amostras", "number"),
      column("1° coleta - Março — Produto — Análise", "text"),
      column("2° coleta - Junho — Produto — Máquina", "category"),
      column("2° coleta - Junho — Produto — Análise", "text"),
      column("3° coleta - Setembro — Produto — Máquina", "category"),
      column("4° coleta - Dezembro — Produto — Análise", "text"),
    ];
    const plan = generateAutoDashboardPlan({ columns, rows: [] });
    expect(plan.recommendations.some((item) => item.widgetType === "schedule-heatmap")).toBe(false);
  });
});
