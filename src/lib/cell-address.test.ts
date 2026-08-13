import { describe, expect, it } from "vitest";

import { decodeCellAddress, encodeCellAddress } from "@/lib/cell-address";

describe("endereços A1 sem carregar o leitor de planilhas", () => {
  it.each([
    [0, 0, "A1"],
    [9, 25, "Z10"],
    [2, 26, "AA3"],
    [104, 702, "AAA105"],
  ] as const)("converte linha %i e coluna %i", (row, column, address) => {
    expect(encodeCellAddress(row, column)).toBe(address);
    expect(decodeCellAddress(address)).toEqual({ row, column });
  });

  it("aceita referências absolutas e rejeita texto solto", () => {
    expect(decodeCellAddress("$BC$12")).toEqual({ row: 11, column: 54 });
    expect(() => decodeCellAddress("linha 12")).toThrow("inválido");
  });
});
