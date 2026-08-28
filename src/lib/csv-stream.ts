/**
 * Leitura de CSV por streaming de verdade.
 *
 * "De verdade" aqui é literal, no sentido do vocabulário registrado em
 * `docs/IMPORT_ARCHITECTURE.md`: o arquivo nunca é carregado inteiro num
 * `ArrayBuffer`. O que atravessa é o `ReadableStream` do próprio `Blob`, os
 * pedaços decodificados são descartados assim que viram linha, e as linhas saem
 * em blocos com teto de blocos pendentes.
 *
 * Um pedaço de bytes não é uma linha. O separador de linha pode cair entre dois
 * pedaços, um caractere multibyte pode ser cortado ao meio, e uma quebra de
 * linha dentro de campo entre aspas não termina registro nenhum. Por isso o
 * analisador guarda estado entre pedaços e nada aqui assume fronteira.
 */

/**
 * O delimitador vem do leitor atual, e nao de uma regra nova.
 *
 * Ele ja resolve o caso das virgulas decimais brasileiras num arquivo separado
 * por ponto e virgula, e ter duas respostas diferentes para a mesma pergunta
 * seria a forma mais facil de os dois caminhos divergirem. Nao ha ciclo: quem
 * for ligar o caminho progressivo deve faze-lo num coordenador, nunca dentro do
 * leitor atual.
 */
import { detectDelimiter } from "@/lib/workbook-reader";

const CR = "\r";
/** Teto da tabela de reaproveitamento, e do tamanho que vale reaproveitar. */
const CSV_INTERN_MAX_ENTRIES = 50_000;
const CSV_INTERN_MAX_LENGTH = 256;

const LF = "\n";
const QUOTE = '"';

/**
 * Analisador incremental de registros CSV.
 *
 * Guarda entre alimentações: o campo em construção, o registro em construção,
 * se está dentro de aspas, e se o último caractere visto foi um CR ainda sem o
 * LF do par. Sem esse último estado, um CRLF partido exatamente no meio viraria
 * dois registros.
 */
export class CsvRecordParser {
  private readonly delimiter: string;
  /**
   * Reaproveita a mesma instancia de string para celulas repetidas.
   *
   * Sem isto, o analisador cria uma string nova por celula: num arquivo de 200
   * mil linhas por 8 colunas sao 1,6 milhao de instancias distintas, e a grade
   * resultante custou 267 MiB contra 37 MiB da grade equivalente do SheetJS,
   * que reaproveita as strings ja alocadas no workbook. Planilha real repete
   * muito (categoria, status, unidade), entao a tabela colapsa a maior parte.
   *
   * O teto existe porque coluna de alta cardinalidade (identificador, texto
   * livre) nunca repete: passar dele, a tabela vira so custo, e o analisador
   * volta a devolver a string crua.
   */
  private readonly interned = new Map<string, string>();
  private field = "";
  private record: string[] = [];
  private inQuotes = false;
  private quoteJustClosed = false;
  private pendingCarriageReturn = false;
  private started = false;

  constructor(delimiter: string) {
    this.delimiter = delimiter;
  }

  /** Consome um trecho já decodificado e devolve os registros que ele fechou. */
  push(text: string): string[][] {
    const records: string[][] = [];
    for (const char of text) this.consume(char, records);
    return records;
  }

  /**
   * Fecha o analisador.
   *
   * A última linha pode não ter quebra: se houver qualquer coisa em construção,
   * ela é um registro. Um arquivo que termina com quebra de linha não produz um
   * registro vazio a mais.
   */
  finish(): string[][] {
    if (this.pendingCarriageReturn) {
      this.pendingCarriageReturn = false;
      return this.closeRecord();
    }
    if (!this.started) return [];
    return this.closeRecord();
  }

  /** Devolve a instancia ja conhecida deste texto, quando houver. */
  private intern(value: string): string {
    if (value.length > CSV_INTERN_MAX_LENGTH) return value;
    const conhecida = this.interned.get(value);
    if (conhecida !== undefined) return conhecida;
    if (this.interned.size < CSV_INTERN_MAX_ENTRIES) this.interned.set(value, value);
    return value;
  }

  private closeRecord(): string[][] {
    this.record.push(this.intern(this.field));
    const finished = this.record;
    this.field = "";
    this.record = [];
    this.started = false;
    this.inQuotes = false;
    this.quoteJustClosed = false;
    return [finished];
  }

  private consume(char: string, records: string[][]): void {
    // Um CR pendente só vira fim de registro depois de saber se o próximo
    // caractere é o LF do par. Ele pode chegar no pedaço seguinte.
    if (this.pendingCarriageReturn) {
      this.pendingCarriageReturn = false;
      records.push(...this.closeRecord());
      if (char === LF) return;
    }

    if (this.inQuotes) {
      if (char === QUOTE) {
        // Aspas dentro de aspas: a próxima decide entre aspas escapadas e fim
        // do campo. O estado precisa sobreviver à fronteira do pedaço.
        this.inQuotes = false;
        this.quoteJustClosed = true;
        return;
      }
      this.field += char;
      return;
    }

    if (this.quoteJustClosed) {
      this.quoteJustClosed = false;
      if (char === QUOTE) {
        this.field += QUOTE;
        this.inQuotes = true;
        return;
      }
      // Cai adiante e trata o caractere normalmente, fora das aspas.
    }

    if (char === QUOTE) {
      this.inQuotes = true;
      this.started = true;
      return;
    }
    if (char === this.delimiter) {
      this.record.push(this.intern(this.field));
      this.field = "";
      this.started = true;
      return;
    }
    if (char === CR) {
      this.pendingCarriageReturn = true;
      return;
    }
    if (char === LF) {
      records.push(...this.closeRecord());
      return;
    }
    this.field += char;
    this.started = true;
  }
}

/**
 * Decodificador de texto com a mesma decisão de codificação do leitor atual.
 *
 * O leitor atual escolhe entre UTF-8 e windows-1252 contando caracteres de
 * substituição sobre o texto **inteiro**. Essa heurística não cabe numa
 * passagem só: decidir por um prefixo mudaria o resultado num arquivo cujo
 * primeiro trecho é UTF-8 limpo e o resto não é.
 *
 * A saída é uma passagem de reconhecimento, barata, que só conta. Ela não monta
 * texto nem linha, então a memória continua limitada, e o `Blob` é lido do
 * disco duas vezes em troca de manter o comportamento exato.
 */
export type CsvEncodingSniff = {
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
  /** Bytes do marcador de ordem, que não fazem parte do conteúdo. */
  bomBytes: number;
  totalBytes: number;
};

function encodingFromBom(head: Uint8Array): CsvEncodingSniff["encoding"] | null {
  if (head[0] === 0xff && head[1] === 0xfe) return "utf-16le";
  if (head[0] === 0xfe && head[1] === 0xff) return "utf-16be";
  return null;
}

export async function sniffCsvEncoding(
  blob: Blob,
  signal?: AbortSignal,
): Promise<CsvEncodingSniff> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const bom = encodingFromBom(head);
  if (bom) return { encoding: bom, bomBytes: 2, totalBytes: blob.size };

  const decoder = new TextDecoder("utf-8", { fatal: false });
  let replacements = 0;
  let characters = 0;
  const reader = blob.stream().getReader();
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Importação cancelada.", "AbortError");
      const chunk = await reader.read();
      if (chunk.done) break;
      const texto = decoder.decode(chunk.value, { stream: true });
      characters += texto.length;
      for (const char of texto) if (char === "�") replacements += 1;
    }
    const resto = decoder.decode();
    characters += resto.length;
    for (const char of resto) if (char === "�") replacements += 1;
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  // Mesma regra do leitor atual: alguns poucos substitutos não condenam o
  // arquivo, porque UTF-8 legítimo pode conter o próprio caractere.
  const tolerancia = Math.max(1, characters * 0.001);
  return {
    encoding: replacements <= tolerancia ? "utf-8" : "windows-1252",
    bomBytes: 0,
    totalBytes: blob.size,
  };
}

/** Inverte os pares de bytes de UTF-16BE para reaproveitar o decodificador LE. */
function swapUtf16(bytes: Uint8Array): Uint8Array {
  const trocado = bytes.slice();
  for (let indice = 0; indice + 1 < trocado.length; indice += 2)
    [trocado[indice], trocado[indice + 1]] = [trocado[indice + 1]!, trocado[indice]!];
  return trocado;
}

export type CsvBlockOptions = {
  /** Linhas por bloco entregue. */
  blockSize: number;
  /** Chamado a cada bloco. Esperar a promessa é o que dá backpressure. */
  onBlock: (rows: string[][]) => void | Promise<void>;
  /** Progresso em bytes lidos, para barra determinada. */
  onProgress?: (bytesRead: number, totalBytes: number) => void;
  signal?: AbortSignal;
  /** Delimitador já decidido. Quando ausente, é detectado no cabeçalho. */
  delimiter?: string;
};

export type CsvReadSummary = {
  records: number;
  bytesRead: number;
  encoding: CsvEncodingSniff["encoding"];
  delimiter: string;
};

/**
 * Lê o CSV inteiro em blocos, sem nunca materializar o arquivo.
 *
 * `onBlock` pode devolver uma promessa. Enquanto ela não resolve, nada novo é
 * lido do `Blob`: é assim que a leitura respeita o consumidor em vez de encher
 * uma fila. Não existe fila aqui, e um bloco por vez é o teto natural.
 */
export async function readCsvInBlocks(
  blob: Blob,
  sniff: CsvEncodingSniff,
  options: CsvBlockOptions,
): Promise<CsvReadSummary> {
  const { blockSize, onBlock, onProgress, signal } = options;
  const utf16 = sniff.encoding === "utf-16le" || sniff.encoding === "utf-16be";
  const decoder = new TextDecoder(utf16 ? "utf-16le" : sniff.encoding, { fatal: false });
  const source = sniff.bomBytes ? blob.slice(sniff.bomBytes) : blob;

  let delimiter = options.delimiter ?? null;
  let parser = delimiter ? new CsvRecordParser(delimiter) : null;
  let cabecalhoPendente = "";
  let bloco: string[][] = [];
  let records = 0;
  let bytesRead = 0;
  let primeiroTrecho = true;

  const entregar = async (forcar: boolean) => {
    if (!bloco.length || (!forcar && bloco.length < blockSize)) return;
    const enviar = bloco;
    bloco = [];
    await onBlock(enviar);
  };

  const reader = source.stream().getReader();
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Importação cancelada.", "AbortError");
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      const bytes = sniff.encoding === "utf-16be" ? swapUtf16(chunk.value) : chunk.value;
      let texto = decoder.decode(bytes, { stream: true });
      if (primeiroTrecho) {
        primeiroTrecho = false;
        texto = texto.replace(/^\uFEFF/, "");
      }

      // O delimitador sai do início do arquivo. Enquanto não houver texto
      // suficiente para uma decisão estável, o trecho fica retido: começar a
      // analisar com o separador errado produziria linhas erradas que não teria
      // como desfazer.
      if (!parser) {
        cabecalhoPendente += texto;
        if (cabecalhoPendente.length < 64 * 1024 && !cabecalhoPendente.includes(LF)) continue;
        delimiter = options.delimiter ?? (detectDelimiter(cabecalhoPendente) as string);
        parser = new CsvRecordParser(delimiter);
        texto = cabecalhoPendente;
        cabecalhoPendente = "";
      }

      for (const registro of parser.push(texto)) {
        bloco.push(registro);
        records += 1;
      }
      onProgress?.(bytesRead, sniff.totalBytes);
      await entregar(false);
    }

    const resto = decoder.decode();
    if (!parser) {
      cabecalhoPendente += resto;
      delimiter = options.delimiter ?? (detectDelimiter(cabecalhoPendente) as string);
      parser = new CsvRecordParser(delimiter);
      for (const registro of parser.push(cabecalhoPendente.replace(/^\uFEFF/, ""))) {
        bloco.push(registro);
        records += 1;
      }
    } else if (resto) {
      for (const registro of parser.push(resto)) {
        bloco.push(registro);
        records += 1;
      }
    }
    for (const registro of parser.finish()) {
      bloco.push(registro);
      records += 1;
    }
    onProgress?.(bytesRead, sniff.totalBytes);
    await entregar(true);
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return { records, bytesRead, encoding: sniff.encoding, delimiter: delimiter ?? "," };
}

/**
 * Converte a grade lida em algo que a normalizacao interprete igual ao atual.
 *
 * Um campo vazio num CSV e uma celula **ausente**, e nao um texto vazio. O
 * leitor atual chega nisso de graca, porque o SheetJS nao cria celula para
 * campo vazio e a normalizacao le `null`. A grade do leitor de streaming tem
 * a string vazia de verdade, entao a traducao precisa ser explicita.
 *
 * A diferenca nao e cosmetica: `null` alimenta as regras de valor faltante e a
 * contagem de nulos, enquanto texto vazio conta como preenchido. Sem esta
 * conversao, todo CSV importado pelo caminho novo teria metricas de qualidade
 * diferentes das do caminho atual, sem nada na tela indicando isso.
 */
export function csvGridToSheetRows(grid: string[][]): (string | null)[][] {
  return grid.map((linha) => linha.map((celula) => (celula === "" ? null : celula)));
}
