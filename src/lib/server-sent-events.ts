export type ServerSentEvent = {
  event: string;
  data: string;
};

export type ServerSentEventLimit = "evento" | "stream";

/**
 * Um limite de tamanho foi estourado durante a leitura.
 *
 * A mensagem é um código fixo de propósito: ela pode acabar em log, e nada do
 * conteúdo do stream (pergunta, célula, resposta) pode viajar junto. Quem
 * mostra algo para a pessoa traduz o `limit`, não este texto.
 */
export class ServerSentEventLimitError extends Error {
  readonly limit: ServerSentEventLimit;

  constructor(limit: ServerSentEventLimit) {
    super(limit === "evento" ? "SSE_EVENT_TOO_LARGE" : "SSE_STREAM_TOO_LARGE");
    this.name = "ServerSentEventLimitError";
    this.limit = limit;
  }
}

export type ServerSentEventLimits = {
  /** Teto de um evento e do fragmento ainda sem separador. */
  maxEventBytes?: number;
  /** Teto de bytes lidos do stream inteiro. */
  maxStreamBytes?: number;
};

const EVENT_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;
const LINE_BOUNDARY = /\r\n|\n|\r/;

/**
 * Comprimento em UTF-8 sem alocar um buffer novo.
 *
 * `new TextEncoder().encode(texto).length` responderia o mesmo, mas cria uma
 * cópia inteira do texto a cada chamada — exatamente a duplicação de memória
 * que os limites daqui existem para evitar.
 */
export function utf8Length(text: string) {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
      continue;
    }
    if (code < 0x800) {
      bytes += 2;
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
        continue;
      }
    }
    bytes += 3;
  }
  return bytes;
}

function parseEventBlock(block: string): ServerSentEvent | null {
  let event = "message";
  const data: string[] = [];

  for (const line of block.split(LINE_BOUNDARY)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }

  return data.length ? { event, data: data.join("\n") } : null;
}

/**
 * Retira eventos SSE completos de um buffer e preserva o fragmento final.
 * O protocolo permite CRLF, LF ou CR; chunks de rede podem cortar qualquer
 * uma dessas sequências no meio, por isso o fragmento sempre volta ao chamador.
 *
 * Com `maxEventBytes`, um bloco fechado maior que o teto interrompe a leitura
 * na hora, antes de virar string parseada.
 */
export function extractServerSentEvents(
  buffer: string,
  options: { flush?: boolean; maxEventBytes?: number } = {},
) {
  const { flush = false, maxEventBytes = Number.POSITIVE_INFINITY } = options;
  const events: ServerSentEvent[] = [];
  let rest = buffer;
  let boundary = EVENT_BOUNDARY.exec(rest);

  while (boundary) {
    const block = rest.slice(0, boundary.index);
    if (utf8Length(block) > maxEventBytes) throw new ServerSentEventLimitError("evento");
    rest = rest.slice(boundary.index + boundary[0].length);
    const event = parseEventBlock(block);
    if (event) events.push(event);
    boundary = EVENT_BOUNDARY.exec(rest);
  }

  if (flush && rest) {
    if (utf8Length(rest) > maxEventBytes) throw new ServerSentEventLimitError("evento");
    const event = parseEventBlock(rest);
    if (event) events.push(event);
    rest = "";
  }

  return { events, rest };
}

/**
 * Decodificador incremental com contabilidade de bytes.
 *
 * Existe como objeto, e não como função, porque três coisas precisam durar
 * entre um chunk e o próximo: o `TextDecoder` (que segura a sobra de um
 * caractere multibyte cortado), o fragmento ainda sem separador e os
 * contadores dos limites. O proxy do Gemini e a conversa no navegador usam o
 * mesmo objeto com tetos diferentes, então a regra de contagem é uma só.
 *
 * A contagem do fragmento é incremental: enquanto nenhum separador aparece,
 * basta somar o tamanho dos chunks; quando um evento fecha, o resto é medido
 * de novo. Isso evita varrer o buffer inteiro a cada chunk e é o que torna
 * "stream sem separador nenhum" um erro em vez de um vazamento silencioso.
 */
export class ServerSentEventDecoder {
  private readonly decoder = new TextDecoder();
  private readonly maxEventBytes: number;
  private readonly maxStreamBytes: number;
  private buffer = "";
  private pendingBytes = 0;
  private streamBytes = 0;

  constructor(limits: ServerSentEventLimits = {}) {
    this.maxEventBytes = limits.maxEventBytes ?? Number.POSITIVE_INFINITY;
    this.maxStreamBytes = limits.maxStreamBytes ?? Number.POSITIVE_INFINITY;
  }

  /** Total de bytes já lidos do stream, para telemetria operacional. */
  get bytesRead() {
    return this.streamBytes;
  }

  push(chunk: Uint8Array): ServerSentEvent[] {
    this.streamBytes += chunk.byteLength;
    if (this.streamBytes > this.maxStreamBytes) {
      this.release();
      throw new ServerSentEventLimitError("stream");
    }
    this.pendingBytes += chunk.byteLength;
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  /** Fecha a decodificação e entrega um evento final sem linha em branco. */
  flush(): ServerSentEvent[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  /** Solta o buffer. Chamado em conclusão, erro e cancelamento. */
  release() {
    this.buffer = "";
    this.pendingBytes = 0;
  }

  private drain(flush: boolean): ServerSentEvent[] {
    let extracted;
    try {
      extracted = extractServerSentEvents(this.buffer, {
        flush,
        maxEventBytes: this.maxEventBytes,
      });
    } catch (error) {
      this.release();
      throw error;
    }
    this.buffer = extracted.rest;
    if (extracted.events.length || flush) this.pendingBytes = utf8Length(this.buffer);
    if (this.pendingBytes > this.maxEventBytes) {
      this.release();
      throw new ServerSentEventLimitError("evento");
    }
    return extracted.events;
  }
}

export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  limits: ServerSentEventLimits = {},
) {
  const reader = body.getReader();
  const decoder = new ServerSentEventDecoder(limits);
  let complete = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      for (const event of decoder.push(value)) yield event;
    }

    for (const event of decoder.flush()) yield event;
  } finally {
    decoder.release();
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function encodeServerSentEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
