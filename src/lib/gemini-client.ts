import type { Dashboard, SheetData } from "@/lib/types";
import { postResponseWithHumanCheck } from "@/lib/human-check-client";
import type { LiveDashboardContext } from "@/lib/assistant-context";
import { readServerSentEvents } from "@/lib/server-sent-events";

export type GeminiChatMessage = { role: "user" | "assistant"; text: string };
export type GeminiStreamingOptions = {
  onUpdate?: (answer: string) => void;
  signal?: AbortSignal;
};

const unavailableMessage = "O assistente está indisponível no momento. Tente novamente depois.";

function responseError(raw: string) {
  try {
    const result = JSON.parse(raw) as { error?: unknown };
    return typeof result.error === "string" ? result.error : unavailableMessage;
  } catch {
    return unavailableMessage;
  }
}

async function readStreamedAnswer(response: Response, options: GeminiStreamingOptions) {
  if (!response.body) throw new Error(unavailableMessage);
  let answer = "";
  let completed = false;

  for await (const event of readServerSentEvents(response.body)) {
    let payload: { text?: unknown; error?: unknown } = {};
    try {
      payload = JSON.parse(event.data) as typeof payload;
    } catch {
      throw new Error(unavailableMessage);
    }

    if (event.event === "delta") {
      if (typeof payload.text !== "string") throw new Error(unavailableMessage);
      answer += payload.text;
      options.onUpdate?.(answer);
    } else if (event.event === "error") {
      throw new Error(typeof payload.error === "string" ? payload.error : unavailableMessage);
    } else if (event.event === "done") {
      completed = true;
      break;
    }
  }

  if (!completed || !answer.trim())
    throw new Error(
      answer ? "A conexão com o assistente foi interrompida. Tente novamente." : unavailableMessage,
    );
  return answer.trim();
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

  if (!response.ok) throw new Error(responseError(await response.text()));
  if (response.headers.get("content-type")?.includes("text/event-stream"))
    return readStreamedAnswer(response, options);

  // Compatibilidade durante uma implantação gradual: um cliente novo ainda
  // entende a resposta JSON do servidor anterior.
  const raw = await response.text();
  let result: { answer?: string; error?: string } = {};
  try {
    result = JSON.parse(raw) as typeof result;
  } catch {
    // O proxy ou a plataforma podem devolver uma página/response vazia em falhas.
  }
  if (!result.answer) throw new Error(result.error ?? unavailableMessage);
  options.onUpdate?.(result.answer);
  return result.answer;
}
