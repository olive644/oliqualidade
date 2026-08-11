import type { Column, Row } from "@/lib/types";

export type GeminiDashboardInput = {
  name: string;
  sheetName: string;
  columns: Column[];
  rows: Row[];
};

export type GeminiSafeContext = {
  dashboard: string;
  sheet: string;
  rowCount: number;
  columns: Array<{
    key: string;
    label: string;
    kind: string;
    missing: number;
    distinct: number;
    min?: number;
    max?: number;
    average?: number;
    topValues?: Array<{ value: string; count: number }>;
  }>;
};

const SENSITIVE =
  /(cpf|cnpj|rg|email|e-mail|telefone|celular|phone|endereco|endereço|senha|password|token|secret|api.?key|pix|conta.?banc)/i;
const INJECTION = [
  /ignore\s+(all\s+)?previous/i,
  /ignore\s+(todas?\s+)?instru/i,
  /system\s*(prompt|message)/i,
  /reveal|exfiltrat|vaze|mostre.*(?:chave|segredo|prompt)/i,
  /developer\s*(message|instruction)/i,
  /jailbreak|bypass/i,
];

export function detectPromptInjection(message: string) {
  return INJECTION.some((pattern) => pattern.test(message));
}

export function validateChatMessage(value: unknown) {
  if (typeof value !== "string") throw new Error("Mensagem inválida.");
  const message = value.trim();
  if (!message || message.length > 2_000)
    throw new Error("A mensagem deve ter entre 1 e 2.000 caracteres.");
  if (detectPromptInjection(message))
    throw new Error("A mensagem contém instruções potencialmente inseguras.");
  return message;
}

const asNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/%$/, "")
    .replace(/\.(?=\d{3}(?:,|$))/g, "")
    .replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

export function buildSafeDashboardContext(input: GeminiDashboardInput): GeminiSafeContext {
  const rows = input.rows.slice(0, 50_000);
  return {
    dashboard: input.name.slice(0, 120),
    sheet: input.sheetName.slice(0, 120),
    rowCount: input.rows.length,
    columns: input.columns
      .filter((column) => !SENSITIVE.test(`${column.key} ${column.label}`))
      .map((column) => {
        const values = rows
          .map((row) => row[column.key])
          .filter((value) => value !== null && value !== "");
        const base = {
          key: column.key,
          label: column.label,
          kind: column.kind,
          missing: input.rows.length - values.length,
          distinct: new Set(values.map(String)).size,
        };
        if (["number", "currency", "percentage"].includes(column.kind)) {
          const numbers = values.map(asNumber).filter((value): value is number => value !== null);
          return numbers.length
            ? {
                ...base,
                min: Math.min(...numbers),
                max: Math.max(...numbers),
                average: numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
              }
            : base;
        }
        const counts = new Map<string, number>();
        for (const value of values)
          counts.set(
            String(value).slice(0, 100),
            (counts.get(String(value).slice(0, 100)) ?? 0) + 1,
          );
        return {
          ...base,
          topValues: [...counts]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([value, count]) => ({ value, count })),
        };
      }),
  };
}

const buckets = new Map<string, number[]>();
export function checkRateLimit(key: string, now = Date.now(), limit = 12, windowMs = 60_000) {
  const recent = (buckets.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
