import { describe, expect, it } from "vitest";

import { sourceRowIndexesOf } from "@/lib/chart-source-rows";

describe("sourceRowIndexesOf", () => {
  it("preserva todas as linhas de um ponto agregado", () => {
    expect(sourceRowIndexesOf({ name: "A", total: 10, sourceRowIndexes: [1, 3, 8] })).toEqual([
      1, 3, 8,
    ]);
  });

  it("converte a origem de um ponto bruto em lista", () => {
    expect(sourceRowIndexesOf({ name: "A", total: 10, sourceRowIndex: 4 })).toEqual([4]);
  });

  it("retorna vazio quando o ponto não tem rastreabilidade", () => {
    expect(sourceRowIndexesOf({ name: "A", total: 10 })).toEqual([]);
  });
});
