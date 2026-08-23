import { describe, expect, it } from "vitest";

import {
  boxPlotChartValidity,
  histogramChartValidity,
  paretoChartValidity,
  scatterChartValidity,
} from "@/lib/chart-validity";

describe("validade compartilhada dos gráficos", () => {
  it("explica quando faltam valores para o histograma", () => {
    const result = histogramChartValidity(Array.from({ length: 19 }, (_, index) => index));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("ao menos 20");
    expect(result.reason).toContain("há 19");
  });

  it("aceita histograma com amostra e variedade suficientes", () => {
    expect(histogramChartValidity(Array.from({ length: 20 }, (_, index) => index)).valid).toBe(
      true,
    );
  });

  it("exige pares e variação nos dois eixos da dispersão", () => {
    const fewPairs = scatterChartValidity(
      Array.from({ length: 7 }, (_, index) => ({ x: index, y: index * 2 })),
    );
    expect(fewPairs.reason).toContain("8 pares");
    const constantAxis = scatterChartValidity(
      Array.from({ length: 8 }, (_, index) => ({ x: 1, y: index })),
    );
    expect(constantAxis.reason).toContain("1 em X");
  });

  it("exige categorias repetidas e com variação no box plot", () => {
    const sparse = boxPlotChartValidity(
      new Map([
        ["A", [1, 2, 3]],
        ["B", [4, 5, 6, 7]],
      ]),
    );
    expect(sparse.reason).toContain("4 valores");
    const constant = boxPlotChartValidity(
      new Map([
        ["A", [1, 1, 1, 1]],
        ["B", [2, 3, 4, 5]],
      ]),
    );
    expect(constant.reason).toContain("precisa de variação");
  });

  it("recusa contribuições negativas no Pareto", () => {
    const result = paretoChartValidity(
      new Map([
        ["A", [10]],
        ["B", [-2]],
        ["C", [5]],
      ]),
    );
    expect(result.reason).toContain("contribuições negativas");
  });
});
