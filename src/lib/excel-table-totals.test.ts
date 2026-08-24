import { describe, expect, it } from "vitest";
import { tableTotalsRegions } from "./excel-table-totals";
import type { StructuredTableDiagnostic } from "@/lib/workbook-metadata";

const tabela = (name: string, range: string, totalsRowCount = 1): StructuredTableDiagnostic => ({
  name,
  range,
  columns: [],
  calculatedColumns: [],
  totalsRowCount,
  headerRowCount: 1,
});

describe("tableTotalsRegions", () => {
  it("aponta a última linha do intervalo e as colunas da própria tabela", () => {
    // Moradia B10:E21 no orçamento pessoal real: a linha 21 é o total.
    expect(tableTotalsRegions([tabela("Moradia", "B10:E21")], 0, 0)).toEqual([
      { table: "Moradia", row: 20, startColumn: 1, endColumn: 4 },
    ]);
  });

  it("desconta o início da grade, em linha e em coluna", () => {
    // A grade lida começa em B10, então a linha 21 é o índice 11 e a coluna B
    // é o índice 0.
    expect(tableTotalsRegions([tabela("Moradia", "B10:E21")], 9, 1)).toEqual([
      { table: "Moradia", row: 11, startColumn: 0, endColumn: 3 },
    ]);
  });

  it("não aponta nada quando a tabela não tem linha de totais", () => {
    expect(tableTotalsRegions([tabela("Lista", "B9:H25", 0)], 0, 0)).toEqual([]);
  });

  it("aponta várias linhas quando a tabela declara mais de uma", () => {
    expect(tableTotalsRegions([tabela("Bloco", "B2:C10", 2)], 0, 0).map((r) => r.row)).toEqual([
      8, 9,
    ]);
  });

  it("limita cada total às colunas do seu bloco, preservando o bloco ao lado", () => {
    // Blocos lado a lado: a linha de totais da esquerda é uma linha comum da
    // direita. A limpeza por célula é o que impede perder esse dado real.
    const regioes = tableTotalsRegions(
      [tabela("Esquerda", "B10:E21"), tabela("Direita", "G10:J30")],
      0,
      0,
    );
    expect(regioes).toEqual([
      { table: "Esquerda", row: 20, startColumn: 1, endColumn: 4 },
      { table: "Direita", row: 29, startColumn: 6, endColumn: 9 },
    ]);
  });

  it("ignora intervalo ausente ou inválido em vez de mirar na primeira linha", () => {
    // decode_range aceita lixo e devolve A1: sem validar a forma, um
    // intervalo quebrado apagaria a primeira linha de dados da planilha.
    const semIntervalo: StructuredTableDiagnostic = { ...tabela("X", "A1:A2"), range: null };
    expect(
      tableTotalsRegions([semIntervalo, tabela("Y", "isto não é um intervalo")], 0, 0),
    ).toEqual([]);
  });
});
