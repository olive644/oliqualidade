import type { Column, Row, Value } from "@/lib/types";

export type LongScheduleRow = {
  item: Value;
  indicator: string;
  period: string;
  value: Value;
  sourceRow: number;
  sourceColumn: string;
  sourceAddress: string;
  rawValue: Value;
  /** Demais campos da linha, preservados para revisão e widgets ricos. */
  dimensions: Record<string, Value>;
};

export type ScheduleCriterion = {
  kind: "max" | "min" | "range" | "absence" | "expected-text";
  min?: number;
  max?: number;
  inclusiveMin: boolean;
  inclusiveMax: boolean;
  label: string;
  expectedText?: string;
};

export type ScheduleEvaluation = "within" | "outside" | "not-evaluable";
export type ScheduleCellState = "empty" | "planned" | "done" | "warning" | "failed" | "neutral";

export type ScheduleMetrics = {
  cells: number;
  planned: number;
  results: number;
  within: number;
  outside: number;
  attention: number;
  empty: number;
  rowsWithoutResult: number;
  observations: number;
  coverage: number;
};

const PERIOD =
  /^(?:(?:jan(?:eiro)?|fev(?:ereiro)?|mar(?:[cç]o)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)[-/ ]?\d{2,4}|\d{1,2}[-/]\d{2,4}|\d{4})$/i;

/** Converte números de planilhas brasileiras sem confundir 0,46 com 46. */
export function parseScheduleNumber(value: Value | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^(?:\d{1,2}[/-]\d{4}|\d{4}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/.test(trimmed))
    return null;
  const match = trimmed.match(/[-+]?\d[\d.,]*/);
  if (!match) return null;
  let token = match[0];
  const comma = token.lastIndexOf(",");
  const dot = token.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? /\./g : /,/g;
    token = token.replace(thousands, "").replace(decimal, ".");
  } else if (comma >= 0) {
    token = /^[-+]?\d{1,3}(?:,\d{3})+$/.test(token)
      ? token.replace(/,/g, "")
      : token.replace(",", ".");
  } else if (dot >= 0 && /^[-+]?\d{1,3}(?:\.\d{3})+$/.test(token)) {
    token = token.replace(/\./g, "");
  }
  const parsed = Number(token);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Interpreta limites comuns de cronogramas e laudos: Máx. 25, <1,1,
 * Até 5 uT, mínimo 0,80, faixas como 6,0 a 9,5 e "Ausência".
 */
export function parseScheduleCriterion(value: Value | undefined): ScheduleCriterion | null {
  if (value === null || value === undefined || value === "") return null;
  const label = String(value).trim();
  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\bausencia\b|\bausente\b|\bnegativo\b|\bnao detectado\b/.test(normalized)) {
    return {
      kind: "absence",
      max: 0,
      inclusiveMin: true,
      inclusiveMax: true,
      label,
    };
  }
  if (/^(?:conforme|adequado|aprovado)$/.test(normalized)) {
    return {
      kind: "expected-text",
      inclusiveMin: true,
      inclusiveMax: true,
      label,
      expectedText: normalized,
    };
  }
  const numbers = [...label.matchAll(/[-+]?\d[\d.,]*/g)]
    .map((match) => parseScheduleNumber(match[0]))
    .filter((number): number is number => number !== null);
  if (!numbers.length) return null;
  if (numbers.length >= 2 && /±/.test(label)) {
    const [center = 0, tolerance = 0] = numbers;
    return {
      kind: "range",
      min: center - Math.abs(tolerance),
      max: center + Math.abs(tolerance),
      inclusiveMin: true,
      inclusiveMax: true,
      label,
    };
  }
  const hasRange =
    numbers.length >= 2 &&
    (/\b(?:a|ate|entre)\b/.test(normalized) || /\d\s*[-–—]\s*\d/.test(normalized));
  if (hasRange) {
    const [first = 0, second = 0] = numbers;
    return {
      kind: "range",
      min: Math.min(first, second),
      max: Math.max(first, second),
      inclusiveMin: !/>/.test(label),
      inclusiveMax: !/</.test(label),
      label,
    };
  }
  const limit = numbers[0]!;
  if (/\b(?:min|minimo|maior)\b/.test(normalized) || />/.test(label)) {
    return {
      kind: "min",
      min: limit,
      inclusiveMin: !/>\s*\d/.test(label),
      inclusiveMax: true,
      label,
    };
  }
  return {
    kind: "max",
    max: limit,
    inclusiveMin: true,
    inclusiveMax: !/<\s*\d/.test(label),
    label,
  };
}

export function evaluateScheduleValue(
  value: Value | undefined,
  criterion: ScheduleCriterion | null,
): ScheduleEvaluation {
  if (!criterion) return "not-evaluable";
  if (criterion.kind === "absence" || criterion.kind === "expected-text") {
    if (criterion.kind === "absence" && typeof value === "number") {
      return value === 0 ? "within" : "outside";
    }
    if (typeof value !== "string") return "not-evaluable";
    const normalized = value
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (criterion.kind === "absence") {
      return /^(?:ausente|ausencia|negativo|nao detectado|0)$/.test(normalized)
        ? "within"
        : "outside";
    }
    if (/^(?:nao conforme|inadequado|reprovado)$/.test(normalized)) return "outside";
    return normalized === criterion.expectedText ? "within" : "outside";
  }
  const numeric = parseScheduleNumber(value);
  if (numeric === null) return "not-evaluable";
  const aboveMin =
    criterion.min === undefined ||
    (criterion.inclusiveMin ? numeric >= criterion.min : numeric > criterion.min);
  const belowMax =
    criterion.max === undefined ||
    (criterion.inclusiveMax ? numeric <= criterion.max : numeric < criterion.max);
  return aboveMin && belowMax ? "within" : "outside";
}

/** Classifica a célula sem confundir códigos de frequência com resultados. */
export function scheduleCellState(
  value: unknown,
  rowStatus: unknown,
  criterion: ScheduleCriterion | null = null,
): ScheduleCellState {
  const text = String(value ?? "").trim();
  if (!text || /^[-–—]$/.test(text)) return "empty";

  // O conteúdo da célula é a fonte de verdade. O status geral da linha é
  // apenas fallback: "Planejado" não pode esconder uma medição já preenchida
  // nem transformar um valor fora do limite em uma marcação planejada.
  if (/\b(?:nc|n[aã]o conforme|reprovad[oa]|atrasad[oa]|cancelad[oa]|falha)\b/i.test(text))
    return "failed";
  if (/\b(?:pendente|aten[cç][aã]o|em andamento|parcial|aguardando)\b/i.test(text))
    return "warning";
  if (
    /\b(?:executad[oa]|conclu[ií]d[oa]|realizad[oa]|aprovad[oa]|conforme|ok)\b/i.test(text) ||
    /^c$/i.test(text)
  )
    return "done";

  const evaluation = evaluateScheduleValue(
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? value
      : null,
    criterion,
  );
  if (evaluation === "within") return "done";
  if (evaluation === "outside") return "failed";

  if (
    /\b(?:planejad[oa]|programad[oa]|previst[oa])\b/i.test(text) ||
    /^(?:d|s|m|t|a|sm)$/i.test(text)
  )
    return "planned";

  const status = String(rowStatus ?? "").trim();
  if (/\b(?:nc|n[aã]o conforme|reprovad[oa]|atrasad[oa]|cancelad[oa]|falha)\b/i.test(status))
    return "failed";
  if (/\b(?:pendente|aten[cç][aã]o|em andamento|parcial|aguardando)\b/i.test(status))
    return "warning";
  if (/\b(?:executad[oa]|conclu[ií]d[oa]|realizad[oa]|aprovad[oa]|conforme|ok)\b/i.test(status))
    return "done";
  if (/\b(?:planejad[oa]|programad[oa]|previst[oa])\b/i.test(status)) return "planned";
  return "neutral";
}

export function scheduleCriterionForRow(
  row: Row,
  columns: Column[],
  periodKeys: string[],
): ScheduleCriterion | null {
  const periods = new Set(periodKeys);
  const candidates = columns.filter((column) => !periods.has(column.key));
  const minimum = candidates.find((column) =>
    /(?:^|\b)(?:m[ií]n(?:imo)?|limite inferior)(?:\b|\.)/i.test(`${column.label} ${column.key}`),
  );
  const maximum = candidates.find((column) =>
    /(?:^|\b)(?:m[aá]x(?:imo)?|limite superior)(?:\b|\.)/i.test(`${column.label} ${column.key}`),
  );
  const min = minimum ? parseScheduleNumber(row[minimum.key]) : null;
  const max = maximum ? parseScheduleNumber(row[maximum.key]) : null;
  if (min !== null || max !== null) {
    return {
      kind: min !== null && max !== null ? "range" : min !== null ? "min" : "max",
      ...(min !== null ? { min } : {}),
      ...(max !== null ? { max } : {}),
      inclusiveMin: true,
      inclusiveMax: true,
      label: [min !== null ? `Mín. ${min}` : null, max !== null ? `Máx. ${max}` : null]
        .filter(Boolean)
        .join(" · "),
    };
  }
  const specification = candidates.find((column) =>
    /(?:^|\b)(?:limite|crit[eé]rio|especifica[cç][aã]o|meta)(?:\b|\.)/i.test(
      `${column.label} ${column.key}`,
    ),
  );
  return parseScheduleCriterion(specification ? row[specification.key] : null);
}

export function summarizeScheduleRows(
  rows: Row[],
  columns: Column[],
  periodKeys: string[],
  statusKey?: string,
  observationKeys: string[] = [],
): ScheduleMetrics {
  const metrics: Omit<ScheduleMetrics, "coverage"> = {
    cells: 0,
    planned: 0,
    results: 0,
    within: 0,
    outside: 0,
    attention: 0,
    empty: 0,
    rowsWithoutResult: 0,
    observations: 0,
  };
  for (const row of rows) {
    const criterion = scheduleCriterionForRow(row, columns, periodKeys);
    let rowHasResult = false;
    metrics.cells += periodKeys.length;
    if (observationKeys.some((key) => scheduleCellState(row[key], null) !== "empty"))
      metrics.observations++;
    for (const key of periodKeys) {
      const state = scheduleCellState(row[key], statusKey ? row[statusKey] : null, criterion);
      if (state === "empty") {
        metrics.empty++;
        continue;
      }
      if (state === "planned") {
        metrics.planned++;
        continue;
      }
      rowHasResult = true;
      metrics.results++;
      if (state === "done") metrics.within++;
      if (state === "failed") metrics.outside++;
      if (state === "warning") metrics.attention++;
    }
    if (!rowHasResult) metrics.rowsWithoutResult++;
  }
  return {
    ...metrics,
    coverage: Math.min(
      100,
      Math.round((metrics.results / Math.max(1, metrics.planned || metrics.cells)) * 100),
    ),
  };
}

function spreadsheetColumnName(index: number): string {
  let result = "";
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
    result = String.fromCharCode(65 + ((current - 1) % 26)) + result;
  }
  return result;
}

export function scheduleToLong(rows: Row[]): LongScheduleRow[] {
  const keys = Object.keys(rows[0] ?? {});
  const periods = keys.filter((key) => PERIOD.test(key.trim()));
  if (periods.length < 2) return [];
  const dimensions = keys.filter((key) => !periods.includes(key));
  const itemKey =
    dimensions.find((key) => /ponto|item|local|an[aá]lise|processo|descri[cç][aã]o/i.test(key)) ??
    dimensions[0];
  if (!itemKey) return [];
  const indicatorKey = dimensions.find((key) => key !== itemKey) ?? itemKey;
  return rows.flatMap((row, rowIndex) =>
    periods.map((period) => {
      const rawValue = row[period] ?? null;
      return {
        item: row[itemKey] ?? null,
        indicator: String(row[indicatorKey] ?? indicatorKey),
        period,
        value: rawValue,
        sourceRow: rowIndex + 2,
        sourceColumn: period,
        sourceAddress: `${spreadsheetColumnName(keys.indexOf(period))}${rowIndex + 2}`,
        rawValue,
        dimensions: Object.fromEntries(dimensions.map((key) => [key, row[key] ?? null])),
      };
    }),
  );
}
