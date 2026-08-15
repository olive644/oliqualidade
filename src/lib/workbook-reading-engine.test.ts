import { describe, expect, it } from "vitest";

import {
  canUseWasmCandidate,
  compareWasmInventory,
  describeReaderOutcome,
  normalizeWasmCandidateFormats,
  normalizeWasmReaderMode,
  normalizeWasmSampleRate,
  registerWasmWorkbookReader,
  registeredWasmWorkbookReader,
  shouldSampleWasm,
  shouldTryWasm,
  workbookFormat,
  type WorkbookReadReport,
} from "@/lib/workbook-reading-engine";
import type { OoxmlInspection } from "@/lib/ooxml-reader";

function baseReport(overrides: Partial<WorkbookReadReport> = {}): WorkbookReadReport {
  return {
    reader: "sheetjs-verified",
    format: "xlsx",
    elapsedMs: 10,
    parseMs: 5,
    verificationMs: 5,
    sheets: 1,
    repairedCells: 0,
    divergentCells: 0,
    fallbackUsed: false,
    wasmAvailable: false,
    wasmReaderMode: "shadow",
    wasmCandidateStatus: "not-eligible",
    wasmFallbackReason: null,
    wasmOutputUsed: false,
    wasmSampleRate: 1,
    wasmShadowStatus: "unavailable",
    wasmShadowMs: 0,
    wasmComparedCells: 0,
    wasmDivergentCells: 0,
    wasmComparedStructures: 0,
    wasmDivergentStructures: 0,
    wasmDivergentSheets: 0,
    wasmSchemaVersion: null,
    ...overrides,
  };
}

describe("contrato do Reading Engine v2", () => {
  it("reconhece o formato sem depender do nome completo", () => {
    expect(workbookFormat("Plano de Produção.XLSX")).toBe("xlsx");
    expect(workbookFormat("sem-extensao")).toBe("sem-extensao");
  });

  it("não tenta o adaptador WASM quando ele não foi registrado", () => {
    registerWasmWorkbookReader(undefined);
    expect(registeredWasmWorkbookReader()).toBeUndefined();
    expect(shouldTryWasm("relatorio.xlsx")).toBe(false);
  });

  it("normaliza e aplica uma amostragem WASM determinística", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(normalizeWasmSampleRate(-1)).toBe(0);
    expect(normalizeWasmSampleRate("0.25")).toBe(0.25);
    expect(normalizeWasmSampleRate(2)).toBe(1);
    expect(normalizeWasmSampleRate("inválido")).toBe(1);
    expect(shouldSampleWasm("relatorio.xlsx", bytes, 0)).toBe(false);
    expect(shouldSampleWasm("relatorio.xlsx", bytes, 1)).toBe(true);
    expect(shouldSampleWasm("relatorio.xlsx", bytes, 0.5)).toBe(
      shouldSampleWasm("relatorio.xlsx", bytes, 0.5),
    );
  });

  it("ativa o modo candidato por padrão, ainda restrito ao XLSX", () => {
    expect(normalizeWasmReaderMode(undefined)).toBe("candidate");
    expect(normalizeWasmReaderMode("CANDIDATE")).toBe("candidate");
    expect(normalizeWasmReaderMode("qualquer")).toBe("shadow");
    expect(normalizeWasmCandidateFormats(undefined)).toEqual(["xlsx"]);
    expect(normalizeWasmCandidateFormats(" xlsx, XLSM, xlsx, xltx ")).toEqual(["xlsx"]);
    expect(canUseWasmCandidate("xlsx", ["xlsx"])).toBe(true);
    expect(canUseWasmCandidate("xlsm", ["xlsx", "xlsm"])).toBe(false);
    expect(canUseWasmCandidate("xlsx", [])).toBe(false);
  });

  it("compara células do inventário WASM sem modificar o leitor TypeScript", () => {
    const inspection = {
      sheets: new Map([
        [
          "Dados",
          new Map([
            ["A1", { address: "A1", rawValue: "Produto", displayValue: "Produto" }],
            ["A2", { address: "A2", rawValue: 42, displayValue: "42" }],
          ]),
        ],
      ]),
      structures: new Map([
        [
          "Dados",
          {
            mergedRanges: ["A1:B1"],
            hiddenRows: [3],
            hiddenColumns: [{ start: 4, end: 5 }],
          },
        ],
      ]),
      workbook: { SheetNames: [], Sheets: {} },
    } satisfies OoxmlInspection;

    expect(
      compareWasmInventory(
        {
          schemaVersion: "3.0.0",
          sheets: [
            {
              name: "Dados",
              mergedRanges: ["A1:B1"],
              hiddenRows: [3],
              hiddenColumns: [{ start: 4, end: 6 }],
              cells: [
                { address: "A1", rawValue: "Produto", displayValue: "Produto" },
                { address: "A2", rawValue: 43, displayValue: "43" },
              ],
            },
          ],
        },
        inspection,
      ),
    ).toEqual({
      comparedCells: 2,
      divergentCells: 1,
      comparedStructures: 4,
      divergentStructures: 2,
      divergentSheets: 1,
    });
  });

  it("não descreve nada no caminho comum (sheetjs-verified, sem reparo)", () => {
    expect(describeReaderOutcome(baseReport())).toEqual([]);
  });

  it("explica quando o núcleo Rust produziu o resultado", () => {
    const messages = describeReaderOutcome(baseReport({ reader: "rust-wasm" }));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("núcleo Rust");
  });

  it("explica quando houve fallback do Rust para o motor TypeScript", () => {
    const messages = describeReaderOutcome(
      baseReport({ reader: "sheetjs-verified", fallbackUsed: true }),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("motor TypeScript padrão");
  });

  it("combina a mensagem de células reparadas com a do leitor Rust", () => {
    const messages = describeReaderOutcome(baseReport({ reader: "rust-wasm", repairedCells: 3 }));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("3 célula(s) recuperada(s)");
    expect(messages[1]).toContain("núcleo Rust");
  });

  it("prioriza o estado 'processado pelo Rust' sobre o de fallback quando ambos poderiam se aplicar", () => {
    // reader "rust-wasm" e fallbackUsed nunca coexistem de verdade (o
    // fallback só ocorre quando o Rust NÃO foi usado), mas a função não
    // deve emitir as duas mensagens contraditórias se isso acontecer.
    const messages = describeReaderOutcome(baseReport({ reader: "rust-wasm", fallbackUsed: true }));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("núcleo Rust");
  });
});
