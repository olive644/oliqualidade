import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiChatPanel } from "./gemini-chat-panel";
import { encodeServerSentEvent } from "@/lib/server-sent-events";
import type { Dashboard, SheetData } from "@/lib/types";
import type { LiveDashboardContext } from "@/lib/assistant-context";
import { ASSISTANT_STOPPED_MESSAGE } from "@/lib/assistant-stream";

/**
 * Teste do painel como recurso vivo: quantas vezes a tela é atualizada durante
 * a chegada do texto, o que acontece quando a pessoa manda parar e o que sobra
 * de estado depois disso. O quadro de vídeo é controlado pelo teste, porque o
 * agrupamento das atualizações é justamente o que está sendo medido.
 */

const sheet: SheetData = {
  name: "Vendas",
  rows: [{ Valor: 10 }],
  columns: [{ key: "Valor", label: "Valor", kind: "number", visible: true, description: "" }],
  filters: [],
};

const dashboard: Dashboard = {
  id: "d1",
  name: "Painel",
  sheets: [sheet],
  activeSheetIndex: 0,
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
};

const liveView: LiveDashboardContext = {
  capturedAt: "2026-08-26T12:00:00.000Z",
  source: "current-filtered-view",
  dashboard: "Painel",
  sheet: "Vendas",
  totalRows: 1,
  visibleRows: 1,
  search: "",
  filters: [],
  sort: null,
  widgets: [],
};

const encoder = new TextEncoder();

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let framesRequested = 0;

function installFrameControl() {
  frames = new Map();
  nextFrame = 0;
  framesRequested = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    framesRequested += 1;
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => frames.delete(handle));
}

async function runFrames() {
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => {
    for (const callback of pending) callback(0);
  });
}

type Provider = {
  send: (payload: string) => void;
  close: () => void;
  signals: AbortSignal[];
  bodies: Array<Record<string, unknown>>;
};

function stubStreamingFetch(): Provider {
  const signals: AbortSignal[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      if (init.signal) signals.push(init.signal);
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      const stream = new ReadableStream<Uint8Array>({
        start(current) {
          controller = current;
          // Abortar um fetch de verdade derruba o corpo da resposta. Sem
          // reproduzir isso, o cancelamento pareceria funcionar no sinal e a
          // leitura continuaria esperando para sempre.
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            try {
              current.error(error);
            } catch {
              // O corpo já pode ter sido fechado antes do aborto.
            }
          });
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }),
  );

  return {
    // Tolerante de propósito: depois de um aborto o corpo já está derrubado,
    // e insistir nele é exatamente o que um provedor real faria sem que isso
    // devesse virar falha do teste.
    send: (payload: string) => {
      try {
        controller?.enqueue(encoder.encode(payload));
      } catch {
        // corpo já encerrado
      }
    },
    close: () => {
      try {
        controller?.close();
      } catch {
        // corpo já encerrado
      }
    },
    signals,
    bodies,
  };
}

function renderPanel() {
  return render(
    <GeminiChatPanel
      dashboard={dashboard}
      sheet={sheet}
      liveRows={sheet.rows}
      liveView={liveView}
    />,
  );
}

async function ask(question: string) {
  fireEvent.change(screen.getByLabelText("Mensagem para o assistente"), {
    target: { value: question },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
  });
}

async function openAndAsk(question = "Qual é o total?") {
  fireEvent.click(screen.getByRole("button", { name: "Conversar com Oli" }));
  await ask(question);
}

const delta = (text: string) => encodeServerSentEvent("delta", { text });

beforeEach(() => installFrameControl());

afterEach(() => vi.unstubAllGlobals());

describe("painel do assistente durante a geração", () => {
  it("agrupa centenas de trechos em pouquíssimas atualizações e não perde nenhum", async () => {
    const provider = stubStreamingFetch();
    renderPanel();
    await openAndAsk();

    const trechos = Array.from({ length: 400 }, (_, index) => `t${index} `);
    await act(async () => {
      for (const trecho of trechos) provider.send(delta(trecho));
    });

    // Nenhum quadro rodou ainda: 400 trechos chegaram e a tela foi agendada
    // uma vez só. É esta razão que o agrupamento existe para produzir.
    expect(framesRequested).toBeLessThanOrEqual(2);

    await runFrames();
    const parcial = document.querySelector('[data-status="gerando"]');
    expect(parcial?.textContent).toBe(trechos.join(""));

    await act(async () => {
      provider.send(encodeServerSentEvent("done", {}));
      provider.close();
    });

    // Texto final idêntico e completo, mesmo com o stream terminando antes do
    // próximo quadro: o último trecho nunca fica preso no buffer.
    await waitFor(() => {
      expect(screen.getByText(trechos.join("").trim())).toBeTruthy();
    });
    expect(framesRequested).toBeLessThanOrEqual(3);
  });

  it("mostra o texto chegando quando os quadros rodam durante o stream", async () => {
    const provider = stubStreamingFetch();
    renderPanel();
    await openAndAsk();

    await act(async () => provider.send(delta("Total ")));
    await runFrames();
    expect(document.querySelector('[data-status="gerando"]')?.textContent).toBe("Total ");

    await act(async () => provider.send(delta("de R$ 10,00")));
    await runFrames();
    expect(document.querySelector('[data-status="gerando"]')?.textContent).toBe(
      "Total de R$ 10,00",
    );
  });

  it("oferece parar a resposta com nome acessível e alcançável por teclado", async () => {
    stubStreamingFetch();
    renderPanel();
    await openAndAsk();

    const parar = screen.getByRole("button", { name: /Parar resposta/ });
    expect(parar.tagName).toBe("BUTTON");
    expect(parar.getAttribute("type")).toBe("button");
    expect(parar.hasAttribute("disabled")).toBe(false);
  });

  it("para a resposta, marca como interrompida e aceita outra pergunta", async () => {
    const provider = stubStreamingFetch();
    renderPanel();
    await openAndAsk("Qual é o total?");

    await act(async () => provider.send(delta("Metade da resp")));
    await runFrames();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Parar resposta/ }));
    });

    await waitFor(() => {
      expect(document.querySelector('[data-status="interrompida"]')).toBeTruthy();
    });
    expect(provider.signals[0]?.aborted).toBe(true);
    expect(screen.getByText(ASSISTANT_STOPPED_MESSAGE)).toBeTruthy();
    expect(document.querySelector('[data-status="interrompida"]')?.textContent).toContain(
      "Metade da resp",
    );

    // A conversa volta a aceitar pergunta, e o trecho interrompido não é
    // reapresentado ao modelo como se fosse resposta concluída.
    await ask("E em maio?");
    expect(provider.bodies).toHaveLength(2);
    const history = provider.bodies[1]?.["history"] as Array<{ role: string; text: string }>;
    expect(history.map((item) => item.text)).toEqual(["Qual é o total?"]);
  });

  it("cancela a resposta ao fechar o painel", async () => {
    const provider = stubStreamingFetch();
    renderPanel();
    await openAndAsk();
    await act(async () => provider.send(delta("Comecei")));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fechar assistente" }));
    });

    expect(provider.signals[0]?.aborted).toBe(true);
  });

  it("cancela e não atualiza mais nada quando o painel é desmontado no meio", async () => {
    const provider = stubStreamingFetch();
    const view = renderPanel();
    await openAndAsk();
    await act(async () => provider.send(delta("Chegando")));

    view.unmount();
    expect(provider.signals[0]?.aborted).toBe(true);

    // Depois do desmonte, o que ainda estiver no fio não pode virar erro nem
    // tentativa de desenhar em componente que não existe mais.
    await act(async () => {
      provider.send(delta("depois do desmonte"));
      provider.send(encodeServerSentEvent("done", {}));
      provider.close();
    });
    await runFrames();
    expect(document.body.textContent).not.toContain("depois do desmonte");
  });

  it("explica um estouro de prazo sem termo técnico e oferece tentar de novo", async () => {
    const provider = stubStreamingFetch();
    renderPanel();
    await openAndAsk();

    await act(async () => {
      provider.send(delta("Comecei a responder"));
      provider.send(
        encodeServerSentEvent("error", {
          error: "A resposta parou de chegar no meio do caminho. Tente novamente.",
          reason: "inatividade",
        }),
      );
      provider.close();
    });

    await waitFor(() => {
      expect(document.querySelector('[data-status="inatividade"]')).toBeTruthy();
    });
    expect(screen.getByText("Tempo esgotado")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tentar novamente/ })).toBeTruthy();
    expect(document.body.textContent).not.toContain("AbortError");
    expect(document.body.textContent).not.toContain("SSE");
  });
});
