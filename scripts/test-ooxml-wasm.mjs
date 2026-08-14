import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { initSync, inventory_ooxml_json } from "../src/wasm/oli-ooxml-core/oli_ooxml_core.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasm = readFileSync(join(root, "src", "wasm", "oli-ooxml-core", "oli_ooxml_core_bg.wasm"));
const fixture = readFileSync(join(root, "test-fixtures", "problematic-import.xlsx"));

initSync({ module: wasm });
const inventory = JSON.parse(inventory_ooxml_json(fixture));
if (inventory.schemaVersion !== "3.0.0")
  throw new Error(`Contrato WASM inesperado: ${inventory.schemaVersion ?? "ausente"}`);
if (inventory.sheets?.length !== 2)
  throw new Error(`Inventário WASM retornou ${inventory.sheets?.length ?? 0} abas; esperado: 2.`);
if (!inventory.sheets.some((sheet) => sheet.cells?.length > 0))
  throw new Error("Inventário WASM não retornou células para a fixture pública.");

console.log("Smoke WASM aprovado: contrato 3.0.0, 2 abas e células inventariadas.");
