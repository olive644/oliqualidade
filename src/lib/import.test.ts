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

  it("preenche cabeçalhos vindos de células mescladas em vez de virar 'coluna_N'", () => {
    // Simula uma célula de cabeçalho mesclada cobrindo 3 colunas (comum em
    // relatórios com categorias agrupando várias sub-colunas): o Excel só
    // guarda o texto na célula de origem, então as colunas 2 e 3 chegam
    // como null no array, mesmo aparecendo com o mesmo nome visualmente.
    const ws = sheet([
      ["Amostra", "Ar ambiente", null, null],
      ["A1", 10, 20, 30],
    ]);
    ws["!merges"] = [{ s: { r: 0, c: 1 }, e: { r: 0, c: 3 } }];
    const { rows, warning } = sheetToRows(ws);
    expect(Object.keys(rows[0] as object)).toEqual([
      "Amostra",
      "Ar ambiente",
      "Ar ambiente_2",
      "Ar ambiente_3",
    ]);
    expect(warning).toContain("mesclada");
  });

  it("preenche células de dados vindas de mesclagem vertical (item cobrindo várias linhas de fornecedores)", () => {
    // Reproduz o padrão real relatado: um item de compra (Descrição,
    // Código, Unidade, Qtd) mesclado verticalmente cobrindo 3 linhas de
    // fornecedores concorrentes abaixo dele. Só a linha de origem da
    // mesclagem tem valor no arquivo; as duas linhas seguintes vêm nulas
    // nessas colunas, mesmo pertencendo ao mesmo item visualmente.
    const ws = sheet([
      ["Item", "Descrição", "Qtd", "Fornecedor", "Preço"],
      [1, "Cloreto de sódio", 1, "Empresa A", 80],
      [null, null, null, "Empresa B", 100],
      [null, null, null, "Empresa C", 95],
    ]);
    ws["!merges"] = [
      { s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }, // Item
      { s: { r: 1, c: 1 }, e: { r: 3, c: 1 } }, // Descrição
      { s: { r: 1, c: 2 }, e: { r: 3, c: 2 } }, // Qtd
    ];
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toEqual([
      { Item: 1, Descrição: "Cloreto de sódio", Qtd: 1, Fornecedor: "Empresa A", Preço: 80 },
      { Item: 1, Descrição: "Cloreto de sódio", Qtd: 1, Fornecedor: "Empresa B", Preço: 100 },
      { Item: 1, Descrição: "Cloreto de sódio", Qtd: 1, Fornecedor: "Empresa C", Preço: 95 },
    ]);
    expect(warning).toContain("mesclada");
  });

  it("ignora linhas de nota/resumo soltas no fim da planilha, sem confundir com dado da tabela", () => {
    // Reproduz o padrão real relatado: depois da tabela de itens, a
    // planilha fecha com um texto corrido de resumo ("Total da compra:
    // R$X — verificar documentação..."), que ocupa só 1 célula de uma
    // coluna quase toda vazia, em vez de seguir o padrão preenchido da
    // tabela.
    const ws = sheet([
      ["Item", "Descrição", "Qtd", "Fornecedor", "Preço"],
      [1, "Cloreto de sódio", 1, "Empresa A", 80],
      [2, "Micropipeta", 1, "Empresa D", 1500],
      [null, null, null, null, "Total da compra do professor: R$ 1580,00"],
      [null, null, null, null, "Empresa A ganhou o item 1: verificar documentação."],
    ]);
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toEqual([
      { Item: 1, Descrição: "Cloreto de sódio", Qtd: 1, Fornecedor: "Empresa A", Preço: 80 },
      { Item: 2, Descrição: "Micropipeta", Qtd: 1, Fornecedor: "Empresa D", Preço: 1500 },
    ]);
    expect(warning).toContain("nota");
  });

  it("não deixa uma nota de rodapé mesclada horizontalmente escapar do corte, mesmo cobrindo várias colunas", () => {
    // Reproduz o caso real: a ÚLTIMA linha da planilha é uma frase longa
    // mesclada horizontalmente cobrindo várias colunas (parece "cheia"),
    // mas uma linha de nota mais curta ("Total da compra do professor")
    // vem ANTES dela. Sem tratar a mesclagem de frase longa como especial,
    // a linha da frase comprida "protege" a linha anterior de ser cortada,
    // porque a varredura de baixo pra cima para na primeira linha que
    // parece preenchida.
    const ws = sheet([
      ["Item", "Descrição", "Qtd", "Fornecedor", "Preço"],
      [1, "Cloreto de sódio", 1, "Empresa A", 80],
      [2, "Micropipeta", 1, "Empresa D", 1500],
      [null, null, null, null, 1715], // "Total da compra do professor"
      [
        "Empresa D ganhou o item 2: verificar se o faturamento mínimo da empresa é menor do que R$1.500,00.",
        null,
        null,
        null,
        null,
      ],
    ]);
    // A frase longa da última linha está mesclada cobrindo as 5 colunas.
    ws["!merges"] = [{ s: { r: 4, c: 0 }, e: { r: 4, c: 4 } }];
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toEqual([
      { Item: 1, Descrição: "Cloreto de sódio", Qtd: 1, Fornecedor: "Empresa A", Preço: 80 },
      { Item: 2, Descrição: "Micropipeta", Qtd: 1, Fornecedor: "Empresa D", Preço: 1500 },
    ]);
    expect(warning).toContain("nota");
  });

  it("corta notas do fim mesmo quando há centenas de linhas em branco entre os dados e as notas", () => {
    // Reproduz o caso real relatado: um monte de linhas em branco
    // "sobrando" no arquivo entre a última linha de dado e as notas de
    // rodapé. O corte de notas do fim precisa ignorar as linhas em branco
    // primeiro, senão o orçamento do corte (limitado de propósito) é
    // gasto todo em linhas em branco e nunca alcança a nota de verdade.
    const blankRows = Array.from({ length: 50 }, () => [null, null, null, null, null]);
    const ws2 = sheet([
      ["Item", "Descrição", "Qtd", "Fornecedor", "Preço"],
      [1, "Cloreto de sódio", 1, "Empresa A", 80],
      [2, "Micropipeta", 1, "Empresa D", 1500],
      [null, null, null, null, "Total da compra do professor"],
      ...blankRows,
    ]);
    const { rows: rows2, warning: warning2 } = sheetToRows(ws2);
    expect(rows2).toEqual([
      { Item: 1, Descrição: "Cloreto de sódio", Qtd: 1, Fornecedor: "Empresa A", Preço: 80 },
      { Item: 2, Descrição: "Micropipeta", Qtd: 1, Fornecedor: "Empresa D", Preço: 1500 },
    ]);
    expect(warning2).toContain("nota");
    expect(warning2).toContain("branco");
  });

  it("acha a linha de cabeçalho real quando há metadados de formulário acima da tabela", () => {
    // Padrão comum em planilhas institucionais (ex: formulários de compra):
    // linhas do topo com um rótulo e um valor solto, e só bem embaixo a
    // tabela de verdade com o cabeçalho completo.
    const ws = sheet([
      ["Programa de Pós-Graduação", null, null, null],
      ["Professor responsável", null, null, null],
      ["Item", "Descrição do material", "Unidade", "Qtd"],
      [1, "Cloreto de sódio", "Frasco", 2],
      [2, "Micropipeta automática", "Unidade", 1],
    ]);
    const { rows } = sheetToRows(ws);
    expect(Object.keys(rows[0] as object)).toEqual([
      "Item",
      "Descrição do material",
      "Unidade",
      "Qtd",
    ]);
    expect(rows[0]).toEqual({
      Item: 1,
      "Descrição do material": "Cloreto de sódio",
      Unidade: "Frasco",
      Qtd: 2,
    });
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
