import { describe, expect, it } from "vitest";

import { evalFormula, fmt, infer, inferColumns, sortChronologically } from "@/lib/format";
import type { Row } from "@/lib/types";

describe("infer", () => {
  it("detecta moeda por nome de coluna com valor numérico", () => {
    const rows: Row[] = [{ receita: 100 }, { receita: 200 }];
    const [col] = infer(rows);
    expect(col?.kind).toBe("currency");
    expect(col?.label).toBe("Receita");
  });

  it("detecta moeda quando o nome da coluna já traz 'R$', mesmo sem receita/custo/valor", () => {
    // Reproduz o bug relatado: colunas como "Total (R$)", "Preço Unitário
    // (R$)" e "Desconto (R$)" ficavam classificadas como número comum
    // (sem formatação de moeda) porque o nome não continha nenhuma das
    // palavras-chave antigas.
    const rows: Row[] = [{ "Total (R$)": 99.8 }, { "Total (R$)": 119.9 }];
    expect(infer(rows)[0]?.kind).toBe("currency");
  });

  it("detecta moeda por 'preço', 'faturamento', 'desconto' e 'salário' no nome da coluna", () => {
    expect(infer([{ "Preço unit.": 80 }])[0]?.kind).toBe("currency");
    expect(infer([{ "Faturamento bruto": 1798.1 }])[0]?.kind).toBe("currency");
    expect(infer([{ "Desconto aplicado": 10 }])[0]?.kind).toBe("currency");
    expect(infer([{ "Salário base": 3000 }])[0]?.kind).toBe("currency");
  });

  it("detecta percentual por nome de coluna (margem/taxa)", () => {
    const rows: Row[] = [{ margem: 0.1 }, { margem: 0.2 }];
    expect(infer(rows)[0]?.kind).toBe("percentage");
  });

  it("detecta número puro quando o nome não sugere moeda nem percentual", () => {
    const rows: Row[] = [{ quantidade: 5 }, { quantidade: 8 }];
    expect(infer(rows)[0]?.kind).toBe("number");
  });

  it("infere números armazenados como texto sem promover códigos e protocolos", () => {
    const columns = infer([
      { Quantidade: "12", "Nº 1": "39960", Código: "50026804" },
      { Quantidade: "18", "Nº 1": "39963", Código: "50041209" },
    ]);
    expect(columns.find((column) => column.key === "Quantidade")?.kind).toBe("number");
    expect(columns.find((column) => column.key === "Nº 1")?.kind).not.toBe("number");
    expect(columns.find((column) => column.key === "Código")?.kind).not.toBe("number");
  });

  it("detecta data pelo nome da coluna", () => {
    const rows: Row[] = [{ data_venda: "01/02/2024" }, { data_venda: "02/02/2024" }];
    expect(infer(rows)[0]?.kind).toBe("date");
  });

  it("detecta data pelo formato dd/mm/aaaa mesmo sem o nome sugerir", () => {
    const rows: Row[] = [{ quando: "05/08/2026" }];
    expect(infer(rows)[0]?.kind).toBe("date");
  });

  it("detecta categoria quando há poucos valores distintos de texto", () => {
    const rows: Row[] = [{ status: "ativo" }, { status: "inativo" }, { status: "ativo" }];
    expect(infer(rows)[0]?.kind).toBe("category");
  });

  it("detecta texto livre quando há muitos valores distintos", () => {
    const rows: Row[] = Array.from({ length: 15 }, (_, i) => ({ observacao: `nota ${i}` }));
    expect(infer(rows)[0]?.kind).toBe("text");
  });

  it("retorna lista vazia para dados vazios", () => {
    expect(infer([])).toEqual([]);
  });

  it("detecta moeda por nome mesmo quando a coluna está 100% vazia", () => {
    // Reproduz o bug relatado: uma coluna "Total (R$)" sem nenhum valor
    // preenchido (todas as linhas null) caía no fallback de categoria
    // (new Set([]).size === 0 < 12) em vez de respeitar o nome da coluna,
    // o que fazia a tabela mostrar "Não informado" em vez de "–" e perder
    // a formatação de moeda.
    const rows: Row[] = [{ "Total (R$)": null }, { "Total (R$)": null }, { "Total (R$)": null }];
    expect(infer(rows)[0]?.kind).toBe("currency");
  });

  it("cai em número (não categoria) quando a coluna está vazia e o nome não dá pista", () => {
    const rows: Row[] = [{ observacao: null }, { observacao: null }];
    expect(infer(rows)[0]?.kind).toBe("number");
  });
});

describe("sortChronologically", () => {
  it("ordena datas brasileiras pelo tempo, não alfabeticamente", () => {
    expect(
      sortChronologically([
        { name: "31/07/2026" },
        { name: "04/05/2026" },
        { name: "18/06/2026" },
      ]).map((item) => item.name),
    ).toEqual(["04/05/2026", "18/06/2026", "31/07/2026"]);
  });
});

describe("inferColumns", () => {
  it("infere só as chaves pedidas, ignorando as demais colunas da linha", () => {
    const rows: Row[] = [{ receita: 100, extra: "não deve aparecer" }];
    const cols = inferColumns(rows, ["receita"]);
    expect(cols).toHaveLength(1);
    expect(cols[0]?.key).toBe("receita");
  });
});

describe("fmt", () => {
  it("retorna null para valores ausentes", () => {
    expect(fmt(null, "text")).toBeNull();
    expect(fmt("", "number")).toBeNull();
  });

  it("formata texto como string simples", () => {
    expect(fmt("Recife", "text")).toBe("Recife");
    expect(fmt(42, "text")).toBe("42");
  });

  it("formata moeda em BRL", () => {
    const expected = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
      1234.5,
    );
    expect(fmt(1234.5, "currency")).toBe(expected);
  });

  it("formata percentual", () => {
    const expected = new Intl.NumberFormat("pt-BR", {
      style: "percent",
      minimumFractionDigits: 1,
    }).format(0.256);
    expect(fmt(0.256, "percentage")).toBe(expected);
  });

  it("formata número com no máximo 2 casas decimais", () => {
    const expected = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(1000.567);
    expect(fmt(1000.567, "number")).toBe(expected);
  });
});

describe("evalFormula", () => {
  const keys = ["preco", "quantidade", "custo"];

  it("calcula uma multiplicação simples entre colunas", () => {
    expect(evalFormula("preco * quantidade", { preco: 10, quantidade: 3, custo: 0 }, keys)).toBe(
      30,
    );
  });

  it("calcula uma expressão com parênteses e mais de uma operação", () => {
    expect(
      evalFormula("(preco - custo) * quantidade", { preco: 20, quantidade: 2, custo: 5 }, keys),
    ).toBe(30);
  });

  it("trata valor não numérico da coluna como zero", () => {
    expect(evalFormula("preco * quantidade", { preco: null, quantidade: 3, custo: 0 }, keys)).toBe(
      0,
    );
  });

  it("retorna null para divisão que resulta em valor não finito", () => {
    expect(evalFormula("preco / custo", { preco: 10, quantidade: 1, custo: 0 }, keys)).toBeNull();
  });

  it("retorna null quando a fórmula referencia algo fora do padrão permitido", () => {
    expect(
      evalFormula("preco * naoExiste", { preco: 10, quantidade: 1, custo: 0 }, keys),
    ).toBeNull();
  });
});
