import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbookReadReport } from "@/lib/workbook-reading-engine";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
};

function baseReport(overrides: Partial<WorkbookReadReport> = {}): WorkbookReadReport {
  return {
    reader: "sheetjs-verified",
    format: "xlsx",
    elapsedMs: 120,
    parseMs: 90,
    verificationMs: 30,
    analysisMs: 20,
    sourceBytes: 5000,
    expandedBytes: 20000,
    visitedCells: 100,
    estimatedPeakMemoryBytes: 61000,
    sheets: 2,
    repairedCells: 0,
    divergentCells: 0,
    fallbackUsed: false,
    wasmAvailable: true,
    wasmReaderMode: "candidate",
    wasmCandidateStatus: "primary",
    wasmFallbackReason: null,
    wasmOutputUsed: true,
    wasmSampleRate: 1,
    wasmShadowStatus: "matched",
    wasmShadowMs: 15,
    wasmComparedCells: 40,
    wasmDivergentCells: 0,
    wasmComparedStructures: 2,
    wasmDivergentStructures: 0,
    wasmDivergentSheets: 0,
    wasmSchemaVersion: "3.0.0",
    ...overrides,
  };
}

describe("import-metrics: construção de entradas", () => {
  it("mapeia campos numéricos e de reader de um relatório bem-sucedido, sem dado de planilha", async () => {
    const { buildImportMetricEntry } = await import("./import-metrics");
    const entry = buildImportMetricEntry(baseReport(), 1_700_000_000_000);
    expect(entry).toEqual({
      timestamp: 1_700_000_000_000,
      format: "xlsx",
      failed: false,
      reader: "sheetjs-verified",
      elapsedMs: 120,
      parseMs: 90,
      verificationMs: 30,
      analysisMs: 20,
      sourceBytes: 5000,
      expandedBytes: 20000,
      visitedCells: 100,
      estimatedPeakMemoryBytes: 61000,
      sheets: 2,
      repairedCells: 0,
      divergentCells: 0,
      fallbackUsed: false,
      wasmAvailable: true,
      wasmOutputUsed: true,
      wasmShadowStatus: "matched",
      wasmShadowMs: 15,
      wasmFallbackReason: null,
      wasmComparedCells: 40,
      wasmDivergentCells: 0,
      errorMessage: null,
    });
  });

  it("registra falha com mensagem truncada, sem reader nem contagens", async () => {
    const { buildFailedImportMetricEntry } = await import("./import-metrics");
    const longMessage = "A".repeat(500);
    const entry = buildFailedImportMetricEntry(new Error(longMessage), "csv", 42);
    expect(entry.failed).toBe(true);
    expect(entry.reader).toBeNull();
    expect(entry.format).toBe("csv");
    expect(entry.timestamp).toBe(42);
    expect(entry.errorMessage).toHaveLength(200);
    expect(entry.sheets).toBe(0);
  });

  it("usa mensagem genérica quando o erro não é uma instância de Error", async () => {
    const { buildFailedImportMetricEntry } = await import("./import-metrics");
    const entry = buildFailedImportMetricEntry("string solta", "xlsx");
    expect(entry.errorMessage).toBe("Erro desconhecido na importação.");
  });
});

describe("import-metrics: persistência", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("indexedDB", undefined);
    vi.resetModules();
  });

  it("acumula entradas registradas e as recupera na ordem de inserção", async () => {
    const { buildImportMetricEntry, recordImportMetric } = await import("./import-metrics");
    const { loadImportMetrics } = await import("./storage");
    await recordImportMetric(buildImportMetricEntry(baseReport(), 1));
    await recordImportMetric(buildImportMetricEntry(baseReport({ reader: "rust-wasm" }), 2));
    const stored = await loadImportMetrics();
    expect(stored.map((entry) => entry.timestamp)).toEqual([1, 2]);
    expect(stored[1]?.reader).toBe("rust-wasm");
  });

  it("limita o histórico às últimas 200 entradas", async () => {
    const { buildImportMetricEntry, recordImportMetric } = await import("./import-metrics");
    const { loadImportMetrics } = await import("./storage");
    for (let i = 0; i < 205; i++) {
      await recordImportMetric(buildImportMetricEntry(baseReport(), i));
    }
    const stored = await loadImportMetrics();
    expect(stored).toHaveLength(200);
    expect(stored[0]?.timestamp).toBe(5);
    expect(stored[stored.length - 1]?.timestamp).toBe(204);
  });

  it("em modo privado, grava só em sessionStorage e não em localStorage", async () => {
    const { buildImportMetricEntry, recordImportMetric } = await import("./import-metrics");
    const { IMPORT_METRICS_KEY, loadImportMetrics, setPrivateMode } = await import("./storage");
    setPrivateMode(true);
    await recordImportMetric(buildImportMetricEntry(baseReport(), 7));
    expect(localStorage.getItem(IMPORT_METRICS_KEY)).toBeNull();
    expect((await loadImportMetrics())[0]?.timestamp).toBe(7);
  });

  it("limpa o histórico armazenado", async () => {
    const { buildImportMetricEntry, clearImportMetrics, recordImportMetric } =
      await import("./import-metrics");
    const { loadImportMetrics } = await import("./storage");
    await recordImportMetric(buildImportMetricEntry(baseReport(), 1));
    await clearImportMetrics();
    expect(await loadImportMetrics()).toEqual([]);
  });
});

describe("import-metrics: agregação", () => {
  it("resume tempo médio por leitor, fallback e divergências do shadow mode", async () => {
    const { buildFailedImportMetricEntry, buildImportMetricEntry, summarizeImportMetrics } =
      await import("./import-metrics");
    const entries = [
      buildImportMetricEntry(baseReport({ reader: "sheetjs-verified", elapsedMs: 100 }), 1),
      buildImportMetricEntry(baseReport({ reader: "sheetjs-verified", elapsedMs: 200 }), 2),
      buildImportMetricEntry(
        baseReport({ reader: "rust-wasm", elapsedMs: 40, wasmShadowStatus: "matched" }),
        3,
      ),
      buildImportMetricEntry(
        baseReport({
          reader: "sheetjs-verified",
          fallbackUsed: true,
          wasmShadowStatus: "diverged",
        }),
        4,
      ),
      buildFailedImportMetricEntry(new Error("falhou"), "xlsx", 5),
    ];

    const summary = summarizeImportMetrics(entries);

    expect(summary.totalImports).toBe(5);
    expect(summary.failedImports).toBe(1);
    expect(summary.byReader["sheetjs-verified"]).toBe(3);
    expect(summary.byReader["rust-wasm"]).toBe(1);
    expect(summary.avgElapsedMsByReader["sheetjs-verified"]).toBeCloseTo((100 + 200 + 120) / 3);
    expect(summary.avgElapsedMsByReader["rust-wasm"]).toBe(40);
    expect(summary.fallbackCount).toBe(1);
    expect(summary.wasmShadowMatched).toBe(3);
    expect(summary.wasmShadowDiverged).toBe(1);
    expect(summary.avgVisitedCells).toBe(100);
    expect(summary.maxEstimatedPeakMemoryBytes).toBe(61000);
    expect(summary.avgParseMs).toBe(90);
    expect(summary.avgVerificationMs).toBe(30);
    expect(summary.avgAnalysisMs).toBe(20);
  });
});
