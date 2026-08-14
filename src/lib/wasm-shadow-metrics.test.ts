import { describe, expect, it } from "vitest";

import {
  assessWasmPromotion,
  assessWasmPromotionByFormat,
  type WasmCorpusObservation,
  type WasmPromotionCriteria,
} from "@/lib/wasm-shadow-metrics";

const permissiveCriteria: WasmPromotionCriteria = {
  requiredSchemaVersion: "3.0.0",
  minimumWorkbooks: 2,
  minimumComparedCells: 100,
  minimumSanitizedRealWorkbooks: 0,
  maximumFailedWorkbooks: 0,
  maximumDivergentWorkbooks: 0,
  maximumDivergentCellRatio: 0,
  maximumDivergentStructures: 0,
  maximumP95ElapsedMs: 100,
};

const matched = (elapsedMs: number): WasmCorpusObservation => ({
  format: "xlsx",
  source: "synthetic",
  status: "matched",
  schemaVersion: "3.0.0",
  comparedCells: 50,
  divergentCells: 0,
  comparedStructures: 2,
  divergentStructures: 0,
  divergentSheets: 0,
  elapsedMs,
});

describe("gate de promoção do shadow WASM", () => {
  it("aprova apenas um corpus suficiente, compatível e sem divergências", () => {
    expect(assessWasmPromotion([matched(20), matched(80)], permissiveCriteria)).toMatchObject({
      eligible: true,
      measuredWorkbooks: 2,
      matchedWorkbooks: 2,
      comparedCells: 100,
      p95ElapsedMs: 80,
      reasons: [],
    });
  });

  it("bloqueia corpus insuficiente, divergência, falha e contrato incompatível", () => {
    const assessment = assessWasmPromotion(
      [
        {
          ...matched(120),
          status: "diverged",
          schemaVersion: "2.0.0",
          divergentCells: 2,
          divergentStructures: 1,
          divergentSheets: 1,
        },
        {
          ...matched(10),
          status: "failed",
          schemaVersion: null,
          comparedCells: 0,
        },
        { ...matched(1), status: "sampled-out", comparedCells: 10_000 },
      ],
      { ...permissiveCriteria, minimumWorkbooks: 3 },
    );

    expect(assessment.eligible).toBe(false);
    expect(assessment.measuredWorkbooks).toBe(2);
    expect(assessment.divergentCellRatio).toBe(0.04);
    expect(assessment.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("corpus insuficiente"),
        expect.stringContaining("falhas acima"),
        expect.stringContaining("arquivos divergentes"),
        expect.stringContaining("taxa de divergência"),
        expect.stringContaining("estruturas divergentes"),
        expect.stringContaining("latência p95"),
        expect.stringContaining("contrato incompatível"),
      ]),
    );
  });

  it("avalia a promoção separadamente por formato", () => {
    const assessments = assessWasmPromotionByFormat(
      [matched(20), { ...matched(30), format: "xlsm" }],
      { ...permissiveCriteria, minimumWorkbooks: 1, minimumComparedCells: 50 },
    );

    expect(Object.keys(assessments)).toEqual(["xlsm", "xlsx"]);
    expect(assessments["xlsx"]?.eligible).toBe(true);
    expect(assessments["xlsm"]?.eligible).toBe(true);
  });
});
