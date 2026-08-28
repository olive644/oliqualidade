import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { CsvRecordParser, readCsvInBlocks, sniffCsvEncoding } from "@/lib/csv-stream";

const encoder = new TextEncoder();

/** Analisa um texto inteiro de uma vez, como referência. */
function parseWhole(text: string, delimiter = ","): string[][] {
  const parser = new CsvRecordParser(delimiter);
  return [...parser.push(text), ...parser.finish()];
}

/** Analisa o mesmo texto cortado em pedaços de tamanho fixo. */
function parseInChunks(text: string, size: number, delimiter = ","): string[][] {
  const parser = new CsvRecordParser(delimiter);
  const registros: string[][] = [];
  for (let offset = 0; offset < text.length; offset += size)
    registros.push(...parser.push(text.slice(offset, offset + size)));
  registros.push(...parser.finish());
  return registros;
}

/**
 * Blob com tamanho de pedaço sob controle do teste.
 *
 * O `Blob` real decide sozinho onde cortar, e o que precisa ser provado aqui é
 * justamente que o corte não importa.
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

async function lerTudo(bytes: Uint8Array, chunkSize: number, blockSize = 2) {
  const blob = blobComPedacos(bytes, chunkSize);
  const sniff = await sniffCsvEncoding(blob);
  const blocos: string[][][] = [];
  const resumo = await readCsvInBlocks(blob, sniff, {
    blockSize,
    onBlock: (rows) => {
      blocos.push(rows);
    },
  });
  return { blocos, linhas: blocos.flat(), resumo };
}

describe("analisador incremental de CSV", () => {
  it("dá o mesmo resultado cortando em qualquer posição", () => {
    const texto = 'a,b,c\r\n1,"dois, com vírgula",3\n"com ""aspas""",x,\n último,,fim';
    const referencia = parseWhole(texto);

    // Um pedaço de bytes não é uma linha: o corte tem de ser irrelevante em
    // toda posição, inclusive no meio do CRLF e no meio das aspas escapadas.
    for (let tamanho = 1; tamanho <= texto.length; tamanho += 1)
      expect(parseInChunks(texto, tamanho), `pedaços de ${tamanho}`).toEqual(referencia);
  });

  it("preserva campo entre aspas com quebra de linha dentro", () => {
    expect(parseWhole('a,"linha um\nlinha dois",c')).toEqual([["a", "linha um\nlinha dois", "c"]]);
  });

  it("entende aspas escapadas e aspas no meio do campo", () => {
    expect(parseWhole('"ele disse ""oi""",fim')).toEqual([['ele disse "oi"', "fim"]]);
  });

  it("aceita CRLF, LF e CR como fim de registro", () => {
    expect(parseWhole("a,b\r\nc,d\ne,f\rg,h")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
  });

  it("entrega a última linha mesmo sem quebra final", () => {
    expect(parseWhole("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("não inventa um registro vazio quando o arquivo termina com quebra", () => {
    expect(parseWhole("a,b\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("preserva células vazias, inclusive no começo e no fim", () => {
    expect(parseWhole(",a,,b,")).toEqual([["", "a", "", "b", ""]]);
    expect(parseWhole('"",x')).toEqual([["", "x"]]);
  });

  it("preserva cabeçalhos repetidos sem renomear nem descartar", () => {
    expect(parseWhole("Valor,Valor,Valor")).toEqual([["Valor", "Valor", "Valor"]]);
  });

  it("respeita o delimitador escolhido", () => {
    expect(parseWhole("a;b;c", ";")).toEqual([["a", "b", "c"]]);
    expect(parseWhole("a\tb\tc", "\t")).toEqual([["a", "b", "c"]]);
    // Com ponto e vírgula, a vírgula decimal é conteúdo e não separador.
    expect(parseWhole("Valor\n1.234,50", ";")).toEqual([["Valor"], ["1.234,50"]]);
  });

  it("não termina registro dentro de aspas, nem com CRLF", () => {
    expect(parseWhole('"a\r\nb",c')).toEqual([["a\r\nb", "c"]]);
  });
});

describe("leitura do blob em blocos", () => {
  const conteudo = "Id,Nome\n1,Ana\n2,Bruno\n3,Célia\n4,Davi\n";

  it("chega ao mesmo resultado com qualquer tamanho de pedaço de bytes", async () => {
    const bytes = encoder.encode(conteudo);
    const referencia = (await lerTudo(bytes, bytes.length)).linhas;

    for (const tamanho of [1, 2, 3, 5, 7, 13, bytes.length]) {
      const { linhas } = await lerTudo(bytes, tamanho);
      expect(linhas, `pedaços de ${tamanho}`).toEqual(referencia);
    }
  });

  it("mantém caractere multibyte cortado entre pedaços", async () => {
    // "Célia" tem um caractere de dois bytes. Cortar no meio dele e decodificar
    // sem estado produziria o caractere de substituição.
    const bytes = encoder.encode("Nome\nCélia\nJoão\n");
    for (let tamanho = 1; tamanho <= bytes.length; tamanho += 1) {
      const { linhas } = await lerTudo(bytes, tamanho);
      expect(linhas, `pedaços de ${tamanho}`).toEqual([["Nome"], ["Célia"], ["João"]]);
    }
  });

  it("entrega blocos na ordem e com o tamanho pedido", async () => {
    const { blocos } = await lerTudo(encoder.encode(conteudo), 4, 2);

    expect(blocos.map((bloco) => bloco.length)).toEqual([2, 2, 1]);
    expect(blocos.flat().map((linha) => linha[0])).toEqual(["Id", "1", "2", "3", "4"]);
  });

  it("só lê o próximo pedaço depois que o consumidor libera o bloco", async () => {
    // É isto que é backpressure: sem esperar a promessa, a leitura correria à
    // frente e a fila viraria uma segunda cópia do arquivo.
    const bytes = encoder.encode(conteudo);
    const blob = blobComPedacos(bytes, 4);
    const sniff = await sniffCsvEncoding(blob);

    let emVoo = 0;
    let maximoEmVoo = 0;
    await readCsvInBlocks(blob, sniff, {
      blockSize: 1,
      onBlock: async () => {
        emVoo += 1;
        maximoEmVoo = Math.max(maximoEmVoo, emVoo);
        await Promise.resolve();
        emVoo -= 1;
      },
    });

    expect(maximoEmVoo).toBe(1);
  });

  it("reporta progresso monotônico em bytes até o total", async () => {
    const bytes = encoder.encode(conteudo);
    const blob = blobComPedacos(bytes, 5);
    const sniff = await sniffCsvEncoding(blob);
    const lidos: number[] = [];

    await readCsvInBlocks(blob, sniff, {
      blockSize: 10,
      onBlock: () => {},
      onProgress: (bytesRead, total) => {
        expect(total).toBe(bytes.byteLength);
        lidos.push(bytesRead);
      },
    });

    expect(lidos).toEqual([...lidos].sort((a, b) => a - b));
    expect(lidos.at(-1)).toBe(bytes.byteLength);
  });

  it("cancela pelo AbortSignal e não entrega mais nada depois", async () => {
    const bytes = encoder.encode(conteudo.repeat(50));
    const blob = blobComPedacos(bytes, 8);
    const sniff = await sniffCsvEncoding(blob);
    const controller = new AbortController();
    const depoisDoCancelamento = vi.fn();
    let blocos = 0;

    const leitura = readCsvInBlocks(blob, sniff, {
      blockSize: 1,
      signal: controller.signal,
      onBlock: () => {
        blocos += 1;
        if (blocos === 2) controller.abort();
        if (controller.signal.aborted && blocos > 2) depoisDoCancelamento();
      },
    });

    await expect(leitura).rejects.toMatchObject({ name: "AbortError" });
    expect(depoisDoCancelamento).not.toHaveBeenCalled();
  });

  it("descarta o marcador de ordem de bytes sem comê-lo do primeiro campo", async () => {
    const comBom = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("Id,Nome\n1,Ana\n")]);

    const { linhas, resumo } = await lerTudo(comBom, 3);

    expect(linhas[0]).toEqual(["Id", "Nome"]);
    expect(resumo.encoding).toBe("utf-8");
  });

  it("detecta o delimitador do cabeçalho quando ele não é informado", async () => {
    const { linhas, resumo } = await lerTudo(encoder.encode("a;b;c\n1;2;3\n"), 4);

    expect(resumo.delimiter).toBe(";");
    expect(linhas).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("conta os registros lidos no resumo", async () => {
    const { resumo } = await lerTudo(encoder.encode(conteudo), 6);

    expect(resumo.records).toBe(5);
    expect(resumo.bytesRead).toBe(encoder.encode(conteudo).byteLength);
  });
});

describe("reconhecimento de codificação", () => {
  it("reconhece UTF-8 limpo", async () => {
    const sniff = await sniffCsvEncoding(blobComPedacos(encoder.encode("Ação,Preço\n"), 3));

    expect(sniff.encoding).toBe("utf-8");
    expect(sniff.bomBytes).toBe(0);
  });

  it("cai para windows-1252 quando o arquivo não é UTF-8 válido", async () => {
    // Bytes latin-1 acentuados soltos: em UTF-8 viram substituição em massa,
    // que é exatamente o sinal que o leitor atual usa para trocar de tabela.
    const latin1 = new Uint8Array([
      0x41, 0x99, 0xe7, 0xe3, 0x6f, 0x2c, 0x50, 0x72, 0xe9, 0xe7, 0x6f, 0x0a,
    ]);

    expect((await sniffCsvEncoding(blobComPedacos(latin1, 2))).encoding).toBe("windows-1252");
  });

  it("reconhece UTF-16 pelos dois marcadores de ordem", async () => {
    const le = new Uint8Array([0xff, 0xfe, 0x41, 0x00]);
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x41]);

    expect((await sniffCsvEncoding(blobComPedacos(le, 4))).encoding).toBe("utf-16le");
    expect((await sniffCsvEncoding(blobComPedacos(be, 4))).encoding).toBe("utf-16be");
    expect((await sniffCsvEncoding(blobComPedacos(le, 4))).bomBytes).toBe(2);
  });

  it("cancela o reconhecimento pelo sinal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      sniffCsvEncoding(blobComPedacos(encoder.encode("a,b\n"), 1), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("equivalência com o leitor atual", () => {
  /** A grade que o SheetJS produz hoje para o mesmo CSV. */
  function gradeDoLeitorAtual(texto: string, delimitador: string): string[][] {
    const workbook = XLSX.read(texto, { type: "string", FS: delimitador, raw: true });
    const aba = workbook.Sheets[workbook.SheetNames[0]!]!;
    return XLSX.utils
      .sheet_to_json<string[]>(aba, { header: 1, raw: true, defval: "", blankrows: false })
      .map((linha) => linha.map((valor) => String(valor ?? "")));
  }

  const casos: Array<{ nome: string; texto: string; delimitador: string }> = [
    { nome: "simples", texto: "a,b,c\n1,2,3", delimitador: "," },
    { nome: "com CRLF", texto: "a,b\r\n1,2\r\n", delimitador: "," },
    { nome: "campo entre aspas", texto: 'a,b\n"um, dois",3', delimitador: "," },
    { nome: "aspas escapadas", texto: 'a\n"ele disse ""oi"""', delimitador: "," },
    { nome: "quebra dentro de aspas", texto: 'a,b\n"linha um\nlinha dois",x', delimitador: "," },
    { nome: "células vazias", texto: "a,b,c\n1,,3", delimitador: "," },
    { nome: "ponto e vírgula", texto: "a;b\n1.234,50;x", delimitador: ";" },
    { nome: "tabulação", texto: "a\tb\n1\t2", delimitador: "\t" },
    { nome: "sem quebra final", texto: "a,b\n1,2", delimitador: "," },
    { nome: "cabeçalhos repetidos", texto: "Valor,Valor\n1,2", delimitador: "," },
  ];

  it.each(casos)("produz a mesma grade do SheetJS: $nome", async ({ texto, delimitador }) => {
    const bytes = encoder.encode(texto);
    const blob = blobComPedacos(bytes, 3);
    const sniff = await sniffCsvEncoding(blob);
    const linhas: string[][] = [];
    await readCsvInBlocks(blob, sniff, {
      blockSize: 100,
      delimiter: delimitador,
      onBlock: (rows) => {
        for (const linha of rows) linhas.push(linha);
      },
    });

    expect(linhas).toEqual(gradeDoLeitorAtual(texto, delimitador));
  });
});
