import { describe, expect, it } from "vitest";
import { barTooltipReading, periodPointReading } from "./chart-reading";

const ranking = [
  { total: 100, count: 40 },
  { total: 82, count: 12 },
  { total: 31, count: 2 },
];

describe("barTooltipReading", () => {
  it("não compara com o vizinho anterior quando o eixo é de categorias", () => {
    // Bug real: as barras chegam ordenadas da maior para a menor, então o
    // vizinho anterior é só a categoria de valor mais alto. O tooltip
    // mostrava "↓ 18%" nesse ponto e a leitura virava "caiu 18%".
    const reading = barTooltipReading({
      index: 1,
      series: ranking,
      mode: "aggregate",
      axis: "category",
    });
    expect(reading.changeFromPrevious).toBeNull();
  });

  it("compara com a maior barra do gráfico em eixo de categorias", () => {
    const reading = barTooltipReading({
      index: 1,
      series: ranking,
      mode: "aggregate",
      axis: "category",
    });
    expect(reading.shareOfLargest).toBeCloseTo(82, 10);
  });

  it("não afirma nada sobre proporção quando o ponto é a maior barra", () => {
    const reading = barTooltipReading({
      index: 0,
      series: ranking,
      mode: "aggregate",
      axis: "category",
    });
    expect(reading.shareOfLargest).toBeNull();
  });

  it("compara com o período anterior quando o eixo é cronológico", () => {
    const reading = barTooltipReading({
      index: 1,
      series: [{ total: 200 }, { total: 250 }],
      mode: "aggregate",
      axis: "time",
    });
    expect(reading.changeFromPrevious).toBeCloseTo(25, 10);
  });

  it("não divide por zero quando o período anterior é zero", () => {
    const reading = barTooltipReading({
      index: 1,
      series: [{ total: 0 }, { total: 250 }],
      mode: "aggregate",
      axis: "time",
    });
    expect(reading.changeFromPrevious).toBeNull();
  });

  it("não compara o primeiro ponto de uma série cronológica com nada", () => {
    const reading = barTooltipReading({
      index: 0,
      series: [{ total: 200 }, { total: 250 }],
      mode: "aggregate",
      axis: "time",
    });
    expect(reading.changeFromPrevious).toBeNull();
  });

  it("informa quantos registros sustentam a barra no modo agrupado", () => {
    const reading = barTooltipReading({
      index: 2,
      series: ranking,
      mode: "aggregate",
      axis: "category",
    });
    expect(reading.count).toBe(2);
  });

  it("omite a contagem no modo linha a linha, onde cada marca já é uma linha", () => {
    const reading = barTooltipReading({
      index: 2,
      series: ranking,
      mode: "raw",
      axis: "category",
    });
    expect(reading.count).toBeNull();
  });

  it("não quebra quando o ponto sob o mouse não existe mais na série", () => {
    expect(
      barTooltipReading({ index: -1, series: ranking, mode: "aggregate", axis: "category" }),
    ).toEqual({ changeFromPrevious: null, shareOfLargest: null, count: null });
  });
});

describe("periodPointReading", () => {
  it("compara com o período anterior", () => {
    const reading = periodPointReading({
      index: 1,
      series: [{ total: 200 }, { total: 250 }],
      mode: "aggregate",
    });
    expect(reading.changeFromPrevious).toBeCloseTo(25, 10);
  });

  it("não divide por zero quando o período anterior é zero", () => {
    const reading = periodPointReading({
      index: 1,
      series: [{ total: 0 }, { total: 250 }],
      mode: "aggregate",
    });
    expect(reading.changeFromPrevious).toBeNull();
  });

  it("não compara o primeiro ponto da série com nada", () => {
    const reading = periodPointReading({
      index: 0,
      series: [{ total: 200 }, { total: 250 }],
      mode: "aggregate",
    });
    expect(reading.changeFromPrevious).toBeNull();
  });

  it("informa quantos registros sustentam o ponto no modo agrupado", () => {
    const reading = periodPointReading({ index: 2, series: ranking, mode: "aggregate" });
    expect(reading.count).toBe(2);
  });

  it("omite a contagem no modo linha a linha, onde cada marca já é uma linha", () => {
    const reading = periodPointReading({ index: 2, series: ranking, mode: "raw" });
    expect(reading.count).toBeNull();
  });

  it("não quebra quando o ponto sob o mouse não existe mais na série", () => {
    expect(periodPointReading({ index: -1, series: ranking, mode: "aggregate" })).toEqual({
      changeFromPrevious: null,
      count: null,
      vsAverage: null,
      isHighest: false,
      isLowest: false,
    });
  });

  const periodo = [{ total: 100 }, { total: 150 }, { total: 90 }, { total: 300 }, { total: 200 }];

  it("compara com a média do período", () => {
    // Média de [100, 150, 90, 300, 200] é 168; 300 fica (300-168)/168 = 78,57% acima.
    const reading = periodPointReading({ index: 3, series: periodo, mode: "aggregate" });
    expect(reading.vsAverage).toBeCloseTo(((300 - 168) / 168) * 100, 6);
  });

  it("marca o maior valor do período", () => {
    const reading = periodPointReading({ index: 3, series: periodo, mode: "aggregate" });
    expect(reading.isHighest).toBe(true);
    expect(reading.isLowest).toBe(false);
  });

  it("marca o menor valor do período", () => {
    const reading = periodPointReading({ index: 2, series: periodo, mode: "aggregate" });
    expect(reading.isLowest).toBe(true);
    expect(reading.isHighest).toBe(false);
  });

  it("não marca pico nem vale com menos de três pontos, mesmo motivo de seriesAverage", () => {
    const curta = [{ total: 10 }, { total: 20 }];
    const reading = periodPointReading({ index: 1, series: curta, mode: "aggregate" });
    expect(reading.isHighest).toBe(false);
    expect(reading.isLowest).toBe(false);
    expect(reading.vsAverage).toBeNull();
  });
});
