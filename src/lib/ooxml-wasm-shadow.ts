import initWasm, { inventory_ooxml_json } from "@/wasm/oli-ooxml-core/oli_ooxml_core.js";

import {
  registerWasmWorkbookReader,
  type WasmWorkbookInventory,
} from "@/lib/workbook-reading-engine";

let initialization: Promise<unknown> | undefined;

function isInventory(value: unknown): value is WasmWorkbookInventory {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WasmWorkbookInventory>;
  return (
    typeof candidate.schemaVersion === "string" &&
    Array.isArray(candidate.sheets) &&
    candidate.sheets.every(
      (sheet) =>
        !!sheet &&
        typeof sheet === "object" &&
        typeof sheet.name === "string" &&
        Array.isArray(sheet.cells) &&
        sheet.cells.every(
          (cell) =>
            !!cell &&
            typeof cell === "object" &&
            typeof cell.address === "string" &&
            typeof cell.displayValue === "string" &&
            (cell.formula === undefined || typeof cell.formula === "string") &&
            (cell.rawValue === null ||
              typeof cell.rawValue === "string" ||
              typeof cell.rawValue === "number" ||
              typeof cell.rawValue === "boolean"),
        ),
    )
  );
}

export async function inventoryWorkbookWithWasm(bytes: Uint8Array): Promise<WasmWorkbookInventory> {
  initialization ??= initWasm();
  await initialization;
  const parsed: unknown = JSON.parse(inventory_ooxml_json(bytes));
  if (!isInventory(parsed)) throw new Error("O inventário WASM retornou um contrato inválido.");
  return parsed;
}

registerWasmWorkbookReader({ inventory: inventoryWorkbookWithWasm });
