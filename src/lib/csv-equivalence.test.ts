import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { CsvRecordParser, csvGridToSheetRows } from "@/lib/csv-stream";
import { sheetsWithData, type SheetOption } from "@/lib/import";
import { describeImportedSheetsDifferences } from "@/lib/progressive-import";

/**
 * Equivalência entre o leitor de CSV por streaming e o caminho atual, no nível
 * que de fato importa: as linhas tipadas que o painel recebe.
 *
 * O teste em `csv-stream.test.ts` compara a grade de textos, dos bytes até o
 * conjunto de células. Esta comparação vai além e confronta `SheetOption[]`
 * contra `SheetOption[]`, com números virando número, datas virando data e o
 * cabeçalho já detectado. É a garantia que sustenta trocar de leitor sem trocar
 * de resultado, e é a que precisa continuar valendo quando a normalização
 * passar a aceitar uma grade.
 *
 * A construção de worksheet usada aqui é a mais direta possível, e existe só
 * para atravessar a normalização atual. Ela não é o desenho pretendido: medido,
 * `aoa_to_sheet` custa 193,7 MiB contra 164,5 MiB do `XLSX.read` no arquivo de
 * referência, então ligar o caminho progressivo por ela pioraria a memória. O
 * que este teste prova é o resultado, não o caminho.
 */

const opcoesDoLeitorAtual = {
  type: "string",
  raw: true,
  cellDates: true,
  cellFormula: true,
  cellNF: true,
  cellText: true,
  cellStyles: true,
  sheetStubs: true,
  bookDeps: true,
  dense: true,
  nodim: true,
  UTC: false,
} as const;

function abasPeloCaminhoAtual(texto: string, delimitador: string): SheetOption[] {
  return sheetsWithData(XLSX.read(texto, { ...opcoesDoLeitorAtual, FS: delimitador }));
}

function abasPeloLeitorDeStreaming(texto: string, delimitador: string): SheetOption[] {
  const parser = new CsvRecordParser(delimitador);
  const grade = [...parser.push(texto), ...parser.finish()];
  const workbook = XLSX.utils.book_new();
  // Campo vazio vira celula ausente, como o leitor atual entende.
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(csvGridToSheetRows(grade)),
    "Sheet1",
  );
  return sheetsWithData(workbook);
}

const casos = [
  { nome: "números com decimal", texto: "Id;Valor\n1;10,5\n2;20\n", delimitador: ";" },
  { nome: "datas", texto: "Quando;Nome\n2026-08-27;Ana\n2026-01-02;Bruno\n", delimitador: ";" },
  { nome: "texto e categoria", texto: "Nome;Setor\nAna;Compras\nBruno;Vendas\n", delimitador: ";" },
  { nome: "moeda com ponto", texto: "Item;Preco\nBolo;1234.56\nTorta;7.00\n", delimitador: ";" },
  { nome: "booleanos", texto: "Item;Ativo\nA;TRUE\nB;FALSE\n", delimitador: ";" },
  { nome: "células vazias", texto: "a,b,c\n1,,3\n,2,\n", delimitador: "," },
  { nome: "campo entre aspas", texto: 'Nome,Nota\n"Silva, Ana",boa\n', delimitador: "," },
  { nome: "quebra dentro de aspas", texto: 'Nome,Nota\n"Ana\nMaria",boa\n', delimitador: "," },
  { nome: "CRLF", texto: "a,b\r\n1,2\r\n3,4\r\n", delimitador: "," },
  { nome: "sem quebra final", texto: "a,b\n1,2\n3,4", delimitador: "," },
  { nome: "negativos e zero", texto: "Id;Saldo\n1;-10,5\n2;0\n", delimitador: ";" },
  { nome: "tabulação", texto: "a\tb\n1\t2\n", delimitador: "\t" },
] as const;

describe("equivalência tipada entre o leitor de streaming e o caminho atual", () => {
  it.each(casos)("produz as mesmas linhas tipadas: $nome", ({ texto, delimitador }) => {
    const atual = abasPeloCaminhoAtual(texto, delimitador);
    const streaming = abasPeloLeitorDeStreaming(texto, delimitador);

    expect(describeImportedSheetsDifferences(atual, streaming)).toEqual([]);
  });

  it("não confunde equivalência de texto com equivalência de tipo", () => {
    // Guarda contra uma regressão sutil: se o leitor de streaming passasse a
    // entregar tudo como texto, a comparação de grade continuaria passando e
    // esta aqui não. Número tem de chegar como número.
    const [aba] = abasPeloLeitorDeStreaming("Id;Valor\n1;10,5\n", ";");
    const linha = aba?.rows[0];

    expect(typeof linha?.["Valor"]).toBe("number");
    expect(linha?.["Valor"]).toBe(10.5);
  });
});
