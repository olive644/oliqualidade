import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { sheetToRows } from "@/lib/import";

const sheet = (aoa: (string | number | null)[][]) => XLSX.utils.aoa_to_sheet(aoa);

describe("sheetToRows", () => {
  it("converte uma planilha simples em linhas", () => {
    const ws = sheet([
      ["nome", "valor"],
      ["Bolo de cenoura", 45],
      ["Brigadeiro", 5],
    ]);
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toEqual([
      { nome: "Bolo de cenoura", valor: 45 },
      { nome: "Brigadeiro", valor: 5 },
    ]);
    expect(warning).toBeNull();
  });

  it("renomeia cabeçalhos duplicados em vez de perder dados", () => {
    const ws = sheet([
      ["nome", "valor", "valor"],
      ["Bolo", 10, 20],
    ]);
    const { rows, warning } = sheetToRows(ws);
    expect(rows[0]).toEqual({ nome: "Bolo", valor: 10, valor_2: 20 });
    expect(warning).toContain("renomeada");
  });

  it("ignora linhas inteiramente em branco no meio dos dados", () => {
    // Uma linha em branco "real" (ex: vinda de um CSV colado) chega como
    // células de string vazia, não como células ausentes.
    const ws = sheet([
      ["nome", "valor"],
      ["Bolo", 10],
      ["", ""],
      ["Torta", 20],
    ]);
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r["nome"])).toEqual(["Bolo", "Torta"]);
    expect(warning).toContain("ignorada");
  });

  it("combina os dois avisos quando há cabeçalho duplicado e linha em branco", () => {
    const ws = sheet([
      ["nome", "nome"],
      ["Bolo", "Cenoura"],
      ["", ""],
    ]);
    const { warning } = sheetToRows(ws);
    expect(warning).toContain("renomeada");
    expect(warning).toContain("ignorada");
  });

  it("retorna rows vazio para uma planilha sem nenhuma linha de dados", () => {
    const ws = sheet([["nome", "valor"]]);
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toEqual([]);
    expect(warning).toBeNull();
  });

  it("retorna rows vazio para um arquivo completamente vazio", () => {
    const ws = sheet([]);
    const { rows } = sheetToRows(ws);
    expect(rows).toEqual([]);
  });

  it("preenche colunas sem nome no cabeçalho com um nome genérico", () => {
    const ws = sheet([
      ["nome", null],
      ["Bolo", "obs"],
    ]);
    const { rows } = sheetToRows(ws);
    expect(rows[0]).toEqual({ nome: "Bolo", coluna_2: "obs" });
  });

  it("acha o cabeçalho real quando um valor solto vazou para a primeira linha", () => {
    // Reproduz o bug relatado: uma célula com valor numérico ("10000") como
    // primeira linha, seguida de linha em branco, e só depois o cabeçalho
    // de verdade de uma tabela de amortização.
    const ws = sheet([
      ["10000", null, null],
      [null, null, null],
      ["parcela", "valor_parcela", "saldo_devedor"],
      [1, 500, 9500],
      [2, 500, 9000],
    ]);
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toEqual([
      { parcela: 1, valor_parcela: 500, saldo_devedor: 9500 },
      { parcela: 2, valor_parcela: 500, saldo_devedor: 9000 },
    ]);
    expect(warning).toContain("cabeçalho foi identificado na linha 3");
  });

  it("avisa quando uma coluna ficou quase vazia", () => {
    const ws = sheet([
      ["parcela", "status", "coluna_extra"],
      ...Array.from({ length: 10 }, (_, i) => [i + 1, "Em dia", null]),
      [11, "Em dia", "único valor perdido"],
    ]);
    const { warning } = sheetToRows(ws);
    expect(warning).toContain('"Coluna extra"');
    expect(warning).toContain("quase vazia");
  });

  it("mantém a primeira linha como cabeçalho quando ela é um cabeçalho válido normal", () => {
    const ws = sheet([
      ["parcela", "valor_parcela"],
      [1, 500],
      [2, 500],
    ]);
    const { warning } = sheetToRows(ws);
    expect(warning).toBeNull();
  });
});
