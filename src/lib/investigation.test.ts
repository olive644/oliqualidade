import { describe, expect, it } from "vitest";
import { buildInvestigation } from "./investigation";

describe("buildInvestigation", () => {
  it("explica a mudança entre os dois períodos mais recentes por categoria", () => {
    const result = buildInvestigation({
      rows: [
        { data: "2026-01-01", equipe: "A", valor: 10 },
        { data: "2026-01-01", equipe: "B", valor: 20 },
        { data: "2026-02-01", equipe: "A", valor: 25 },
        { data: "2026-02-01", equipe: "B", valor: 15 },
      ],
      metric: { key: "valor" },
      dimension: { key: "equipe" },
      date: { key: "data" },
      operation: "sum",
    });

    expect(result).toMatchObject({
      mode: "period-change",
      previousPeriod: "2026-01-01",
      currentPeriod: "2026-02-01",
      previousValue: 30,
      currentValue: 40,
      difference: 10,
      recordCount: 4,
    });
    expect(result.causes.map((cause) => [cause.name, cause.difference])).toEqual([
      ["A", 15],
      ["B", -5],
    ]);
    expect(result.causes.map((cause) => cause.shareOfMovement)).toEqual([0.75, 0.25]);
    expect(result.nextStep).toBe("bar");
  });

  it("usa contribuição atual quando não existem dois períodos", () => {
    const result = buildInvestigation({
      rows: [
        { equipe: "A", valor: 30 },
        { equipe: "B", valor: 10 },
      ],
      metric: { key: "valor" },
      dimension: { key: "equipe" },
      operation: "sum",
    });

    expect(result.mode).toBe("current-contribution");
    expect(result.previousValue).toBeNull();
    expect(result.causes[0]).toMatchObject({ name: "A", difference: 30 });
    expect(result.nextStep).toBe("pareto");
  });

  it("mantém valores negativos sem chamar a direção de boa ou ruim", () => {
    const result = buildInvestigation({
      rows: [
        { data: "2026-01-01", equipe: "A", valor: -5 },
        { data: "2026-02-01", equipe: "A", valor: -12 },
      ],
      metric: { key: "valor" },
      dimension: { key: "equipe" },
      date: { key: "data" },
      operation: "sum",
    });

    expect(result.difference).toBe(-7);
    expect(result.causes[0]?.difference).toBe(-7);
    expect(result.causes[0]?.shareOfMovement).toBe(1);
  });
});
