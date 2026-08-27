import { describe, expect, it, vi } from "vitest";
import {
  extractServerSentEvents,
  readServerSentEvents,
  ServerSentEventDecoder,
  ServerSentEventLimitError,
  utf8Length,
  type ServerSentEvent,
} from "@/lib/server-sent-events";

const encoder = new TextEncoder();

function streamOf(bytes: Uint8Array, chunkSize = bytes.length) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize)
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>, limits = {}) {
  const events: ServerSentEvent[] = [];
  for await (const event of readServerSentEvents(stream, limits)) events.push(event);
  return events;
}

describe("leitura de Server-Sent Events", () => {
  it("preserva eventos, UTF-8 e separadores cortados entre chunks", async () => {
    const bytes = encoder.encode(
      ': pulso\r\nevent: delta\r\ndata: {"text":"ação"}\r\n\r\nevent: done\ndata: {}',
    );

    expect(await collect(streamOf(bytes, 3))).toEqual([
      { event: "delta", data: '{"text":"ação"}' },
      { event: "done", data: "{}" },
    ]);
  });

  it("junta várias linhas data do mesmo evento e ignora campo desconhecido", async () => {
    const bytes = encoder.encode(
      "event: delta\nid: 42\nretry: 1000\ndata: primeira\ndata: segunda\nfuturo: ignorado\n\n",
    );

    expect(await collect(streamOf(bytes))).toEqual([{ event: "delta", data: "primeira\nsegunda" }]);
  });

  it("descarta comentários e batimentos sem inventar evento", async () => {
    const bytes = encoder.encode(": keep-alive\n\n:\n\nevent: delta\ndata: valor\n\n");

    expect(await collect(streamOf(bytes))).toEqual([{ event: "delta", data: "valor" }]);
  });

  it("aceita CRLF, LF e CR como separador na mesma leitura", async () => {
    const bytes = encoder.encode("data: um\r\n\r\ndata: dois\n\ndata: três\r\r");

    expect(await collect(streamOf(bytes))).toEqual([
      { event: "message", data: "um" },
      { event: "message", data: "dois" },
      { event: "message", data: "três" },
    ]);
  });

  it("entrega o evento final mesmo sem a linha em branco de fechamento", async () => {
    const bytes = encoder.encode("event: done\ndata: {}");

    expect(await collect(streamOf(bytes))).toEqual([{ event: "done", data: "{}" }]);
  });

  it("não produz evento nenhum com corpo vazio", async () => {
    expect(await collect(streamOf(new Uint8Array()))).toEqual([]);
  });

  it("entrega o que chegou quando o stream termina de forma abrupta", async () => {
    const bytes = encoder.encode("event: delta\ndata: parcial\n\nevent: delta\ndata: cor");

    expect(await collect(streamOf(bytes))).toEqual([
      { event: "delta", data: "parcial" },
      { event: "delta", data: "cor" },
    ]);
  });

  it("cancela o corpo quando quem lê desiste no meio", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: delta\ndata: um\n\n"));
        controller.enqueue(encoder.encode("event: delta\ndata: dois\n\n"));
      },
      cancel,
    });

    for await (const event of readServerSentEvents(stream)) {
      expect(event.data).toBe("um");
      break;
    }

    expect(cancel).toHaveBeenCalled();
  });
});

describe("limites de tamanho do SSE", () => {
  const limite = 1_024;

  const eventoDe = (bytes: number) => `data: ${"a".repeat(bytes - "data: ".length)}`;

  it("aceita um evento exatamente no limite", async () => {
    const bloco = eventoDe(limite);
    expect(utf8Length(bloco)).toBe(limite);

    const events = await collect(streamOf(encoder.encode(`${bloco}\n\n`)), {
      maxEventBytes: limite,
    });

    expect(events).toHaveLength(1);
  });

  it("recusa um evento um byte acima do limite", async () => {
    const bloco = eventoDe(limite + 1);

    await expect(
      collect(streamOf(encoder.encode(`${bloco}\n\n`)), { maxEventBytes: limite }),
    ).rejects.toThrow(ServerSentEventLimitError);
  });

  it("recusa o evento grande mesmo picado em muitos chunks", async () => {
    const bloco = eventoDe(limite * 4);

    await expect(
      collect(streamOf(encoder.encode(`${bloco}\n\n`), 64), { maxEventBytes: limite }),
    ).rejects.toThrow(ServerSentEventLimitError);
  });

  it("recusa um stream sem nenhum separador de evento", async () => {
    const bytes = encoder.encode(`data: ${"b".repeat(limite * 3)}`);

    await expect(collect(streamOf(bytes, 128), { maxEventBytes: limite })).rejects.toThrow(
      ServerSentEventLimitError,
    );
  });

  it("recusa quando a soma de eventos válidos passa do teto da resposta", async () => {
    const evento = "data: 0123456789\n\n";
    const bytes = encoder.encode(evento.repeat(40));

    const erro = await collect(streamOf(bytes, evento.length * 4), {
      maxStreamBytes: evento.length * 10,
    }).catch((error: unknown) => error);

    expect(erro).toBeInstanceOf(ServerSentEventLimitError);
    expect((erro as ServerSentEventLimitError).limit).toBe("stream");
  });

  it("não deixa o conteúdo vazar na mensagem do erro", () => {
    const erro = new ServerSentEventLimitError("evento");

    expect(erro.message).toBe("SSE_EVENT_TOO_LARGE");
  });

  it("solta o buffer depois da interrupção por limite", () => {
    const decoder = new ServerSentEventDecoder({ maxEventBytes: 32 });

    expect(() => decoder.push(encoder.encode(`data: ${"c".repeat(64)}`))).toThrow(
      ServerSentEventLimitError,
    );
    // O fragmento gigante não pode ter sobrado: se tivesse, o evento válido
    // abaixo sairia grudado nele em vez de sair sozinho.
    expect(decoder.push(encoder.encode("data: ok\n\n"))).toEqual([
      { event: "message", data: "ok" },
    ]);
  });

  it("conta bytes, não caracteres, ao medir um evento", () => {
    // Cada "é" ocupa dois bytes: em caracteres o bloco caberia no teto.
    const bloco = `data: ${"é".repeat(20)}`;

    expect(bloco.length).toBeLessThan(50);
    expect(() => extractServerSentEvents(`${bloco}\n\n`, { maxEventBytes: 40 })).toThrow(
      ServerSentEventLimitError,
    );
  });
});
