import { describe, expect, it } from "vitest";
import { isReferenceMetric } from "./reference-metrics";

describe("isReferenceMetric", () => {
  it("reconhece os nomes de referência mais comuns", () => {
    expect(isReferenceMetric("Meta")).toBe(true);
    expect(isReferenceMetric("Alvo mensal")).toBe(true);
    expect(isReferenceMetric("Limite superior")).toBe(true);
    expect(isReferenceMetric("Target")).toBe(true);
  });

  it("não confunde resultado com referência", () => {
    expect(isReferenceMetric("Resultado")).toBe(false);
    expect(isReferenceMetric("Faturamento")).toBe(false);
    // "Metálico" contém "meta" como pedaço de palavra, não como palavra.
    expect(isReferenceMetric("Teor metálico")).toBe(false);
  });

  it("aceita rótulo e chave, porque nem sempre os dois dizem o mesmo", () => {
    expect(isReferenceMetric("Valor esperado", "meta_mensal")).toBe(true);
    expect(isReferenceMetric(undefined, null)).toBe(false);
  });
});
