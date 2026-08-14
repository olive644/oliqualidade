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
  source: WasmCorpusObservation["source"];
  features: string[];
};

type GeneratedManifest = {
  schemaVersion: string;
  cases: GeneratedCase[];
};

const generatedRoot = "test-fixtures/generated";
const generatedManifestPath = join(generatedRoot, "manifest.generated.json");
const sanitizedRoot = process.env["OLI_SANITIZED_CORPUS_DIR"] ?? "test-fixtures/sanitized-real";
const sanitizedManifestPath = join(sanitizedRoot, "manifest.local.json");
const wasm = readFileSync(
  new URL("../wasm/oli-ooxml-core/oli_ooxml_core_bg.wasm", import.meta.url),
);
initSync({ module: wasm });

function observation(
  report: WorkbookReadReport,
  format: string,
  source: WasmCorpusObservation["source"],
  corpusId?: string,
): WasmCorpusObservation {
  return {
    format,
    source,
    corpusId,
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
      wasmSampleRate: 0,
      wasmReaderMode: "candidate",
      wasmCandidateFormats: ["xlsx"],
    });
    expect(result.report.reader).toBe("rust-wasm");
    expect(result.report.wasmSchemaVersion).toBe("3.0.0");
    expect(result.report.wasmShadowStatus).toMatch(/^(matched|diverged)$/);
    expect(result.report.wasmCandidateStatus).toBe("primary");
    expect(result.report.wasmFallbackReason).toBeNull();
    expect(result.report.wasmOutputUsed).toBe(true);
    expect(result.report.wasmSampleRate).toBe(1);
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
        const measured = observation(
          result.report,
          testCase.format,
          testCase.source,
          testCase.id,
        );
        observations.push(measured);
        cases.push({ id: testCase.id, features: testCase.features, ...measured });
      }

      const syntheticAssessment = assessWasmPromotion(observations);
      expect(syntheticAssessment.measuredWorkbooks).toBe(25);
      expect(syntheticAssessment.comparedCells).toBeGreaterThanOrEqual(10_000);
      expect(syntheticAssessment.failedWorkbooks).toBe(0);
      expect(syntheticAssessment.sanitizedRealWorkbooks).toBe(0);
      expect(syntheticAssessment.eligible).toBe(false);
      expect(syntheticAssessment.reasons).toEqual(
        expect.arrayContaining([expect.stringContaining("corpus real sanitizado insuficiente")]),
      );

      let sanitizedManifest: GeneratedManifest | undefined;
      if (existsSync(sanitizedManifestPath)) {
        sanitizedManifest = JSON.parse(
          readFileSync(sanitizedManifestPath, "utf8"),
        ) as GeneratedManifest;
        expect(sanitizedManifest.schemaVersion).toBe("1.0.0");
        for (const testCase of sanitizedManifest.cases) {
          expect(testCase.source).toBe("sanitized-real");
          const result = await readWorkbookBytesWithEngine(
            readFileSync(join(sanitizedRoot, testCase.file)),
            testCase.file,
            undefined,
            { wasmSampleRate: 1 },
          );
          const measured = observation(
          result.report,
          testCase.format,
          testCase.source,
          testCase.id,
        );
          observations.push(measured);
          cases.push({ id: testCase.id, features: testCase.features, ...measured });
        }
      }

      const assessment = assessWasmPromotion(observations);
      const byFormat = assessWasmPromotionByFormat(observations);
      if (!sanitizedManifest?.cases.length) {
        expect(byFormat["xlsx"]?.measuredWorkbooks).toBe(25);
        expect(assessment.sanitizedRealWorkbooks).toBe(0);
        expect(assessment.eligible).toBe(false);
      } else {
        expect(assessment.sanitizedRealWorkbooks).toBe(sanitizedManifest.cases.length);
        expect(byFormat["xlsx"]?.measuredWorkbooks).toBe(25 + sanitizedManifest.cases.length);
      }

      mkdirSync("test-results", { recursive: true });
      writeFileSync(
        "test-results/wasm-corpus-report.json",
        `${JSON.stringify(
          {
            schemaVersion: "1.0.0",
            generatedManifest: manifest.schemaVersion,
            sanitizedManifest: sanitizedManifest?.schemaVersion ?? null,
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
