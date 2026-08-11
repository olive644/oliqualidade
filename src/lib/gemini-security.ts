import type { Column, Row } from "@/lib/types";
import { parseDateValue } from "@/lib/format";

type RankedAggregate = {
  group: string;
  sum: number;
  average: number;
  count: number;
};

type CrossAnalysis = {
  groupBy: string;
  metric: string;
  ranking: RankedAggregate[];
};

type MonthlyCrossAnalysis = CrossAnalysis & {
  dateColumn: string;
  month: string;
};

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
  crossAnalyses: CrossAnalysis[];
  monthlyCrossAnalyses: MonthlyCrossAnalysis[];
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

const semanticScore = (column: Column, patterns: RegExp[]) => {
  const name = `${column.key} ${column.label}`;
  return patterns.reduce(
    (score, pattern, index) => score + (pattern.test(name) ? 20 - index : 0),
    0,
  );
};

const preferredColumns = (columns: Column[], patterns: RegExp[], limit: number) =>
  columns
    .map((column, index) => ({ column, index, score: semanticScore(column, patterns) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ column }) => column);

const summarizeGroups = (rows: Row[], groupKey: string, metricKey: string) => {
  const groups = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const group = String(row[groupKey] ?? "")
      .trim()
      .slice(0, 100);
    const value = asNumber(row[metricKey]);
    if (!group || value === null) continue;
    const aggregate = groups.get(group) ?? { sum: 0, count: 0 };
    aggregate.sum += value;
    aggregate.count += 1;
    groups.set(group, aggregate);
  }
  return [...groups]
    .map(([group, aggregate]) => ({
      group,
      sum: aggregate.sum,
      average: aggregate.sum / aggregate.count,
      count: aggregate.count,
    }))
    .sort((a, b) => b.sum - a.sum || b.count - a.count)
    .slice(0, 10);
};

function buildCrossAnalyses(rows: Row[], columns: Column[]) {
  const dimensions = preferredColumns(
    columns.filter(
      (column) =>
        ["text", "category"].includes(column.kind) &&
        !SENSITIVE.test(`${column.key} ${column.label}`),
    ),
    [
      /vendedor|seller|consultor|representante/i,
      /cliente|customer/i,
      /produto|item/i,
      /categoria/i,
    ],
    6,
  );
  const metrics = preferredColumns(
    columns.filter((column) => ["number", "currency", "percentage"].includes(column.kind)),
    [
      /total.?bruto|valor.?total/i,
      /faturamento|receita|vendas?|sales|revenue/i,
      /quantidade|qtd|quantity/i,
      /pre[cç]o/i,
    ],
    4,
  );
  const dates = preferredColumns(
    columns.filter((column) => column.kind === "date"),
    [/data.?venda|date.?sale/i, /data|date|m[eê]s/i],
    1,
  );
  const crossAnalyses = dimensions.flatMap((dimension) =>
    metrics.map((metric) => ({
      groupBy: dimension.label,
      metric: metric.label,
      ranking: summarizeGroups(rows, dimension.key, metric.key),
    })),
  );
  const monthlyCrossAnalyses: MonthlyCrossAnalysis[] = [];
  const dateColumn = dates[0];
  if (dateColumn) {
    const byMonth = new Map<string, Row[]>();
    for (const row of rows) {
      const timestamp = parseDateValue(row[dateColumn.key] ?? null);
      if (timestamp === null) continue;
      const date = new Date(timestamp);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const bucket = byMonth.get(month) ?? [];
      bucket.push(row);
      byMonth.set(month, bucket);
    }
    const months = [...byMonth].sort(([a], [b]) => a.localeCompare(b)).slice(-24);
    for (const dimension of dimensions)
      for (const metric of metrics)
        for (const [month, monthRows] of months)
          monthlyCrossAnalyses.push({
            dateColumn: dateColumn.label,
            month,
            groupBy: dimension.label,
            metric: metric.label,
            ranking: summarizeGroups(monthRows, dimension.key, metric.key).slice(0, 5),
          });
  }
  return { crossAnalyses, monthlyCrossAnalyses };
}

export function buildSafeDashboardContext(input: GeminiDashboardInput): GeminiSafeContext {
  const rows = input.rows.slice(0, 50_000);
  const analyses = buildCrossAnalyses(rows, input.columns);
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
    ...analyses,
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
