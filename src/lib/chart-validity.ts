import { parseNumericValue } from "@/lib/format";
import type { Row } from "@/lib/types";

export type ChartValidity = {
  valid: boolean;
  reason: string | null;
};

export const CHART_VALIDITY_LIMITS = {
  histogramValues: 20,
  histogramDistinctValues: 5,
  scatterPairs: 8,
  scatterDistinctValues: 3,
  boxCategories: 2,
  boxValuesPerCategory: 4,
  boxDistinctValuesPerCategory: 2,
  paretoCategories: 3,
} as const;

const valid = (): ChartValidity => ({ valid: true, reason: null });
const invalid = (reason: string): ChartValidity => ({ valid: false, reason });

export function numericValuesFor(rows: Row[], valueKey: string): number[] {
  return rows
    .map((row) => parseNumericValue(row[valueKey]))
    .filter((value): value is number => value !== null && Number.isFinite(value));
}

export function pairedNumericValues(
  rows: Row[],
  xKey: string,
  yKey: string,
): Array<{ x: number; y: number }> {
  return rows.flatMap((row) => {
    const x = parseNumericValue(row[xKey]);
    const y = parseNumericValue(row[yKey]);
    return x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
  });
}

export function groupedNumericValues(
  rows: Row[],
  groupKey: string,
  valueKey: string,
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const rawGroup = row[groupKey];
    const value = parseNumericValue(row[valueKey]);
    if (rawGroup === null || rawGroup === undefined || rawGroup === "" || value === null) continue;
    const group = String(rawGroup);
    groups.set(group, [...(groups.get(group) ?? []), value]);
  }
  return groups;
}

export function groupedCountValues(rows: Row[], groupKey: string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const rawGroup = row[groupKey];
    if (rawGroup === null || rawGroup === undefined || rawGroup === "") continue;
    const group = String(rawGroup);
    groups.set(group, [...(groups.get(group) ?? []), 1]);
  }
  return groups;
}

export function histogramChartValidity(values: number[]): ChartValidity {
  if (values.length < CHART_VALIDITY_LIMITS.histogramValues) {
    return invalid(
      `O histograma precisa de ao menos ${CHART_VALIDITY_LIMITS.histogramValues} valores numéricos válidos; há ${values.length}.`,
    );
  }
  const distinct = new Set(values).size;
  if (distinct < CHART_VALIDITY_LIMITS.histogramDistinctValues) {
    return invalid(
      `O histograma precisa de ao menos ${CHART_VALIDITY_LIMITS.histogramDistinctValues} valores distintos; há ${distinct}.`,
    );
  }
  return valid();
}

export function scatterChartValidity(points: Array<{ x: number; y: number }>): ChartValidity {
  if (points.length < CHART_VALIDITY_LIMITS.scatterPairs) {
    return invalid(
      `A dispersão precisa de ao menos ${CHART_VALIDITY_LIMITS.scatterPairs} pares numéricos completos; há ${points.length}.`,
    );
  }
  const distinctX = new Set(points.map((point) => point.x)).size;
  const distinctY = new Set(points.map((point) => point.y)).size;
  if (
    distinctX < CHART_VALIDITY_LIMITS.scatterDistinctValues ||
    distinctY < CHART_VALIDITY_LIMITS.scatterDistinctValues
  ) {
    return invalid(
      `A dispersão precisa de ao menos ${CHART_VALIDITY_LIMITS.scatterDistinctValues} valores distintos em cada eixo; há ${distinctX} em X e ${distinctY} em Y.`,
    );
  }
  return valid();
}

export function boxPlotChartValidity(groups: ReadonlyMap<string, number[]>): ChartValidity {
  if (groups.size < CHART_VALIDITY_LIMITS.boxCategories) {
    return invalid(
      `O box plot precisa de ao menos ${CHART_VALIDITY_LIMITS.boxCategories} categorias; há ${groups.size}.`,
    );
  }
  const sparse = [...groups.values()].filter(
    (values) => values.length < CHART_VALIDITY_LIMITS.boxValuesPerCategory,
  ).length;
  if (sparse > 0) {
    return invalid(
      `Cada categoria do box plot precisa de ao menos ${CHART_VALIDITY_LIMITS.boxValuesPerCategory} valores numéricos; ${sparse} ${sparse === 1 ? "categoria não atende" : "categorias não atendem"}.`,
    );
  }
  const constant = [...groups.values()].filter(
    (values) => new Set(values).size < CHART_VALIDITY_LIMITS.boxDistinctValuesPerCategory,
  ).length;
  if (constant > 0) {
    return invalid(
      `Cada categoria do box plot precisa de variação; ${constant} ${constant === 1 ? "categoria tem" : "categorias têm"} menos de ${CHART_VALIDITY_LIMITS.boxDistinctValuesPerCategory} valores distintos.`,
    );
  }
  return valid();
}

export function paretoChartValidity(groups: ReadonlyMap<string, number[]>): ChartValidity {
  if (groups.size < CHART_VALIDITY_LIMITS.paretoCategories) {
    return invalid(
      `O Pareto precisa de ao menos ${CHART_VALIDITY_LIMITS.paretoCategories} categorias; há ${groups.size}.`,
    );
  }
  const values = [...groups.values()].flat();
  if (values.some((value) => value < 0)) {
    return invalid("O Pareto não aceita contribuições negativas, pois elas distorcem o acumulado.");
  }
  if (!values.some((value) => value > 0)) {
    return invalid("O Pareto precisa de pelo menos uma contribuição positiva.");
  }
  return valid();
}
