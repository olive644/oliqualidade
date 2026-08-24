import { describe, expect, it } from "vitest";
import {
  densityForWidth,
  WIDGET_DENSITY_COMPACT_MAX,
  WIDGET_DENSITY_EXPANDED_MIN,
} from "./widget-density";

describe("densityForWidth", () => {
  it("classifica pelo espaço do widget, não pelo da tela", () => {
    expect(densityForWidth(300)).toBe("compact");
    expect(densityForWidth(560)).toBe("normal");
    expect(densityForWidth(900)).toBe("expanded");
  });

  it("usa os mesmos limites que as regras de CSS", () => {
    expect(densityForWidth(WIDGET_DENSITY_COMPACT_MAX - 1)).toBe("compact");
    expect(densityForWidth(WIDGET_DENSITY_COMPACT_MAX)).toBe("normal");
    expect(densityForWidth(WIDGET_DENSITY_EXPANDED_MIN - 1)).toBe("normal");
    expect(densityForWidth(WIDGET_DENSITY_EXPANDED_MIN)).toBe("expanded");
  });

  it("cai em normal enquanto a largura ainda não foi medida", () => {
    // Primeira renderização, antes do ResizeObserver responder: assumir
    // compacto esconderia informação sem motivo, e assumir expandido
    // mostraria o que não cabe.
    expect(densityForWidth(0)).toBe("normal");
    expect(densityForWidth(Number.NaN)).toBe("normal");
  });
});
