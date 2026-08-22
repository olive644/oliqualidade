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
  level: "alta",
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
  hyperlinks: [],
  definedNames: [],
  externalLinks: [],
  dataValidations: [],
  hasVbaMacros: false,
  images: [],
  shapes: [],
  charts: [],
  cellFills: [],
  calculatedColumns: [],
  autofilterRange: null,
  formulaExamples: [],
  sourceCellRepresentations: [],
  sourceNotes: [],
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

  it("nunca vira métrica nem dimensão quando a coluna não tem nenhum valor preenchido", () => {
    const numeric = classifyDashboardColumn(
      column("foto", "number"),
      diagnostic("foto", "number", { filled: 0, missing: 12 }),
    );
    expect(numeric.role).toBe("unsupported");
    expect(numeric.reasons.join(" ")).toContain("não tem nenhum valor preenchido");

    const categorical = classifyDashboardColumn(
      column("observacao", "text"),
      diagnostic("observacao", "text", { filled: 0, missing: 12 }),
    );
    expect(categorical.role).toBe("unsupported");
  });

  it("classifica normalmente quando a coluna tem ao menos um valor preenchido", () => {
    const result = classifyDashboardColumn(
      column("foto", "number"),
      diagnostic("foto", "number", { filled: 1, missing: 11 }),
    );
    expect(result.role).toBe("metric");
  });

  it.each(["revenue", "amount", "sales", "cost", "profit"])(
    'reconhece "%s" como medida empresarial em inglês, igual ao já feito em português',
    (name) => {
      // METRIC_NAME só tinha termos em português, diferente de
      // TEMPORAL_NAME/GEO_NAME/IDENTIFIER_NAME, que já eram bilíngues. Uma
      // coluna numérica chamada "revenue"/"amount" não ganhava o bônus de
      // confiança nem o motivo "medida empresarial", mesmo tendo o mesmo
      // papel de uma coluna "receita"/"valor".
      const result = classifyDashboardColumn(column(name, "number"), diagnostic(name, "number"));
      expect(result.role).toBe("metric");
      expect(result.reasons).toContain("O nome da coluna indica uma medida empresarial.");
    },
  );
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

  it("recomenda KPIs, série temporal, barras, mapa e tabela", () => {
    const plan = generateAutoDashboardPlan({ columns, rows, diagnostics: importDiagnostics });
    const types = plan.recommendations.map((item) => item.widgetType);
    expect(types).toContain("metric-trend");
    expect(types).toContain("area");
    expect(types).toContain("bar");
    expect(types).toContain("map");
    expect(types).toContain("table");
    expect(plan.classifications.find((item) => item.key === "id_pedido")?.role).toBe("identifier");
    expect(
      plan.recommendations.every((item) => item.confidence >= 0 && item.confidence <= 100),
    ).toBe(true);
  });

  it("marca a série temporal como gráfico principal (largura cheia) quando há coluna de data", () => {
    const plan = generateAutoDashboardPlan({ columns, rows, diagnostics: importDiagnostics });
    const areaRecommendation = plan.recommendations.find((item) => item.widgetType === "area");
    expect(areaRecommendation?.primary).toBe(true);
    const barRecommendations = plan.recommendations.filter((item) => item.widgetType === "bar");
    expect(barRecommendations.every((item) => !item.primary)).toBe(true);

    const widgets = buildRecommendedWidgets(plan, columns, rows);
    const areaWidget = widgets.find((w) => w.type === "area");
    expect(areaWidget?.span).toBe(3);
  });

  it("sem coluna de data, marca só a primeira dimensão como gráfico principal", () => {
    const columnsWithoutDate = columns.filter((c) => c.key !== "data_venda");
    const plan = generateAutoDashboardPlan({
      columns: columnsWithoutDate,
      rows,
      diagnostics: importDiagnostics,
    });
    const barRecommendations = plan.recommendations.filter(
      (item) => item.widgetType === "bar" || item.widgetType === "map",
    );
    expect(barRecommendations.filter((item) => item.primary)).toHaveLength(1);
    expect(barRecommendations[0]?.primary).toBe(true);
    expect(barRecommendations.slice(1).every((item) => !item.primary)).toBe(true);

    const widgets = buildRecommendedWidgets(plan, columnsWithoutDate, rows);
    const primaryWidget = widgets.find((w) => w.title === barRecommendations[0]?.title);
    expect(primaryWidget?.span).toBe(3);
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

  it("só recomenda ranking quando a barra sozinha ficaria longa demais para responder 'quem lidera'", () => {
    // "produto" tem só 3 categorias no fixture: a barra já mostra as três
    // ordenadas por valor, então um ranking ao lado seria a mesma informação
    // duas vezes. Ranking só ganha uma pergunta própria ("o topo concentra
    // quanto do restante?") quando sobra gente de fora do topN.
    const lowCardinality = generateAutoDashboardPlan({
      columns,
      rows,
      diagnostics: importDiagnostics,
    });
    expect(
      lowCardinality.recommendations.some(
        (item) => item.widgetType === "ranking" && item.groupKey === "produto",
      ),
    ).toBe(false);

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
        (item) => item.widgetType === "ranking" && item.groupKey === "produto",
      ),
    ).toBe(true);
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
    expect(widgets.find((item) => item.type === "area")?.groupKey).toBe("data_venda");
    expect(widgets.every((item) => Boolean(item.title))).toBe(true);
  });

  it("escolhe as dimensões por confiança/qualidade, não pela ordem da planilha", () => {
    // As duas primeiras colunas categóricas da planilha ("setor", "turno")
    // têm qualidade ruim (baixa confiança do diagnóstico, qualityScore
    // abaixo de 70), enquanto a terceira ("linha_producao") é praticamente
    // perfeita. Antes desta correção, `dimensions.slice(0, 2)` pegava
    // sempre as 2 primeiras da planilha nessa ordem — a coluna de melhor
    // qualidade nunca virava gráfico de barra/ranking por estar em 3º
    // lugar, mesmo sendo claramente a mais confiável.
    const rankedColumns = [
      column("faturamento", "currency"),
      column("setor", "category"),
      column("turno", "category"),
      column("linha_producao", "category"),
    ];
    const rankedRows: Row[] = Array.from({ length: 12 }, (_, index) => ({
      faturamento: 100 + index,
      setor: ["A", "B", "C"][index % 3] ?? "A",
      turno: ["Manha", "Tarde"][index % 2] ?? "Manha",
      linha_producao: ["L1", "L2", "L3"][index % 3] ?? "L1",
    }));
    const rankedDiagnostics = diagnostics([
      diagnostic("faturamento", "currency"),
      diagnostic("setor", "category", { unique: 3, confidence: 0.5, qualityScore: 50 }),
      diagnostic("turno", "category", { unique: 2, confidence: 0.5, qualityScore: 50 }),
      diagnostic("linha_producao", "category", { unique: 3, confidence: 0.99, qualityScore: 99 }),
    ]);
    const plan = generateAutoDashboardPlan({
      columns: rankedColumns,
      rows: rankedRows,
      diagnostics: rankedDiagnostics,
    });
    const barGroupKeys = plan.recommendations
      .filter((item) => item.widgetType === "bar")
      .map((item) => item.groupKey);
    expect(barGroupKeys).toContain("linha_producao");
    expect(barGroupKeys).not.toContain("turno");
  });

  it.each(["Localidade", "Endereço", "Território"])(
    'reconhece "%s" como dimensão geográfica e recomenda mapa em vez de barras',
    (geoLabel) => {
      // GEO_NAME só reconhecia um subconjunto do vocabulário já usado em
      // LOCATION_KEY_HINT (widgets.ts) — cidade/estado/país/região, mas não
      // localidade/endereço/território. Uma coluna assim virava um gráfico
      // de barras genérico em vez de mapa, mesmo sendo claramente
      // geográfica.
      const geoColumns = [column("faturamento", "currency"), column(geoLabel, "category")];
      const geoRows: Row[] = Array.from({ length: 6 }, (_, index) => ({
        faturamento: 100 + index,
        [geoLabel]: ["A", "B", "C"][index % 3] ?? "A",
      }));
      const geoDiagnostics = diagnostics([
        diagnostic("faturamento", "currency"),
        diagnostic(geoLabel, "category", { unique: 3 }),
      ]);
      const plan = generateAutoDashboardPlan({
        columns: geoColumns,
        rows: geoRows,
        diagnostics: geoDiagnostics,
      });
      expect(plan.recommendations.some((item) => item.widgetType === "map")).toBe(true);
    },
  );

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
      plan.recommendations.some((item) => item.widgetType === "area" && item.op === "count"),
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

  it("não sugere agregações enganosas para formulários operacionais especializados", () => {
    const columns = [
      column("Hora", "text"),
      column("Referência", "text"),
      column("Aceita", "number"),
      column("Rejeita", "number"),
      column("Resultado", "text"),
      column("Inspetor", "text"),
    ];
    const plan = generateAutoDashboardPlan({ columns, rows: [] });
    expect(plan.recommendations.map((item) => item.widgetType)).toEqual(["table"]);
    expect(plan.reasons.join(" ")).toContain("matriz de validação por horário");
  });
});
