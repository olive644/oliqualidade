import type { Dashboard, SheetData } from "@/lib/types";
import { postResponseWithHumanCheck } from "@/lib/human-check-client";
import type { LiveDashboardContext } from "@/lib/assistant-context";
import {
  readServerSentEvents,
  ServerSentEventLimitError,
  utf8Length,
} from "@/lib/server-sent-events";
import {
  ASSISTANT_STREAM_MESSAGES,
  CHAT_MAX_ANSWER_BYTES,
  CHAT_MAX_EVENT_BYTES,
  CHAT_MAX_STREAM_BYTES,
  type AssistantStreamFailure,
} from "@/lib/assistant-stream";

export type GeminiChatMessage = { role: "user" | "assistant"; text: string };
export type GeminiStreamingOptions = {
  /**
   * Recebe cada trecho novo, não a resposta acumulada.
   *
   * Entregar o acumulado obrigava a materializar a resposta inteira a cada
   * delta, e a conversa guardava uma segunda cópia do mesmo texto. Com o
   * trecho, quem exibe decide quando juntar, e existe um acumulador só.
   */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
};

/**
 * Falha do assistente com motivo legível por código.
 *
 * A mensagem é o que a pessoa lê; o motivo é o que a interface usa para
 * escolher o estado visual. Nenhum dos dois carrega nome de exceção, código
 * interno ou detalhe de protocolo.
 */
export class AssistantStreamError extends Error {
  readonly reason: AssistantStreamFailure;

  constructor(reason: AssistantStreamFailure, message = ASSISTANT_STREAM_MESSAGES[reason]) {
    super(message);
    this.name = "AssistantStreamError";
    this.reason = reason;
  }
}

const FAILURE_REASONS = new Set<string>(Object.keys(ASSISTANT_STREAM_MESSAGES));

function failureReason(value: unknown): AssistantStreamFailure | null {
  return typeof value === "string" && FAILURE_REASONS.has(value)
    ? (value as AssistantStreamFailure)
    : null;
}

function responseError(raw: string) {
  try {
    const result = JSON.parse(raw) as { error?: unknown; reason?: unknown };
    const reason = failureReason(result.reason) ?? "indisponivel";
    return new AssistantStreamError(
      reason,
      typeof result.error === "string" ? result.error : ASSISTANT_STREAM_MESSAGES[reason],
    );
  } catch {
    return new AssistantStreamError("indisponivel");
  }
}

async function readStreamedAnswer(response: Response, options: GeminiStreamingOptions) {
  if (!response.body) throw new AssistantStreamError("indisponivel");
  // Lista de trechos, juntada uma vez só no fim. Concatenar a cada delta
  // forçaria uma cópia inteira da resposta por trecho recebido.
  const chunks: string[] = [];
  let answerBytes = 0;
  let completed = false;

  try {
    for await (const event of readServerSentEvents(response.body, {
      maxEventBytes: CHAT_MAX_EVENT_BYTES,
      maxStreamBytes: CHAT_MAX_STREAM_BYTES,
    })) {
      let payload: { text?: unknown; error?: unknown; reason?: unknown } = {};
      try {
        payload = JSON.parse(event.data) as typeof payload;
      } catch {
        throw new AssistantStreamError("provedor");
      }

      if (event.event === "delta") {
        if (typeof payload.text !== "string") throw new AssistantStreamError("provedor");
        answerBytes += utf8Length(payload.text);
        if (answerBytes > CHAT_MAX_ANSWER_BYTES) throw new AssistantStreamError("limite-excedido");
        chunks.push(payload.text);
        options.onDelta?.(payload.text);
      } else if (event.event === "error") {
        const reason = failureReason(payload.reason) ?? "provedor";
        throw new AssistantStreamError(
          reason,
          typeof payload.error === "string" ? payload.error : ASSISTANT_STREAM_MESSAGES[reason],
        );
      } else if (event.event === "done") {
        completed = true;
        break;
      }
    }
  } catch (error) {
    // O leitor sinaliza o estouro com um erro próprio, sem conteúdo junto.
    if (error instanceof ServerSentEventLimitError)
      throw new AssistantStreamError("limite-excedido");
    throw error;
  }

  const answer = chunks.join("").trim();
  // Sem `done` não houve conclusão, mesmo com texto na tela. Guardar isso como
  // resposta pronta apresentaria um pedaço como se fosse o todo.
  if (!completed || !answer) throw new AssistantStreamError(answer ? "rede" : "indisponivel");
  return answer;
}

export async function askGemini(
  message: string,
  dashboard: Dashboard,
  sheet: SheetData,
  liveRows: SheetData["rows"],
  liveView: LiveDashboardContext,
  history: GeminiChatMessage[] = [],
  options: GeminiStreamingOptions = {},
) {
  const response = await postResponseWithHumanCheck(
    "/api/gemini/chat",
    {
      message,
      history,
      dashboard: {
        name: dashboard.name,
        sheetName: sheet.name,
        columns: sheet.columns,
        // O servidor recebe a mesma base já filtrada que alimenta os widgets,
        // não a planilha original desconectada do que está na tela.
        rows: liveRows,
        liveView,
      },
    },
    options.signal,
  );

  if (!response.ok) throw responseError(await response.text());
  if (response.headers.get("content-type")?.includes("text/event-stream"))
    return readStreamedAnswer(response, options);

  // Compatibilidade durante uma implantação gradual: um cliente novo ainda
  // entende a resposta JSON do servidor anterior.
  const raw = await response.text();
  let result: { answer?: string; error?: string; reason?: unknown } = {};
  try {
    result = JSON.parse(raw) as typeof result;
  } catch {
    // O proxy ou a plataforma podem devolver uma página/response vazia em falhas.
  }
  if (!result.answer) {
    const reason = failureReason(result.reason) ?? "indisponivel";
    throw new AssistantStreamError(reason, result.error ?? ASSISTANT_STREAM_MESSAGES[reason]);
  }
  options.onDelta?.(result.answer);
  return result.answer;
}
