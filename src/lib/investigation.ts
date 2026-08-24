import { aggregate, type AggregationOp } from "@/lib/data-pipeline";
import { parseNumericValue } from "@/lib/format";
import type { Column, Row } from "@/lib/types";

export type InvestigationCause = {
  name: string;
  current: number;
  previous: number | null;
  difference: number;
  shareOfMovement: number;
  rowIndexes: number[];
};

export type InvestigationResult = {
  mode: "period-change" | "current-contribution";
  currentPeriod: string | null;
  previousPeriod: string | null;
  currentValue: number;
  previousValue: number | null;
  difference: number | null;
  causes: InvestigationCause[];
  recordCount: number;
  nextStep: "pareto" | "bar";
};

function metricValue(rows: Row[], metricKey: string, operation: AggregationOp): number {
  return aggregate(
    rows
      .map((row) => parseNumericValue(row[metricKey]))
      .filter((value): value is number => value !== null),
    operation,
  );
}

function periodOrder(value: string): number | string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : timestamp;
}

export function buildInvestigation(input: {
  rows: Row[];
  metric: Pick<Column, "key">;
  dimension: Pick<Column, "key">;
  date?: Pick<Column, "key"> | undefined;
  operation: AggregationOp;
}): InvestigationResult {
  const indexed = input.rows.map((row, index) => ({ row, index }));
  const periods = input.date
    ? [
        ...new Set(indexed.map(({ row }) => String(row[input.date!.key] ?? "")).filter(Boolean)),
      ].sort((a, b) => {
        const left = periodOrder(a);
        const right = periodOrder(b);
        return typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), "pt-BR", { numeric: true });
      })
    : [];
  const currentPeriod = periods.at(-1) ?? null;
  const previousPeriod = periods.at(-2) ?? null;
  const mode = currentPeriod && previousPeriod ? "period-change" : "current-contribution";
  const currentRows =
    mode === "period-change"
      ? indexed.filter(({ row }) => String(row[input.date!.key] ?? "") === currentPeriod)
      : indexed;
  const previousRows =
    mode === "period-change"
      ? indexed.filter(({ row }) => String(row[input.date!.key] ?? "") === previousPeriod)
      : [];
  const names = new Set(
    [...currentRows, ...previousRows].map(({ row }) =>
      String(row[input.dimension.key] ?? "Não informado"),
    ),
  );
  const causes = [...names].map((name) => {
    const currentGroup = currentRows.filter(
      ({ row }) => String(row[input.dimension.key] ?? "Não informado") === name,
    );
    const previousGroup = previousRows.filter(
      ({ row }) => String(row[input.dimension.key] ?? "Não informado") === name,
    );
    const current = metricValue(
      currentGroup.map(({ row }) => row),
      input.metric.key,
      input.operation,
    );
    const previous =
      mode === "period-change"
        ? metricValue(
            previousGroup.map(({ row }) => row),
            input.metric.key,
            input.operation,
          )
        : null;
    return {
      name,
      current,
      previous,
      difference: current - (previous ?? 0),
      shareOfMovement: 0,
      rowIndexes: [...currentGroup, ...previousGroup].map(({ index }) => index),
    };
  });
  const movement = causes.reduce((sum, cause) => sum + Math.abs(cause.difference), 0);
  for (const cause of causes)
    cause.shareOfMovement = movement === 0 ? 0 : Math.abs(cause.difference) / movement;
  causes.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  const currentValue = metricValue(
    currentRows.map(({ row }) => row),
    input.metric.key,
    input.operation,
  );
  const previousValue =
    mode === "period-change"
      ? metricValue(
          previousRows.map(({ row }) => row),
          input.metric.key,
          input.operation,
        )
      : null;

  return {
    mode,
    currentPeriod,
    previousPeriod,
    currentValue,
    previousValue,
    difference: previousValue === null ? null : currentValue - previousValue,
    causes: causes.slice(0, 5),
    recordCount: new Set(causes.flatMap((cause) => cause.rowIndexes)).size,
    nextStep: causes.every((cause) => cause.difference >= 0) ? "pareto" : "bar",
  };
}
