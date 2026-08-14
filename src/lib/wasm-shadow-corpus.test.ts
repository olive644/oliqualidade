import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readWorkbookBytesWithEngine } from "@/lib/workbook-reader";
import { registerWasmWorkbookReader, type WorkbookReadReport } from "@/lib/workbook-reading-engine";
import {
  assessWasmPromotion,
  assessWasmPromotionByFormat,
  type WasmCorpusObservation,
} from "@/lib/wasm-shadow-metrics";
import { initSync, inventory_ooxml_json } from "@/wasm/oli-ooxml-core/oli_ooxml_core.js";

type GeneratedCase = {
  id: string;
  file: string;
  format: string;
  source: "synthetic";
  features: string[];
};

type GeneratedManifest = {
  schemaVersion: string;
  cases: GeneratedCase[];
};

const generatedRoot = "test-fixtures/generated";
const generatedManifestPath = join(generatedRoot, "manifest.generated.json");
const wasm = readFileSync(
  new URL("../wasm/oli-ooxml-core/oli_ooxml_core_bg.wasm", import.meta.url),
);
initSync({ module: wasm });

function observation(
  report: WorkbookReadReport,
  format: string,
  source: WasmCorpusObservation["source"],
): WasmCorpusObservation {
  return {
    format,
    source,
    status: report.wasmShadowStatus,
    schemaVersion: report.wasmSchemaVersion,
    comparedCells: report.wasmComparedCells,
    divergentCells: report.wasmDivergentCells,
    comparedStructures: report.wasmComparedStructures,
    divergentStructures: report.wasmDivergentStructures,
    divergentSheets: report.wasmDivergentSheets,
    elapsedMs: report.wasmShadowMs,
  };
}

describe("corpus público com o binário WASM real", () => {
  beforeAll(() => {
    registerWasmWorkbookReader({
      inventory: async (input) => JSON.parse(inventory_ooxml_json(input)),
    });
  });
  afterAll(() => registerWasmWorkbookReader(undefined));

  it("mede paridade sem promover uma fixture isolada", async () => {
    const bytes = readFileSync(
      new URL("../../test-fixtures/problematic-import.xlsx", import.meta.url),
    );
    const result = await readWorkbookBytesWithEngine(bytes, "problematic-import.xlsx", undefined, {
      wasmSampleRate: 1,
    });
    expect(result.report.wasmSchemaVersion).toBe("3.0.0");
    expect(result.report.wasmShadowStatus).toMatch(/^(matched|diverged)$/);
    expect(result.report.wasmComparedCells).toBeGreaterThan(0);

    const assessment = assessWasmPromotion([observation(result.report, "xlsx", "synthetic")]);
    expect(assessment.eligible).toBe(false);
    expect(assessment.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("corpus insuficiente"),
        expect.stringContaining("corpus real sanitizado insuficiente"),
      ]),
    );
  });
});

describe.skipIf(!existsSync(generatedManifestPath))(
  "corpus sintético reproduzível com o binário WASM real",
  () => {
    beforeAll(() => {
      registerWasmWorkbookReader({
        inventory: async (input) => JSON.parse(inventory_ooxml_json(input)),
      });
    });
    afterAll(() => registerWasmWorkbookReader(undefined));

    it("mede volume, cobertura estrutural e promoção por formato", async () => {
      const manifest = JSON.parse(readFileSync(generatedManifestPath, "utf8")) as GeneratedManifest;
      expect(manifest.schemaVersion).toBe("1.0.0");
      expect(manifest.cases).toHaveLength(25);

      const observations: WasmCorpusObservation[] = [];
      const cases = [];
      for (const testCase of manifest.cases) {
        const result = await readWorkbookBytesWithEngine(
          readFileSync(join(generatedRoot, testCase.file)),
          testCase.file,
          undefined,
          { wasmSampleRate: 1 },
        );
        const measured = observation(result.report, testCase.format, testCase.source);
        observations.push(measured);
        cases.push({ id: testCase.id, features: testCase.features, ...measured });
      }

      const assessment = assessWasmPromotion(observations);
      const byFormat = assessWasmPromotionByFormat(observations);
      expect(assessment.measuredWorkbooks).toBe(25);
      expect(assessment.comparedCells).toBeGreaterThanOrEqual(10_000);
      expect(assessment.failedWorkbooks).toBe(0);
      expect(assessment.sanitizedRealWorkbooks).toBe(0);
      expect(assessment.eligible).toBe(false);
      expect(assessment.reasons).toEqual(
        expect.arrayContaining([expect.stringContaining("corpus real sanitizado insuficiente")]),
      );
      expect(byFormat["xlsx"]?.measuredWorkbooks).toBe(25);

      mkdirSync("test-results", { recursive: true });
      writeFileSync(
        "test-results/wasm-corpus-report.json",
        `${JSON.stringify(
          {
            schemaVersion: "1.0.0",
            generatedManifest: manifest.schemaVersion,
            assessment,
            byFormat,
            cases,
          },
          null,
          2,
        )}\n`,
      );
      console.info("Métrica agregada do corpus WASM", assessment);
    }, 30_000);
  },
);
