import { describe, expect, it } from "vitest";

import {
  compareWasmInventory,
  registerWasmWorkbookReader,
  registeredWasmWorkbookReader,
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
      workbook: { SheetNames: [], Sheets: {} },
    } satisfies OoxmlInspection;

    expect(
      compareWasmInventory(
        {
          schemaVersion: "3.0.0",
          sheets: [
            {
              name: "Dados",
              cells: [
                { address: "A1", rawValue: "Produto", displayValue: "Produto" },
                { address: "A2", rawValue: 43, displayValue: "43" },
              ],
            },
          ],
        },
        inspection,
      ),
    ).toEqual({ comparedCells: 2, divergentCells: 1, divergentSheets: 1 });
  });
});
