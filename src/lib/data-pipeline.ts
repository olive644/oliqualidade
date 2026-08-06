import type { ChartAggregationOp, Column, FilterRule, Row } from "@/lib/types";
import { numericKinds } from "@/lib/types";
import { parseDateValue } from "@/lib/format";

/** Rótulo usado quando o valor de agrupamento está ausente. Usado também
 * para detectar esse caso na renderização dos gráficos (eixo, legenda,
 * fatia da pizza) e aplicar uma marcação visual diferenciada. */
export const NOT_INFORMED = "Não informado";

/**
 * Aplica as regras de dados ausentes configuradas por coluna.
 * - Numéricas: ignore (padrão, mantém null), zero, interpolate, hide-row
 * - Texto/categoria: ignore (mantém null, exibido como "Não informado"), hide-row
 * Retorna as linhas processadas e o conjunto de células (rowIndex-key) que
 * foram estimadas por interpolação, para marcação visual sutil.
 */
export function applyMissingRules(
  rows: Row[],
  columns: Column[],
): { rows: Row[]; interpolated: Set<string> } {
  let result = rows.map((r) => ({ ...r }));
  const interpolated = new Set<string>();

  for (const col of columns) {
    const rule = col.missingRule ?? "ignore";
    if (rule === "hide-row") {
      result = result.filter((r) => r[col.key] !== null && r[col.key] !== "");
      continue;
    }
    if (!numericKinds.includes(col.kind)) continue; // "zero"/"interpolate" só fazem sentido em numéricas
    if (rule === "zero") {
      for (const r of result) if (r[col.key] === null || r[col.key] === "") r[col.key] = 0;
    } else if (rule === "interpolate") {
      const idxs = result
        .map((r, i) => ({ i, v: r[col.key] }))
        .filter((x) => x.v !== null && x.v !== "" && Number.isFinite(Number(x.v)));
      for (let i = 0; i < result.length; i++) {
        const row = result[i];
        if (!row) continue;
        const v = row[col.key];
        if (v !== null && v !== "") continue;
        const before = [...idxs].reverse().find((x) => x.i < i);
        const after = idxs.find((x) => x.i > i);
        if (before && after) {
          const ratio = (i - before.i) / (after.i - before.i);
          const value = Number(before.v) + (Number(after.v) - Number(before.v)) * ratio;
          row[col.key] = value;
          interpolated.add(`${i}-${col.key}`);
        } else if (before) {
          row[col.key] = before.v ?? null;
          interpolated.add(`${i}-${col.key}`);
        } else if (after) {
          row[col.key] = after.v ?? null;
          interpolated.add(`${i}-${col.key}`);
        }
      }
    }
  }
  return { rows: result, interpolated };
}

export type QualitySignal = {
  columnKey: string;
  kind: "duplicate-rows" | "outlier" | "text-inconsistency";
  message: string;
};

/**
 * Sinaliza problemas comuns de qualidade de dados, sem bloquear a interface:
 * linhas duplicadas, outliers numéricos (fora de 3 desvios padrão) e
 * inconsistência de formatação em texto (maiúsculas/espaços).
 */
export function detectQualitySignals(rows: Row[], columns: Column[]): QualitySignal[] {
  const signals: QualitySignal[] = [];

  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const r of rows) {
    const key = JSON.stringify(r);
    if (seen.has(key)) duplicateCount++;
    else seen.add(key);
  }
  if (duplicateCount > 0) {
    signals.push({
      columnKey: "*",
      kind: "duplicate-rows",
      message: `${duplicateCount} linha${duplicateCount > 1 ? "s" : ""} duplicada${duplicateCount > 1 ? "s" : ""} encontrada${duplicateCount > 1 ? "s" : ""}.`,
    });
  }

  for (const col of columns) {
    if (numericKinds.includes(col.kind)) {
      const values = rows.map((r) => Number(r[col.key])).filter((v) => Number.isFinite(v));
      if (values.length < 4) continue;
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
      const std = Math.sqrt(variance);
      if (std > 0) {
        const outliers = values.filter((v) => Math.abs(v - mean) > 3 * std);
        if (outliers.length) {
          signals.push({
            columnKey: col.key,
            kind: "outlier",
            message: `Valor muito fora do padrão em "${col.label}".`,
          });
        }
      }
    } else if (col.kind === "text" || col.kind === "category") {
      const normalized = new Map<string, Set<string>>();
      for (const r of rows) {
        const raw = r[col.key];
        if (raw === null || raw === "") continue;
        const s = String(raw);
        const norm = s.trim().toLowerCase();
        if (!normalized.has(norm)) normalized.set(norm, new Set());
        normalized.get(norm)?.add(s);
      }
      const hasInconsistency = [...normalized.values()].some((variants) => variants.size > 1);
      if (hasInconsistency) {
        signals.push({
          columnKey: col.key,
          kind: "text-inconsistency",
          message: `"${col.label}" tem o mesmo valor escrito de formas diferentes.`,
        });
      }
    }
  }
  return signals;
}

export type AggregationOp = ChartAggregationOp;

export const aggregationLabels: Record<AggregationOp, string> = {
  sum: "Soma",
  avg: "Média",
  count: "Contagem",
  min: "Mínimo",
  max: "Máximo",
};

export function aggregate(values: number[], op: AggregationOp): number {
  if (op === "count") return values.length;
  if (!values.length) return 0;
  if (op === "sum") return values.reduce((s, v) => s + v, 0);
  if (op === "avg") return values.reduce((s, v) => s + v, 0) / values.length;
  if (op === "min") return Math.min(...values);
  return Math.max(...values);
}

/**
 * Agrupa linhas por uma coluna e agrega uma coluna numérica com a operação
 * escolhida.
 */
export function groupAndAggregate(
  rows: Row[],
  groupKey: string,
  valueKey: string,
  op: AggregationOp,
): { name: string; total: number }[] {
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const name = String(r[groupKey] ?? NOT_INFORMED);
    const v = Number(r[valueKey]);
    if (!buckets.has(name)) buckets.set(name, []);
    if (Number.isFinite(v)) buckets.get(name)?.push(v);
  }
  return Array.from(buckets.entries()).map(([name, values]) => ({
    name,
    total: aggregate(values, op),
  }));
}

/**
 * Aplica de forma padronizada o clique de cross-filter em um widget
 * (barra, pizza, linha, área, ranking, mapa): clicar em um valor filtra a
 * base por aquela coluna; clicar de novo no mesmo valor remove o filtro
 * (alterna). Diferente de simplesmente substituir todos os filtros, os
 * filtros de outras colunas são mantidos, para permitir combinar cliques em
 * widgets diferentes (ex: filtrar por região em um mapa e por mês em uma
 * linha do tempo ao mesmo tempo).
 */
export function toggleClickFilter(filters: FilterRule[], key: string, value: string): FilterRule[] {
  const existing = filters.find((f) => f.key === key);
  const isSameSimpleFilter = existing && existing.value === value && !existing.min && !existing.max;
  if (isSameSimpleFilter) return filters.filter((f) => f.key !== key);
  return [...filters.filter((f) => f.key !== key), { key, value, min: "", max: "" }];
}

/** Filtro de intervalo numérico/data reutilizado pelos filtros da tabela. */
export function matchesRange(
  value: unknown,
  min: string | undefined,
  max: string | undefined,
  isDate: boolean,
): boolean {
  if (!min && !max) return true;
  const num = isDate ? parseDateValue(value as string | number | null) : Number(value);
  const minNum = isDate ? (min ? parseDateValue(min) : null) : min ? Number(min) : null;
  const maxNum = isDate ? (max ? parseDateValue(max) : null) : max ? Number(max) : null;
  if (num === null || Number.isNaN(num)) return false;
  if (minNum !== null && num < minNum) return false;
  if (maxNum !== null && num > maxNum) return false;
  return true;
}

export type JoinResult = { rows: Row[]; addedKeys: string[] };

/**
 * Faz um left join simples entre a base atual e uma segunda planilha:
 * para cada linha da base, procura a primeira linha da segunda planilha cujo
 * valor da coluna de correspondência seja igual ao da base (comparação por
 * texto, sem diferenciar maiúsculas/minúsculas) e copia os demais campos
 * dela. Linhas da base sem correspondência mantêm os novos campos como
 * null, ou seja, nenhuma linha da base é perdida ou duplicada. Colunas da
 * segunda planilha com o mesmo nome de uma coluna já existente (fora a
 * própria coluna de correspondência) recebem um sufixo numérico para não
 * colidir.
 */
export function leftJoin(
  baseRows: Row[],
  baseKey: string,
  otherRows: Row[],
  otherKey: string,
  existingKeys: string[],
): JoinResult {
  const otherKeys = Object.keys(otherRows[0] ?? {}).filter((k) => k !== otherKey);
  const keyMap = new Map<string, string>(); // chave original da 2ª planilha -> chave final, sem colisão
  const addedKeys: string[] = [];
  for (const k of otherKeys) {
    let finalKey = k;
    let n = 2;
    while (existingKeys.includes(finalKey) || addedKeys.includes(finalKey)) {
      finalKey = `${k}_${n}`;
      n++;
    }
    keyMap.set(k, finalKey);
    addedKeys.push(finalKey);
  }

  const index = new Map<string, Row>();
  for (const r of otherRows) {
    const k = String(r[otherKey] ?? "")
      .trim()
      .toLowerCase();
    if (k && !index.has(k)) index.set(k, r);
  }

  const rows = baseRows.map((row) => {
    const next = { ...row };
    const matchKey = String(row[baseKey] ?? "")
      .trim()
      .toLowerCase();
    const match = matchKey ? index.get(matchKey) : undefined;
    for (const k of otherKeys) {
      const finalKey = keyMap.get(k);
      if (!finalKey) continue;
      next[finalKey] = match ? (match[k] ?? null) : null;
    }
    return next;
  });

  return { rows, addedKeys };
}
