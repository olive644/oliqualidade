import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { preferredSheetIndex, sheetsWithData, sheetToRows } from "@/lib/import";
import type { WorksheetWithAdvancedMetadata } from "@/lib/workbook-metadata";

const sheet = (aoa: (string | number | null)[][]) => XLSX.utils.aoa_to_sheet(aoa);

// aoa_to_sheet, ao receber um valor Date, grava a célula como número serial
// com formato de data (t: "n", z: "m/d/yy") — não como célula de data de
// verdade (t: "d"). Isso não reproduz o que XLSX.read({ cellDates: true })
// devolve pra uma célula de data real do Excel (t: "d", v: objeto Date).
// Esse helper simula esse segundo caso, sobrescrevendo o tipo/valor da
// célula depois de montar a planilha.
const sheetWithDates = (aoa: (string | number | Date | null)[][]) => {
  const ws = XLSX.utils.aoa_to_sheet(aoa as (string | number | null)[][]);
  aoa.forEach((row, r) => {
    row.forEach((v, c) => {
      if (v instanceof Date) ws[XLSX.utils.encode_cell({ r, c })] = { t: "d", v };
    });
  });
  return ws;
};

describe("sheetToRows", () => {
  it("nunca transforma data inválida em cabeçalho NaN/NaN/NaN", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Produto", "NaN/NaN/NaN", "Valor"],
      ["A", "x", 10],
    ]);
    const result = sheetToRows(ws);
    expect(Object.keys(result.rows[0] ?? {})).toEqual(["Produto", "coluna_2", "Valor"]);
  });
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

  it("não transforma linhas ocultas do Excel em registros ou métricas", () => {
    const ws = sheet([
      ["Item", "Status", "jun", "jul"],
      ["Manipulador", "Planejado", "T", null],
      ["Manipulador antigo", "Planejado", "4s", "4s"],
      ["Manipulador", "Executado", null, null],
    ]);
    ws["!rows"] = [{}, {}, { hidden: true }, {}];

    const result = sheetToRows(ws);

    expect(result.rows).toEqual([
      { Item: "Manipulador", Status: "Planejado", jun: "T", jul: null },
      { Item: "Manipulador", Status: "Executado", jun: null, jul: null },
    ]);
    expect(result.rows.flatMap(Object.values)).not.toContain("4s");
    expect(result.sourceGrid?.rows[2]).toEqual(["Manipulador antigo", "Planejado", "4s", "4s"]);
    expect(result.audit?.hiddenRowsIgnored).toBe(1);
    expect(result.audit?.blankRowsIgnored).toBe(0);
    expect(result.warning).toContain("linha oculta foi preservada");
    expect(result.warning).toContain("ignorada nos registros, métricas e widgets");
  });

  it("preserva uma grade original limitada com coordenadas reais", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Título", null],
      ["Nome", "Valor"],
      ["A", 10],
    ]);
    ws["!ref"] = "B4:C6";
    ws["B4"] = { t: "s", v: "Título" };
    ws["B5"] = { t: "s", v: "Nome" };
    ws["C5"] = { t: "s", v: "Valor" };
    ws["B6"] = { t: "s", v: "A" };
    ws["C6"] = { t: "n", v: 10 };
    const { sourceGrid } = sheetToRows(ws);
    expect(sourceGrid).toMatchObject({
      startRow: 4,
      startColumn: 2,
      totalRows: 3,
      totalColumns: 2,
      truncatedRows: false,
      truncatedColumns: false,
    });
    expect(sourceGrid?.rows).toEqual([
      ["Título", null],
      ["Nome", "Valor"],
      ["A", 10],
    ]);
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

  it("combina cabeçalhos hierárquicos mesclados com os nomes das subcolunas", () => {
    const ws = sheet([
      ["Data", "Torre de Processo", null, "Reservatório", null],
      ["Data", "Cloro", "pH", "Cloro", "pH"],
      ["01/08/2026", 0.72, 7.1, 0.65, 7.3],
      ["02/08/2026", 0.69, 7.2, 0.61, 7.4],
    ]);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 0, c: 2 } },
      { s: { r: 0, c: 3 }, e: { r: 0, c: 4 } },
    ];

    const { rows, warning } = sheetToRows(ws);

    expect(Object.keys(rows[0] ?? {})).toEqual([
      "Data",
      "Torre de Processo — Cloro",
      "Torre de Processo — pH",
      "Reservatório — Cloro",
      "Reservatório — pH",
    ]);
    expect(rows[0]?.["Torre de Processo — Cloro"]).toBe(0.72);
    expect(rows).toHaveLength(2);
    expect(warning).toContain("cabeçalho hierárquico");
  });

  it("reconhece o título mesclado como banner mesmo quando o gerador repete o texto em toda célula da mesclagem", () => {
    // Excel de verdade só grava o valor na célula de origem da mesclagem;
    // alguns geradores de OOXML fora do Excel (scripts próprios) escrevem o
    // mesmo texto em cada célula coberta. Sem reconhecer isso como banner,
    // essa linha de título virava o cabeçalho da tabela, e o cabeçalho
    // hierárquico real (linhas 2-3) vazava como duas linhas de dado.
    const title = "Modelo — Avaliação HACCP";
    const ws = sheet([
      [title, title, title, title, title, title, title],
      [null, null, null, null, null, null, null],
      ["Perigo identificado", "Avaliação", null, null, "Tratamento", null, null],
      [null, "Probabilidade", "Severidade", "Nível", "Responsável", "Prazo", "Decisão"],
      ["Vazamento", 3, 3, 9, "Qualidade", "10/04/2026", "Crítico"],
    ]);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } },
      { s: { r: 2, c: 1 }, e: { r: 2, c: 3 } },
      { s: { r: 2, c: 4 }, e: { r: 2, c: 6 } },
    ];

    const { rows } = sheetToRows(ws);

    expect(Object.keys(rows[0] ?? {})).toEqual([
      "Perigo identificado",
      "Avaliação — Probabilidade",
      "Avaliação — Severidade",
      "Avaliação — Nível",
      "Tratamento — Responsável",
      "Tratamento — Prazo",
      "Tratamento — Decisão",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["Perigo identificado"]).toBe("Vazamento");
  });

  it("não fabrica registro fantasma a partir do cabeçalho hierárquico de um modelo genuinamente vazio", () => {
    // Um modelo (.xltx/.xltm) sem nenhuma linha preenchida não tem
    // evidência de dado (numérica/data) pra confirmar a segunda camada do
    // cabeçalho — mas também não tem dado nenhum que a extensão do
    // cabeçalho possa engolir por engano, então é seguro reconhecer as duas
    // camadas puramente pela mesclagem estrutural.
    const title = "Modelo — Avaliação HACCP";
    const ws = sheet([
      [title, title, title, title, title, title, title],
      [null, null, null, null, null, null, null],
      ["Perigo identificado", "Avaliação", null, null, "Tratamento", null, null],
      [null, "Probabilidade", "Severidade", "Nível", "Responsável", "Prazo", "Decisão"],
      [null, null, null, "", null, null, ""],
      [null, null, null, "", null, null, ""],
    ]);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } },
      { s: { r: 2, c: 1 }, e: { r: 2, c: 3 } },
      { s: { r: 2, c: 4 }, e: { r: 2, c: 6 } },
    ];

    const { rows } = sheetToRows(ws);

    expect(rows).toEqual([]);
  });

  it("não inclui duas vezes o mesmo rótulo vindo de mesclagem vertical no cabeçalho", () => {
    const ws = sheet([
      ["Amostra", "Medições", null],
      [null, "Cloro", "pH"],
      ["Ponto 1", 0.8, 7.2],
    ]);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 0, c: 2 } },
    ];

    const { rows } = sheetToRows(ws);

    expect(rows).toEqual([{ Amostra: "Ponto 1", "Medições — Cloro": 0.8, "Medições — pH": 7.2 }]);
  });

  it("combina quatro níveis de cabeçalho quando a hierarquia é comprovada por mesclagens", () => {
    const ws = sheet([
      ["Cronograma", null, null, null, "Cronograma", null, null, null],
      ["1ª coleta", null, null, null, "2ª coleta", null, null, null],
      ["Produto", null, null, null, "Produto", null, null, null],
      [
        "Máquina",
        "Gramatura",
        "Nº de amostras",
        "Análise",
        "Máquina",
        "Gramatura",
        "Nº de amostras",
        "Análise",
      ],
      ["IN10", "17 g", 1, "Salmonella/25g", "IN12", "40 g", 1, "E. coli/g"],
    ]);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 0, c: 4 }, e: { r: 0, c: 7 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
      { s: { r: 1, c: 4 }, e: { r: 1, c: 7 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
      { s: { r: 2, c: 4 }, e: { r: 2, c: 7 } },
    ];
    const { rows } = sheetToRows(ws);
    expect(rows).toEqual([
      {
        "Cronograma — 1ª coleta — Produto — Máquina": "IN10",
        "Cronograma — 1ª coleta — Produto — Gramatura": "17 g",
        "Cronograma — 1ª coleta — Produto — Nº de amostras": 1,
        "Cronograma — 1ª coleta — Produto — Análise": "Salmonella/25g",
        "Cronograma — 2ª coleta — Produto — Máquina": "IN12",
        "Cronograma — 2ª coleta — Produto — Gramatura": "40 g",
        "Cronograma — 2ª coleta — Produto — Nº de amostras": 1,
        "Cronograma — 2ª coleta — Produto — Análise": "E. coli/g",
      },
    ]);
  });

  it("preserva grupos esparsos acima de muitas subcolunas temporais", () => {
    const ws = sheet([
      [null, null, null, "Programado", null, null, "Realizado"],
      ["Item", "Descrição", "Gramatura", "1-Jul", "2-Jul", "3-Jul", "1-Jul"],
      [10, "Produto A", 6, 100, 120, 90, 98],
      [11, "Produto B", 8, 80, 70, 60, 75],
    ]);
    expect(Object.keys(sheetToRows(ws).rows[0] ?? {})).toEqual([
      "Item",
      "Descrição",
      "Gramatura",
      "Programado — 1-Jul",
      "Programado — 2-Jul",
      "Programado — 3-Jul",
      "Realizado — 1-Jul",
    ]);
  });

  it("não absorve linhas de dados quando um cabeçalho folha possui uma mesclagem visual", () => {
    const ws = sheet([
      ["Objeto", "Ponto", "Frequência", "Análise", "Limite", null, null],
      ["Produto", "Embalagem", "Trimestral", "Bolores", "< 25", null, null],
      ["Ar", "Processo", "Trimestral", "Mesófilos", "< 50", null, null],
    ]);
    ws["!merges"] = [
      { s: { r: 0, c: 4 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 4 }, e: { r: 1, c: 6 } },
      { s: { r: 2, c: 4 }, e: { r: 2, c: 6 } },
    ];
    const { rows } = sheetToRows(ws);
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0] ?? {})).toEqual([
      "Objeto",
      "Ponto",
      "Frequência",
      "Análise",
      "Limite",
    ]);
    expect(rows[0]?.["Objeto"]).toBe("Produto");
  });

  it("renomeia cabeçalhos genéricos de documento e limpa placeholders vazios", () => {
    const ws = sheet([
      ["Dados", null, null, "jan", "fev"],
      ["Água", "Saída do poço", "Planejado", "M", null],
      [null, null, "Executado", "-", "NaN"],
    ]);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
      { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
      { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } },
    ];
    const { rows, warning } = sheetToRows(ws);
    expect(Object.keys(rows[0] ?? {})).toEqual([
      "Categoria",
      "Item / Ponto",
      "Situação",
      "jan",
      "fev",
    ]);
    expect(rows[1]).toMatchObject({
      Categoria: "Água",
      "Item / Ponto": "Saída do poço",
      Situação: "Executado",
      jan: null,
      fev: null,
    });
    expect(warning).toContain("marcadores vazios");
  });

  it("interrompe a tabela antes de um rodapé institucional longo e mesclado", () => {
    const ws = sheet([
      ["Item", "Status", "jan", "fev"],
      ["Água", "Planejado", "M", "M"],
      ["Água", "Executado", null, null],
      ["Ar", "Planejado", "T", null],
      ["Ar", "Executado", null, null],
      [
        "Observações institucionais muito longas que não pertencem aos dados da tabela e descrevem todo o procedimento de controle",
        null,
        null,
        null,
      ],
      ["NÍVEL DE REVISÃO", null, null, null],
      ["Rev. 01", "Alteração do documento", null, null],
    ]);
    ws["!merges"] = [{ s: { r: 5, c: 0 }, e: { r: 5, c: 3 } }];
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => !Object.values(row).includes("NÍVEL DE REVISÃO"))).toBe(true);
    expect(warning).toContain("rodapé institucional");
  });

  it("remove coluna genérica redundante e adjacente (nota de rodapé mesclada horizontalmente transbordando pra 2 colunas sem cabeçalho)", () => {
    // Reproduz o padrão real (Requisitos de Monitoramento, seção 79/80 do
    // audit): uma matriz pequena (3 linhas) sem nome pra coluna de rótulo,
    // com uma nota de rodapé curta mesclada horizontalmente (2 colunas) na
    // última linha, ambas as colunas sem cabeçalho. Colunas genéricas
    // "Coluna N" normalmente não são consideradas redundantes entre si
    // (podem ser coincidência), mas quando são vizinhas diretas no
    // cabeçalho, o padrão é quase certamente mesclagem transbordando, não
    // coincidência — a segunda coluna deve sumir.
    const ws = sheet([
      ["Nível", "Valor", null, null],
      ["Alto", 1, null, null],
      ["Médio", 2, null, null],
      ["Baixo", 3, "Adaptada de FSSC 22000", "Adaptada de FSSC 22000"],
    ]);
    const { rows } = sheetToRows(ws);
    expect(Object.keys(rows[0] ?? {})).toHaveLength(3);
    expect(rows).toEqual([
      { Nível: "Alto", Valor: 1, coluna_3: null },
      { Nível: "Médio", Valor: 2, coluna_3: null },
      { Nível: "Baixo", Valor: 3, coluna_3: "Adaptada de FSSC 22000" },
    ]);
  });

  it("não remove colunas genéricas coincidentemente iguais quando não são vizinhas diretas no cabeçalho", () => {
    // Guarda de proteção do teste acima: duas colunas sem nome, com o
    // mesmo valor esparso, mas SEPARADAS por outra coluna com dado
    // próprio — nada indica mesclagem transbordando aqui, é coincidência
    // plausível. Ambas devem sobreviver.
    const ws = sheet([
      ["Nível", null, "Meio", null],
      ["Alto", "X", "m1", "X"],
      ["Médio", null, "m2", null],
      ["Baixo", null, "m3", null],
    ]);
    const { rows } = sheetToRows(ws);
    expect(Object.keys(rows[0] ?? {})).toHaveLength(4);
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

  it("não triplica um registro quando todas as colunas da linha estão mescladas com a mesma altura (só formatação visual, não dado repetido)", () => {
    // Reproduz o padrão real de uma matriz de risco (HACCP): cada "linha"
    // visual é na verdade um bloco de 3 linhas de planilha mescladas em
    // TODAS as colunas com a mesma altura — ao contrário do teste acima
    // (só Item/Descrição/Qtd mesclados, Fornecedor/Preço variam por linha
    // de verdade), aqui não sobra nenhuma coluna com dado independente por
    // linha. As duas linhas de baixo são só esticamento visual do Excel,
    // não 3 observações distintas — preenchê-las triplica contagens/somas.
    const ws = sheet([
      ["Superfície", "Probabilidade", "Perigo", "Criticidade"],
      ["Sacos Plásticos", 3, 1, 3],
      [null, null, null, null],
      [null, null, null, null],
      ["Silos", 3, 2, 6],
      [null, null, null, null],
      [null, null, null, null],
    ]);
    ws["!merges"] = [
      { s: { r: 1, c: 0 }, e: { r: 3, c: 0 } },
      { s: { r: 1, c: 1 }, e: { r: 3, c: 1 } },
      { s: { r: 1, c: 2 }, e: { r: 3, c: 2 } },
      { s: { r: 1, c: 3 }, e: { r: 3, c: 3 } },
      { s: { r: 4, c: 0 }, e: { r: 6, c: 0 } },
      { s: { r: 4, c: 1 }, e: { r: 6, c: 1 } },
      { s: { r: 4, c: 2 }, e: { r: 6, c: 2 } },
      { s: { r: 4, c: 3 }, e: { r: 6, c: 3 } },
    ];
    const { rows } = sheetToRows(ws);
    expect(rows).toEqual([
      { Superfície: "Sacos Plásticos", Probabilidade: 3, Perigo: 1, Criticidade: 3 },
      { Superfície: "Silos", Probabilidade: 3, Perigo: 2, Criticidade: 6 },
    ]);
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

  it("registra um balanço objetivo das transformações da importação", () => {
    const ws = sheet([
      ["Relatório", null, null],
      ["Produto", "Valor", null],
      ["A", 10, null],
      [null, null, null],
      ["B", "20,50", null],
      ["Observação final", null, null],
    ]);
    ws["!ref"] = "A1:E6";
    const result = sheetToRows(ws);
    expect(result.audit).toMatchObject({
      sourceNonEmptyCells: 8,
      outputNonEmptyCells: 4,
      numericCellsConverted: 1,
      rowsAboveHeaderIgnored: 1,
      blankRowsIgnored: 1,
      trailingRowsIgnored: 1,
      columnsIgnored: 3,
    });
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

  it("replica descrição longa mesclada verticalmente, mesmo passando de 60 caracteres", () => {
    // Reproduz o bug relatado: uma descrição de item comprida (bem comum
    // em pedido de compra, com especificação técnica detalhada) mesclada
    // verticalmente cobrindo as linhas dos fornecedores concorrentes. O
    // corte por tamanho de texto vale só pra mesclagem horizontal (nota de
    // rodapé); mesclagem vertical é sempre dado legítimo, mesmo longo.
    const descricaoLonga =
      "CLORETO DE SÓDIO - ASPECTO FÍSICO PÓ CRISTALINO BRANCO OU CRISTAIS INCOLORES, PESO MOLECULAR 58,45G/MOL, PUREZA MÍNIMA DE 99,5%.";
    expect(descricaoLonga.length).toBeGreaterThan(60);
    const wsVert = sheet([
      ["Item", "Descrição", "Qtd", "Fornecedor"],
      [1, descricaoLonga, 1, "Empresa A"],
      [null, null, null, "Empresa B"],
      [null, null, null, "Empresa C"],
    ]);
    wsVert["!merges"] = [
      { s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }, // Item, vertical
      { s: { r: 1, c: 1 }, e: { r: 3, c: 1 } }, // Descrição, vertical
      { s: { r: 1, c: 2 }, e: { r: 3, c: 2 } }, // Qtd, vertical
    ];
    const { rows: rowsVert } = sheetToRows(wsVert);
    expect(rowsVert.every((r) => r["Descrição"] === descricaoLonga)).toBe(true);
    expect(rowsVert.every((r) => r["Item"] === 1)).toBe(true);
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

  it("aceita anos numéricos como cabeçalhos quando existe um título acima", () => {
    const ws = sheet([
      ["Relatório anual", null, null],
      ["Indicador", 2024, 2025],
      ["Receita", 10, 20],
      ["Custo", 5, 8],
    ]);
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toEqual([
      { Indicador: "Receita", "2024": 10, "2025": 20 },
      { Indicador: "Custo", "2024": 5, "2025": 8 },
    ]);
    expect(warning).toContain("linha 2");
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

  it("descarta automaticamente uma coluna sem nome no cabeçalho e quase vazia (fragmento fora da tabela)", () => {
    // Reproduz o bug relatado: uma coluna extra sem cabeçalho, com texto
    // solto em só uma linha, aparecia como "Coluna N" com dado sem sentido
    // mesmo não existindo de fato como coluna da planilha do usuário.
    const ws = sheet([
      ["parcela", "status", null],
      ...Array.from({ length: 10 }, (_, i) => [i + 1, "Em dia", null]),
      [11, "Em dia", "nota solta"],
    ]);
    const { rows, warning } = sheetToRows(ws);
    expect(Object.keys(rows[0] as object)).toEqual(["parcela", "status"]);
    expect(warning).toContain("removida automaticamente");
  });

  it("mantém uma coluna sem nome no cabeçalho quando ela tem dados de verdade", () => {
    const ws = sheet([
      ["parcela", "status", null],
      ...Array.from({ length: 10 }, (_, i) => [i + 1, "Em dia", `obs ${i}`]),
    ]);
    const { rows, warning } = sheetToRows(ws);
    expect(Object.keys(rows[0] as object)).toEqual(["parcela", "status", "coluna_3"]);
    expect(warning ?? "").not.toContain("removida automaticamente");
  });

  it("não confunde um título mesclado horizontalmente no topo com o cabeçalho da tabela", () => {
    // Reproduz o bug relatado: uma aba tipo "RESUMO DE VENDAS" com um
    // título mesclado A1:D1 seguido de pares rótulo/valor. Antes da
    // correção, o preenchimento de mesclagem espalhava o título pelas 4
    // colunas, a linha ficava "100% preenchida" e era escolhida como
    // cabeçalho — gerando 3 colunas fantasmas quase vazias que inundavam a
    // tabela de "Não informado".
    const ws = sheet([
      ["RESUMO DE VENDAS", null, null, null],
      [null, null, null, null],
      ["Total de vendas", 12, null, null],
      ["Faturamento bruto", 1798.1, null, null],
      ["Descontos", 100, null, null],
      ["Faturamento líquido", 1698.1, null, null],
      ["Itens vendidos", 19, null, null],
      ["Ticket médio", 141.5, null, null],
    ]);
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    const { rows } = sheetToRows(ws);
    // A linha de título não deve virar o cabeçalho: nenhuma coluna
    // resultante deve ser um fragmento vazio tipo "coluna_3"/"coluna_4".
    const headers = Object.keys(rows[0] as object);
    expect(headers).not.toContain("coluna_3");
    expect(headers).not.toContain("coluna_4");
    expect(rows.some((r) => Object.values(r).includes("Faturamento bruto"))).toBe(true);
  });

  it("mantém um cabeçalho legítimo com nomes repetidos, sem tratar como título mesclado", () => {
    // Duas colunas digitadas com o mesmo nome de propósito (sem nenhuma
    // mesclagem envolvida) continuam sendo um cabeçalho válido — só o caso
    // de mesclagem horizontal virando "banner" deve ser rejeitado.
    const ws = sheet([
      ["nome", "nome"],
      ["Bolo", "Cenoura"],
    ]);
    const { rows, warning } = sheetToRows(ws);
    expect(Object.keys(rows[0] as object)).toEqual(["nome", "nome_2"]);
    expect(warning).toContain("renomeada");
  });

  it("ignora um bloco de resumo (rótulo/valor) no topo e acha a tabela de verdade mais abaixo", () => {
    // Reproduz o bug relatado com o arquivo real do usuário
    // (planilha_vendas_exemplo.xlsx, aba "Resumo"): um título, um bloco de
    // KPIs em pares rótulo/valor (nenhum deles é cabeçalho — são todos
    // dados), uma linha em branco, um subtítulo, e só então a tabela de
    // verdade. Antes da correção, uma das linhas do bloco de KPI (ex:
    // "Total de vendas", 12) era escolhida como cabeçalho, e a tabela real
    // (Categoria/Faturamento) virava lixo dentro dela.
    const ws = sheet([
      ["RESUMO DE VENDAS"],
      [],
      ["Total de vendas", 12],
      ["Faturamento bruto", 1798.1],
      ["Descontos", 100],
      ["Faturamento líquido", 1698.1],
      ["Itens vendidos", 19],
      ["Ticket médio", "#DIV/0!"],
      [],
      [],
      ["Vendas por categoria"],
      ["Categoria", "Faturamento (R$)"],
      ["Roupas", 714.1],
      ["Calçados", 489.7],
      ["Acessórios", 494.3],
    ]);
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    const { rows } = sheetToRows(ws);
    expect(rows).toEqual([
      { Categoria: "Roupas", "Faturamento (R$)": 714.1 },
      { Categoria: "Calçados", "Faturamento (R$)": 489.7 },
      { Categoria: "Acessórios", "Faturamento (R$)": 494.3 },
    ]);
  });

  it("não escolhe uma linha de dado como cabeçalho só porque tem um erro de fórmula do Excel (#DIV/0!)", () => {
    // "#DIV/0!" é texto, não passaria no teste antigo de "maioria numérica",
    // mas semanticamente é um valor de dado quebrado, nunca um rótulo de
    // coluna — sem esse tratamento, essa linha vira cabeçalho por engano.
    const ws = sheet([
      ["Métrica", "Valor"],
      ["Ticket médio", "#DIV/0!"],
      ["Total", 100],
    ]);
    const { rows } = sheetToRows(ws);
    expect(Object.keys(rows[0] as object)).toEqual(["Métrica", "Valor"]);
  });

  it("ignora uma repetição literal do cabeçalho no meio dos dados (sem separador de bloco)", () => {
    // Relatórios paginados costumam repetir a linha de cabeçalho a cada
    // quebra de página, sem linha em branco nem título separando um
    // "bloco" novo — por isso a lógica de blocos empilhados (teste acima)
    // não cobre esse caso. Sem o filtro, essa linha virava um registro de
    // dado com o próprio texto do cabeçalho: {"Nome":"Nome","Valor":"Valor"}.
    const ws = sheet([
      ["Nome", "Valor"],
      ["Item 1", 10],
      ["Item 2", 20],
      ["Nome", "Valor"],
      ["Item 3", 30],
      ["Item 4", 40],
    ]);
    const { rows, warning, audit } = sheetToRows(ws);
    expect(rows).toEqual([
      { Nome: "Item 1", Valor: 10 },
      { Nome: "Item 2", Valor: 20 },
      { Nome: "Item 3", Valor: 30 },
      { Nome: "Item 4", Valor: 40 },
    ]);
    expect(audit?.repeatedHeaderRowsIgnored).toBe(1);
    expect(warning).toContain("repetia o cabeçalho no meio dos dados");
  });

  it("não descarta uma linha de dado que só coincide com o cabeçalho em uma única coluna", () => {
    // A exigência de pelo menos 2 colunas batendo evita falso positivo:
    // um item de catálogo pode legitimamente se chamar "Nome" ou "Valor".
    const ws = sheet([
      ["Nome", "Valor"],
      ["Item 1", 10],
      ["Nome", 99],
      ["Item 2", 20],
    ]);
    const { rows, audit } = sheetToRows(ws);
    expect(rows).toEqual([
      { Nome: "Item 1", Valor: 10 },
      { Nome: "Nome", Valor: 99 },
      { Nome: "Item 2", Valor: 20 },
    ]);
    expect(audit?.repeatedHeaderRowsIgnored ?? 0).toBe(0);
  });

  it("combina blocos repetidos (mesmo cabeçalho, empilhados) numa única tabela com coluna de origem", () => {
    const ws = sheet([
      ["Núcleo 1"],
      ["Data", "Total"],
      ["2025-03-20", 8],
      ["2025-03-21", 5],
      [],
      ["Núcleo 2"],
      ["Data", "Total"],
      ["2025-03-20", 27],
      ["2025-03-21", 9],
    ]);
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toEqual([
      { Núcleo: "Núcleo 1", Data: "2025-03-20", Total: 8 },
      { Núcleo: "Núcleo 1", Data: "2025-03-21", Total: 5 },
      { Núcleo: "Núcleo 2", Data: "2025-03-20", Total: 27 },
      { Núcleo: "Núcleo 2", Data: "2025-03-21", Total: 9 },
    ]);
    expect(warning).toContain("2 blocos de tabela repetidos");
  });

  it("combina blocos repetidos lado a lado (mesma faixa de linhas, colunas diferentes)", () => {
    // Reproduz o caso real: "Núcleo 2" e "Núcleo 5" ocupam o mesmo
    // intervalo de linhas, um começando na coluna A e outro na coluna E —
    // sem isolar por faixa de colunas, o título/cabeçalho de um vaza pro
    // outro.
    const ws = sheet([
      ["Núcleo 2", null, null, null, "Núcleo 5"],
      ["Data", "Total", null, null, "Data", "Total"],
      ["2025-03-20", 27, null, null, "2025-03-21", 3],
      ["2025-03-21", 9, null, null, null, null],
      [],
      ["Núcleo 3"],
      ["Data", "Total"],
      ["2025-03-20", 2],
      ["2025-03-21", 4],
    ]);
    const { rows } = sheetToRows(ws);
    expect(rows).toEqual([
      { Núcleo: "Núcleo 2", Data: "2025-03-20", Total: 27 },
      { Núcleo: "Núcleo 2", Data: "2025-03-21", Total: 9 },
      { Núcleo: "Núcleo 5", Data: "2025-03-21", Total: 3 },
      { Núcleo: "Núcleo 3", Data: "2025-03-20", Total: 2 },
      { Núcleo: "Núcleo 3", Data: "2025-03-21", Total: 4 },
    ]);
  });

  it("não ativa o modo de blocos repetidos numa planilha de tabela única normal", () => {
    const ws = sheet([
      ["Nome", "Idade"],
      ["Ana", 30],
      ["Bruno", 25],
    ]);
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toEqual([
      { Nome: "Ana", Idade: 30 },
      { Nome: "Bruno", Idade: 25 },
    ]);
    expect(warning).toBeNull();
  });

  it("não ativa o modo de blocos repetidos numa tabela única grande com colunas de texto pouco variadas", () => {
    // Reproduz um bug real encontrado com o arquivo do usuário: uma tabela
    // de vendas normal e grande, terminando numa sequência de colunas de
    // texto de poucos valores possíveis (forma de pagamento, status,
    // cidade) — separada do resto por uma coluna numérica (quantidade),
    // exatamente como no arquivo real. Duas linhas de DADO comuns podem
    // ter, por coincidência, a mesma combinação de valores nessa sequência
    // final (ex: "Boleto" + "Concluída" + "Olinda"), o que batia no mesmo
    // critério usado para achar cabeçalho de bloco repetido — e a tabela
    // inteira virava "blocos" sem sentido, perdendo quase todas as colunas
    // reais. Nenhuma linha de dado comum tem um título isolado genuíno
    // acima dela (diferente de "Núcleo 1"/"Núcleo 2"), então exigir um
    // título de verdade evita esse falso positivo.
    const header = ["ID Venda", "Quantidade", "Forma de Pagamento", "Status", "Cidade"];
    const rows: (string | number)[][] = [header];
    const formas = ["Boleto", "Pix", "Cartão"];
    const status = ["Concluída", "Cancelada"];
    const cidades = ["Paulista", "Olinda", "Recife"];
    for (let i = 0; i < 60; i++) {
      rows.push([
        `V${i.toString().padStart(4, "0")}`,
        (i % 5) + 1,
        formas[i % formas.length]!,
        status[i % status.length]!,
        cidades[i % cidades.length]!,
      ]);
    }
    const ws = sheet(rows);
    const { rows: result, warning } = sheetToRows(ws);
    expect(result).toHaveLength(60);
    expect(Object.keys(result[0] as object)).toEqual(header);
    expect(warning ?? "").not.toContain("blocos de tabela repetidos");
  });

  it("preenche mesclagem corretamente quando a planilha não começa em A1 (offset de linha/coluna)", () => {
    // Mesma planilha do teste "combina blocos repetidos (mesmo cabeçalho,
    // empilhados)" acima, mas deslocada pra começar em C3 em vez de A1 —
    // reproduz o formato real (dados começando em B2), onde "!merges" usa
    // coordenadas absolutas da planilha inteira, não relativas ao range
    // usado.
    const ws = sheet([
      [null, null, null],
      [null, null, null],
      [null, null, "Núcleo 1"],
      [null, null, "Data", "Total"],
      [null, null, "2025-03-20", 8],
      [null, null, "2025-03-21", 5],
      [null, null, null],
      [null, null, "Núcleo 2"],
      [null, null, "Data", "Total"],
      [null, null, "2025-03-20", 27],
      [null, null, "2025-03-21", 9],
    ]);
    const { rows } = sheetToRows(ws);
    expect(rows).toEqual([
      { Núcleo: "Núcleo 1", Data: "2025-03-20", Total: 8 },
      { Núcleo: "Núcleo 1", Data: "2025-03-21", Total: 5 },
      { Núcleo: "Núcleo 2", Data: "2025-03-20", Total: 27 },
      { Núcleo: "Núcleo 2", Data: "2025-03-21", Total: 9 },
    ]);
  });

  it("formata célula de data de verdade do Excel (objeto Date, não texto) como dd/mm/aaaa", () => {
    // Quando o arquivo é lido com `cellDates: true` (ver src/routes/index.tsx),
    // uma célula formatada como data no Excel chega em sheet_to_json como
    // objeto Date de verdade, não como número serial nem como texto — é
    // esse formato que aoa_to_sheet também produz pra um valor Date.
    const ws = sheetWithDates([
      ["Data", "Total"],
      [new Date(2025, 2, 20), 8],
      [new Date(2025, 2, 21), 5],
    ]);
    const { rows } = sheetToRows(ws);
    expect(rows).toEqual([
      { Data: "20/03/2025", Total: 8 },
      { Data: "21/03/2025", Total: 5 },
    ]);
  });

  it("formata datas de verdade também no modo de blocos repetidos", () => {
    const ws = sheetWithDates([
      ["Núcleo 1"],
      ["Data", "Total"],
      [new Date(2025, 2, 20), 8],
      [new Date(2025, 2, 21), 5],
      [],
      ["Núcleo 2"],
      ["Data", "Total"],
      [new Date(2025, 2, 20), 27],
      [new Date(2025, 2, 21), 9],
    ]);
    const { rows } = sheetToRows(ws);
    expect(rows).toEqual([
      { Núcleo: "Núcleo 1", Data: "20/03/2025", Total: 8 },
      { Núcleo: "Núcleo 1", Data: "21/03/2025", Total: 5 },
      { Núcleo: "Núcleo 2", Data: "20/03/2025", Total: 27 },
      { Núcleo: "Núcleo 2", Data: "21/03/2025", Total: 9 },
    ]);
  });

  it("lê formulário de qualidade com cabeçalho institucional, mesclagens e medições numéricas como texto", () => {
    const ws = sheetWithDates([
      ["Controle de Análise Diária de Cloro Residual Livre", null, null, null, null, null, null],
      ["FRS-QA-028-Suape", null, null, null, null, null, null],
      ["Rev. 01 – Vigência: 26/07/2024", null, null, null, null, null, null],
      [],
      ["Elaborado por: Qualidade", null, "Revisado por: Gestão", null, "Aprovado por: Liderança"],
      ["Técnico de Qualidade", null, "Técnica de Qualidade", null, "Líder de Qualidade"],
      ["Data: 22/07/2024", null, "Data: 26/07/2024", null, "Data: 27/07/2024"],
      [
        "Data",
        "Pontos de Análise (0,2 a 2 mg/L - Frequência Diária) TODO DESVIO DEVE SER COMUNICADO À GESTÃO DE QUALIDADE",
      ],
      [],
      [
        null,
        "Saída do Poço",
        "Pia de Higienização de Alimentos",
        "Pia de Higienização de Mãos",
        "Torre de Processo",
        "Barreira Sanitária (Injeção)",
        "Barreira Sanitária (AOKI)",
      ],
      [new Date(2026, 6, 1), 2, 1, 1, 1, 1, 0.2],
      [new Date(2026, 6, 2), "2.05", "1.33", "1.13", "1.00", "2.68", "0.50"],
    ]);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } },
      { s: { r: 5, c: 2 }, e: { r: 5, c: 3 } },
      { s: { r: 5, c: 4 }, e: { r: 5, c: 5 } },
      { s: { r: 4, c: 6 }, e: { r: 6, c: 6 } },
      { s: { r: 7, c: 0 }, e: { r: 9, c: 0 } },
      { s: { r: 7, c: 1 }, e: { r: 7, c: 6 } },
    ];
    // Reproduz colunas apenas formatadas além da tabela real.
    ws["!ref"] = "A1:W12";

    const { rows, warning } = sheetToRows(ws);

    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0] as object)).toEqual([
      "Data",
      "Saída do Poço",
      "Pia de Higienização de Alimentos",
      "Pia de Higienização de Mãos",
      "Torre de Processo",
      "Barreira Sanitária (Injeção)",
      "Barreira Sanitária (AOKI)",
    ]);
    expect(rows[1]).toEqual({
      Data: "02/07/2026",
      "Saída do Poço": 2.05,
      "Pia de Higienização de Alimentos": 1.33,
      "Pia de Higienização de Mãos": 1.13,
      "Torre de Processo": 1,
      "Barreira Sanitária (Injeção)": 2.68,
      "Barreira Sanitária (AOKI)": 0.5,
    });
    expect(warning).toContain("linha 10");
    expect(warning).toContain("medições numéricas");
  });

  it("recupera coluna com fórmula sem valor calculado guardado no arquivo", () => {
    // Reproduz o caso real relatado: planilha gerada por script (não pelo
    // Excel de verdade), onde "Total" tem a fórmula mas nunca foi
    // calculada — sem sheetStubs:true a célula nem apareceria no objeto da
    // planilha, e mesmo com ela, um Array.forEach ingênuo pularia a
    // posição por ser um "buraco" no array, não um null de verdade.
    const ws = XLSX.utils.aoa_to_sheet([
      ["Quantidade", "Preço", "Total"],
      [2, 4200, null],
      [1, 1800, null],
    ]);
    ws["C2"] = { t: "z", f: "A2*B2", v: 0 };
    ws["C3"] = { t: "z", f: "A3*B3", v: 0 };
    const { rows, warning } = sheetToRows(ws);
    expect(rows).toEqual([
      { Quantidade: 2, Preço: 4200, Total: 8400 },
      { Quantidade: 1, Preço: 1800, Total: 1800 },
    ]);
    // Coluna recuperada não deve ser listada como "quase vazia" no aviso.
    expect(warning).toBeNull();
  });

  it("não trava nem inventa valor quando a fórmula está fora do escopo suportado (outra aba)", () => {
    // Ex.: célula de "Dashboard" somando um intervalo de outra aba
    // ("=SOMASE(Vendas!E5:E104,\"Brasil\",Vendas!P5:P104)") — fica vazia,
    // igual ficaria sem a recuperação de fórmula, em vez de tentar
    // adivinhar algo errado.
    const ws = XLSX.utils.aoa_to_sheet([
      ["País", "Receita"],
      ["Brasil", null],
    ]);
    ws["B2"] = { t: "z", f: 'SUMIF(Vendas!E5:E104,"Brasil",Vendas!P5:P104)', v: 0 };
    const { rows } = sheetToRows(ws);
    expect(rows).toEqual([{ País: "Brasil", Receita: null }]);
  });
});

describe("formatos operacionais especializados", () => {
  it("normaliza lista de presença sem incorporar o rodapé ao cadastro", () => {
    const ws = sheet([
      ["Lista de Presença"],
      ["Nome do evento: NR10"],
      ["Entidade Promotora: Amcor", null, null, null, "Carga horária: 08:00h"],
      ["Instrutor: Ana"],
      ["N°", "Matrícula", "Nome", null, "Setor", "Turno", "Dia: 25/05/2026"],
      [null, null, null, null, null, null, "ASSINATURA"],
      [1, 10, "Ada", null, "QA", "Dia"],
      [2, 11, "Bia", null, "QA", "Dia"],
      [3, null, null],
      [4, null, null],
      [5, null, null],
      ["Objetivo:", null, "Texto institucional"],
    ]);
    const result = sheetToRows(ws);
    expect(result.tableMode).toBe("attendance-roster");
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]).toMatchObject({
      Evento: "NR10",
      "N°": 1,
      Matrícula: 10,
      Nome: "Ada",
      Setor: "QA",
      Turno: "Dia",
      Data: "25/05/2026",
    });
    expect(result.rows.some((row) => row["Nome"] === "Texto institucional")).toBe(false);
  });

  it("normaliza matriz repetida de validação por horário", () => {
    const ws = sheet([
      ["Registro de Validação"],
      ["HORA", "07:00h", null, "08:00h", null],
      ["REFERÊNCIA", "N° de peças", null, "N° de peças", null],
      [null, "Aceita", "Rejeita", "Aceita", "Rejeita"],
      ["Resultado", "OK", null, "OK", null],
      ["Aviso #"],
      ["Inspetor", "Ana", null, "Bia"],
      ["HORA", "09:00h", null, "10:00h", null],
      ["REFERÊNCIA", "N° de peças", null, "N° de peças", null],
      [null, "Aceita", "Rejeita", "Aceita", "Rejeita"],
      ["Resultado", "OK", null, "OK", null],
      ["Aviso #"],
      ["Inspetor", "Caio", null, "Dani"],
    ]);
    const result = sheetToRows(ws);
    expect(result.tableMode).toBe("validation-matrix");
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]).toMatchObject({ Hora: "07:00h", Resultado: "OK", Inspetor: "Ana" });
  });

  it("normaliza ensaios laboratoriais lado a lado", () => {
    const ws = sheet([
      ["Amostra Original", null, null, "Amostra Teste"],
      ["Viscosidade - Préforma", null, null, "Viscosidade - Préforma"],
      ["Amostra 1", null, 83.7, "Amostra 1", null, 85.4],
      ["Amostra 2", null, 82.9, "Amostra 2", null, 85.5],
      ["Viscosidade - Resina", null, null, "Viscosidade - Resina"],
      ["Amostra 1", null, 84.2, "Amostra 1", null, 83.9],
      ["Amostra 2", null, 84.7, "Amostra 2", null, 85.4],
    ]);
    const result = sheetToRows(ws);
    expect(result.tableMode).toBe("laboratory-series");
    expect(result.rows).toHaveLength(8);
    expect(Object.keys(result.rows[0] ?? {})).toEqual([
      "Amostra",
      "Ensaio",
      "Identificação",
      "Resultado",
    ]);
  });

  it("separa especificações, estatísticas e amostras dimensionais", () => {
    const ws = sheet([
      ["Relatório dimensional"],
      ["Dimensionais/Funcionais", null, null, "Finish F", "Finish T", "Finish A", "Finish D"],
      ["Unidade de Medida", null, null, "[mm]", "[mm]", "[mm]", "[mm]"],
      ["Especificação", null, "Limite Inferior", 24.8, 27.2, 27.8, 11],
      [null, null, "Alvo", 24.9, 27.4, 28, 11.2],
      [null, null, "Limite Superior", 25.1, 27.5, 28.2, 11.4],
      ["10:00", 1, "10/08/26", 24.9, 27.4, 28, 11.2],
      ["10:00", 2, "10/08/26", 25, 27.4, 28, 11.1],
      ["10:00", 3, "10/08/26", 24.9, 27.3, 28.1, 11.2],
      ["10:30", 1, "10/08/26", 24.9, 27.4, 28, 11.2],
      ["10:30", 2, "10/08/26", 25, 27.4, 28, 11.1],
    ]);
    const result = sheetToRows(ws);
    expect(result.tableMode).toBe("measurement-series");
    expect(result.rows).toHaveLength(8);
    expect(result.rows[0]).toMatchObject({
      Categoria: "Especificação",
      Estatística: "Limite Inferior",
    });
    expect(result.rows.at(-1)).toMatchObject({ Categoria: "Medição", Hora: "10:30", Amostra: 2 });
  });
});

describe("sheetsWithData", () => {
  it("retorna uma opção por aba quando todas têm dado", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet([["nome"], ["Bolo"]]), "Vendas");
    XLSX.utils.book_append_sheet(wb, sheet([["total"], [10]]), "Resumo");
    const options = sheetsWithData(wb);
    expect(options.map((o) => o.name)).toEqual(["Vendas", "Resumo"]);
    expect(options[0]?.rows).toEqual([{ nome: "Bolo" }]);
  });

  it("não marca regionsKeptTogether quando a aba tem só uma região", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet([["nome"], ["Bolo"]]), "Vendas");
    const options = sheetsWithData(wb);
    expect(options[0]?.audit?.regionsKeptTogether).toBeUndefined();
  });

  it("separa tabelas diferentes lado a lado em opções próprias de importação", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheet([
        ["Cliente", "Valor", null, null, "Produto", "Quantidade"],
        ["Ana", 10, null, null, "Cloro", 2],
        ["Beto", 20, null, null, "Resina", 3],
        ["Caio", 30, null, null, "Filme", 4],
      ]),
      "Dados",
    );

    const options = sheetsWithData(wb);

    expect(options.map((option) => option.name)).toEqual(["Dados · Região 1", "Dados · Região 2"]);
    expect(options[0]?.rows).toEqual([
      { Cliente: "Ana", Valor: 10 },
      { Cliente: "Beto", Valor: 20 },
      { Cliente: "Caio", Valor: 30 },
    ]);
    expect(options[1]?.rows).toEqual([
      { Produto: "Cloro", Quantidade: 2 },
      { Produto: "Resina", Quantidade: 3 },
      { Produto: "Filme", Quantidade: 4 },
    ]);
    expect(options.every((option) => option.warning?.includes("separada automaticamente"))).toBe(
      true,
    );
  });

  it("mantém identificadores e períodos na mesma tabela quando há só uma coluna de respiro", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheet([
        ["Máquina", "Tecnologia", "Atendimento %", null, "1-Jul", "2-Jul", "3-Jul", "4-Jul"],
        ["IN04", "G600", "90%", null, "80%", "90%", "100%", "95%"],
        ["IN05", "G1-600", "85%", null, "75%", "80%", "90%", "92%"],
      ]),
      "Atendimento",
    );
    const options = sheetsWithData(wb);
    expect(options).toHaveLength(1);
    expect(options[0]?.name).toBe("Atendimento");
    expect(Object.keys(options[0]?.rows[0] ?? {})).toEqual([
      "Máquina",
      "Tecnologia",
      "Atendimento %",
      "1-Jul",
      "2-Jul",
      "3-Jul",
      "4-Jul",
    ]);
    // Duas regiões foram detectadas (identificadores + matriz de períodos) mas
    // mantidas juntas por segurança: isso precisa ficar registrado no
    // auditoria, não descartado silenciosamente.
    expect(options[0]?.audit?.regionsKeptTogether).toBe(
      options[0]?.diagnostics?.tableRegions.length,
    );
    expect(options[0]?.diagnostics?.tableRegions.length).toBeGreaterThan(1);
  });

  it("separa tabelas diferentes empilhadas quando ambas têm estrutura própria", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheet([
        ["Cliente", "Valor"],
        ["Ana", 10],
        ["Beto", 20],
        ["Caio", 30],
        [],
        ["Produto", "Quantidade", "Unidade"],
        ["Cloro", 2, "kg"],
        ["Resina", 3, "kg"],
        ["Filme", 4, "m"],
      ]),
      "Dados",
    );

    const options = sheetsWithData(wb);

    expect(options.map((option) => option.name)).toEqual(["Dados · Região 1", "Dados · Região 2"]);
    expect(options[0]?.rows).toHaveLength(3);
    expect(options[1]?.rows).toHaveLength(3);
    expect(Object.keys(options[1]?.rows[0] ?? {})).toEqual(["Produto", "Quantidade", "Unidade"]);
  });

  it("separa quadros empilhados que se encostam, usando título e reinício de cabeçalho", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheet([
        ["Bebidas:"],
        ["Produto", "Quantidade", "Análise"],
        ["Suco", 1, "Bolores"],
        ["Refrigerante", 2, "Leveduras"],
        ["Água Potável:"],
        ["Material", "Frequência", "Análise"],
        ["Água", "Diário", "Cloro"],
        ["Água", "Mensal", "Coliformes"],
      ]),
      "Critérios",
    );

    const options = sheetsWithData(wb);

    expect(options.map((option) => option.name)).toEqual([
      "Critérios · Bebidas:",
      "Critérios · Água Potável:",
    ]);
    expect(options[0]?.rows).toEqual([
      { Produto: "Suco", Quantidade: 1, Análise: "Bolores" },
      { Produto: "Refrigerante", Quantidade: 2, Análise: "Leveduras" },
    ]);
    expect(options[1]?.rows).toEqual([
      { Material: "Água", Frequência: "Diário", Análise: "Cloro" },
      { Material: "Água", Frequência: "Mensal", Análise: "Coliformes" },
    ]);
    expect(options.every((option) => option.warning?.includes("empilhadas"))).toBe(true);
  });

  it("propaga metadados avançados também na divisão por título de seção (quadros empilhados que se encostam)", () => {
    const ws = sheet([
      ["Bebidas:"],
      ["Produto", "Quantidade", "Análise"],
      ["Suco", 1, "Bolores"],
      ["Refrigerante", 2, "Leveduras"],
      ["Água Potável:"],
      ["Material", "Frequência", "Análise"],
      ["Água", "Diário", "Cloro"],
      ["Água", "Mensal", "Coliformes"],
    ]) as WorksheetWithAdvancedMetadata;
    ws["!oliAdvanced"] = {
      structuredTables: [],
      pivotTables: [],
      autoFilterRange: null,
      comments: [],
      hyperlinks: [{ address: "C7", target: "https://exemplo.com/cloro-secao" }],
      definedNames: [],
      externalLinks: [],
      dataValidations: [],
      hasVbaMacros: false,
      images: [],
      shapes: [],
      charts: [],
      cellFills: [],
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Critérios");

    const options = sheetsWithData(wb);

    expect(options.map((option) => option.name)).toEqual([
      "Critérios · Bebidas:",
      "Critérios · Água Potável:",
    ]);
    expect(options[0]?.diagnostics?.hyperlinks).toEqual([]);
    expect(options[1]?.diagnostics?.hyperlinks).toHaveLength(1);
    expect(options[1]?.diagnostics?.hyperlinks?.[0]?.target).toBe(
      "https://exemplo.com/cloro-secao",
    );
  });

  it("propaga metadados avançados (!oliAdvanced) só pra região que contém a âncora, com endereço remapeado", () => {
    const ws = sheet([
      ["Cliente", "Valor"],
      ["Ana", 10],
      ["Beto", 20],
      ["Caio", 30],
      [],
      ["Produto", "Quantidade", "Unidade"],
      ["Cloro", 2, "kg"],
      ["Resina", 3, "kg"],
      ["Filme", 4, "m"],
    ]) as WorksheetWithAdvancedMetadata;
    ws["!oliAdvanced"] = {
      structuredTables: [],
      pivotTables: [],
      autoFilterRange: null,
      comments: [],
      hyperlinks: [{ address: "A7", target: "https://exemplo.com/cloro" }],
      definedNames: [],
      externalLinks: [],
      dataValidations: [],
      hasVbaMacros: false,
      images: [],
      shapes: [],
      charts: [],
      cellFills: [],
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dados");

    const options = sheetsWithData(wb);

    expect(options.map((option) => option.name)).toEqual(["Dados · Região 1", "Dados · Região 2"]);
    expect(options[0]?.diagnostics?.hyperlinks).toEqual([]);
    expect(options[1]?.diagnostics?.hyperlinks).toEqual([
      { address: "A2", target: "https://exemplo.com/cloro" },
    ]);
  });

  it("descarta metadados avançados cuja âncora cai fora de todas as regiões detectadas, em vez de atribuir à região errada", () => {
    const ws = sheet([
      ["Cliente", "Valor"],
      ["Ana", 10],
      ["Beto", 20],
      ["Caio", 30],
      [],
      ["Produto", "Quantidade", "Unidade"],
      ["Cloro", 2, "kg"],
      ["Resina", 3, "kg"],
      ["Filme", 4, "m"],
    ]) as WorksheetWithAdvancedMetadata;
    ws["!oliAdvanced"] = {
      structuredTables: [],
      pivotTables: [],
      autoFilterRange: null,
      comments: [],
      hyperlinks: [{ address: "Z50", target: "https://exemplo.com/orfao" }],
      definedNames: [],
      externalLinks: [],
      dataValidations: [],
      hasVbaMacros: false,
      images: [],
      shapes: [],
      charts: [],
      cellFills: [],
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dados");

    const options = sheetsWithData(wb);

    expect(options[0]?.diagnostics?.hyperlinks).toEqual([]);
    expect(options[1]?.diagnostics?.hyperlinks).toEqual([]);
  });

  it("preserva o período dos grupos laterais ao separar seções trimestrais", () => {
    const wb = XLSX.utils.book_new();
    const ws = sheet([
      ["Cronograma", null, null, null, "Cronograma", null, null, null],
      ["Março", null, null, null, "Junho", null, null, null],
      ["Produto", null, null, null, "Produto", null, null, null],
      [
        "Máquina",
        "Gramatura",
        "Quantidade",
        "Análise",
        "Máquina",
        "Gramatura",
        "Quantidade",
        "Análise",
      ],
      ["IN01", "10 g", 1, "Salmonella", "IN02", "20 g", 1, "Bolores"],
      ["Ar ambiente", null, null, null, "Ar ambiente", null, null, null],
      [
        "Ponto",
        "Análise",
        "Quantidade",
        "Resultado",
        "Ponto",
        "Análise",
        "Quantidade",
        "Resultado",
      ],
      ["Sala 1", "Mesófilos", 1, "Conforme", "Sala 2", "Bolores", 1, "Conforme"],
    ]);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 0, c: 4 }, e: { r: 0, c: 7 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
      { s: { r: 1, c: 4 }, e: { r: 1, c: 7 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
      { s: { r: 2, c: 4 }, e: { r: 2, c: 7 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 3 } },
      { s: { r: 5, c: 4 }, e: { r: 5, c: 7 } },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Plano");

    const options = sheetsWithData(wb);

    expect(options).toHaveLength(2);
    expect(Object.keys(options[1]?.rows[0] ?? {})).toEqual([
      "Cronograma — Março — Ar ambiente — Ponto",
      "Cronograma — Março — Ar ambiente — Análise",
      "Cronograma — Março — Ar ambiente — Quantidade",
      "Cronograma — Março — Ar ambiente — Resultado",
      "Cronograma — Junho — Ar ambiente — Ponto",
      "Cronograma — Junho — Ar ambiente — Análise",
      "Cronograma — Junho — Ar ambiente — Quantidade",
      "Cronograma — Junho — Ar ambiente — Resultado",
    ]);
  });

  it("não divide uma tabela normal que contém linhas em branco no meio dos dados", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheet([["Cliente", "Valor"], ["Ana", 10], ["Beto", 20], [], ["Caio", 30], ["Davi", 40]]),
      "Dados",
    );

    const options = sheetsWithData(wb);

    expect(options).toHaveLength(1);
    expect(options[0]?.name).toBe("Dados");
    expect(options[0]?.rows).toHaveLength(4);
  });

  it("mantém blocos repetidos como uma única tabela combinada", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheet([
        ["Núcleo 1"],
        ["Data", "Total"],
        ["01/08/2026", 10],
        ["02/08/2026", 12],
        [],
        ["Núcleo 2"],
        ["Data", "Total"],
        ["01/08/2026", 8],
        ["02/08/2026", 9],
      ]),
      "Produção",
    );

    const options = sheetsWithData(wb);

    expect(options).toHaveLength(1);
    expect(options[0]?.name).toBe("Produção");
    expect(options[0]?.rows).toHaveLength(4);
    expect(options[0]?.warning).toContain("blocos de tabela repetidos");
  });

  it("preserva a coluna identificadora à esquerda dos meses em blocos repetidos", () => {
    const wb = XLSX.utils.book_new();
    const ws = sheet([
      ["Coliformes", null, null, null, "E. coli", null, null],
      [null, "jan", "fev", "Máx.", null, "jan", "fev", "Máx."],
      ["Saída do Poço", 0, 1, 0, "Saída do Poço", 0, 0, 0],
      ["Torneira", 0, null, 0, "Torneira", 0, null, 0],
    ]);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 0, c: 4 }, e: { r: 0, c: 7 } },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Monitoramento");
    const options = sheetsWithData(wb);
    expect(options).toHaveLength(1);
    expect(options[0]?.rows[0]).toMatchObject({
      Bloco: "Coliformes",
      "Ponto / Item": "Saída do Poço",
      jan: 0,
      fev: 1,
    });
  });

  it("ignora a aba automática de relatório de compatibilidade do Excel", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheet([
        ["Nome", "Valor"],
        ["A", 1],
      ]),
      "Dados",
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheet([
        [null, "Compatibility Report for arquivo.xls"],
        [null, "Significant loss of functionality"],
      ]),
      "Sheet1",
    );
    expect(sheetsWithData(wb).map((option) => option.name)).toEqual(["Dados"]);
  });

  it("pula abas sem nenhuma linha de dado, mas mantém as abas com dado", () => {
    // Reproduz o caso comum de um arquivo de exemplo com uma aba "Página1"
    // vazia (sobra de template) além das abas de verdade.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet([]), "Página1");
    XLSX.utils.book_append_sheet(wb, sheet([["nome"], ["Bolo"]]), "Vendas");
    const options = sheetsWithData(wb);
    expect(options.map((o) => o.name)).toEqual(["Vendas"]);
  });

  it("retorna lista vazia quando nenhuma aba tem dado", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet([]), "Página1");
    expect(sheetsWithData(wb)).toEqual([]);
  });

  it("mantém uma aba sem linha de dado quando ela tem gráfico/forma/imagem nativos do Excel", () => {
    const wb = XLSX.utils.book_new();
    const ws = sheet([]) as WorksheetWithAdvancedMetadata;
    ws["!oliAdvanced"] = {
      structuredTables: [],
      pivotTables: [],
      autoFilterRange: null,
      comments: [],
      hyperlinks: [],
      definedNames: [],
      externalLinks: [],
      dataValidations: [],
      hasVbaMacros: false,
      images: [],
      shapes: [],
      charts: [{ type: "bar", title: "Vendas do trimestre", anchor: "A1" }],
      cellFills: [],
    };
    XLSX.utils.book_append_sheet(wb, ws, "Só gráfico");
    const options = sheetsWithData(wb);
    expect(options.map((o) => o.name)).toEqual(["Só gráfico"]);
    expect(options[0]?.rows).toEqual([]);
    expect(options[0]?.diagnostics?.charts).toEqual([
      { type: "bar", title: "Vendas do trimestre", anchor: "A1" },
    ]);
    expect(options[0]?.warning).toMatch(/não tem linhas de dado tabular/);
  });

  it("continua descartando uma aba vazia sem nenhum conteúdo visual", () => {
    const wb = XLSX.utils.book_new();
    const ws = sheet([]) as WorksheetWithAdvancedMetadata;
    ws["!oliAdvanced"] = {
      structuredTables: [],
      pivotTables: [],
      autoFilterRange: null,
      comments: [],
      hyperlinks: [],
      definedNames: [],
      externalLinks: [],
      dataValidations: [],
      hasVbaMacros: false,
      images: [],
      shapes: [],
      charts: [],
      cellFills: [],
    };
    XLSX.utils.book_append_sheet(wb, ws, "Página1");
    expect(sheetsWithData(wb)).toEqual([]);
  });
});

describe("preferredSheetIndex", () => {
  it("escolhe a primeira aba com pelo menos uma linha de dado", () => {
    const sheets = [
      { name: "Vazia", rows: [], warning: null },
      { name: "Vendas", rows: [{ nome: "Bolo" }], warning: null },
      { name: "Resumo", rows: [{ total: 10 }], warning: null },
    ];
    expect(preferredSheetIndex(sheets)).toBe(1);
  });

  it("cai no índice 0 quando nenhuma aba tem dado", () => {
    const sheets = [
      { name: "Vazia", rows: [], warning: null },
      { name: "Também vazia", rows: [], warning: null },
    ];
    expect(preferredSheetIndex(sheets)).toBe(0);
  });
});
