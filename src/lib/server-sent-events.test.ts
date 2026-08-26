import { describe, expect, it } from "vitest";
import { readServerSentEvents } from "@/lib/server-sent-events";

describe("leitura de Server-Sent Events", () => {
  it("preserva eventos, UTF-8 e separadores cortados entre chunks", async () => {
    const bytes = new TextEncoder().encode(
      ': pulso\r\nevent: delta\r\ndata: {"text":"ação"}\r\n\r\nevent: done\ndata: {}',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 3)
          controller.enqueue(bytes.slice(offset, offset + 3));
        controller.close();
      },
    });

    const events = [];
    for await (const event of readServerSentEvents(stream)) events.push(event);

    expect(events).toEqual([
      { event: "delta", data: '{"text":"ação"}' },
      { event: "done", data: "{}" },
    ]);
  });
});
