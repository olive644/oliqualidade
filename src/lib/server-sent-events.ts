export type ServerSentEvent = {
  event: string;
  data: string;
};

const EVENT_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;
const LINE_BOUNDARY = /\r\n|\n|\r/;

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
 */
export function extractServerSentEvents(buffer: string, flush = false) {
  const events: ServerSentEvent[] = [];
  let rest = buffer;
  let boundary = EVENT_BOUNDARY.exec(rest);

  while (boundary) {
    const block = rest.slice(0, boundary.index);
    rest = rest.slice(boundary.index + boundary[0].length);
    const event = parseEventBlock(block);
    if (event) events.push(event);
    boundary = EVENT_BOUNDARY.exec(rest);
  }

  if (flush && rest) {
    const event = parseEventBlock(rest);
    if (event) events.push(event);
    rest = "";
  }

  return { events, rest };
}

export async function* readServerSentEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const extracted = extractServerSentEvents(buffer);
      buffer = extracted.rest;
      for (const event of extracted.events) yield event;
    }

    buffer += decoder.decode();
    const extracted = extractServerSentEvents(buffer, true);
    for (const event of extracted.events) yield event;
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function encodeServerSentEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
