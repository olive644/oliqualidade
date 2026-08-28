import {
  existsSync,
  openAsBlob,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import * as XLSX from "xlsx";

import { openZipFromBlob } from "@/lib/zip-blob-reader";
import { validateZipWorkbook } from "@/lib/workbook-reader";
import {
  MAX_ZIP_ENTRIES,
  ZIP_INCOMPLETE_MESSAGE,
  ZIP_INVALID_DIRECTORY_MESSAGE,
  ZIP_TOO_MANY_ENTRIES_MESSAGE,
} from "@/lib/zip-directory";

/**
 * O leitor por `Blob` precisa entregar exatamente os mesmos bytes que o caminho
 * atual, entrada por entrada.
 *
 * A comparação é contra `unzipSync` sobre o pacote inteiro, que é o que a
 * importação usa hoje. Qualquer diferença aqui viraria uma célula errada lá na
 * frente, e sem nada na tela indicando, porque um XML deslocado ainda é um XML
 * que quase analisa.
 */

const encoder = new TextEncoder();

/**
 * Blob que serve fatias de um `Uint8Array`.
 *
 * O `Blob` do Node existe, mas construí-lo a partir dos bytes os copia. Este
 * serve para o teste poder afirmar o que importa: que só as fatias pedidas são
 * lidas, e nunca o arquivo inteiro.
 */
function blobDeBytes(bytes: Uint8Array, contador?: { bytesLidos: number }): Blob {
  return {
    size: bytes.byteLength,
    slice: (inicio = 0, fim = bytes.byteLength) => {
      const recorte = bytes.slice(inicio, fim);
      if (contador) contador.bytesLidos += recorte.byteLength;
      return blobDeBytes(recorte, contador);
    },
    arrayBuffer: async () => bytes.slice().buffer,
    stream: () => {
      throw new Error("o leitor de ZIP não deve usar stream(): ele lê por posição");
    },
  } as unknown as Blob;
}

/** Pacote com nomes, tamanhos e níveis de compressão variados. */
function pacoteSintetico() {
  const conteudo: Record<string, Uint8Array> = {
    "[Content_Types].xml": encoder.encode('<?xml version="1.0"?><Types/>'),
    "xl/workbook.xml": encoder.encode(`<workbook>${"<sheet/>".repeat(50)}</workbook>`),
    // Muito repetitivo, para o deflate ter o que fazer.
    "xl/sharedStrings.xml": encoder.encode(`<sst>${"<si><t>Valor</t></si>".repeat(2_000)}</sst>`),
    "xl/worksheets/sheet1.xml": encoder.encode(
      `<worksheet><sheetData>${"<row><c><v>1</v></c></row>".repeat(1_000)}</sheetData></worksheet>`,
    ),
    // Acentuação no nome, que o formato guarda em UTF-8.
    "docProps/descrição.xml": encoder.encode("<descricao>ação</descricao>"),
    "vazio.bin": new Uint8Array(0),
  };
  return { conteudo, bytes: zipSync(conteudo, { level: 6 }) };
}

describe("leitura de pacote ZIP pelo Blob", () => {
  it("entrega os mesmos bytes de cada entrada que a descompactação inteira", async () => {
    const { bytes } = pacoteSintetico();
    const referencia = unzipSync(bytes);

    const leitor = await openZipFromBlob(blobDeBytes(bytes));

    expect(leitor.entries.map((entrada) => entrada.name).sort()).toEqual(
      Object.keys(referencia).sort(),
    );
    for (const [nome, esperado] of Object.entries(referencia))
      expect(Array.from((await leitor.readEntry(nome))!)).toEqual(Array.from(esperado));
  });

  it("lê só as fatias pedidas, e nunca o arquivo inteiro", async () => {
    const { bytes } = pacoteSintetico();
    const contador = { bytesLidos: 0 };

    const leitor = await openZipFromBlob(blobDeBytes(bytes, contador));
    const aposAbrir = contador.bytesLidos;
    await leitor.readEntry("xl/workbook.xml");

    // Abrir o pacote lê a cauda e o índice, que num pacote pequeno é quase tudo.
    // O que este teste ancora é o outro lado: ler uma entrada pequena custa o
    // cabeçalho fixo mais os bytes dela, e nada além disso. Foi este teste que
    // pegou o leitor lendo 131 KiB de cabeçalho local onde 30 bytes bastam.
    expect(contador.bytesLidos - aposAbrir).toBeLessThan(200);
  });

  it("não expande entrada que ninguém pediu", async () => {
    const { bytes, conteudo } = pacoteSintetico();
    const maior = conteudo["xl/sharedStrings.xml"]!;

    const leitor = await openZipFromBlob(blobDeBytes(bytes));
    const pequena = await leitor.readEntry("[Content_Types].xml");

    expect(pequena).toBeDefined();
    // A soma declarada conhece a entrada grande, mas nada dela foi expandido.
    expect(leitor.totalUncompressedBytes).toBeGreaterThan(maior.byteLength);
  });

  it("devolve o texto decodificado, e aceita nome com acentuação", async () => {
    const { bytes } = pacoteSintetico();

    const leitor = await openZipFromBlob(blobDeBytes(bytes));

    expect(await leitor.readEntryText("docProps/descrição.xml")).toBe(
      "<descricao>ação</descricao>",
    );
  });

  it("devolve ausência para nome que não existe, em vez de erro", async () => {
    const { bytes } = pacoteSintetico();

    const leitor = await openZipFromBlob(blobDeBytes(bytes));

    expect(await leitor.readEntry("xl/worksheets/sheet99.xml")).toBeUndefined();
  });

  it("lê entrada guardada sem compressão", async () => {
    const conteudo = { "sem-compressao.txt": encoder.encode("conteúdo cru") };
    const bytes = zipSync(conteudo, { level: 0 });

    const leitor = await openZipFromBlob(blobDeBytes(bytes));

    expect(await leitor.readEntryText("sem-compressao.txt")).toBe("conteúdo cru");
  });

  it("aceita pacote com comentário no fim, que desloca o registro final", async () => {
    // O registro de fim deixa de ser os últimos 22 bytes, e a busca precisa
    // encontrá-lo mesmo assim.
    const { bytes } = pacoteSintetico();
    const comentario = encoder.encode("comentário do pacote");
    const comComentario = new Uint8Array(bytes.byteLength + comentario.byteLength);
    comComentario.set(bytes);
    comComentario.set(comentario, bytes.byteLength);
    // O tamanho do comentário mora nos dois últimos bytes do registro de fim.
    const vista = new DataView(comComentario.buffer);
    vista.setUint16(bytes.byteLength - 2, comentario.byteLength, true);

    const leitor = await openZipFromBlob(blobDeBytes(comComentario));

    expect(await leitor.readEntryText("[Content_Types].xml")).toContain("<Types/>");
  });

  it("recusa pacote truncado com a mesma mensagem do caminho atual", async () => {
    const { bytes } = pacoteSintetico();
    const truncado = bytes.slice(0, Math.floor(bytes.byteLength / 2));

    await expect(openZipFromBlob(blobDeBytes(truncado))).rejects.toThrow(ZIP_INCOMPLETE_MESSAGE);
    expect(() => validateZipWorkbook(truncado)).toThrow(ZIP_INCOMPLETE_MESSAGE);
  });

  it("aplica o mesmo teto de entradas do caminho atual", async () => {
    const registroFinal = new Uint8Array(22);
    new DataView(registroFinal.buffer).setUint32(0, 0x06054b50, true);
    new DataView(registroFinal.buffer).setUint16(10, MAX_ZIP_ENTRIES + 1, true);

    await expect(openZipFromBlob(blobDeBytes(registroFinal))).rejects.toThrow(
      ZIP_TOO_MANY_ENTRIES_MESSAGE,
    );
    expect(() => validateZipWorkbook(registroFinal)).toThrow(ZIP_TOO_MANY_ENTRIES_MESSAGE);
  });

  it("recusa índice que não cabe no arquivo que diz contê-lo", async () => {
    const registroFinal = new Uint8Array(22);
    const vista = new DataView(registroFinal.buffer);
    vista.setUint32(0, 0x06054b50, true);
    vista.setUint16(10, 1, true);
    vista.setUint32(12, 1_000, true);
    vista.setUint32(16, 5_000, true);

    await expect(openZipFromBlob(blobDeBytes(registroFinal))).rejects.toThrow(
      ZIP_INVALID_DIRECTORY_MESSAGE,
    );
    expect(() => validateZipWorkbook(registroFinal)).toThrow(ZIP_INVALID_DIRECTORY_MESSAGE);
  });
});

/**
 * A prova que vale mais: pacotes reais, gerados por Excel e por outros
 * geradores, onde o cabeçalho local diverge do índice e o campo extra tem
 * tamanho próprio.
 *
 * O corpus é local e não versionado, então este bloco é pulado na CI. Rodar na
 * máquina é responsabilidade de quem mexer aqui.
 */
const RAIZES = ["test-fixtures/sanitized-real", "upload"];

function pacotesLocais(): string[] {
  const encontrados: string[] = [];
  for (const raiz of RAIZES) {
    if (!existsSync(raiz)) continue;
    for (const nome of readdirSync(raiz).sort())
      if (/\.(xlsx|xlsm|xltx|xltm)$/i.test(nome)) encontrados.push(join(raiz, nome));
  }
  return encontrados;
}

const locais = pacotesLocais();

describe.skipIf(!locais.length)("equivalência sobre pacotes reais locais", () => {
  it("encontra o corpus local", () => {
    expect(locais.length).toBeGreaterThan(0);
  });

  it("entrega bytes idênticos aos da descompactação inteira, em todo pacote", async () => {
    let entradasConferidas = 0;
    for (const caminho of locais) {
      const bytes = new Uint8Array(readFileSync(caminho));
      const referencia = unzipSync(bytes);
      const leitor = await openZipFromBlob(blobDeBytes(bytes));

      expect(leitor.entries.map((entrada) => entrada.name).sort()).toEqual(
        Object.keys(referencia).sort(),
      );
      for (const [nome, esperado] of Object.entries(referencia)) {
        const obtido = await leitor.readEntry(nome);
        // Comparar por tamanho antes evita uma mensagem de erro gigante quando
        // o pacote diverge, e diz onde.
        expect(`${caminho}:${nome}:${obtido?.byteLength}`).toBe(
          `${caminho}:${nome}:${esperado.byteLength}`,
        );
        expect(Buffer.from(obtido!).equals(Buffer.from(esperado))).toBe(true);
        entradasConferidas += 1;
      }
    }
    expect(entradasConferidas).toBeGreaterThan(0);
    process.stdout.write(
      `\n  ${locais.length} pacotes reais, ${entradasConferidas} entradas conferidas byte a byte\n`,
    );
  }, 120_000);

  it("declara o mesmo tamanho expandido total que a validação do caminho atual", async () => {
    for (const caminho of locais) {
      const bytes = new Uint8Array(readFileSync(caminho));

      const leitor = await openZipFromBlob(blobDeBytes(bytes));

      expect(`${caminho}:${leitor.totalUncompressedBytes}`).toBe(
        `${caminho}:${validateZipWorkbook(bytes).totalUncompressedBytes}`,
      );
    }
  }, 120_000);
});

/**
 * Quanto a leitura por posição substitui, e quando isso vale a pena.
 *
 * Desligada por padrão, porque gera pacotes de dezenas de MiB:
 *
 *     OLI_ZIP_BENCHMARK=1 npx vitest run src/lib/zip-blob-reader.test.ts
 *
 * A grandeza medida aqui é declarada pelo próprio pacote, e não observada no
 * coletor de lixo: o tamanho expandido total contra o da maior entrada. Essa
 * escolha veio de errar. A primeira versão comparava memória viva com
 * `--expose-gc`, e chegou a reportar um caminho consumindo **menos vinte e dois
 * MiB**: com dois cenários seguidos, o lixo do primeiro era coletado durante a
 * medição do segundo, e a subtração saía negativa. Um número que pode sair
 * negativo não estava medindo o que dizia medir.
 *
 * Os tamanhos declarados não têm esse problema, são exatos, e respondem a
 * pergunta que importa: expandir uma entrada por vez substitui o pacote inteiro
 * expandido por uma entrada só, e o ganho é a razão entre as duas. Melhor
 * ainda, para descobri-los nada precisa ser expandido, que é justamente a
 * capacidade em teste.
 */
const medicaoLigada = process.env["OLI_ZIP_BENCHMARK"] === "1";

const mib = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

/**
 * Pacote OOXML sintético e determinístico, escrito direto no disco.
 *
 * `XLSX.writeFile` depende de um `fs` que o ambiente de teste não entrega ao
 * SheetJS, então os bytes são montados e gravados, como o benchmark de
 * importação já faz.
 */
function escreverPacote(destino: string, abas: number, linhasPorAba: number): number {
  const cabecalho = ["Id", "Data", "Setor", "Produto", "Quantidade", "Valor", "Status", "Nota"];
  const workbook = XLSX.utils.book_new();
  for (let aba = 0; aba < abas; aba += 1) {
    const dados: (string | number)[][] = [cabecalho];
    for (let linha = 0; linha < linhasPorAba; linha += 1)
      dados.push([
        linha,
        `${String((linha % 28) + 1).padStart(2, "0")}/0${(linha % 9) + 1}/2026`,
        `Setor ${linha % 5}`,
        `Produto ${linha % 400}`,
        linha % 97,
        (linha % 1000) + (linha % 100) / 100,
        `Status ${linha % 3}`,
        `Observação ${linha % 50}`,
      ]);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(dados), `Aba ${aba + 1}`);
  }
  writeFileSync(
    destino,
    new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true })),
  );
  return statSync(destino).size;
}

type CustoDoPacote = {
  arquivoMiB: number;
  entradas: number;
  expandidoTotalMiB: number;
  maiorEntradaMiB: number;
  fracaoDaMaior: number;
};

async function medirPacote(abas: number, linhasPorAba: number): Promise<CustoDoPacote> {
  const caminho = join(tmpdir(), `oli-zip-benchmark-${process.pid}-${abas}.xlsx`);
  const arquivoBytes = escreverPacote(caminho, abas, linhasPorAba);
  try {
    // Tudo o que segue sai do índice do pacote. Nada é expandido para obtê-lo,
    // e é essa a capacidade que o leitor acrescenta.
    const leitor = await openZipFromBlob(await openAsBlob(caminho));
    const maior = [...leitor.entries].sort((a, b) => b.uncompressedSize - a.uncompressedSize)[0]!;

    // O total declarado precisa bater com o que a expansão inteira produz,
    // senão a comparação seria entre um número real e um número inventado.
    const expandido = unzipSync(new Uint8Array(readFileSync(caminho)));
    const somaReal = Object.values(expandido).reduce((soma, parte) => soma + parte.byteLength, 0);
    expect(leitor.totalUncompressedBytes).toBe(somaReal);
    expect((await leitor.readEntry(maior.name))!.byteLength).toBe(maior.uncompressedSize);

    return {
      arquivoMiB: mib(arquivoBytes),
      entradas: leitor.entries.length,
      expandidoTotalMiB: mib(leitor.totalUncompressedBytes),
      maiorEntradaMiB: mib(maior.uncompressedSize),
      fracaoDaMaior: maior.uncompressedSize / leitor.totalUncompressedBytes,
    };
  } finally {
    rmSync(caminho, { force: true });
  }
}

describe.skipIf(!medicaoLigada)("custo da leitura por posição", () => {
  it(
    "mostra onde ler uma entrada por vez ajuda, e onde não ajuda",
    { timeout: 900_000 },
    async () => {
      // Uma aba grande contra várias abas com o mesmo total de linhas. A
      // diferença entre os dois casos é a resposta, e não uma média entre eles.
      const umaAba = await medirPacote(1, 120_000);
      const dozeAbas = await medirPacote(12, 10_000);

      const linha = (rotulo: string, custo: CustoDoPacote) =>
        `  ${rotulo.padEnd(18)} arquivo ${String(custo.arquivoMiB).padStart(5)} MiB` +
        ` | ${String(custo.entradas).padStart(3)} entradas` +
        ` | expandido total ${String(custo.expandidoTotalMiB).padStart(5)} MiB` +
        ` | maior entrada ${String(custo.maiorEntradaMiB).padStart(5)} MiB` +
        ` (${Math.round(custo.fracaoDaMaior * 100)}% do total)`;
      process.stdout.write(
        ["", linha("1 aba x 120 mil", umaAba), linha("12 abas x 10 mil", dozeAbas), ""].join("\n"),
      );

      // Com várias abas, expandir uma por vez troca o pacote inteiro por uma
      // fração pequena dele. É aqui que esta peça paga.
      expect(dozeAbas.fracaoDaMaior).toBeLessThan(0.25);
      // Com uma aba só, a maior entrada é quase o pacote inteiro e não há o que
      // economizar. O teste registra isso em vez de esconder.
      expect(umaAba.fracaoDaMaior).toBeGreaterThan(0.5);
    },
  );
});
