import type { Dashboard, SheetData } from "@/lib/types";

export async function askGemini(message: string, dashboard: Dashboard, sheet: SheetData) {
  const response = await fetch("/api/gemini/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      dashboard: {
        name: dashboard.name,
        sheetName: sheet.name,
        columns: sheet.columns,
        rows: sheet.rows,
      },
    }),
  });
  const raw = await response.text();
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
