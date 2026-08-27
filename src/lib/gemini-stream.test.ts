import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleGeminiChat } from "@/lib/gemini-server";
import { resetRateLimitsForTests, type GeminiDashboardInput } from "@/lib/gemini-security";
import {
  CHAT_MAX_ANSWER_BYTES,
  GEMINI_IDLE_TIMEOUT_MS,
  GEMINI_MAX_EVENT_BYTES,
  GEMINI_START_TIMEOUT_MS,
  GEMINI_TOTAL_TIMEOUT_MS,
} from "@/lib/assistant-stream";

/**
 * O que este arquivo cobre é o proxy do Gemini como um recurso vivo: prazos,
 * tetos, desligamento e o vocabulário de erro que a conversa lê. O contrato de
 * eventos usado aqui é o publicado para a Interactions API com `alt=sse`
 * (`interaction.created`, `interaction.status_update`, `step.start`,
 * `step.delta`, `step.stop`, `interaction.completed` e, no fio HTTP cru, o
 * sentinela `event: done` com `data: [DONE]`), não o formato dos mocks
 * anteriores.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const dashboard: GeminiDashboardInput = {
  name: "Vendas",
  sheetName: "Janeiro",
  columns: [{ key: "Valor", label: "Valor", kind: "currency", visible: true, description: "" }],
  rows: [{ Valor: 100 }, { Valor: 200 }],
};

const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

const textDelta = (text: string) =>
  sse("step.delta", { index: 1, delta: { type: "text", text }, event_type: "step.delta" });

const completed = (status = "completed") =>
  sse("interaction.completed", {
    interaction: { id: "v1_abc", status, object: "interaction" },
    event_type: "interaction.completed",
  });

let requestCount = 0;

function chatRequest(body: Record<string, unknown> = {}) {
  requestCount += 1;
  return new Request("http://localhost/api/gemini/chat", {
    method: "POST",
    headers: { origin: "http://localhost", "x-forwarded-for": `stream-${requestCount}` },
    body: JSON.stringify({ message: "Resuma o painel", dashboard, ...body }),
  });
}

/** Corpo do provedor controlado a partir do teste. */
function providerBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(current) {
      controller = current;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    stream,
    send: (payload: string) => controller.enqueue(encoder.encode(payload)),
    close: () => controller.close(),
    get cancelled() {
      return cancelled;
    },
  };
}

type FetchInit = RequestInit & { signal?: AbortSignal };
let lastInit: FetchInit | undefined;

function stubProvider(body: ReadableStream<Uint8Array> | null, contentType = "text/event-stream") {
  const fetchMock = vi.fn(async (_url: string, init: FetchInit) => {
    lastInit = init;
    return new Response(body, { headers: { "content-type": contentType } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function readAll(response: Response) {
  const reader = response.body!.getReader();
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

/** Lê até encontrar um trecho, para não depender da granularidade dos chunks. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
  maxReads = 20,
) {
  let text = "";
  for (let attempt = 0; attempt < maxReads; attempt += 1) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    if (text.includes(needle)) return text;
  }
  return text;
}

beforeEach(() => {
  lastInit = undefined;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetRateLimitsForTests();
});

describe("contrato de eventos do Gemini", () => {
  it("encerra no evento terminal da interação, sem esperar o socket fechar", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });

    provider.send(sse("interaction.created", { event_type: "interaction.created" }));
    provider.send(sse("interaction.status_update", { event_type: "interaction.status_update" }));
    provider.send(sse("step.start", { index: 1, step: { type: "model_output" } }));
    provider.send(textDelta("Total de "));
    provider.send(textDelta("R$ 300,00"));
    provider.send(sse("step.stop", { index: 1, event_type: "step.stop" }));
    provider.send(completed());

    const text = await readAll(response);
    expect(text).toContain('"text":"Total de "');
    expect(text).toContain('"text":"R$ 300,00"');
    expect(text).toContain("event: done");
    // O corpo do provedor nunca foi fechado pelo provedor: quem fechou fomos
    // nós, ao reconhecer o evento terminal.
    expect(provider.cancelled).toBe(true);
  });

  it("aceita também o sentinela [DONE] do fio HTTP cru", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });

    provider.send(textDelta("pronto"));
    provider.send("event: done\ndata: [DONE]\n\n");

    expect(await readAll(response)).toContain("event: done");
  });

  it("não deixa raciocínio interno nem assinatura de pensamento chegarem ao navegador", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });

    provider.send(sse("step.start", { index: 0, step: { type: "thought" } }));
    provider.send(
      sse("step.delta", {
        index: 0,
        delta: { type: "thought_summary", text: "primeiro eu calculo a média" },
        event_type: "step.delta",
      }),
    );
    provider.send(
      sse("step.delta", {
        index: 0,
        delta: { type: "thought_signature", signature: "AsSiNaTuRa" },
        event_type: "step.delta",
      }),
    );
    provider.send(textDelta("A média é 150."));
    provider.send(completed());

    const text = await readAll(response);
    expect(text).toContain("A média é 150.");
    expect(text).not.toContain("primeiro eu calculo");
    expect(text).not.toContain("AsSiNaTuRa");
  });

  it("trata o evento de erro do provedor como falha, mesmo depois de texto", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });

    provider.send(textDelta("Começo da resposta"));
    provider.send(
      sse("error", { error: { message: "policy blocked: cpf", code: "400" }, event_type: "error" }),
    );

    const text = await readAll(response);
    expect(text).toContain("event: error");
    expect(text).toContain('"reason":"provedor"');
    expect(text).not.toContain("event: done");
    // A mensagem crua do provedor pode citar a entrada: ela fica no servidor.
    expect(text).not.toContain("policy blocked");
  });

  it("recusa uma interação que termina com status não final", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });

    provider.send(textDelta("parcial"));
    provider.send(completed("failed"));

    const text = await readAll(response);
    expect(text).toContain('"reason":"provedor"');
    expect(text).not.toContain("event: done");
  });

  it("recusa JSON inválido dentro de um evento sem repassar o conteúdo", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });

    provider.send("event: step.delta\ndata: {nao-e-json\n\n");

    const text = await readAll(response);
    expect(text).toContain("event: error");
    expect(text).not.toContain("nao-e-json");
  });

  it("não conclui quando o provedor fecha sem terminal e sem texto", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });

    provider.send(sse("interaction.created", { event_type: "interaction.created" }));
    provider.close();

    const text = await readAll(response);
    expect(text).toContain("event: error");
    expect(text).toContain("não retornou uma resposta");
  });

  it("responde com falha de provedor quando o corpo não é legível", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>erro</html>", { headers: { "content-type": "text/html" } }),
      ),
    );

    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });

    expect(response.status).toBe(502);
    expect((await response.json()) as { reason: string }).toMatchObject({ reason: "provedor" });
  });

  it("marca a resposta com no-store e sem transformação intermediária", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });
    provider.send(textDelta("ok"));
    provider.send(completed());
    await readAll(response);

    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cache-control")).toContain("no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });
});

describe("prazos do streaming", () => {
  it("desiste quando o Gemini demora a devolver os cabeçalhos", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: FetchInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      ),
    );

    const pending = handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });
    await vi.advanceTimersByTimeAsync(GEMINI_START_TIMEOUT_MS + 10);
    const response = await pending;

    expect(response.status).toBe(504);
    expect((await response.json()) as { reason: string }).toMatchObject({ reason: "inicio-lento" });
  });

  it("desiste quando a resposta para de chegar no meio", async () => {
    vi.useFakeTimers();
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });
    const reader = response.body!.getReader();

    provider.send(textDelta("Começou"));
    expect(decoder.decode((await reader.read()).value)).toContain("Começou");

    const pendingRead = reader.read();
    await vi.advanceTimersByTimeAsync(GEMINI_IDLE_TIMEOUT_MS + 10);

    expect(decoder.decode((await pendingRead).value)).toContain('"reason":"inatividade"');
    expect(lastInit?.signal?.aborted).toBe(true);
  });

  it("desiste quando a geração passa da duração máxima", async () => {
    vi.useFakeTimers();
    // Provedor que sempre tem o que entregar: o prazo de inatividade nunca
    // expira, então o que sobra para acabar com a geração é o prazo total.
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode(textDelta(".")));
      },
    });
    stubProvider(stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });
    const reader = response.body!.getReader();

    await reader.read();
    await vi.advanceTimersByTimeAsync(GEMINI_TOTAL_TIMEOUT_MS + 10);

    expect(await readUntil(reader, "duracao-maxima")).toContain('"reason":"duracao-maxima"');
    expect(lastInit?.signal?.aborted).toBe(true);
  });
});

describe("tetos de memória do proxy", () => {
  it("corta um evento do provedor acima do teto sem repassar o conteúdo", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });

    provider.send(`event: step.delta\ndata: ${"z".repeat(GEMINI_MAX_EVENT_BYTES + 1)}`);
    provider.close();

    const text = await readAll(response);
    expect(text).toContain('"reason":"limite-excedido"');
    expect(text).not.toContain("zzzz");
  });

  it("corta a resposta que passa do teto de texto", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });
    const reader = response.body!.getReader();

    const bloco = "a".repeat(32 * 1024);
    for (let enviados = 0; enviados <= CHAT_MAX_ANSWER_BYTES; enviados += bloco.length)
      provider.send(textDelta(bloco));

    expect(await readUntil(reader, "limite-excedido", 60)).toContain('"reason":"limite-excedido"');
    expect(provider.cancelled).toBe(true);
  });
});

describe("desconexão do navegador", () => {
  it("aborta o Gemini quando o navegador cancela a leitura", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest(), { GEMINI_API_KEY: "k" });
    const reader = response.body!.getReader();

    provider.send(textDelta("primeiro trecho"));
    await reader.read();
    await reader.cancel();

    expect(lastInit?.signal?.aborted).toBe(true);
    expect(provider.cancelled).toBe(true);
  });

  it("aborta o Gemini quando a própria requisição é abortada", async () => {
    const provider = providerBody();
    stubProvider(provider.stream);
    const client = new AbortController();
    const request = new Request("http://localhost/api/gemini/chat", {
      method: "POST",
      headers: { origin: "http://localhost", "x-forwarded-for": "desconexao-sinal" },
      body: JSON.stringify({ message: "Resuma o painel", dashboard }),
      signal: client.signal,
    });
    const response = await handleGeminiChat(request, { GEMINI_API_KEY: "k" });
    const reader = response.body!.getReader();

    provider.send(textDelta("um pouco"));
    await reader.read();
    client.abort();
    await Promise.resolve();

    expect(provider.cancelled).toBe(true);
  });
});

describe("telemetria do stream", () => {
  it("registra só números e motivo, nunca pergunta ou resposta", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const provider = providerBody();
    stubProvider(provider.stream);
    const response = await handleGeminiChat(chatRequest({ message: "Qual o valor de Recife?" }), {
      GEMINI_API_KEY: "k",
    });

    provider.send(textDelta("O valor é 300."));
    provider.send(completed());
    await readAll(response);

    const registro = info.mock.calls.at(-1);
    expect(registro?.[0]).toBe("gemini chat stream");
    expect(registro?.[1]).toMatchObject({ outcome: "concluida", deltas: 1 });
    const serializado = JSON.stringify(registro);
    expect(serializado).not.toContain("Recife");
    expect(serializado).not.toContain("O valor é 300.");
  });
});
