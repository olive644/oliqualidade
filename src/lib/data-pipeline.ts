import type { ChartAggregationOp, Column, FilterRule, Row } from "@/lib/types";
import { numericKinds } from "@/lib/types";
import { parseDateValue } from "@/lib/format";

/** Rótulo usado quando o valor de agrupamento está ausente. Usado também
 * para detectar esse caso na renderização dos gráficos (eixo, legenda,
 * fatia da pizza) e aplicar uma marcação visual diferenciada. */
export const NOT_INFORMED = "Não informado";

export function sortAllBarCategories<T extends { total: number }>(series: T[]): T[] {
  return [...series].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

/**
 * Barras sempre lado a lado (layout horizontal), pra permitir comparar a
 * variação entre categorias visualmente de forma direta. Quando há muitas
 * categorias, em vez de trocar de layout, o gráfico ganha uma largura maior
 * que a área visível (BAR_SLOT px por categoria) e o container rola na
 * horizontal — inclusive por arrasto com o mouse, não só toque/scrollbar.
 */
const BAR_SLOT_PX = 64;
const BAR_SCROLL_THRESHOLD = 12;

export function barChartPresentation(categoryCount: number) {
  const scrollable = categoryCount > BAR_SCROLL_THRESHOLD;
  return {
    scrollable,
    contentWidth: scrollable ? categoryCount * BAR_SLOT_PX : undefined,
  };
}

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
    const pct = rows.length ? Math.round((duplicateCount / rows.length) * 100) : 0;
    signals.push({
      columnKey: "*",
      kind: "duplicate-rows",
      message: `${duplicateCount} linha${duplicateCount > 1 ? "s" : ""} duplicada${duplicateCount > 1 ? "s" : ""} encontrada${duplicateCount > 1 ? "s" : ""} (${pct}% da base). São linhas com todos os valores idênticos a outra já existente.`,
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
        const lower = mean - 3 * std;
        const upper = mean + 3 * std;
        const outliers = values.filter((v) => v < lower || v > upper);
        if (outliers.length) {
          const extreme = outliers.reduce((a, b) =>
            Math.abs(b - mean) > Math.abs(a - mean) ? b : a,
          );
          const fmtNum = (n: number) =>
            new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);
          signals.push({
            columnKey: col.key,
            kind: "outlier",
            message: `"${col.label}" tem ${outliers.length} valor${outliers.length > 1 ? "es" : ""} muito fora do padrão (ex: ${fmtNum(extreme)}), enquanto a maioria fica entre ${fmtNum(lower)} e ${fmtNum(upper)}.`,
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
      const inconsistent = [...normalized.values()].filter((variants) => variants.size > 1);
      if (inconsistent.length) {
        const first = inconsistent[0];
        const example = first ? [...first].map((v) => `"${v}"`).join(" / ") : "";
        signals.push({
          columnKey: col.key,
          kind: "text-inconsistency",
          message: `"${col.label}" tem o mesmo valor escrito de formas diferentes, ex: ${example}${inconsistent.length > 1 ? ` (e mais ${inconsistent.length - 1} caso${inconsistent.length - 1 > 1 ? "s" : ""})` : ""}.`,
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
  multiply: "Multiplicação",
  divide: "Divisão",
};

/**
 * Multiplicação e divisão agregam os valores do grupo em sequência (ex: 3
 * valores a, b, c viram a/b/c). Fazem mais sentido em grupos com poucos
 * valores (idealmente 2); com 1 valor só, retornam o próprio valor.
 */
export function aggregate(values: number[], op: AggregationOp): number {
  if (op === "count") return values.length;
  if (!values.length) return 0;
  if (op === "sum") return values.reduce((s, v) => s + v, 0);
  if (op === "avg") return values.reduce((s, v) => s + v, 0) / values.length;
  if (op === "min") return Math.min(...values);
  if (op === "max") return Math.max(...values);
  if (op === "multiply") return values.reduce((s, v) => s * v, 1);
  if (op === "divide") return values.reduce((acc, v, i) => (i === 0 ? v : acc / v));
  return Math.max(...values);
}

/**
 * Agrupa linhas por uma coluna e agrega uma coluna numérica com a operação
 * escolhida.
 */
/**
 * Agrupa e agrega linhas por uma coluna categórica. Grupos sem nenhum valor
 * numérico válido na coluna agregada (célula vazia/texto em todas as linhas
 * daquele grupo) são descartados do resultado — mostrar uma barra "zerada"
 * nesse caso seria enganoso, já que 0 significaria "sem dado", não "valor
 * zero" de fato. A operação "count" é a exceção: ela conta linhas do grupo
 * independente da coluna numérica estar preenchida ou não.
 */
export function groupAndAggregate(
  rows: Row[],
  groupKey: string,
  valueKey: string,
  op: AggregationOp,
): { name: string; total: number }[] {
  const buckets = new Map<string, { values: number[]; rowCount: number }>();
  for (const r of rows) {
    const name = String(r[groupKey] ?? NOT_INFORMED);
    if (!buckets.has(name)) buckets.set(name, { values: [], rowCount: 0 });
    const bucket = buckets.get(name);
    if (!bucket) continue;
    bucket.rowCount++;
    const raw = r[valueKey];
    const hasValue = raw !== null && raw !== undefined && raw !== "";
    const v = hasValue ? Number(raw) : NaN;
    if (hasValue && Number.isFinite(v)) bucket.values.push(v);
  }
  const result: { name: string; total: number }[] = [];
  for (const [name, bucket] of buckets) {
    if (op === "count") {
      result.push({ name, total: bucket.rowCount });
      continue;
    }
    if (!bucket.values.length) continue;
    result.push({ name, total: aggregate(bucket.values, op) });
  }
  return result;
}

/**
 * Quando cada grupo tem no máximo 1 valor numérico válido na coluna
 * agregada (ex: uma aba "Resumo" com uma linha por vendedor, já
 * pré-agregada), soma, média, mínimo, máximo, multiplicação e divisão
 * produzem exatamente o mesmo número — escolher entre elas não muda nada no
 * gráfico. Nesse caso oferecer as 7 opções é confuso: parece que existe uma
 * escolha real quando não existe. Essa função decide quais operações fazem
 * sentido mostrar, olhando pros dados de verdade (linhas atuais, já
 * filtradas) em vez de assumir isso estaticamente:
 * - Algum grupo com mais de 1 valor numérico: todas as 7 operações continuam
 *   fazendo sentido (o caso comum, ex: várias vendas por vendedor).
 * - Nenhum grupo com mais de 1 valor, mas algum grupo com mais de 1 linha
 *   (ex: linhas com o valor em branco): soma (mostrando o único valor
 *   presente) e contagem (mostrando quantas linhas existem) continuam sendo
 *   informações diferentes uma da outra.
 * - Cada grupo tem exatamente 1 linha e 1 valor: nenhuma operação muda o
 *   resultado; só faz sentido mostrar o valor em si, sem escolha nenhuma.
 */
export function relevantAggregationOps(
  rows: Row[],
  groupKey: string,
  valueKey: string,
): AggregationOp[] {
  const buckets = new Map<string, { values: number; rowCount: number }>();
  for (const r of rows) {
    const name = String(r[groupKey] ?? NOT_INFORMED);
    const bucket = buckets.get(name) ?? { values: 0, rowCount: 0 };
    bucket.rowCount++;
    const raw = r[valueKey];
    const hasValue = raw !== null && raw !== undefined && raw !== "";
    if (hasValue && Number.isFinite(Number(raw))) bucket.values++;
    buckets.set(name, bucket);
  }
  const list = [...buckets.values()];
  if (!list.length) return ["sum"];
  const maxValues = list.length ? Math.max(...list.map((b) => b.values)) : 0;
  const maxRows = list.length ? Math.max(...list.map((b) => b.rowCount)) : 0;
  if (maxValues === 0) return ["count"];
  // Multiplicação/divisão entre dezenas de linhas explode ou tende a zero,
  // produzindo barras ilegíveis e sem interpretação analítica útil.
  if (maxValues > 1) return ["sum", "avg", "count", "min", "max"];
  if (maxRows > 1) return ["sum", "count"];
  return ["sum"];
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

// Abaixo dessa fração da fatia menor, mesmo um arredondamento reduzido
// ainda ocupa mais espaço angular do que a fatia tem, e ela vira um traço
// solto flutuando fora do anel em vez de uma fatia de verdade — ver
// pieRoundnessFor.
const PIE_THIN_SLICE_THRESHOLD = 0.03;

/**
 * Calcula o arredondamento (cornerRadius) e o espaçamento entre fatias
 * (paddingAngle) do gráfico de pizza/distribuição, reduzindo os dois quando
 * a menor fatia é fina demais para o arredondamento padrão (acontece com
 * colunas de alta cardinalidade, tipo um ID único por linha, onde nenhuma
 * categoria se destaca das outras e mesmo o "top 5" vira fatias minúsculas).
 * Fatias muito finas (< 3% do total) zeram o arredondamento por completo —
 * qualquer valor maior que zero ainda consegue "comer" uma fatia desse
 * tamanho e quebrar o desenho.
 */
export function pieRoundnessFor(series: { total: number }[]): {
  cornerRadius: number;
  paddingAngle: number;
} {
  const total = series.reduce((s, e) => s + e.total, 0);
  const smallestShare =
    total > 0 && series.length ? Math.min(...series.map((e) => e.total)) / total : 1;
  return smallestShare < PIE_THIN_SLICE_THRESHOLD
    ? { cornerRadius: 0, paddingAngle: 1 }
    : { cornerRadius: 6, paddingAngle: 3 };
}
