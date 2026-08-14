import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { readWorkbookBytesWithEngine } from "@/lib/workbook-reader";
import { registerWasmWorkbookReader } from "@/lib/workbook-reading-engine";
import { assessWasmPromotion } from "@/lib/wasm-shadow-metrics";
import { initSync, inventory_ooxml_json } from "@/wasm/oli-ooxml-core/oli_ooxml_core.js";

const wasm = readFileSync(
  new URL("../wasm/oli-ooxml-core/oli_ooxml_core_bg.wasm", import.meta.url),
);
initSync({ module: wasm });

describe("corpus público com o binário WASM real", () => {
  afterEach(() => registerWasmWorkbookReader(undefined));

  it("mede paridade sem promover um corpus ainda insuficiente", async () => {
    const bytes = readFileSync(
      new URL("../../test-fixtures/problematic-import.xlsx", import.meta.url),
    );
    registerWasmWorkbookReader({
      inventory: async (input) => JSON.parse(inventory_ooxml_json(input)),
    });

    const result = await readWorkbookBytesWithEngine(bytes, "problematic-import.xlsx", undefined, {
      wasmSampleRate: 1,
    });
    expect(result.report.wasmSchemaVersion).toBe("3.0.0");
    expect(result.report.wasmShadowStatus).toMatch(/^(matched|diverged)$/);
    expect(result.report.wasmComparedCells).toBeGreaterThan(0);

    console.info("Métrica do corpus WASM", {
      arquivo: "problematic-import.xlsx",
      estado: result.report.wasmShadowStatus,
      celulasComparadas: result.report.wasmComparedCells,
      celulasDivergentes: result.report.wasmDivergentCells,
      abasDivergentes: result.report.wasmDivergentSheets,
      tempoMs: result.report.wasmShadowMs,
    });

    const assessment = assessWasmPromotion([
      {
        status: result.report.wasmShadowStatus,
        schemaVersion: result.report.wasmSchemaVersion,
        comparedCells: result.report.wasmComparedCells,
        divergentCells: result.report.wasmDivergentCells,
        divergentSheets: result.report.wasmDivergentSheets,
        elapsedMs: result.report.wasmShadowMs,
      },
    ]);
    expect(assessment.eligible).toBe(false);
    expect(assessment.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("corpus insuficiente")]),
    );
  });
});
