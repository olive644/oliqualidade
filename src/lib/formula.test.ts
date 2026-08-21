import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { excelSerialToday, isVolatileFormula, resolveFormulaCell } from "@/lib/formula";

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

  it("avalia IF com comparações e combinações AND/OR", () => {
    const ws = sheetWithFormulas([[75, 12, null, null, null]], {
      C1: "IF(A1>=70,1,0)",
      D1: "IF(AND(A1>70,B1<15),100,0)",
      E1: "IF(OR(A1<0,B1=12),1,0)",
    });
    expect(resolveFormulaCell(ws, "C1")).toBe(1);
    expect(resolveFormulaCell(ws, "D1")).toBe(100);
    expect(resolveFormulaCell(ws, "E1")).toBe(1);
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

  it("avalia SUMIF e COUNTIF em intervalos locais", () => {
    const ws = sheetWithFormulas(
      [
        ["Aprovado", 10, null, null],
        ["Reprovado", 20, null, null],
        ["Aprovado", 30, null, null],
        ["Aprovado parcial", 40, null, null],
      ],
      {
        C1: 'SUMIF(A1:A4,"Aprovado",B1:B4)',
        D1: 'COUNTIF(A1:A4,"Aprovado*")',
      },
    );
    expect(resolveFormulaCell(ws, "C1")).toBe(40);
    expect(resolveFormulaCell(ws, "D1")).toBe(3);
  });

  it("aceita critérios numéricos e operadores em agregações condicionais", () => {
    const ws = sheetWithFormulas(
      [
        [5, 10, null, null],
        [15, 20, null, null],
        [25, 30, null, null],
      ],
      { C1: 'SUMIF(A1:A3,">=15",B1:B3)', D1: 'COUNTIF(A1:A3,"<>15")' },
    );
    expect(resolveFormulaCell(ws, "C1")).toBe(50);
    expect(resolveFormulaCell(ws, "D1")).toBe(2);
  });

  it("recusa SUMIF com dimensões diferentes ou intervalo circular", () => {
    const ws = sheetWithFormulas(
      [
        [1, 10, null],
        [2, 20, null],
      ],
      { C1: 'SUMIF(A1:A2,">0",B1:B3)' },
    );
    expect(resolveFormulaCell(ws, "C1")).toBeNull();
    ws["C2"] = { t: "z", f: 'COUNTIF(A1:C2,">0")', v: 0 };
    expect(resolveFormulaCell(ws, "C2")).toBeNull();
  });

  it("não tenta avaliar função não suportada (ex.: VLOOKUP)", () => {
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

describe("fórmulas que dependem da data de hoje", () => {
  it("reconhece TODAY e NOW, e ignora nomes que só as contêm", () => {
    expect(isVolatileFormula("-(TODAY()-L67)")).toBe(true);
    expect(isVolatileFormula("=NOW()")).toBe(true);
    expect(isVolatileFormula("=today()-A1")).toBe(true);
    expect(isVolatileFormula("=SUM(A1:A9)")).toBe(false);
  });

  it("recalcula prazo contra uma célula de data, ignorando o valor salvo", () => {
    // Reproduz o cronograma de calibração real: a coluna de prazo é
    // "-(TODAY()-vencimento)" e o arquivo guarda o resultado do dia em que
    // foi salvo. A referência é uma célula de DATA, que o Excel trata como
    // número de dias — sem isso a conta inteira falha.
    const ws = XLSX.utils.aoa_to_sheet([["vencimento", "dias"]]);
    const vencimento = new Date(Date.UTC(2024, 2, 16));
    ws["A2"] = { t: "d", v: vencimento, w: "16/03/2024" };
    ws["B2"] = { t: "n", v: -616, f: "-(TODAY()-A2)" };

    // Sem forçar, devolve o valor congelado que veio do arquivo.
    expect(resolveFormulaCell(ws, "B2")).toBe(-616);

    // Forçando, recalcula para hoje.
    const recalculado = resolveFormulaCell(ws, "B2", new Map(), new Set(), true);
    const esperado = -(excelSerialToday() - 45367); // 45367 = 16/03/2024
    expect(recalculado).toBe(esperado);
    expect(recalculado).not.toBe(-616);
  });

  it("continua preferindo o valor salvo em fórmula que não é volátil", () => {
    const ws = XLSX.utils.aoa_to_sheet([[10, 20]]);
    ws["C1"] = { t: "n", v: 30, f: "A1+B1" };
    expect(resolveFormulaCell(ws, "C1")).toBe(30);
  });
});
