import { describe, expect, it, vi } from "vitest";
import {
  CSV_PROGRESSIVE_BLOCK_SIZE,
  PROGRESSIVE_IMPORT_SUPPORT,
  ProgressiveImportFallback,
  readCsvWorkbookProgressively,
} from "@/lib/csv-progressive-import";
import type { SheetOption } from "@/lib/import";
import { chooseImportStrategy } from "@/lib/import-strategy";
import { describeImportedSheetsDifferences } from "@/lib/progressive-import";
import {
  MAX_WORKBOOK_CELLS,
  readWorkbookBytes,
  type WorkbookReadProgress,
} from "@/lib/workbook-reader";

const encoder = new TextEncoder();

/**
 * Blob com tamanho de pedaço sob controle do teste.
 *
 * Um `Blob` real decide sozinho onde cortar. Aqui o corte precisa ser pequeno
 * de propósito, para que registro, caractere multibyte e fim de linha caiam
 * atravessados na fronteira em toda leitura do arquivo de teste.
 */
function blobComPedacos(bytes: Uint8Array, chunkSize: number): Blob {
  return {
    size: bytes.byteLength,
    slice: (inicio = 0, fim = bytes.byteLength) =>
      blobComPedacos(bytes.slice(inicio, fim), chunkSize),
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let offset = 0; offset < bytes.length; offset += chunkSize)
            controller.enqueue(bytes.slice(offset, offset + chunkSize));
          controller.close();
        },
      }),
    arrayBuffer: async () => bytes.slice().buffer,
  } as unknown as Blob;
}

/** O caminho validado, exatamente como ele roda hoje. */
function abasPeloCaminhoAtual(bytes: Uint8Array, fileName = "dados.csv"): SheetOption[] {
  return readWorkbookBytes(bytes, fileName);
}

async function abasPeloCaminhoProgressivo(
  bytes: Uint8Array,
  { chunkSize = 7, blockSize = 3, fileName = "dados.csv" } = {},
): Promise<SheetOption[]> {
  const resultado = await readCsvWorkbookProgressively(blobComPedacos(bytes, chunkSize), {
    fileName,
    blockSize,
  });
  return resultado.sheets;
}

/**
 * As formas de CSV que os dois caminhos precisam ler igual.
 *
 * A lista não é decorativa: cada linha aqui é um lugar onde os dois leitores
 * poderiam divergir em silêncio, porque cada um chega ao resultado por um
 * caminho diferente (o SheetJS monta uma worksheet, o progressivo monta uma
 * grade). A comparação é feita nas linhas tipadas, e não na grade de textos,
 * porque é a linha tipada que o painel recebe.
 */
const casos: Array<{ nome: string; texto: string }> = [
  { nome: "simples", texto: "a,b,c\n1,2,3\n" },
  { nome: "número com decimal brasileira", texto: "Id;Valor\n1;10,5\n2;20\n" },
  { nome: "datas", texto: "Quando;Nome\n2026-08-27;Ana\n2026-01-02;Bruno\n" },
  { nome: "moeda com ponto", texto: "Item;Preco\nBolo;1234.56\nTorta;7.00\n" },
  { nome: "booleanos", texto: "Item;Ativo\nA;TRUE\nB;FALSE\n" },
  { nome: "negativos e zero", texto: "Id;Saldo\n1;-10,5\n2;0\n3;0,0\n" },
  { nome: "células vazias", texto: "a,b,c\n1,,3\n,2,\n" },
  { nome: "campo entre aspas", texto: 'Nome,Nota\n"Silva, Ana",boa\n"Souza, Bia",otima\n' },
  { nome: "aspas escapadas", texto: 'Nome,Fala\nAna,"ele disse ""oi"""\n' },
  { nome: "quebra de linha dentro de aspas", texto: 'Nome,Nota\n"Ana\nMaria",boa\n' },
  { nome: "CRLF", texto: "a,b\r\n1,2\r\n3,4\r\n" },
  { nome: "sem quebra final", texto: "a,b\n1,2\n3,4" },
  { nome: "tabulação", texto: "a\tb\n1\t2\n3\t4\n" },
  { nome: "cabeçalhos repetidos", texto: "Valor,Valor\n1,2\n3,4\n" },
  { nome: "coluna final vazia", texto: "a,b,\n1,2,\n3,4,\n" },
  { nome: "coluna do meio vazia", texto: "a,,c\n1,,3\n4,,6\n" },
  { nome: "linha mais curta que o cabeçalho", texto: "a,b,c\n1,2\n3,4,5\n" },
  { nome: "linha vazia no meio", texto: "a,b\n1,2\n\n3,4\n" },
  { nome: "linhas vazias no fim", texto: "a,b\n1,2\n\n\n" },
  { nome: "só o cabeçalho", texto: "a,b,c\n" },
  {
    nome: "título com ponto e vírgula antes de dados por vírgula",
    // O caso que a janela de 25 linhas do detector de delimitador existe para
    // resolver: decidindo pela primeira linha, o separador sairia errado.
    texto: `Relatório de vendas; janeiro\nNome,Valor\n${Array.from(
      { length: 30 },
      (_, indice) => `Item ${indice},${indice}`,
    ).join("\n")}\n`,
  },
  {
    nome: "muitas linhas, atravessando vários blocos",
    texto: `Id;Setor;Valor\n${Array.from(
      { length: 2_500 },
      (_, indice) => `${indice};Setor ${indice % 7};${indice},5`,
    ).join("\n")}\n`,
  },
  {
    nome: "acentuação em UTF-8",
    texto: "Município;População\nSão Paulo;12396372\nBrasília;3055149\n",
  },
];

describe("equivalência entre o caminho progressivo de CSV e o caminho atual", () => {
  it.each(casos)("produz o mesmo resultado: $nome", async ({ texto }) => {
    const bytes = encoder.encode(texto);

    const atual = abasPeloCaminhoAtual(bytes);
    const progressivo = await abasPeloCaminhoProgressivo(bytes);

    expect(describeImportedSheetsDifferences(atual, progressivo)).toEqual([]);
    expect(progressivo).toHaveLength(atual.length);
  });

  it("a comparação não passa por vacuidade: o caso comum devolve aba com linha", async () => {
    // `describeImportedSheetsDifferences` aceita dois conjuntos vazios, e um
    // caminho progressivo que não devolvesse nada passaria em toda a lista
    // acima. Este teste ancora o outro extremo.
    const progressivo = await abasPeloCaminhoProgressivo(
      encoder.encode("Nome;Valor\nAna;1\nBia;2\n"),
    );

    expect(progressivo).toHaveLength(1);
    expect(progressivo[0]?.rows).toHaveLength(2);
  });

  it("lê windows-1252 igual ao caminho atual", async () => {
    // Bytes que não formam UTF-8 válido: é a heurística de codificação que
    // decide, e ela precisa decidir igual nos dois caminhos.
    const bytes = Uint8Array.from([
      ...encoder.encode("Nome;Cidade\n"),
      0x4a,
      0x6f,
      0x73,
      0xe9,
      0x3b,
      0x53,
      0xe3,
      0x6f,
      0x20,
      0x50,
      0x61,
      0x75,
      0x6c,
      0x6f,
      0x0a,
    ]);

    const atual = abasPeloCaminhoAtual(bytes);
    const progressivo = await abasPeloCaminhoProgressivo(bytes);

    expect(describeImportedSheetsDifferences(atual, progressivo)).toEqual([]);
    expect(progressivo[0]?.rows[0]?.["Nome"]).toBe("José");
  });

  it("descarta o marcador de ordem de bytes como o caminho atual", async () => {
    const bytes = encoder.encode("﻿Nome;Valor\nAna;1\n");

    const atual = abasPeloCaminhoAtual(bytes);
    const progressivo = await abasPeloCaminhoProgressivo(bytes);

    expect(describeImportedSheetsDifferences(atual, progressivo)).toEqual([]);
    expect(Object.keys(progressivo[0]?.rows[0] ?? {})).toContain("Nome");
  });

  it("chega ao mesmo resultado com qualquer tamanho de pedaço e de bloco", async () => {
    const texto = 'Nome,Nota\n"Ana\nMaria",10\nBia,"20,5"\nCarlos,30\n';
    const bytes = encoder.encode(texto);
    const referencia = abasPeloCaminhoAtual(bytes);

    for (const chunkSize of [1, 3, 64, bytes.byteLength])
      for (const blockSize of [1, 2, 1_000]) {
        const progressivo = await abasPeloCaminhoProgressivo(bytes, { chunkSize, blockSize });
        expect(describeImportedSheetsDifferences(referencia, progressivo)).toEqual([]);
      }
  });

  it("célula vazia continua sendo ausência, e não texto vazio", async () => {
    // A regra que a seção 148 do audit fixou: ausência alimenta as regras de
    // valor faltante, e texto vazio conta como preenchido. Um caminho que
    // entregasse `""` mudaria as métricas de qualidade sem nada na tela dizer.
    // Qual é a forma da ausência (chave ausente ou `null`) quem decide é o
    // caminho atual, e o teste cobra dos dois a mesma resposta.
    const bytes = encoder.encode("a,b,c\n1,,3\n");
    const [pelaAtual] = abasPeloCaminhoAtual(bytes);
    const [pelaProgressiva] = await abasPeloCaminhoProgressivo(bytes);

    expect(pelaProgressiva?.rows[0]?.["b"]).not.toBe("");
    expect(pelaProgressiva?.rows[0]?.["b"]).toBe(pelaAtual?.rows[0]?.["b"]);
    expect("b" in (pelaProgressiva?.rows[0] ?? {})).toBe("b" in (pelaAtual?.rows[0] ?? {}));
  });

  it("número chega como número, e não como texto", async () => {
    const [aba] = await abasPeloCaminhoProgressivo(encoder.encode("Id;Valor\n1;10,5\n"));

    expect(typeof aba?.rows[0]?.["Valor"]).toBe("number");
    expect(aba?.rows[0]?.["Valor"]).toBe(10.5);
  });
});

describe("progresso da leitura progressiva", () => {
  it("reporta fração real no reconhecimento e na leitura, sem recuar", async () => {
    const bytes = encoder.encode(
      `a,b\n${Array.from({ length: 400 }, (_, indice) => `${indice},${indice}`).join("\n")}\n`,
    );
    const eventos: WorkbookReadProgress[] = [];

    await readCsvWorkbookProgressively(blobComPedacos(bytes, 64), {
      fileName: "dados.csv",
      blockSize: 50,
      onProgress: (progresso) => eventos.push(progresso),
    });

    const etapas = eventos.map((evento) => evento.stage);
    expect(etapas[0]).toBe("decoding");
    expect(etapas).toContain("streaming");
    expect(etapas).toContain("analyzing");
    expect(etapas.at(-1)).toBe("complete");

    for (const etapa of ["decoding", "streaming"] as const) {
      const fracoes = eventos
        .filter((evento) => evento.stage === etapa && evento.completed !== undefined)
        .map((evento) => evento.completed! / evento.total!);
      expect(fracoes.length).toBeGreaterThan(1);
      expect(fracoes).toEqual([...fracoes].sort((a, b) => a - b));
      expect(fracoes.at(-1)).toBe(1);
    }
  });

  it("a etapa de leitura sabe medir, ao contrário do parse do caminho atual", async () => {
    const bytes = encoder.encode("a,b\n1,2\n");
    const eventos: WorkbookReadProgress[] = [];

    await readCsvWorkbookProgressively(blobComPedacos(bytes, 4), {
      fileName: "dados.csv",
      onProgress: (progresso) => eventos.push(progresso),
    });

    expect(eventos.some((evento) => evento.stage === "streaming" && evento.total! > 0)).toBe(true);
    expect(eventos.some((evento) => evento.stage === "parsing")).toBe(false);
  });
});

describe("recusa, fallback e cancelamento", () => {
  it("pede o caminho atual quando o conteúdo não é texto", async () => {
    // Um pacote OOXML renomeado para `.csv`. O caminho atual sabe lê-lo; este
    // não, e dizer isso é diferente de recusar o arquivo.
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...encoder.encode("qualquer coisa")]);

    await expect(
      readCsvWorkbookProgressively(blobComPedacos(bytes, 4), { fileName: "planilha.csv" }),
    ).rejects.toBeInstanceOf(ProgressiveImportFallback);
  });

  it("recusa um arquivo que não é planilha com a mesma mensagem do caminho atual", async () => {
    const bytes = encoder.encode("%PDF-1.7\nconteúdo qualquer\n");

    const erroProgressivo = await readCsvWorkbookProgressively(blobComPedacos(bytes, 4), {
      fileName: "relatorio.csv",
    }).then(
      () => null,
      (erro: unknown) => erro as Error,
    );
    const erroAtual = (() => {
      try {
        readWorkbookBytes(bytes, "relatorio.csv");
        return null;
      } catch (erro) {
        return erro as Error;
      }
    })();

    expect(erroProgressivo).toBeInstanceOf(Error);
    expect(erroProgressivo).not.toBeInstanceOf(ProgressiveImportFallback);
    expect(erroProgressivo?.message).toBe(erroAtual?.message);
  });

  it("recusa durante a leitura quando o arquivo passa do teto de células", async () => {
    // O teto é conferido enquanto o arquivo é lido, e não depois: recusar só no
    // fim significaria ter montado a planilha inteira na memória antes.
    const colunas = 10;
    const linhas = Math.ceil(MAX_WORKBOOK_CELLS / colunas) + 10;
    const cabecalho = Array.from({ length: colunas }, (_, indice) => `c${indice}`).join(",");
    const linha = Array.from({ length: colunas }, () => "1").join(",");
    const bytes = encoder.encode(`${cabecalho}\n${`${linha}\n`.repeat(linhas)}`);

    await expect(
      readCsvWorkbookProgressively(blobComPedacos(bytes, 64 * 1024), { fileName: "grande.csv" }),
    ).rejects.toThrow(/2 milhões de células/);
  });

  it("cancela pelo sinal e não devolve resultado", async () => {
    const bytes = encoder.encode(
      `a,b\n${Array.from({ length: 500 }, (_, indice) => `${indice},x`).join("\n")}\n`,
    );
    const controlador = new AbortController();
    const onProgress = vi.fn((progresso: WorkbookReadProgress) => {
      if (progresso.stage === "streaming") controlador.abort();
    });

    await expect(
      readCsvWorkbookProgressively(blobComPedacos(bytes, 32), {
        fileName: "dados.csv",
        blockSize: 10,
        signal: controlador.signal,
        onProgress,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("relatório da leitura progressiva", () => {
  it("identifica o leitor e não inventa verificação nem WASM", async () => {
    const bytes = encoder.encode("a,b\n1,2\n3,4\n");

    const { report } = await readCsvWorkbookProgressively(blobComPedacos(bytes, 4), {
      fileName: "dados.csv",
    });

    expect(report.reader).toBe("csv-progressivo");
    expect(report.format).toBe("csv");
    expect(report.sourceBytes).toBe(bytes.byteLength);
    // CSV não é compactado: apresentar um tamanho expandido diferente seria
    // inventar um número.
    expect(report.expandedBytes).toBe(bytes.byteLength);
    expect(report.verificationMs).toBe(0);
    expect(report.wasmCandidateStatus).toBe("not-eligible");
    expect(report.wasmOutputUsed).toBe(false);
    expect(report.sheets).toBe(1);
  });

  it("estima o pico sem o arquivo e sem a worksheet", async () => {
    const bytes = encoder.encode(`a,b,c\n${"1,2,3\n".repeat(100)}`);

    const { report } = await readCsvWorkbookProgressively(blobComPedacos(bytes, 128), {
      fileName: "dados.csv",
    });

    // O caminho atual estima pico a partir do arquivo somado a duas cópias
    // expandidas. Aqui nenhuma das duas existe, e reaproveitar aquela fórmula
    // apresentaria um pico que este programa não produz.
    expect(report.estimatedPeakMemoryBytes).toBeLessThan(
      report.sourceBytes + report.expandedBytes * 2 + report.visitedCells * 160,
    );
    expect(report.estimatedPeakMemoryBytes).toBeGreaterThan(0);
  });

  it("entrega a aba pelo escoamento e não devolve a segunda cópia", async () => {
    const bytes = encoder.encode("a,b\n1,2\n");
    const escoadas: SheetOption[] = [];

    const resultado = await readCsvWorkbookProgressively(blobComPedacos(bytes, 4), {
      fileName: "dados.csv",
      onSheet: (aba) => escoadas.push(aba),
    });

    expect(escoadas).toHaveLength(1);
    expect(resultado.sheets).toHaveLength(0);
    expect(resultado.report.sheets).toBe(1);
  });
});

describe("ligação com o seletor de estratégia", () => {
  it("o CSV grande passa a escolher o caminho progressivo", () => {
    const decisao = chooseImportStrategy({
      fileName: "dados.csv",
      bytes: 40 * 1024 * 1024,
      support: PROGRESSIVE_IMPORT_SUPPORT,
    });

    expect(decisao.strategy).toBe("csv-progressivo");
    expect(decisao.reason).toBe("pico-alto");
  });

  it("o CSV pequeno continua no caminho atual, que é o validado pelo corpus", () => {
    const decisao = chooseImportStrategy({
      fileName: "dados.csv",
      bytes: 2 * 1024 * 1024,
      support: PROGRESSIVE_IMPORT_SUPPORT,
    });

    expect(decisao.strategy).toBe("atual");
    expect(decisao.reason).toBe("pico-confortavel");
  });

  it("o XLSX grande continua sem caminho progressivo, e o motivo diz isso", () => {
    const decisao = chooseImportStrategy({
      fileName: "planilha.xlsx",
      bytes: 40 * 1024 * 1024,
      support: PROGRESSIVE_IMPORT_SUPPORT,
    });

    expect(decisao.strategy).toBe("atual");
    expect(decisao.preferred).toBe("ooxml-progressivo");
    expect(decisao.reason).toBe("caminho-progressivo-indisponivel");
  });

  it("o tamanho de bloco vem da lista de candidatos, e não de um número solto", () => {
    expect([1_000, 2_000, 5_000]).toContain(CSV_PROGRESSIVE_BLOCK_SIZE);
  });
});
