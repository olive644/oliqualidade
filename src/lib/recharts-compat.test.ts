import { describe, expect, it } from "vitest";
import {
  chartLabelCenter,
  chartTooltipName,
  finiteChartCoordinate,
  formatChartTooltipValue,
  numericChartTooltipValue,
  seriesPointFromChartPayload,
  sourceRowFromChartPayload,
} from "./recharts-compat";

describe("compatibilidade com contratos do Recharts 3", () => {
  it("normaliza apenas coordenadas finitas", () => {
    expect(finiteChartCoordinate(12)).toBe(12);
    expect(finiteChartCoordinate(" 12.5 ")).toBe(12.5);
    expect(finiteChartCoordinate(0)).toBe(0);
    expect(finiteChartCoordinate(undefined)).toBeNull();
    expect(finiteChartCoordinate("não numérico")).toBeNull();
    expect(finiteChartCoordinate(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("preserva número, texto e arrays sem converter ausência em zero", () => {
    expect(formatChartTooltipValue(1234.5, "number")).toBe("1.234,5");
    expect(formatChartTooltipValue("N/A", "number")).toBe("N/A");
    expect(formatChartTooltipValue([10, 20], "number")).toBe("10 – 20");
    expect(formatChartTooltipValue(undefined, "number")).toBe("Valor indisponível");
    expect(formatChartTooltipValue(Number.NaN, "number")).toBe("Valor indisponível");
    expect(numericChartTooltipValue("0")).toBeNull();
    expect(numericChartTooltipValue(0)).toBe(0);
  });

  it("trata nomes e payloads desconhecidos sem casts amplos", () => {
    expect(chartTooltipName(undefined, "Valor")).toBe("Valor");
    expect(chartTooltipName(2025, "Valor")).toBe("2025");
    expect(sourceRowFromChartPayload({ sourceRow: 7 })).toBe(7);
    expect(sourceRowFromChartPayload({ sourceRow: "7" })).toBeUndefined();
    expect(seriesPointFromChartPayload({ name: "Alfa", total: 12 })).toEqual({
      name: "Alfa",
      total: 12,
    });
    expect(seriesPointFromChartPayload({ name: "Alfa", total: Number.NaN })).toBeNull();
    expect(seriesPointFromChartPayload(null)).toBeNull();
  });
});

describe("chartLabelCenter", () => {
  it("aceita o viewBox cartesiano, que é o que o Recharts 3 entrega", () => {
    // Foi este formato que quebrou o número no meio da rosca: sem `cx`, a
    // guarda antiga devolvia `null` em toda renderização e o texto sumia.
    expect(chartLabelCenter({ x: 6, y: 6, width: 191, height: 196 })).toEqual({
      cx: 101.5,
      cy: 104,
    });
  });

  it("continua aceitando o viewBox polar, que é o que a documentação promete", () => {
    expect(chartLabelCenter({ cx: 120, cy: 90, innerRadius: 40, outerRadius: 70 })).toEqual({
      cx: 120,
      cy: 90,
    });
  });

  it("recusa o que não dá um par finito, para o SVG nunca receber NaN", () => {
    expect(chartLabelCenter(null)).toBeNull();
    expect(chartLabelCenter(undefined)).toBeNull();
    expect(chartLabelCenter({})).toBeNull();
    expect(chartLabelCenter({ x: 0, y: 0, width: Number.NaN, height: 10 })).toBeNull();
    expect(chartLabelCenter({ cx: Number.POSITIVE_INFINITY, cy: 3 })).toBeNull();
    // Coordenada como string não conta: o cálculo do centro é aritmético, e
    // "6" + 191/2 daria concatenação em vez de soma.
    expect(chartLabelCenter({ x: "6", y: "6", width: 100, height: 100 })).toBeNull();
  });
});
