import type { ChartAggregationOp, Column, FilterRule, Row } from "@/lib/types";
import { numericKinds } from "@/lib/types";
import { parseDateValue, parseNumericValue } from "@/lib/format";
import { sourceRowIndexOf } from "@/lib/data-review";

/** Rótulo usado quando o valor de agrupamento está ausente. Usado também
 * para detectar esse caso na renderização dos gráficos (eixo, legenda,
 * fatia da pizza) e aplicar uma marcação visual diferenciada. */
export const NOT_INFORMED = "Não informado";

function writtenGroupLabel(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && !value.trim()) return null;
  return String(value);
}

/**
 * Quantas linhas têm o valor de agrupamento vazio. Essas linhas nunca entram
 * em `groupAndAggregate`/`chartSeries` (writtenGroupLabel devolve null e a
 * linha é pulada) — este contador existe só para avisar quantas ficaram de
 * fora, sem mudar esse comportamento de descarte.
 */
export function countMissingGroupRows(rows: Row[], groupKey: string): number {
  return rows.filter((r) => writtenGroupLabel(r[groupKey]) === null).length;
}

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
const BAR_SLOT_PX = 88;
const BAR_SCROLL_THRESHOLD = 8;

export function barChartPresentation(categoryCount: number) {
  const scrollable = categoryCount > BAR_SCROLL_THRESHOLD;
  return {
    scrollable,
    contentWidth: scrollable ? categoryCount * BAR_SLOT_PX : undefined,
  };
}

// Linha, área e sparkline também precisam de espaço horizontal por ponto:
// comprimir dezenas de datas na largura fixa do cartão sobrepõe rótulos e
// transforma a curva em um bloco difícil de ler. A versão compacta é usada
// pela métrica com tendência, que tem menos altura e pede um passo menor.
const TIME_SERIES_SLOT_PX = 72;
const COMPACT_TIME_SERIES_SLOT_PX = 44;
const TIME_SERIES_SCROLL_THRESHOLD = 8;
const COMPACT_TIME_SERIES_SCROLL_THRESHOLD = 10;

export function timeSeriesChartPresentation(pointCount: number, compact = false) {
  const threshold = compact ? COMPACT_TIME_SERIES_SCROLL_THRESHOLD : TIME_SERIES_SCROLL_THRESHOLD;
  const slot = compact ? COMPACT_TIME_SERIES_SLOT_PX : TIME_SERIES_SLOT_PX;
  const scrollable = pointCount > threshold;
  return {
    scrollable,
    contentWidth: scrollable ? pointCount * slot : undefined,
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
        .filter((x) => x.v !== null && x.v !== "" && parseNumericValue(x.v) !== null);
      for (let i = 0; i < result.length; i++) {
        const row = result[i];
        if (!row) continue;
        const v = row[col.key];
        if (v !== null && v !== "") continue;
        const before = [...idxs].reverse().find((x) => x.i < i);
        const after = idxs.find((x) => x.i > i);
        if (before && after) {
          const ratio = (i - before.i) / (after.i - before.i);
          const value =
            (parseNumericValue(before.v) ?? 0) +
            ((parseNumericValue(after.v) ?? 0) - (parseNumericValue(before.v) ?? 0)) * ratio;
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
      const values = rows
        .map((r) => parseNumericValue(r[col.key]))
        .filter((v): v is number => v !== null);
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
): { name: string; total: number; sourceRowIndexes?: number[] }[] {
  const buckets = new Map<
    string,
    { values: number[]; valueRowIndexes: number[]; rowCount: number; rowIndexes: number[] }
  >();
  for (const r of rows) {
    const name = writtenGroupLabel(r[groupKey]);
    if (name === null) continue;
    if (!buckets.has(name))
      buckets.set(name, { values: [], valueRowIndexes: [], rowCount: 0, rowIndexes: [] });
    const bucket = buckets.get(name);
    if (!bucket) continue;
    bucket.rowCount++;
    // Índice estável em `sheet.rows` (sobrevive a cálculo, regra de dado
    // ausente, filtro e ordenação — ver `markSourceRows`), null nas bases de
    // teste que não passam pelo pipeline real. É o mesmo `rowIndex` que
    // `traceImportedCell`/`resolveSourceCellProvenance` esperam, o que
    // permite ir do balde agregado direto até a célula de origem.
    const sourceRowIndex = sourceRowIndexOf(r);
    if (sourceRowIndex !== null) bucket.rowIndexes.push(sourceRowIndex);
    const raw = r[valueKey];
    const v = parseNumericValue(raw);
    if (v !== null) {
      bucket.values.push(v);
      if (sourceRowIndex !== null) bucket.valueRowIndexes.push(sourceRowIndex);
    }
  }
  const result: { name: string; total: number; sourceRowIndexes?: number[] }[] = [];
  for (const [name, bucket] of buckets) {
    if (op === "count") {
      result.push({
        name,
        total: bucket.rowCount,
        ...(bucket.rowIndexes.length ? { sourceRowIndexes: bucket.rowIndexes } : {}),
      });
      continue;
    }
    if (!bucket.values.length) continue;
    result.push({
      name,
      total: aggregate(bucket.values, op),
      ...(bucket.valueRowIndexes.length ? { sourceRowIndexes: bucket.valueRowIndexes } : {}),
    });
  }
  return result;
}

export type ParetoEntry = {
  name: string;
  total: number;
  /** Fração (0 a 1) do total acumulado até e incluindo esta categoria, com as categorias ordenadas da maior para a menor. */
  cumulativeShare: number;
  sourceRowIndexes?: number[];
};

/**
 * Ordena as categorias da maior para a menor contribuição e acumula a
 * participação de cada uma, para responder "poucas causas explicam a
 * maior parte do problema?" — a leitura clássica de Pareto (80/20), que
 * nem a barra (mostra tudo, mas não acumula) nem o ranking (top N, mas sem
 * o percentual acumulado) respondem sozinhos.
 *
 * Categorias com total zero ou negativo ficam de fora: a lógica de "causa"
 * pressupõe contribuição positiva, e misturá-las quebraria a leitura
 * monótona do acumulado (a linha deixaria de subir de esquerda pra
 * direita).
 */
export function paretoSeries(
  rows: Row[],
  groupKey: string,
  valueKey: string,
  op: AggregationOp,
): ParetoEntry[] {
  const sorted = groupAndAggregate(rows, groupKey, valueKey, op)
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total);
  const grandTotal = sorted.reduce((sum, entry) => sum + entry.total, 0);
  let running = 0;
  return sorted.map((entry) => {
    running += entry.total;
    return { ...entry, cumulativeShare: grandTotal > 0 ? running / grandTotal : 0 };
  });
}

/**
 * Prepara a série de um gráfico sem esconder a diferença entre os dados
 * originais e uma agregação. No modo raw, cada valor numérico preenchido
 * permanece uma marca independente, na mesma ordem das linhas do Excel.
 */
export function chartSeries(
  rows: Row[],
  groupKey: string,
  valueKey: string,
  op: AggregationOp,
  mode: "raw" | "aggregate",
): Array<{
  name: string;
  total: number;
  sourceRow?: number;
  sourceRowIndex?: number;
  sourceRowIndexes?: number[];
}> {
  if (mode === "aggregate") return groupAndAggregate(rows, groupKey, valueKey, op);
  return rows.flatMap((row, index) => {
    const name = writtenGroupLabel(row[groupKey]);
    if (name === null) return [];
    // `sourceRow` (posição no array já filtrado/ordenado) segue existindo só
    // pelo hover; `sourceRowIndex` é o índice estável em `sheet.rows` (null
    // fora do pipeline real) que dá pra usar de fato pra buscar a célula de
    // origem — os dois divergem sempre que há filtro, busca ou ordenação
    // ativos.
    const sourceRowIndex = sourceRowIndexOf(row);
    const traceable = sourceRowIndex !== null ? { sourceRowIndex } : {};
    if (op === "count") return [{ name, total: 1, sourceRow: index + 1, ...traceable }];
    const value = parseNumericValue(row[valueKey]);
    return value !== null ? [{ name, total: value, sourceRow: index + 1, ...traceable }] : [];
  });
}

export type HistogramBin = {
  label: string;
  rangeStart: number;
  rangeEnd: number;
  count: number;
  sourceRowIndexes?: number[];
};

/**
 * Menor teto (Sturges) e maior piso (nunca menos de 5) para o número de
 * faixas quando o widget não fixa `binCount`: poucos valores em faixas
 * demais criam barras de altura 0/1 sem dizer nada sobre a forma da
 * distribuição; faixas demais numa base grande escondem o formato atrás de
 * ruído. `Math.log2(n) + 1` é a regra clássica para número de faixas.
 */
const MIN_HISTOGRAM_BINS = 5;
const MAX_HISTOGRAM_BINS = 20;

function sturgesBinCount(sampleSize: number): number {
  return Math.min(
    MAX_HISTOGRAM_BINS,
    Math.max(MIN_HISTOGRAM_BINS, Math.ceil(Math.log2(Math.max(sampleSize, 1)) + 1)),
  );
}

/**
 * Divide os valores numéricos de uma coluna em faixas de largura igual, para
 * responder "como os valores estão distribuídos" — pergunta que soma/média
 * por categoria não responde, e que agrupar por uma coluna categórica não
 * serve para responder quando a distribuição é da própria métrica, não de
 * uma dimensão.
 *
 * Valores ausentes ou não numéricos são excluídos silenciosamente (mesmo
 * espírito de `groupAndAggregate`); a base fica sem nenhuma faixa quando não
 * sobra nenhum valor válido, em vez de um histograma "zerado" enganoso.
 */
export function histogramBins(rows: Row[], valueKey: string, binCount?: number): HistogramBin[] {
  const values: { value: number; sourceRowIndex: number | null }[] = [];
  for (const row of rows) {
    const value = parseNumericValue(row[valueKey]);
    if (value !== null) values.push({ value, sourceRowIndex: sourceRowIndexOf(row) });
  }
  if (!values.length) return [];

  const min = Math.min(...values.map((v) => v.value));
  const max = Math.max(...values.map((v) => v.value));
  const numberLabel = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

  // Todo valor igual (inclusive base de 1 valor só): uma faixa só, sem
  // largura para dividir.
  if (min === max) {
    const sourceRowIndexes = values
      .map((v) => v.sourceRowIndex)
      .filter((index): index is number => index !== null);
    return [
      {
        label: numberLabel(min),
        rangeStart: min,
        rangeEnd: max,
        count: values.length,
        ...(sourceRowIndexes.length ? { sourceRowIndexes } : {}),
      },
    ];
  }

  const bins = Math.max(1, binCount ?? sturgesBinCount(values.length));
  const width = (max - min) / bins;
  const buckets = Array.from({ length: bins }, (_, i) => ({
    rangeStart: min + i * width,
    rangeEnd: i === bins - 1 ? max : min + (i + 1) * width,
    count: 0,
    sourceRowIndexes: [] as number[],
  }));
  for (const { value, sourceRowIndex } of values) {
    // O valor máximo cairia numa faixa fantasma (bins) por arredondamento;
    // fica na última faixa de verdade, como um intervalo fechado nas duas
    // pontas ([min, max]) em vez de [min, max).
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - min) / width)));
    buckets[index]!.count++;
    if (sourceRowIndex !== null) buckets[index]!.sourceRowIndexes.push(sourceRowIndex);
  }
  return buckets.map((bucket) => ({
    label: `${numberLabel(bucket.rangeStart)}–${numberLabel(bucket.rangeEnd)}`,
    rangeStart: bucket.rangeStart,
    rangeEnd: bucket.rangeEnd,
    count: bucket.count,
    ...(bucket.sourceRowIndexes.length ? { sourceRowIndexes: bucket.sourceRowIndexes } : {}),
  }));
}

export type BoxPlotStats = {
  name: string;
  /** Menor valor dentro da cerca inferior (não é necessariamente o mínimo bruto — valores abaixo da cerca são outliers, não whisker). */
  min: number;
  q1: number;
  median: number;
  q3: number;
  /** Maior valor dentro da cerca superior. */
  max: number;
  /** Valores fora de [Q1 − 1.5×IQR, Q3 + 1.5×IQR] — o critério clássico de Tukey. */
  outliers: number[];
  count: number;
  sourceRowIndexes?: number[];
};

/**
 * Mediana de uma lista já ordenada. Extraída à parte porque `boxPlotStats`
 * usa a mesma conta três vezes (mediana geral, Q1 da metade de baixo, Q3 da
 * metade de cima).
 */
function medianOfSorted(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Resumo de cinco números (mínimo, quartis, mediana, máximo) por categoria,
 * mais os valores fora da cerca de Tukey — para responder "como os valores
 * estão distribuídos" com foco em espalhamento e valores fora da curva, o
 * que média/soma por categoria esconde.
 *
 * Q1/Q3 pelo método clássico (Moore & McCabe): a mediana geral divide a
 * série ordenada ao meio; com quantidade ímpar de valores, a própria mediana
 * fica de fora das duas metades. Q1 é a mediana da metade de baixo, Q3 a da
 * metade de cima.
 */
export function boxPlotStats(rows: Row[], groupKey: string, valueKey: string): BoxPlotStats[] {
  const buckets = new Map<string, { value: number; sourceRowIndex: number | null }[]>();
  for (const row of rows) {
    const name = writtenGroupLabel(row[groupKey]);
    if (name === null) continue;
    const value = parseNumericValue(row[valueKey]);
    if (value === null) continue;
    if (!buckets.has(name)) buckets.set(name, []);
    buckets.get(name)!.push({ value, sourceRowIndex: sourceRowIndexOf(row) });
  }

  const result: BoxPlotStats[] = [];
  for (const [name, entries] of buckets) {
    const sortedEntries = [...entries].sort((a, b) => a.value - b.value);
    const values = sortedEntries.map((e) => e.value);
    const half = Math.floor(values.length / 2);
    const lowerHalf = values.slice(0, half);
    const upperHalf = values.length % 2 === 0 ? values.slice(half) : values.slice(half + 1);
    const q1 = medianOfSorted(lowerHalf.length ? lowerHalf : values);
    const q3 = medianOfSorted(upperHalf.length ? upperHalf : values);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const inliers = sortedEntries.filter((e) => e.value >= lowerFence && e.value <= upperFence);
    const outliers = sortedEntries.filter((e) => e.value < lowerFence || e.value > upperFence);
    const sourceRowIndexes = entries
      .map((e) => e.sourceRowIndex)
      .filter((index): index is number => index !== null);
    result.push({
      name,
      min: inliers.length ? inliers[0]!.value : values[0]!,
      q1,
      median: medianOfSorted(values),
      q3,
      max: inliers.length ? inliers[inliers.length - 1]!.value : values[values.length - 1]!,
      outliers: outliers.map((e) => e.value),
      count: values.length,
      ...(sourceRowIndexes.length ? { sourceRowIndexes } : {}),
    });
  }
  return result;
}

export type ScatterPoint = { x: number; y: number; sourceRowIndex: number | null };

/** Um ponto por linha com as duas colunas numéricas preenchidas; linha com qualquer uma vazia/não numérica fica de fora (mesmo espírito de `groupAndAggregate`). */
export function scatterPoints(rows: Row[], xKey: string, yKey: string): ScatterPoint[] {
  const points: ScatterPoint[] = [];
  for (const row of rows) {
    const x = parseNumericValue(row[xKey]);
    const y = parseNumericValue(row[yKey]);
    if (x === null || y === null) continue;
    points.push({ x, y, sourceRowIndex: sourceRowIndexOf(row) });
  }
  return points;
}

export type LinearTrend = { slope: number; intercept: number };

/**
 * Reta de melhor ajuste (mínimos quadrados) entre X e Y. `null` com menos de
 * 2 pontos ou quando todo mundo tem o mesmo X (reta vertical — inclinação
 * não é um número, não é zero).
 */
export function linearTrend(points: { x: number; y: number }[]): LinearTrend | null {
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const varianceX = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  if (varianceX === 0) return null;
  const covariance = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0);
  const slope = covariance / varianceX;
  return { slope, intercept: meanY - slope * meanX };
}

/**
 * Coeficiente de correlação de Pearson, de -1 (relação inversa perfeita) a 1
 * (relação direta perfeita). `null` com menos de 2 pontos ou quando X ou Y
 * não varia — correlação é indefinida nesse caso, não zero: dizer "0" faria
 * parecer que foi medida e não há relação, quando na verdade não dá pra
 * medir.
 */
export function pearsonCorrelation(points: { x: number; y: number }[]): number | null {
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const varianceX = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  const varianceY = points.reduce((sum, p) => sum + (p.y - meanY) ** 2, 0);
  if (varianceX === 0 || varianceY === 0) return null;
  const covariance = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0);
  return covariance / Math.sqrt(varianceX * varianceY);
}

export const MAX_RENDERED_CHART_POINTS = 600;

export type RenderableChartSeries<T> = {
  items: T[];
  omitted: number;
  total: number;
};

/**
 * Mantém o conjunto completo fora do DOM e cria uma prévia distribuída ao
 * longo de toda a série. Primeiro e último pontos sempre são preservados;
 * nenhum valor é recalculado. A tabela detalhada continua sendo a fonte para
 * consultar as linhas que não cabem com segurança no SVG do gráfico.
 */
export function limitChartSeriesForRendering<T>(
  items: T[],
  limit = MAX_RENDERED_CHART_POINTS,
): RenderableChartSeries<T> {
  const safeLimit = Math.max(2, Math.floor(limit));
  if (items.length <= safeLimit) return { items, omitted: 0, total: items.length };
  const sampled = Array.from({ length: safeLimit }, (_, index) => {
    const sourceIndex = Math.round((index * (items.length - 1)) / (safeLimit - 1));
    return items[sourceIndex]!;
  });
  return { items: sampled, omitted: items.length - sampled.length, total: items.length };
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
    const name = writtenGroupLabel(r[groupKey]);
    if (name === null) continue;
    const bucket = buckets.get(name) ?? { values: 0, rowCount: 0 };
    bucket.rowCount++;
    const raw = r[valueKey];
    if (parseNumericValue(raw) !== null) bucket.values++;
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

export type AggregationSemanticProfile = {
  role?: string;
  unitFamily?: string;
  aggregable?: boolean;
};

/**
 * Remove cálculos matematicamente possíveis, mas semanticamente enganosos.
 * Soma continua disponível para medidas aditivas; percentuais, limites,
 * médias, notas e resultados de laboratório usam média/faixa/contagem.
 */
export function semanticAggregationOps(
  operations: AggregationOp[],
  column: Pick<Column, "kind" | "label">,
  profile?: AggregationSemanticProfile,
): AggregationOp[] {
  if (profile?.aggregable === false)
    return operations.includes("count") ? ["count"] : operations.slice(0, 1);

  const label = column.label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const additiveRole = profile?.role === "quantity" || profile?.role === "total";
  const additiveLabel =
    /\b(?:quantidade|qtd|total|receita|faturamento|custo|consumo|producao|volume produzido)\b/.test(
      label,
    );
  const nonAdditiveRole = ["result", "minimum-limit", "maximum-limit", "target", "price"].includes(
    profile?.role ?? "",
  );
  const nonAdditiveUnit = ["percentage", "temperature", "concentration", "dimensionless"].includes(
    profile?.unitFamily ?? "",
  );
  const nonAdditiveLabel =
    /(?:^|\b)(?:resultado|limite|meta|media|indice|taxa|margem|percentual|porcentagem|nota|score|oee|temperatura|concentracao|preco unitario)(?:\b|$)|%/.test(
      label,
    );
  const nonAdditive =
    !additiveRole &&
    !additiveLabel &&
    (column.kind === "percentage" || nonAdditiveRole || nonAdditiveUnit || nonAdditiveLabel);
  if (!nonAdditive) return operations;

  const filtered = operations.filter(
    (operation) => !["sum", "multiply", "divide"].includes(operation),
  );
  if (filtered.length) return filtered;
  return operations.includes("count") ? ["count"] : operations.slice(0, 1);
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
  const num = isDate
    ? parseDateValue(value as string | number | null)
    : parseNumericValue(value as string | number | null);
  const minNum = isDate ? (min ? parseDateValue(min) : null) : min ? parseNumericValue(min) : null;
  const maxNum = isDate ? (max ? parseDateValue(max) : null) : max ? parseNumericValue(max) : null;
  if (num === null) return false;
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
export type PieComparison = {
  selected: { name: string; total: number };
  total: number;
  share: number | null;
  rank: number;
  categoryCount: number;
  reference: { name: string; total: number } | null;
  difference: number | null;
  relativeDifference: number | null;
};

/**
 * Resume uma fatia sem fingir que categorias formam uma linha do tempo.
 * A referência é a maior outra categoria visível (ignorando o agrupador
 * "Outros" quando existe uma categoria individual para comparar).
 */
export function pieComparisonFor(
  series: { name: string; total: number }[],
  selectedIndex: number,
): PieComparison | null {
  const selected = series[selectedIndex];
  if (!selected) return null;

  const total = series.reduce((sum, item) => sum + item.total, 0);
  const ranked = [...series].sort((a, b) => b.total - a.total);
  const alternatives = series.filter((_, index) => index !== selectedIndex);
  const namedAlternatives = alternatives.filter((item) => item.name !== "Outros");
  const reference =
    [...(namedAlternatives.length ? namedAlternatives : alternatives)].sort(
      (a, b) => b.total - a.total,
    )[0] ?? null;
  const difference = reference ? selected.total - reference.total : null;
  const relativeDifference =
    reference && reference.total !== 0 && difference !== null
      ? difference / Math.abs(reference.total)
      : null;

  return {
    selected,
    total,
    share: total !== 0 ? selected.total / total : null,
    rank: ranked.findIndex((item) => item === selected) + 1,
    categoryCount: series.length,
    reference,
    difference,
    relativeDifference,
  };
}

export type TrendSummary = {
  first: { name: string; total: number };
  last: { name: string; total: number };
  change: number;
  relativeChange: number | null;
  min: { name: string; total: number };
  max: { name: string; total: number };
  average: number;
  pointCount: number;
};

/**
 * Resume uma série temporal (já em ordem cronológica) sem fingir que ela é
 * uma comparação de categorias: variação do primeiro ao último ponto, e os
 * pontos de mínimo/máximo já visíveis no gráfico. Diferente de
 * `pieComparisonFor`, a ordem da série importa aqui — o chamador é
 * responsável por passar pontos cronologicamente ordenados.
 */
export function trendSummaryFor(series: { name: string; total: number }[]): TrendSummary | null {
  if (series.length < 2) return null;
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const change = last.total - first.total;
  const relativeChange = first.total !== 0 ? change / Math.abs(first.total) : null;
  const min = series.reduce((m, entry) => (entry.total < m.total ? entry : m), first);
  const max = series.reduce((m, entry) => (entry.total > m.total ? entry : m), first);
  const average = series.reduce((sum, entry) => sum + entry.total, 0) / series.length;
  return { first, last, change, relativeChange, min, max, average, pointCount: series.length };
}

/**
 * Reduz qualquer série (agregada ou "linha a linha") para no máximo 6 fatias
 * antes de chegar num gráfico de pizza: as 5 maiores mais um agrupador
 * "Outros" com o resto. Sem isso, uma coluna de agrupamento de alta
 * cardinalidade (ex. um ID único por linha, ou centenas de categorias reais)
 * manda dezenas ou centenas de fatias direto pro `<Pie>` do Recharts, que
 * quebra visualmente — os ângulos de preenchimento fixos não escalam pra
 * esse volume e o desenho vira um emaranhado de "espinhos" em vez de um
 * círculo. `count` no agrupador "Outros" existe pra não virar uma fatia
 * grande e muda: aparece no tooltip e na legenda, ex. "Outros: 445 (94.7%) ·
 * 490 categorias".
 */
export function collapsePieSeries<T extends { name: string; total: number }>(
  series: T[],
): (T | { name: string; total: number; count: number })[] {
  if (series.length <= 6) return series;
  const sorted = [...series].sort((a, b) => b.total - a.total);
  const top = sorted.slice(0, 5);
  const restItems = sorted.slice(5);
  const rest = restItems.reduce((s, x) => s + x.total, 0);
  return rest ? [...top, { name: "Outros", total: rest, count: restItems.length }] : top;
}

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

export type RankingCoverage = {
  topTotal: number;
  overallTotal: number;
  topShare: number | null;
  categoryCount: number;
  shownCount: number;
  remainingCount: number;
};

/**
 * Um "Top N" some com o resto: sem isso, nada diz se as 5 categorias
 * mostradas são quase tudo ou uma fração pequena das dezenas que existem.
 * `topShare` fica `null` (em vez de 0 ou enganosamente positivo) quando o
 * total geral é zero ou negativo — participação percentual não tem leitura
 * confiável nesses casos.
 */
export function rankingCoverageFor(
  shown: { total: number }[],
  all: { total: number }[],
): RankingCoverage {
  const topTotal = shown.reduce((sum, item) => sum + item.total, 0);
  const overallTotal = all.reduce((sum, item) => sum + item.total, 0);
  return {
    topTotal,
    overallTotal,
    topShare: overallTotal > 0 ? topTotal / overallTotal : null,
    categoryCount: all.length,
    shownCount: shown.length,
    remainingCount: Math.max(0, all.length - shown.length),
  };
}

export type SeriesHeadline = {
  /** Rótulo do número principal, já adaptado à operação de agregação. */
  label: string;
  total: number;
  categoryCount: number;
  /** Variação relativa do primeiro ao último ponto; só para séries temporais. */
  relativeChange: number | null;
  /** Último valor da série temporal, quando a ordem tem sentido cronológico. */
  latest: number | null;
  average: number;
};

/**
 * Números-chave de uma série já agregada, para a faixa de métricas do topo do
 * widget.
 *
 * `temporal` decide o que é o número principal: numa série cronológica o que
 * importa é onde ela chegou (último ponto) e o quanto se moveu; numa
 * comparação de categorias o que importa é o total e quantas categorias
 * existem — pedir "variação" de uma lista de categorias compararia itens que
 * não estão em sequência.
 *
 * Com uma soma total de zero a variação relativa fica `null` em vez de
 * infinita ou 0%: sem base, não há percentual honesto a mostrar.
 */
export function seriesHeadline(
  series: { name: string; total: number }[],
  options: { temporal: boolean; operation: AggregationOp },
): SeriesHeadline | null {
  if (!series.length) return null;
  const total = series.reduce((sum, entry) => sum + entry.total, 0);
  const average = total / series.length;
  const trend = options.temporal ? trendSummaryFor(series) : null;
  const label =
    options.operation === "count"
      ? "Total de registros"
      : options.operation === "avg"
        ? "Média geral"
        : "Total";
  return {
    label: options.temporal ? "Valor mais recente" : label,
    total,
    categoryCount: series.length,
    relativeChange: trend?.relativeChange ?? null,
    latest: options.temporal ? (series.at(-1)?.total ?? null) : null,
    average,
  };
}
