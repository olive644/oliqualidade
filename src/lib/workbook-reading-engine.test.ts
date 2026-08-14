import { describe, expect, it } from "vitest";

import {
  compareWasmInventory,
  normalizeWasmSampleRate,
  registerWasmWorkbookReader,
  registeredWasmWorkbookReader,
  shouldSampleWasm,
  shouldTryWasm,
  workbookFormat,
} from "@/lib/workbook-reading-engine";
import type { OoxmlInspection } from "@/lib/ooxml-reader";

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
});
