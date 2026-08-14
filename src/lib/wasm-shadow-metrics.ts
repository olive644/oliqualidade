import {
  WASM_INVENTORY_SCHEMA_VERSION,
  type WasmShadowStatus,
} from "@/lib/workbook-reading-engine";

export type WasmCorpusObservation = {
  format: string;
  source: "synthetic" | "sanitized-real";
  corpusId?: string;
  status: WasmShadowStatus;
  schemaVersion: string | null;
  comparedCells: number;
  divergentCells: number;
  comparedStructures: number;
  divergentStructures: number;
  divergentSheets: number;
  elapsedMs: number;
};

export type WasmPromotionCriteria = {
  requiredSchemaVersion: string;
  minimumWorkbooks: number;
  minimumComparedCells: number;
  minimumSanitizedRealWorkbooks: number;
  maximumFailedWorkbooks: number;
  maximumDivergentWorkbooks: number;
  maximumDivergentCellRatio: number;
  maximumDivergentStructures: number;
  maximumP95ElapsedMs: number;
};

export const DEFAULT_WASM_PROMOTION_CRITERIA: WasmPromotionCriteria = {
  requiredSchemaVersion: WASM_INVENTORY_SCHEMA_VERSION,
  minimumWorkbooks: 25,
  minimumComparedCells: 10_000,
  minimumSanitizedRealWorkbooks: 5,
  maximumFailedWorkbooks: 0,
  maximumDivergentWorkbooks: 0,
  maximumDivergentCellRatio: 0,
  maximumDivergentStructures: 0,
  maximumP95ElapsedMs: 1_500,
};

export type WasmPromotionAssessment = {
  eligible: boolean;
  measuredWorkbooks: number;
  matchedWorkbooks: number;
  divergentWorkbooks: number;
  failedWorkbooks: number;
  sanitizedRealWorkbooks: number;
  duplicateSanitizedRealWorkbooks: number;
  unidentifiedSanitizedRealWorkbooks: number;
  comparedCells: number;
  divergentCells: number;
  divergentCellRatio: number;
  comparedStructures: number;
  divergentStructures: number;
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
    (item) =>
      item.status === "diverged" ||
      item.divergentCells > 0 ||
      item.divergentStructures > 0 ||
      item.divergentSheets > 0,
  ).length;
  const matchedWorkbooks = measured.filter(
    (item) =>
      item.status === "matched" &&
      item.divergentCells === 0 &&
      item.divergentStructures === 0 &&
      item.divergentSheets === 0,
  ).length;
  const failedWorkbooks = measured.filter((item) => item.status === "failed").length;
  const sanitizedRealObservations = measured.filter((item) => item.source === "sanitized-real");
  const sanitizedRealIds = new Set(
    sanitizedRealObservations
      .map((item) => item.corpusId?.trim())
      .filter((id): id is string => !!id),
  );
  const unidentifiedSanitizedRealWorkbooks = sanitizedRealObservations.filter(
    (item) => !item.corpusId?.trim(),
  ).length;
  const sanitizedRealWorkbooks = sanitizedRealIds.size;
  const duplicateSanitizedRealWorkbooks =
    sanitizedRealObservations.length -
    unidentifiedSanitizedRealWorkbooks -
    sanitizedRealWorkbooks;
  const comparedCells = measured.reduce((total, item) => total + item.comparedCells, 0);
  const divergentCells = measured.reduce((total, item) => total + item.divergentCells, 0);
  const comparedStructures = measured.reduce((total, item) => total + item.comparedStructures, 0);
  const divergentStructures = measured.reduce((total, item) => total + item.divergentStructures, 0);
  const divergentCellRatio = comparedCells ? divergentCells / comparedCells : 0;
  const p95ElapsedMs = percentile95(measured.map((item) => item.elapsedMs));
  const reasons: string[] = [];

  if (measured.length < criteria.minimumWorkbooks)
    reasons.push(`corpus insuficiente: ${measured.length}/${criteria.minimumWorkbooks} arquivos`);
  if (comparedCells < criteria.minimumComparedCells)
    reasons.push(
      `cobertura insuficiente: ${comparedCells}/${criteria.minimumComparedCells} células`,
    );
  if (sanitizedRealWorkbooks < criteria.minimumSanitizedRealWorkbooks)
    reasons.push(
      `corpus real sanitizado insuficiente: ${sanitizedRealWorkbooks}/${criteria.minimumSanitizedRealWorkbooks} arquivos`,
    );
  if (unidentifiedSanitizedRealWorkbooks > 0)
    reasons.push(
      `corpus real sem identidade sanitizada: ${unidentifiedSanitizedRealWorkbooks} arquivo(s)`,
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
  if (divergentStructures > criteria.maximumDivergentStructures)
    reasons.push(
      `estruturas divergentes acima do limite: ${divergentStructures}/${criteria.maximumDivergentStructures}`,
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
    sanitizedRealWorkbooks,
    duplicateSanitizedRealWorkbooks,
    unidentifiedSanitizedRealWorkbooks,
    comparedCells,
    divergentCells,
    divergentCellRatio,
    comparedStructures,
    divergentStructures,
    p95ElapsedMs,
    reasons,
  };
}

export function assessWasmPromotionByFormat(
  observations: WasmCorpusObservation[],
  criteria: WasmPromotionCriteria = DEFAULT_WASM_PROMOTION_CRITERIA,
): Record<string, WasmPromotionAssessment> {
  const formats = new Set(observations.map((observation) => observation.format));
  return Object.fromEntries(
    [...formats].sort().map((format) => [
      format,
      assessWasmPromotion(
        observations.filter((observation) => observation.format === format),
        criteria,
      ),
    ]),
  );
}
