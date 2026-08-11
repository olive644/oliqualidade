import type { Row } from "@/lib/types";

export type AdvancedColumnQuality = {
  key: string;
  sampleSize: number;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  median: number | null;
  mad: number | null;
  iqrOutliers: number;
  zScoreOutliers: number;
  madOutliers: number;
  temporalAnomalies: number;
  anomalyRows: number[];
  score: number;
};

export type AdvancedQualityReport = {
  columns: AdvancedColumnQuality[];
  tableScore: number;
  totalAnomalies: number;
};

const quantile = (sorted: number[], p: number) => {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position),
    upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
};

const numeric = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/%$/, "")
    .replace(/\s/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",")
    ? raw.replace(/\.(?=\d{3}(?:,|$))/g, "").replace(",", ".")
    : raw;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
};

export function analyzeAdvancedQuality(
  rows: Row[],
  columns: Array<{ key: string; kind: string; qualityScore: number }>,
): AdvancedQualityReport {
  const dateKey = columns.find(
    (column) => column.kind === "date" || column.kind === "datetime",
  )?.key;
  const reports = columns
    .filter((column) => ["integer", "number", "currency", "percentage"].includes(column.kind))
    .map((column) => {
      const indexed = rows
        .map((row, index) => ({ index, value: numeric(row[column.key]) }))
        .filter((item): item is { index: number; value: number } => item.value !== null);
      const values = indexed.map((item) => item.value).sort((a, b) => a - b);
      const median = quantile(values, 0.5),
        q1 = quantile(values, 0.25),
        q3 = quantile(values, 0.75);
      const iqr = q1 === null || q3 === null ? null : q3 - q1;
      const mad =
        median === null
          ? null
          : quantile(
              values.map((v) => Math.abs(v - median)).sort((a, b) => a - b),
              0.5,
            );
      const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      const deviation = Math.sqrt(
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length),
      );
      const flagged = new Set<number>();
      let iqrOutliers = 0,
        zScoreOutliers = 0,
        madOutliers = 0,
        temporalAnomalies = 0;
      for (const item of indexed) {
        if (
          iqr !== null &&
          q1 !== null &&
          q3 !== null &&
          (item.value < q1 - 1.5 * iqr || item.value > q3 + 1.5 * iqr)
        ) {
          iqrOutliers++;
          flagged.add(item.index);
        }
        if (deviation > 0 && Math.abs((item.value - mean) / deviation) >= 3) {
          zScoreOutliers++;
          flagged.add(item.index);
        }
        if (mad && Math.abs((0.6745 * (item.value - median!)) / mad) >= 3.5) {
          madOutliers++;
          flagged.add(item.index);
        }
      }
      if (dateKey && indexed.length >= 5) {
        const ordered = indexed.filter(
          (item) => !Number.isNaN(Date.parse(String(rows[item.index]?.[dateKey] ?? ""))),
        );
        const deltas = ordered.slice(1).map((item, i) => ({
          index: item.index,
          value: Math.abs(item.value - ordered[i]!.value),
        }));
        const deltaMedian =
          quantile(
            deltas.map((d) => d.value).sort((a, b) => a - b),
            0.5,
          ) ?? 0;
        const deltaMad =
          quantile(
            deltas.map((d) => Math.abs(d.value - deltaMedian)).sort((a, b) => a - b),
            0.5,
          ) ?? 0;
        for (const delta of deltas)
          if (
            (deltaMad > 0 && delta.value > deltaMedian + 3.5 * deltaMad) ||
            (deltaMad === 0 && deltaMedian > 0 && delta.value > deltaMedian * 3)
          ) {
            temporalAnomalies++;
            flagged.add(delta.index);
          }
      }
      const anomalyRate = flagged.size / Math.max(1, indexed.length);
      return {
        key: column.key,
        sampleSize: indexed.length,
        q1,
        q3,
        iqr,
        median,
        mad,
        iqrOutliers,
        zScoreOutliers,
        madOutliers,
        temporalAnomalies,
        anomalyRows: [...flagged].sort((a, b) => a - b),
        score: Math.max(0, Math.round(column.qualityScore * (1 - Math.min(0.5, anomalyRate)))),
      };
    });
  const totalAnomalies = new Set(reports.flatMap((report) => report.anomalyRows)).size;
  return {
    columns: reports,
    tableScore: columns.length
      ? Math.round(
          columns.reduce(
            (sum, column) =>
              sum + (reports.find((r) => r.key === column.key)?.score ?? column.qualityScore),
            0,
          ) / columns.length,
        )
      : 0,
    totalAnomalies,
  };
}
