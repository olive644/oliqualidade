import { describe, expect, it } from "vitest";

import { analyzeQuestionCoverage, buildExecutiveSummary } from "@/lib/analytical-narrative";
import type { DashboardColumnClassification } from "@/lib/auto-dashboard";
import type { Column, Row, Widget } from "@/lib/types";

const classification = (
  key: string,
  role: DashboardColumnClassification["role"],
  confidence = 90,
): DashboardColumnClassification => ({
  key,
  label: key,
  role,
  confidence,
  reasons: [],
  warnings: [],
});

const widget = (type: Widget["type"], fields: Partial<Widget> = {}): Widget => ({
  id: `w_${type}`,
  type,
  span: 1,
  size: "md",
  ...fields,
});

describe("analyzeQuestionCoverage", () => {
  const fullClassifications: DashboardColumnClassification[] = [
    classification("data", "temporal-dimension"),
    classification("resultado", "metric"),
    classification("amostras", "metric"),
    classification("unidade", "dimension"),
  ];

  it("identifica todas as perguntas respondíveis quando há métrica, dimensão, temporal e duas métricas", () => {
    const coverage = analyzeQuestionCoverage(fullClassifications, []);
    const ids = coverage.answerable.map((q) => q.id).sort();
    expect(ids).toEqual([
      "anomalies",
      "correlation",
      "current-value",
      "distribution",
      "root-causes",
      "share-of-total",
      "trend-over-time",
      "who-is-bigger",
    ]);
  });

  it("sem nenhum widget, nenhuma pergunta respondível está coberta", () => {
    const coverage = analyzeQuestionCoverage(fullClassifications, []);
    expect(coverage.covered).toEqual([]);
    expect(coverage.uncovered.length).toBe(coverage.answerable.length);
  });

  it("marca como coberta só a pergunta cujo widget usa as colunas relevantes", () => {
    const coverage = analyzeQuestionCoverage(fullClassifications, [
      widget("bar", { groupKey: "unidade", valueKey: "resultado" }),
      widget("line", { groupKey: "data", valueKey: "resultado" }),
    ]);
    expect(coverage.covered.map((q) => q.id).sort()).toEqual(["trend-over-time", "who-is-bigger"]);
  });

  it("não trata um tipo de gráfico correto com a métrica errada como cobertura", () => {
    const coverage = analyzeQuestionCoverage(fullClassifications, [
      widget("bar", { groupKey: "unidade", valueKey: "amostras" }),
      widget("line", { groupKey: "data", valueKey: "amostras" }),
    ]);
    expect(coverage.covered.map((q) => q.id)).not.toContain("who-is-bigger");
    expect(coverage.covered.map((q) => q.id)).not.toContain("trend-over-time");
  });

  it("aceita dispersão das duas métricas primárias em qualquer ordem", () => {
    const direct = analyzeQuestionCoverage(fullClassifications, [
      widget("scatter", { valueKey: "resultado", valueKey2: "amostras" }),
    ]);
    const inverse = analyzeQuestionCoverage(fullClassifications, [
      widget("scatter", { valueKey: "amostras", valueKey2: "resultado" }),
    ]);
    expect(direct.covered.map((q) => q.id)).toContain("correlation");
    expect(inverse.covered.map((q) => q.id)).toContain("correlation");
  });

  it("explica por que 'como mudou no tempo' não é respondível sem coluna temporal", () => {
    const withoutTemporal = [
      classification("resultado", "metric"),
      classification("unidade", "dimension"),
    ];
    const coverage = analyzeQuestionCoverage(withoutTemporal, []);
    const trend = coverage.questions.find((q) => q.id === "trend-over-time");
    expect(trend?.answerable).toBe(false);
    expect(trend?.reason).toContain("data confiável");
    expect(coverage.summary).toContain('Não foi possível responder "Como mudou no tempo?"');
  });

  it("explica por que 'duas variáveis têm relação' precisa de pelo menos duas métricas", () => {
    const oneMetric = [
      classification("resultado", "metric"),
      classification("unidade", "dimension"),
    ];
    const coverage = analyzeQuestionCoverage(oneMetric, []);
    const correlation = coverage.questions.find((q) => q.id === "correlation");
    expect(correlation?.answerable).toBe(false);
    expect(correlation?.reason).toContain("só há uma coluna");
  });

  it("sem nenhuma coluna classificada, nenhuma pergunta é respondível", () => {
    const coverage = analyzeQuestionCoverage([], []);
    expect(coverage.answerable).toEqual([]);
    expect(coverage.summary).toContain("Foram identificadas 0 perguntas analíticas possíveis");
  });
});

describe("buildExecutiveSummary", () => {
  const columns: Column[] = [
    { key: "unidade", label: "Unidade", kind: "category", visible: true, description: "" },
    { key: "resultado", label: "Resultado", kind: "number", visible: true, description: "" },
    { key: "data", label: "Data", kind: "date", visible: true, description: "" },
  ];
  const classifications: DashboardColumnClassification[] = [
    classification("unidade", "dimension"),
    classification("resultado", "metric"),
    classification("data", "temporal-dimension"),
  ];

  it("resume a categoria líder e sua participação, com ressalva de meta ausente", () => {
    const rows: Row[] = [
      { unidade: "A", resultado: 70 },
      { unidade: "B", resultado: 30 },
    ];
    const sentences = buildExecutiveSummary({ rows, columns, classifications, exceptionCount: 0 });
    expect(sentences[0]).toContain('"A" concentra');
    expect(sentences[0]).toContain("70");
    expect(sentences.some((s) => s.includes("Não existe meta cadastrada"))).toBe(true);
  });

  it("não inclui a ressalva de meta ausente quando existe uma coluna de meta", () => {
    const columnsWithGoal: Column[] = [
      ...columns,
      { key: "meta", label: "Meta", kind: "number", visible: true, description: "" },
    ];
    const rows: Row[] = [
      { unidade: "A", resultado: 70, meta: 50 },
      { unidade: "B", resultado: 30, meta: 50 },
    ];
    const sentences = buildExecutiveSummary({
      rows,
      columns: columnsWithGoal,
      classifications,
      exceptionCount: 0,
    });
    expect(sentences.some((s) => s.includes("Não existe meta cadastrada"))).toBe(false);
  });

  it("resume a tendência temporal quando há coluna de data e ao menos 2 pontos", () => {
    const rows: Row[] = [
      { unidade: "A", resultado: 10, data: "2026-01-01" },
      { unidade: "A", resultado: 20, data: "2026-02-01" },
      { unidade: "A", resultado: 40, data: "2026-03-01" },
    ];
    const sentences = buildExecutiveSummary({ rows, columns, classifications, exceptionCount: 0 });
    const trendSentence = sentences.find((s) => s.includes("períodos"));
    expect(trendSentence).toBeDefined();
    expect(trendSentence).toContain("+300");
  });

  it("inclui a contagem de inconsistências quando há alguma", () => {
    const rows: Row[] = [{ unidade: "A", resultado: 10 }];
    const sentences = buildExecutiveSummary({ rows, columns, classifications, exceptionCount: 3 });
    expect(sentences.some((s) => s.includes("3 inconsistências foram encontradas"))).toBe(true);
  });

  it("não produz frase de concentração nem de tendência sem dimensão/temporal (planilha pobre em contexto)", () => {
    const onlyMetric: DashboardColumnClassification[] = [classification("resultado", "metric")];
    const rows: Row[] = [{ resultado: 10 }];
    const sentences = buildExecutiveSummary({
      rows,
      columns,
      classifications: onlyMetric,
      exceptionCount: 0,
    });
    expect(sentences).toEqual([]);
  });
});
