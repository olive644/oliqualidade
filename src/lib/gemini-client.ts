import type { Dashboard, SheetData } from "@/lib/types";
import { postWithHumanCheck } from "@/lib/human-check-client";
import type { LiveDashboardContext } from "@/lib/assistant-context";

export type GeminiChatMessage = { role: "user" | "assistant"; text: string };

export async function askGemini(
  message: string,
  dashboard: Dashboard,
  sheet: SheetData,
  liveRows: SheetData["rows"],
  liveView: LiveDashboardContext,
  history: GeminiChatMessage[] = [],
) {
  const { response, raw } = await postWithHumanCheck("/api/gemini/chat", {
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
  });
  let result: { answer?: string; error?: string } = {};
  try {
    result = JSON.parse(raw) as typeof result;
  } catch {
    // O proxy ou a plataforma podem devolver uma página/response vazia em falhas.
  }
  if (!response.ok || !result.answer)
    throw new Error(
      result.error ?? "O assistente está indisponível no momento. Tente novamente depois.",
    );
  return result.answer;
}
