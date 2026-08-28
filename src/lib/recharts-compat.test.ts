import { describe, expect, it } from "vitest";
import {
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
