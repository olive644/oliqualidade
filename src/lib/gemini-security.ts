import type { Column, Row } from "@/lib/types";
import { parseDateValue } from "@/lib/format";
import type { LiveDashboardContext, LiveWidgetSnapshot } from "@/lib/assistant-context";

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
  liveView?: LiveDashboardContext;
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
  liveView?: LiveDashboardContext;
};

export type GeminiChatHistoryMessage = { role: "user" | "assistant"; text: string };

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

export function validateChatHistory(value: unknown): GeminiChatHistoryMessage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Histórico da conversa inválido.");
  return value.slice(-12).map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Histórico da conversa inválido.");
    const candidate = entry as { role?: unknown; text?: unknown };
    if (candidate.role !== "user" && candidate.role !== "assistant")
      throw new Error("Histórico da conversa inválido.");
    if (typeof candidate.text !== "string") throw new Error("Histórico da conversa inválido.");
    const text = candidate.text.trim();
    if (!text || text.length > 4_000) throw new Error("Histórico da conversa inválido.");
    if (candidate.role === "user" && detectPromptInjection(text))
      throw new Error("O histórico contém instruções potencialmente inseguras.");
    return { role: candidate.role, text };
  });
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

const safeText = (value: unknown, limit = 160) => {
  const text = typeof value === "string" ? value : String(value ?? "");
  const clean = text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, limit);
  return INJECTION.some((pattern) => pattern.test(clean))
    ? "[conteúdo ocultado por segurança]"
    : clean;
};

const finiteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const ALLOWED_OPERATIONS = new Set(["sum", "avg", "count", "min", "max", "multiply", "divide"]);

function sanitizeLiveWidget(
  widget: LiveWidgetSnapshot,
  safeKeys: Set<string>,
): LiveWidgetSnapshot | null {
  if (!widget || typeof widget !== "object") return null;
  const allowedTypes = new Set([
    "metric",
    "metric-trend",
    "folder-files",
    "bar",
    "pie",
    "line",
    "area",
    "ranking",
    "rating",
    "map",
    "table",
  ]);
  if (!allowedTypes.has(widget.type)) return null;
  const metric =
    widget.metric && safeKeys.has(widget.metric.key)
      ? {
          key: safeText(widget.metric.key),
          label: safeText(widget.metric.label),
          kind: safeText(widget.metric.kind, 40),
        }
      : undefined;
  const groupBy =
    widget.groupBy && safeKeys.has(widget.groupBy.key)
      ? {
          key: safeText(widget.groupBy.key),
          label: safeText(widget.groupBy.label),
          kind: safeText(widget.groupBy.kind, 40),
        }
      : undefined;
  // Widgets ligados a uma coluna removida por privacidade não entram no
  // contexto do modelo; tabela e contador de arquivos não expõem valores.
  if (widget.metric && !metric) return null;
  if (widget.groupBy && !groupBy) return null;
  const displayedValue = widget.displayedValue
    ? {
        value: finiteNumber(widget.displayedValue.value) ?? 0,
        formatted: safeText(widget.displayedValue.formatted, 80),
      }
    : undefined;
  const sanitizePeriod = (period: { label: string; value: number; formatted: string }) => ({
    label: safeText(period.label, 100),
    value: finiteNumber(period.value) ?? 0,
    formatted: safeText(period.formatted, 80),
  });
  const trend = widget.trend
    ? {
        firstPeriod: sanitizePeriod(widget.trend.firstPeriod),
        lastPeriod: sanitizePeriod(widget.trend.lastPeriod),
        change: finiteNumber(widget.trend.change),
        formattedChange: safeText(widget.trend.formattedChange, 80),
        meaning: safeText(widget.trend.meaning, 240),
      }
    : undefined;
  const previousVersion = widget.previousVersion
    ? {
        change: finiteNumber(widget.previousVersion.change),
        formattedChange: safeText(widget.previousVersion.formattedChange, 80),
        meaning: safeText(widget.previousVersion.meaning, 240),
      }
    : undefined;
  const series = widget.series
    ? {
        items: widget.series.items.slice(0, 100).flatMap((item) => {
          const value = finiteNumber(item.value);
          if (value === null) return [];
          return [
            {
              label: safeText(item.label, 100),
              value,
              formatted: safeText(item.formatted, 80),
              ...(typeof item.groupedCategories === "number" &&
              Number.isFinite(item.groupedCategories)
                ? { groupedCategories: Math.max(0, Math.floor(item.groupedCategories)) }
                : {}),
            },
          ];
        }),
        totalItems: Math.max(0, Math.floor(finiteNumber(widget.series.totalItems) ?? 0)),
        truncated: Boolean(widget.series.truncated),
      }
    : undefined;
  return {
    id: safeText(widget.id, 100),
    type: widget.type,
    title: safeText(widget.title),
    status: widget.status === "ready" ? "ready" : "empty",
    ...(metric ? { metric } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(widget.operation && ALLOWED_OPERATIONS.has(widget.operation.key)
      ? {
          operation: {
            key: widget.operation.key,
            label: safeText(widget.operation.label, 80),
          },
        }
      : {}),
    ...(displayedValue ? { displayedValue } : {}),
    ...(trend ? { trend } : {}),
    ...(previousVersion ? { previousVersion } : {}),
    ...(series ? { series } : {}),
    ...(finiteNumber(widget.scaleMax) === null ? {} : { scaleMax: finiteNumber(widget.scaleMax)! }),
    ...(finiteNumber(widget.rowCount) === null
      ? {}
      : { rowCount: Math.max(0, Math.floor(finiteNumber(widget.rowCount)!)) }),
  };
}

function sanitizeLiveView(
  view: LiveDashboardContext | undefined,
  safeColumns: Column[],
): LiveDashboardContext | undefined {
  if (!view || typeof view !== "object") return undefined;
  const safeKeys = new Set(safeColumns.map((column) => column.key));
  const filters = Array.isArray(view.filters)
    ? view.filters.slice(0, 30).flatMap((filter) => {
        if (!filter || !safeKeys.has(filter.columnKey)) return [];
        return [
          {
            columnKey: safeText(filter.columnKey),
            columnLabel: safeText(filter.columnLabel),
            kind: safeText(filter.kind, 40),
            value: safeText(filter.value),
            ...(filter.min === undefined ? {} : { min: safeText(filter.min, 80) }),
            ...(filter.max === undefined ? {} : { max: safeText(filter.max, 80) }),
          },
        ];
      })
    : [];
  const sort =
    view.sort && safeKeys.has(view.sort.columnKey)
      ? {
          columnKey: safeText(view.sort.columnKey),
          columnLabel: safeText(view.sort.columnLabel),
          direction: view.sort.direction === "desc" ? ("desc" as const) : ("asc" as const),
        }
      : null;
  const widgets = Array.isArray(view.widgets)
    ? view.widgets
        .slice(0, 60)
        .map((widget) => sanitizeLiveWidget(widget, safeKeys))
        .filter((widget): widget is LiveWidgetSnapshot => widget !== null)
    : [];
  return {
    capturedAt: safeText(view.capturedAt, 60),
    source: "current-filtered-view",
    dashboard: safeText(view.dashboard),
    sheet: safeText(view.sheet),
    totalRows: Math.max(0, Math.floor(finiteNumber(view.totalRows) ?? 0)),
    visibleRows: Math.max(0, Math.floor(finiteNumber(view.visibleRows) ?? 0)),
    search: safeText(view.search),
    filters,
    sort,
    widgets,
  };
}

export function buildSafeDashboardContext(input: GeminiDashboardInput): GeminiSafeContext {
  const rows = input.rows.slice(0, 50_000);
  const safeColumns = input.columns.filter(
    (column) => !SENSITIVE.test(`${column.key} ${column.label}`),
  );
  const analyses = buildCrossAnalyses(rows, safeColumns);
  const liveView = sanitizeLiveView(input.liveView, safeColumns);
  if (liveView) {
    liveView.dashboard = input.name.slice(0, 120);
    liveView.sheet = input.sheetName.slice(0, 120);
  }
  return {
    dashboard: input.name.slice(0, 120),
    sheet: input.sheetName.slice(0, 120),
    rowCount: input.rows.length,
    columns: safeColumns.map((column) => {
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
        counts.set(String(value).slice(0, 100), (counts.get(String(value).slice(0, 100)) ?? 0) + 1);
      return {
        ...base,
        topValues: [...counts]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([value, count]) => ({ value, count })),
      };
    }),
    ...analyses,
    ...(liveView ? { liveView } : {}),
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
