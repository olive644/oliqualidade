import { describe, expect, it } from "vitest";
import type { SheetOption } from "@/lib/import";
import {
  describeImportedSheetsDifferences,
  PROGRESSIVE_BLOCK_SIZE_CANDIDATES,
  PROGRESSIVE_MAX_PENDING_BLOCKS,
  sameImportedSheets,
} from "@/lib/progressive-import";

const aba = (name: string, rows: SheetOption["rows"]): SheetOption =>
  ({ name, rows }) as SheetOption;

const base = () => [
  aba("Vendas", [
    { Produto: "Bolo", Valor: 42 },
    { Produto: "Torta", Valor: 7 },
  ]),
  aba("Custos", [{ Item: "Farinha", Valor: 3 }]),
];

describe("equivalência entre o caminho atual e o progressivo", () => {
  it("não acusa diferença entre conjuntos iguais", () => {
    expect(describeImportedSheetsDifferences(base(), base())).toEqual([]);
    expect(sameImportedSheets(base(), base())).toBe(true);
  });

  it("aponta a aba, a linha e a coluna de uma célula divergente", () => {
    const candidato = base();
    candidato[0]!.rows[1] = { Produto: "Torta", Valor: 8 };

    expect(describeImportedSheetsDifferences(base(), candidato)).toEqual([
      { kind: "celula", where: "Vendas, linha 2, coluna Valor" },
    ]);
  });

  it("nunca coloca valor de célula na descrição da diferença", () => {
    const candidato = base();
    candidato[0]!.rows[0] = { Produto: "Segredo Industrial", Valor: 999 };

    const serializado = JSON.stringify(describeImportedSheetsDifferences(base(), candidato));
    // O relatório pode acabar num log, e conteúdo de planilha não pode.
    expect(serializado).not.toContain("Segredo Industrial");
    expect(serializado).not.toContain("999");
    expect(serializado).toContain("Vendas");
  });

  it("distingue quantidade de abas, nome, quantidade de linhas e colunas", () => {
    const menosAbas = base().slice(0, 1);
    expect(describeImportedSheetsDifferences(base(), menosAbas)[0]?.kind).toBe(
      "quantidade-de-abas",
    );

    const outroNome = base();
    outroNome[1] = aba("Despesas", outroNome[1]!.rows);
    expect(describeImportedSheetsDifferences(base(), outroNome)[0]).toEqual({
      kind: "nome-de-aba",
      where: "aba 1",
    });

    const menosLinhas = base();
    menosLinhas[0] = aba("Vendas", [menosLinhas[0]!.rows[0]!]);
    expect(describeImportedSheetsDifferences(base(), menosLinhas)[0]?.kind).toBe(
      "quantidade-de-linhas",
    );

    const outraColuna = base();
    outraColuna[1] = aba("Custos", [{ Item: "Farinha", Preco: 3 }]);
    expect(describeImportedSheetsDifferences(base(), outraColuna)[0]).toEqual({
      kind: "colunas",
      where: "Custos",
    });
  });

  it("trata dois NaN como equivalentes, porque o leitor produz NaN legitimamente", () => {
    const esquerda = [aba("Numeros", [{ Valor: Number.NaN }])];
    const direita = [aba("Numeros", [{ Valor: Number.NaN }])];

    expect(sameImportedSheets(esquerda, direita)).toBe(true);
  });

  it("para de listar diferenças no teto, em vez de relatar a planilha inteira", () => {
    const linhas = Array.from({ length: 500 }, (_, indice) => ({ Valor: indice }));
    const divergentes = linhas.map((linha) => ({ Valor: linha.Valor + 1 }));

    const diferencas = describeImportedSheetsDifferences(
      [aba("Grande", linhas)],
      [aba("Grande", divergentes)],
      5,
    );

    expect(diferencas).toHaveLength(5);
  });
});

describe("constantes do contrato progressivo", () => {
  it("mantém a fila curta o bastante para não virar uma segunda cópia", () => {
    expect(PROGRESSIVE_MAX_PENDING_BLOCKS).toBeGreaterThanOrEqual(1);
    expect(PROGRESSIVE_MAX_PENDING_BLOCKS).toBeLessThanOrEqual(4);
  });

  it("deixa os tamanhos de bloco candidatos num lugar só, para o benchmark decidir", () => {
    expect([...PROGRESSIVE_BLOCK_SIZE_CANDIDATES]).toEqual([1_000, 2_000, 5_000]);
  });
});
