import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { resolveFormulaCell } from "@/lib/formula";

// Monta uma planilha e, pras células indicadas, sobrescreve pra virar uma
// célula "stub" (fórmula sem valor calculado) — reproduz exatamente o que
// XLSX.read({ sheetStubs: true }) devolve pra uma célula assim num arquivo
// real (t: "z", f: "<fórmula>", v: 0 de preenchimento, não um valor real).
function sheetWithFormulas(
  aoa: (string | number | null)[][],
  formulas: Record<string, string>,
): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const [addr, f] of Object.entries(formulas)) {
    ws[addr] = { t: "z", f, v: 0 };
  }
  return ws;
}

describe("resolveFormulaCell", () => {
  it("avalia uma fórmula aritmética simples entre células da mesma linha", () => {
    const ws = sheetWithFormulas([[2, 4200, null]], { C1: "A1*B1" });
    expect(resolveFormulaCell(ws, "C1")).toBe(8400);
  });

  it("resolve fórmulas encadeadas (uma fórmula referenciando outra fórmula)", () => {
    // Reproduz o caso real: Total Bruto = J*K; Total Líquido = O*(1-L)+M;
    // Lucro = P-Q-(O*N); Margem % = IFERROR(R/P, 0) — cada uma depende do
    // resultado calculado da anterior, nenhuma tem valor guardado no
    // arquivo.
    const ws = sheetWithFormulas([[2, 4200, 0.05, 80, 0.12, 6500, null, null, null, null]], {
      G1: "A1*B1", // Total Bruto = 8400
      H1: "G1*(1-C1)+D1", // Total Líquido = 8400*0.95+80 = 8060
      I1: "H1-F1-(G1*E1)", // Lucro = 8060-6500-1008 = 552
      J1: "IFERROR(I1/H1,0)", // Margem % ≈ 0.0684863523573201
    });
    expect(resolveFormulaCell(ws, "G1")).toBe(8400);
    expect(resolveFormulaCell(ws, "H1")).toBe(8060);
    expect(resolveFormulaCell(ws, "I1")).toBe(552);
    expect(resolveFormulaCell(ws, "J1")).toBeCloseTo(0.0684863523573201);
  });

  it("usa o valor de fallback do IFERROR quando o cálculo dá erro (divisão por zero)", () => {
    const ws = sheetWithFormulas([[10, 0, null]], { C1: "IFERROR(A1/B1,0)" });
    expect(resolveFormulaCell(ws, "C1")).toBe(0);
  });

  it("suporta ROUND, ABS, MIN e MAX", () => {
    const ws = sheetWithFormulas([[3.14159, -5, 2, 9]], {
      // Como cada uma é avaliada isoladamente, todas podem ler as mesmas
      // células-base (A1..D1), sem depender de resultado de outra fórmula.
    });
    ws["E1"] = { t: "z", f: "ROUND(A1,2)", v: 0 };
    ws["F1"] = { t: "z", f: "ABS(B1)", v: 0 };
    ws["G1"] = { t: "z", f: "MIN(C1,D1,A1)", v: 0 };
    ws["H1"] = { t: "z", f: "MAX(C1,D1,A1)", v: 0 };
    expect(resolveFormulaCell(ws, "E1")).toBe(3.14);
    expect(resolveFormulaCell(ws, "F1")).toBe(5);
    expect(resolveFormulaCell(ws, "G1")).toBe(2);
    expect(resolveFormulaCell(ws, "H1")).toBe(9);
  });

  it("respeita precedência de operadores e parênteses", () => {
    const ws = sheetWithFormulas([[2, 3, 4]], { D1: "A1+B1*C1" });
    expect(resolveFormulaCell(ws, "D1")).toBe(14);
    ws["E1"] = { t: "z", f: "(A1+B1)*C1", v: 0 };
    expect(resolveFormulaCell(ws, "E1")).toBe(20);
  });

  it("detecta referência circular e não trava num loop infinito", () => {
    const ws = sheetWithFormulas([[null, null]], { A1: "B1+1", B1: "A1+1" });
    expect(resolveFormulaCell(ws, "A1")).toBeNull();
  });

  it("não tenta avaliar fórmula de outra aba (referência com '!')", () => {
    const ws = sheetWithFormulas([[null]], { A1: "Vendas!P5" });
    expect(resolveFormulaCell(ws, "A1")).toBeNull();
  });

  it("avalia intervalos locais em funções agregadoras comuns", () => {
    const ws = sheetWithFormulas(
      [
        [1, 10, null, null, null],
        [2, null, null, null, null],
        [3, 30, null, null, null],
      ],
      {
        C1: "SUM(A1:A3)",
        D1: "AVERAGE(B1:B3)",
        E1: "COUNT(A1:B3)",
      },
    );
    expect(resolveFormulaCell(ws, "C1")).toBe(6);
    expect(resolveFormulaCell(ws, "D1")).toBe(20);
    expect(resolveFormulaCell(ws, "E1")).toBe(5);
  });

  it("recusa intervalos circulares ou maiores que o limite seguro", () => {
    const ws = sheetWithFormulas([[1, null]], { B1: "SUM(A1:B1)" });
    expect(resolveFormulaCell(ws, "B1")).toBeNull();
    ws["C1"] = { t: "z", f: "SUM(A1:A10001)", v: 0 };
    expect(resolveFormulaCell(ws, "C1")).toBeNull();
  });

  it("não tenta avaliar função não suportada (ex.: SUMIF/VLOOKUP)", () => {
    const ws = sheetWithFormulas([[1, null]], { B1: "VLOOKUP(A1,A1,1,0)" });
    expect(resolveFormulaCell(ws, "B1")).toBeNull();
  });

  it("retorna o valor já calculado direto quando ele existe (não reavalia)", () => {
    const ws = XLSX.utils.aoa_to_sheet([[42]]);
    expect(resolveFormulaCell(ws, "A1")).toBe(42);
  });

  it("retorna null pra célula inexistente ou vazia", () => {
    const ws = XLSX.utils.aoa_to_sheet([[1]]);
    expect(resolveFormulaCell(ws, "Z99")).toBeNull();
  });
});
