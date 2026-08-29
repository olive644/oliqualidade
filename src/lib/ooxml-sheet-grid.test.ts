import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { sheetsWithData } from "@/lib/import";
import { inspectOoxml, readOoxmlSheetGrids, type OoxmlSheetGrid } from "@/lib/ooxml-reader";
import { describeImportedSheetsDifferences } from "@/lib/progressive-import";

/**
 * A grade da aba precisa ser substituível pela worksheet.
 *
 * O nível em que isso se afirma importa, e a primeira versão deste teste errou
 * nele. Comparar `grade.aoa` contra `sheet_to_json` da worksheet parece a
 * comparação óbvia, e ela acusa divergências que **não** existem no resultado:
 * numa planilha real do corpus, uma célula de texto com formato de data
 * (`t="s"` com `z="d-mmm"`) faz o `sheet_to_json` produzir `Date { NaN }`,
 * enquanto a grade entrega o texto certo. Quem conserta isso é
 * `normalizeRawRow`, que consulta a célula de origem antes de aceitar a data, e
 * o mesmo vale para o deslocamento de fuso que o `sheet_to_json` aplica a uma
 * data válida: ele prefere `sourceCell.v`.
 *
 * Ou seja, a grade intermediária dos dois caminhos legitimamente difere, e o
 * que precisa coincidir é o que a normalização produz. É isso que este arquivo
 * compara, com a mesma ferramenta que a equivalência do CSV usa.
 *
 * A comparação é sempre contra a worksheet que o **mesmo** leitor monta a
 * partir do **mesmo** XML, e não contra o SheetJS: o que está em teste é a troca
 * de representação, e comparar com o outro leitor misturaria essa pergunta com
 * as divergências conhecidas entre os dois, que `compareAndRepairWithOoxml`
 * existe para tratar.
 */

const encoder = new TextEncoder();

/**
 * A worksheet mínima que acompanha uma grade de OOXML.
 *
 * Além do `!ref`, ela carrega mesclagem e linha oculta, que a normalização lê
 * da worksheet e uma grade de valores não tem como representar. É por isso que
 * `OoxmlSheetGrid` as leva junto: sem elas, uma linha oculta entraria como dado
 * e uma mesclagem deixaria de preencher as células vazias do intervalo.
 */
function worksheetMinimaDaGrade(grade: OoxmlSheetGrid): XLSX.WorkSheet {
  const worksheet: XLSX.WorkSheet = { "!ref": grade.ref };
  if (grade.mergedRanges.length)
    worksheet["!merges"] = grade.mergedRanges.map((intervalo) =>
      XLSX.utils.decode_range(intervalo),
    );
  if (grade.hiddenRows.length) {
    const linhas: XLSX.RowInfo[] = [];
    for (const numero of grade.hiddenRows) linhas[numero - 1] = { hidden: true };
    worksheet["!rows"] = linhas;
  }
  return worksheet;
}

/** Normaliza o mesmo pacote pelos dois caminhos e devolve onde eles divergem. */
function diferencasDoPacote(bytes: Uint8Array | Record<string, Uint8Array>) {
  const inspecao = inspectOoxml(bytes);
  const grades = readOoxmlSheetGrids(bytes);

  const minimo: XLSX.WorkBook = {
    SheetNames: [...inspecao.workbook.SheetNames],
    Sheets: {},
  } as XLSX.WorkBook;
  for (const nome of inspecao.workbook.SheetNames) {
    const grade = grades.get(nome);
    if (!grade) throw new Error(`a aba "${nome}" não produziu grade`);
    minimo.Sheets[nome] = worksheetMinimaDaGrade(grade);
  }

  const pelaWorksheet = sheetsWithData(inspecao.workbook);
  const pelaGrade = sheetsWithData(minimo, {
    gridFor: (nome) => {
      const grade = grades.get(nome);
      return grade ? { aoa: grade.aoa, textAoa: grade.textAoa } : undefined;
    },
  });

  return {
    diferencas: describeImportedSheetsDifferences(pelaWorksheet, pelaGrade),
    abas: pelaWorksheet.length,
    temData: [...grades.values()].some((grade) =>
      grade.aoa.some((linha) => linha.some((valor) => valor instanceof Date)),
    ),
  };
}

/** Constrói um pacote OOXML a partir de linhas, para os casos sintéticos. */
function pacoteDe(dados: unknown[][], formatoDaColuna?: Record<number, string>): Uint8Array {
  const worksheet = XLSX.utils.aoa_to_sheet(dados);
  if (formatoDaColuna)
    for (const [coluna, formato] of Object.entries(formatoDaColuna))
      for (let linha = 0; linha < dados.length; linha += 1) {
        const endereco = XLSX.utils.encode_cell({ r: linha, c: Number(coluna) });
        const celula = worksheet[endereco] as XLSX.CellObject | undefined;
        if (celula && celula.t === "n") celula.z = formato;
      }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");
  return new Uint8Array(
    XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true }),
  );
}

describe("a grade da aba normaliza igual à worksheet do mesmo leitor", () => {
  it("números, textos e vazios", () => {
    const { diferencas, abas } = diferencasDoPacote(
      pacoteDe([
        ["Nome", "Quantidade", "Observação"],
        ["Ana", 10, "primeira"],
        ["Bruno", null, null],
        ["Carla", 0, "zero"],
      ]),
    );

    expect(diferencas).toEqual([]);
    expect(abas).toBe(1);
  });

  it("data com formato, que vira Date nos valores e texto formatado no texto", () => {
    // É aqui que as duas grades deixam de coincidir, ao contrário do CSV: o
    // mesmo número aparece como `Date` numa e como texto na outra.
    const bytes = pacoteDe(
      [
        ["Quando", "Valor"],
        [new Date(Date.UTC(2026, 7, 27)), 1234.5],
        [new Date(Date.UTC(2026, 7, 28)), 99],
      ],
      { 1: "#,##0.00" },
    );

    const grade = readOoxmlSheetGrids(bytes).get("Dados")!;

    expect(grade.aoa[1]![0]).toBeInstanceOf(Date);
    expect(typeof grade.textAoa[1]![0]).toBe("string");
    expect(diferencasDoPacote(bytes).diferencas).toEqual([]);
  });

  it("booleano chega como booleano, e não como texto", () => {
    const bytes = pacoteDe([
      ["Item", "Ativo"],
      ["A", true],
      ["B", false],
    ]);

    const grade = readOoxmlSheetGrids(bytes).get("Dados")!;

    expect(grade.aoa[1]![1]).toBe(true);
    expect(grade.aoa[2]![1]).toBe(false);
    expect(diferencasDoPacote(bytes).diferencas).toEqual([]);
  });

  it("texto com formato de data não vira data fantasma", () => {
    // O caso que o corpus real trouxe: uma célula `t="s"` com formato de data
    // faz o `sheet_to_json` produzir `Date { NaN }`. A grade entrega o texto,
    // e a normalização chega ao mesmo lugar pelos dois caminhos.
    const xml =
      '<worksheet><dimension ref="A1:B2"/><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><t>Quando</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Ana</t></is></c>' +
      '<c r="B2" s="1" t="str"><v>a combinar</v></c></row>' +
      "</sheetData></worksheet>";
    const archive = {
      "xl/workbook.xml": encoder.encode(
        '<workbook><sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": encoder.encode(
        '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/styles.xml": encoder.encode(
        '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="17"/></cellXfs></styleSheet>',
      ),
      "xl/worksheets/sheet1.xml": encoder.encode(xml),
    };

    const grade = readOoxmlSheetGrids(archive).get("Dados")!;

    expect(grade.aoa[1]![1]).toBe("a combinar");
    expect(diferencasDoPacote(archive).diferencas).toEqual([]);
  });

  it("linha oculta e mesclagem viajam com a grade", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Título", null],
      ["Nome", "Valor"],
      ["Ana", 1],
      ["Bia", 2],
    ]);
    worksheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
    worksheet["!rows"] = [undefined, undefined, undefined, { hidden: true }] as XLSX.RowInfo[];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));

    const grade = readOoxmlSheetGrids(bytes).get("Dados")!;

    expect(grade.mergedRanges).toContain("A1:B1");
    expect(grade.hiddenRows).toContain(4);
    expect(diferencasDoPacote(bytes).diferencas).toEqual([]);
  });

  it("célula só com formatação, sem valor, não vira dado", () => {
    // Ela existe no XML e o inventário a registra, mas a worksheet não a cria.
    // A grade segue a worksheet, porque é com ela que precisa ser trocável.
    const archive = {
      "xl/workbook.xml": encoder.encode(
        '<workbook><sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": encoder.encode(
        '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/worksheets/sheet1.xml": encoder.encode(
        '<worksheet><dimension ref="A1:B2"/><sheetData>' +
          '<row r="1"><c r="A1" t="inlineStr"><is><t>Nome</t></is></c><c r="B1" s="1"/></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>Ana</t></is></c></row>' +
          "</sheetData></worksheet>",
      ),
    };

    const grade = readOoxmlSheetGrids(archive).get("Dados")!;

    expect(grade.aoa[0]).toEqual(["Nome", null]);
    expect(grade.aoa[1]).toEqual(["Ana", null]);
  });
});

/**
 * A prova que vale mais: planilhas reais, com formatos, datas, mesclagens e
 * geradores fora do Excel. O corpus é local e não versionado, então este bloco
 * é pulado na CI, e rodar na máquina é responsabilidade de quem mexer aqui.
 */
const RAIZES = ["test-fixtures/sanitized-real", "upload"];

function planilhasLocais(): string[] {
  const encontrados: string[] = [];
  for (const raiz of RAIZES) {
    if (!existsSync(raiz)) continue;
    for (const nome of readdirSync(raiz).sort())
      if (/\.(xlsx|xlsm|xltx|xltm)$/i.test(nome)) encontrados.push(join(raiz, nome));
  }
  return encontrados;
}

const locais = planilhasLocais();

/**
 * Compara um arquivo, ou devolve `null` quando ele não é assunto da comparação.
 *
 * Um pacote que o leitor independente recusa inteiro já não produz worksheet
 * nenhuma hoje, então não há dois caminhos para confrontar.
 */
function comparar(caminho: string) {
  try {
    return { caminho, ...diferencasDoPacote(new Uint8Array(readFileSync(caminho))) };
  } catch (erro) {
    if (erro instanceof Error && /pacote OOXML|aba OOXML/i.test(erro.message)) return null;
    throw erro;
  }
}

describe.skipIf(!locais.length)("a grade contra a worksheet, em planilhas reais", () => {
  it("encontra o corpus local", () => {
    expect(locais.length).toBeGreaterThan(0);
  });

  it("toda planilha real do corpus tem célula de data", { timeout: 300_000 }, () => {
    // Este teste existe para explicar a ausência do outro. A garantia positiva
    // natural seria "em planilha real sem data, a grade é substituível pela
    // worksheet", e ela não pode ser escrita: não existe planilha assim no
    // corpus. Numa planilha de qualidade, data é coluna obrigatória.
    const analisadas = locais.map((caminho) => comparar(caminho)).filter((item) => item !== null);

    expect(analisadas.length).toBeGreaterThan(0);
    expect(analisadas.filter((item) => !item.temData).map((item) => item.caminho)).toEqual([]);
  });

  it("com célula de data, a grade ainda não substitui a worksheet", { timeout: 300_000 }, () => {
    // O achado desta etapa, e o que ele custa. `formatTemporalCell` decide
    // granularidade, fuso e formato a partir de `cell.z` e `cell.w` da célula
    // de origem. Numa worksheet mínima não há célula, então a data é
    // descartada: a coluna perde valor, e quando ela era só data, some inteira,
    // o que ainda desloca a detecção de cabeçalho e muda a contagem de linhas.
    //
    // Não é defeito da grade. É o formato numérico que ela ainda não carrega, e
    // é a próxima peça do caminho progressivo de OOXML. O teste registra o
    // estado atual: se alguém fechar essa lacuna, ele quebra e obriga a
    // atualizar o registro, em vez de deixar a limitação documentada mentindo.
    const comData = locais
      .map((caminho) => comparar(caminho))
      .filter((item): item is NonNullable<typeof item> => item !== null && item.temData);
    const comDivergencia = comData.filter((item) => item.diferencas.length > 0);
    const tipos = [...new Set(comDivergencia.flatMap((item) => item.diferencas.map((d) => d.kind)))]
      .sort()
      .join(", ");

    expect(comDivergencia.length).toBeGreaterThan(0);
    process.stdout.write(
      `\n  ${comData.length} planilhas reais com data` +
        `\n  ${comDivergencia.length} ainda divergem, em: ${tipos}` +
        `\n  ${comData.length - comDivergencia.length} já coincidem\n`,
    );
  });
});

/**
 * A medição que decide se vale fechar a lacuna da data.
 *
 * A grade existe para tirar a worksheet do caminho, e a lacuna encontrada pede
 * que ela carregue o formato numérico e o texto exibido das células de data.
 * Isso reintroduz parte do que ela existe para remover, e o tamanho dessa parte
 * é a pergunta. Medir vem antes de escrever o código, e não depois.
 *
 * Desligada por padrão, porque gera um pacote de dezenas de MiB:
 *
 *     OLI_GRID_BENCHMARK=1 NODE_OPTIONS=--expose-gc npx vitest run src/lib/ooxml-sheet-grid.test.ts
 *
 * Cada variante é medida no seu próprio teste, e nada é retido entre eles. Foi
 * assim por causa da lição da seção 150: medir duas variantes dentro do mesmo
 * teste faz o lixo da primeira ser coletado durante a segunda, e a subtração
 * chega a sair negativa.
 */
const medicaoLigada = process.env["OLI_GRID_BENCHMARK"] === "1";
const podeColetar = typeof (globalThis as { gc?: () => void }).gc === "function";

function vivoAgora(): number {
  const coletar = (globalThis as { gc?: () => void }).gc;
  coletar?.();
  coletar?.();
  coletar?.();
  const uso = process.memoryUsage();
  return uso.heapUsed + uso.external;
}

const emMiB = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

/** 120 mil linhas por 8 colunas, com uma coluna de data de verdade. */
function pacoteComData(): { bytes: Uint8Array; aba: string } {
  const cabecalho = ["Id", "Quando", "Setor", "Produto", "Quantidade", "Valor", "Status", "Nota"];
  const dados: unknown[][] = [cabecalho];
  for (let linha = 0; linha < 120_000; linha += 1)
    dados.push([
      linha,
      new Date(Date.UTC(2026, linha % 12, (linha % 28) + 1)),
      `Setor ${linha % 5}`,
      `Produto ${linha % 400}`,
      linha % 97,
      (linha % 1000) + (linha % 100) / 100,
      `Status ${linha % 3}`,
      `Observação ${linha % 50}`,
    ]);
  const worksheet = XLSX.utils.aoa_to_sheet(dados);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");
  return {
    bytes: new Uint8Array(
      XLSX.write(workbook, { type: "array", bookType: "xlsx", cellDates: true }),
    ),
    aba: "Dados",
  };
}

const medidas: Record<string, number> = {};

describe.skipIf(!medicaoLigada)("o que cada representação custa", () => {
  // O pacote é construído uma vez e fica vivo em todas as medições, então ele
  // entra igualmente na linha de base de todas elas.
  const fixture = medicaoLigada ? pacoteComData() : null;

  it("a worksheet que o leitor monta hoje", { timeout: 900_000 }, () => {
    const base = vivoAgora();
    // Só a worksheet fica viva: o inventário de células e as estruturas que
    // `inspectOoxml` também produz viram lixo antes da medida.
    let retida: XLSX.WorkSheet | null = inspectOoxml(fixture!.bytes).workbook.Sheets[fixture!.aba]!;
    medidas["worksheet"] = vivoAgora() - base;
    expect(retida["!ref"]).toBeDefined();
    retida = null;
  });

  it("a grade de valores e de texto", { timeout: 900_000 }, () => {
    const base = vivoAgora();
    let retida: { aoa: unknown[][]; textAoa: unknown[][] } | null = (() => {
      const grade = readOoxmlSheetGrids(fixture!.bytes).get(fixture!.aba)!;
      return { aoa: grade.aoa, textAoa: grade.textAoa };
    })();
    medidas["grade"] = vivoAgora() - base;
    expect(retida.aoa.length).toBeGreaterThan(100_000);
    retida = null;
  });

  it("a grade mais o formato e o texto das células de data", { timeout: 900_000 }, () => {
    const base = vivoAgora();
    let retida: {
      aoa: unknown[][];
      textAoa: unknown[][];
      formatos: Map<string, { z: string; w: string }>;
    } | null = (() => {
      const grade = readOoxmlSheetGrids(fixture!.bytes).get(fixture!.aba)!;
      // O que a lacuna pede: por célula de data, o formato numérico e o texto
      // exibido, que é o que `formatTemporalCell` consulta na célula de origem.
      const formatos = new Map<string, { z: string; w: string }>();
      for (let linha = 0; linha < grade.aoa.length; linha += 1)
        for (let coluna = 0; coluna < grade.aoa[linha]!.length; coluna += 1)
          if (grade.aoa[linha]![coluna] instanceof Date)
            formatos.set(`${linha},${coluna}`, {
              z: "m/d/yy",
              w: String(grade.textAoa[linha]![coluna] ?? ""),
            });
      return { aoa: grade.aoa, textAoa: grade.textAoa, formatos };
    })();
    medidas["gradeComFormato"] = vivoAgora() - base;
    expect(retida.formatos.size).toBeGreaterThan(100_000);
    retida = null;
  });

  it("diz se vale fechar a lacuna", () => {
    const linhas = [
      "",
      `  worksheet de hoje:              ${String(emMiB(medidas["worksheet"]!)).padStart(6)} MiB`,
      `  grade:                          ${String(emMiB(medidas["grade"]!)).padStart(6)} MiB`,
      `  grade mais formato das datas:   ${String(emMiB(medidas["gradeComFormato"]!)).padStart(6)} MiB`,
      `  custo do formato:               ${String(emMiB(medidas["gradeComFormato"]! - medidas["grade"]!)).padStart(6)} MiB`,
      "",
    ];
    process.stdout.write(linhas.join("\n"));

    // Nenhuma medida pode sair negativa: quando isso acontece, a linha de base
    // estava suja e o número não mede o que diz medir.
    for (const [nome, valor] of Object.entries(medidas))
      expect(`${nome} positivo: ${valor > 0}`).toBe(`${nome} positivo: true`);
    if (podeColetar) expect(medidas["gradeComFormato"]).toBeLessThan(medidas["worksheet"]!);
  });
});

/**
 * Onde os pares de formato moram, medido antes de escolher.
 *
 * A medição acima respondeu que fechar a lacuna compensa. Esta responde a
 * pergunta seguinte, que é de desenho: o mapa por endereço com o par completo é
 * o mais simples de escrever, e não é o mais barato. Duas observações o
 * encolhem, e as duas precisam de número antes de virar código.
 *
 * A primeira é que o texto exibido **já** está na grade: `textAoa` guarda
 * exatamente o `w` que `formatTemporalCell` consulta. Guardá-lo de novo no mapa
 * é pagar duas vezes pela mesma string.
 *
 * A segunda é que o formato numérico repete: uma coluna de data inteira
 * costuma ter um formato só, e o pacote OOXML já guarda formatos por índice de
 * estilo, e não por célula.
 *
 * As variantes são medidas sobre a mesma grade viva, uma de cada vez, com a
 * anterior descartada e o coletor chamado entre elas. Toda medida é conferida
 * como positiva, pela mesma razão da seção 150.
 */
describe.skipIf(!medicaoLigada)("onde os pares de formato moram", () => {
  it("compara os três desenhos possíveis", { timeout: 900_000 }, () => {
    const grade = readOoxmlSheetGrids(pacoteComData().bytes).get("Dados")!;
    const ehData = (linha: number, coluna: number) => grade.aoa[linha]![coluna] instanceof Date;

    /** Mede uma variante com a grade viva, e devolve só o que ela acrescenta. */
    const acrescentadoPor = (construir: () => unknown): number => {
      const base = vivoAgora();
      let retido: unknown = construir();
      const custo = vivoAgora() - base;
      retido = null;
      expect(retido).toBeNull();
      return custo;
    };

    // A: o desenho mais simples. Par completo por célula de data.
    const mapaCompleto = acrescentadoPor(() => {
      const mapa = new Map<string, { z: string; w: string }>();
      for (let linha = 0; linha < grade.aoa.length; linha += 1)
        for (let coluna = 0; coluna < grade.aoa[linha]!.length; coluna += 1)
          if (ehData(linha, coluna))
            mapa.set(`${linha},${coluna}`, {
              z: "m/d/yy",
              w: String(grade.textAoa[linha]![coluna] ?? ""),
            });
      return mapa;
    });

    // B: só o formato por célula. O texto exibido vem de `textAoa`, que a grade
    // já carrega, e a string do formato é a mesma instância em todas.
    const mapaSoFormato = acrescentadoPor(() => {
      const mapa = new Map<string, string>();
      const formato = "m/d/yy";
      for (let linha = 0; linha < grade.aoa.length; linha += 1)
        for (let coluna = 0; coluna < grade.aoa[linha]!.length; coluna += 1)
          if (ehData(linha, coluna)) mapa.set(`${linha},${coluna}`, formato);
      return mapa;
    });

    // C: um formato por coluna. Só vale quando a coluna é homogênea, e o teste
    // ao lado confere se isso se sustenta no corpus real.
    const porColuna = acrescentadoPor(() => {
      const formatos: (string | null)[] = [];
      for (let coluna = 0; coluna < (grade.aoa[0]?.length ?? 0); coluna += 1) {
        let formato: string | null = null;
        for (let linha = 0; linha < grade.aoa.length; linha += 1)
          if (ehData(linha, coluna)) {
            formato = "m/d/yy";
            break;
          }
        formatos[coluna] = formato;
      }
      return formatos;
    });

    process.stdout.write(
      [
        "",
        `  A) mapa por célula, com formato e texto: ${String(emMiB(mapaCompleto)).padStart(5)} MiB`,
        `  B) mapa por célula, só o formato:        ${String(emMiB(mapaSoFormato)).padStart(5)} MiB`,
        `  C) um formato por coluna:                ${String(emMiB(porColuna)).padStart(5)} MiB`,
        "",
      ].join("\n"),
    );

    for (const [nome, valor] of Object.entries({ mapaCompleto, mapaSoFormato, porColuna }))
      expect(`${nome} positivo: ${valor > 0}`).toBe(`${nome} positivo: true`);
    expect(mapaSoFormato).toBeLessThan(mapaCompleto);
    expect(porColuna).toBeLessThan(mapaSoFormato);
  });
});

describe.skipIf(!locais.length)("o formato de data é homogêneo por coluna?", () => {
  it(
    "conta as colunas de data com mais de um formato, no corpus real",
    { timeout: 300_000 },
    () => {
      // O desenho C só é possível se a coluna de data tiver um formato só. Isso é
      // uma afirmação sobre planilha real, não sobre o formato OOXML, então quem
      // responde é o corpus.
      let colunasComData = 0;
      let colunasComVariosFormatos = 0;

      for (const caminho of locais) {
        let inspecao;
        try {
          inspecao = inspectOoxml(new Uint8Array(readFileSync(caminho)));
        } catch {
          continue;
        }
        for (const nome of inspecao.workbook.SheetNames) {
          const worksheet = inspecao.workbook.Sheets[nome]!;
          if (!worksheet["!ref"]) continue;
          const usado = XLSX.utils.decode_range(worksheet["!ref"]);
          for (let coluna = usado.s.c; coluna <= usado.e.c; coluna += 1) {
            const formatos = new Set<string>();
            for (let linha = usado.s.r; linha <= usado.e.r; linha += 1) {
              const celula = worksheet[XLSX.utils.encode_cell({ r: linha, c: coluna })] as
                XLSX.CellObject | undefined;
              if (celula?.t === "d") formatos.add(String(celula.z ?? ""));
            }
            if (formatos.size === 0) continue;
            colunasComData += 1;
            if (formatos.size > 1) colunasComVariosFormatos += 1;
          }
        }
      }

      process.stdout.write(
        `\n  ${colunasComData} colunas de data no corpus` +
          `\n  ${colunasComVariosFormatos} com mais de um formato\n`,
      );
      expect(colunasComData).toBeGreaterThan(0);
    },
  );
});
