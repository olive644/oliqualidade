import type { WasmShadowStatus } from "@/lib/workbook-reading-engine";

export type WasmCorpusObservation = {
  status: WasmShadowStatus;
  schemaVersion: string | null;
  comparedCells: number;
  divergentCells: number;
  divergentSheets: number;
  elapsedMs: number;
};

export type WasmPromotionCriteria = {
  requiredSchemaVersion: string;
  minimumWorkbooks: number;
  minimumComparedCells: number;
  maximumFailedWorkbooks: number;
  maximumDivergentWorkbooks: number;
  maximumDivergentCellRatio: number;
  maximumP95ElapsedMs: number;
};

export const DEFAULT_WASM_PROMOTION_CRITERIA: WasmPromotionCriteria = {
  requiredSchemaVersion: "3.0.0",
  minimumWorkbooks: 25,
  minimumComparedCells: 10_000,
  maximumFailedWorkbooks: 0,
  maximumDivergentWorkbooks: 0,
  maximumDivergentCellRatio: 0,
  maximumP95ElapsedMs: 1_500,
};

export type WasmPromotionAssessment = {
  eligible: boolean;
  measuredWorkbooks: number;
  matchedWorkbooks: number;
  divergentWorkbooks: number;
  failedWorkbooks: number;
  comparedCells: number;
  divergentCells: number;
  divergentCellRatio: number;
  p95ElapsedMs: number;
  reasons: string[];
};

function percentile95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

export function assessWasmPromotion(
  observations: WasmCorpusObservation[],
  criteria: WasmPromotionCriteria = DEFAULT_WASM_PROMOTION_CRITERIA,
): WasmPromotionAssessment {
  const measured = observations.filter(
    (observation) => observation.status !== "unavailable" && observation.status !== "sampled-out",
  );
  const divergentWorkbooks = measured.filter(
    (item) => item.status === "diverged" || item.divergentCells > 0 || item.divergentSheets > 0,
  ).length;
  const matchedWorkbooks = measured.filter(
    (item) => item.status === "matched" && item.divergentCells === 0 && item.divergentSheets === 0,
  ).length;
  const failedWorkbooks = measured.filter((item) => item.status === "failed").length;
  const comparedCells = measured.reduce((total, item) => total + item.comparedCells, 0);
  const divergentCells = measured.reduce((total, item) => total + item.divergentCells, 0);
  const divergentCellRatio = comparedCells ? divergentCells / comparedCells : 0;
  const p95ElapsedMs = percentile95(measured.map((item) => item.elapsedMs));
  const reasons: string[] = [];

  if (measured.length < criteria.minimumWorkbooks)
    reasons.push(`corpus insuficiente: ${measured.length}/${criteria.minimumWorkbooks} arquivos`);
  if (comparedCells < criteria.minimumComparedCells)
    reasons.push(
      `cobertura insuficiente: ${comparedCells}/${criteria.minimumComparedCells} células`,
    );
  if (failedWorkbooks > criteria.maximumFailedWorkbooks)
    reasons.push(`falhas acima do limite: ${failedWorkbooks}/${criteria.maximumFailedWorkbooks}`);
  if (divergentWorkbooks > criteria.maximumDivergentWorkbooks)
    reasons.push(
      `arquivos divergentes acima do limite: ${divergentWorkbooks}/${criteria.maximumDivergentWorkbooks}`,
    );
  if (divergentCellRatio > criteria.maximumDivergentCellRatio)
    reasons.push(
      `taxa de divergência acima do limite: ${divergentCellRatio}/${criteria.maximumDivergentCellRatio}`,
    );
  if (p95ElapsedMs > criteria.maximumP95ElapsedMs)
    reasons.push(
      `latência p95 acima do limite: ${p95ElapsedMs}/${criteria.maximumP95ElapsedMs} ms`,
    );
  const invalidSchemas = measured.filter(
    (item) => item.schemaVersion !== criteria.requiredSchemaVersion,
  ).length;
  if (invalidSchemas)
    reasons.push(
      `contrato incompatível em ${invalidSchemas} arquivo(s); esperado ${criteria.requiredSchemaVersion}`,
    );

  return {
    eligible: reasons.length === 0,
    measuredWorkbooks: measured.length,
    matchedWorkbooks,
    divergentWorkbooks,
    failedWorkbooks,
    comparedCells,
    divergentCells,
    divergentCellRatio,
    p95ElapsedMs,
    reasons,
  };
}
