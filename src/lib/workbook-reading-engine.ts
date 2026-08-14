import type { SheetOption } from "@/lib/import";
import type { OoxmlInspection } from "@/lib/ooxml-reader";

export type WorkbookReaderId = "sheetjs" | "sheetjs-verified" | "ooxml-recovery";
export type WasmShadowStatus = "unavailable" | "sampled-out" | "matched" | "diverged" | "failed";

export type WorkbookReadReport = {
  reader: WorkbookReaderId;
  format: string;
  elapsedMs: number;
  parseMs: number;
  verificationMs: number;
  sheets: number;
  repairedCells: number;
  divergentCells: number;
  fallbackUsed: boolean;
  wasmAvailable: boolean;
  wasmSampleRate: number;
  wasmShadowStatus: WasmShadowStatus;
  wasmShadowMs: number;
  wasmComparedCells: number;
  wasmDivergentCells: number;
  wasmDivergentSheets: number;
  wasmSchemaVersion: string | null;
};

export type WorkbookReadResult = {
  sheets: SheetOption[];
  report: WorkbookReadReport;
};

export type WasmInventoryCell = {
  address: string;
  rawValue: string | number | boolean | null;
  displayValue: string;
  formula?: string;
};

export type WasmWorkbookInventory = {
  schemaVersion: string;
  sheets: Array<{ name: string; cells: WasmInventoryCell[] }>;
};

export type WasmWorkbookReader = {
  inventory: (bytes: Uint8Array) => Promise<WasmWorkbookInventory>;
};

export type WasmShadowComparison = {
  comparedCells: number;
  divergentCells: number;
  divergentSheets: number;
};

declare global {
  interface Window {
    __oliWorkbookWasmReader?: WasmWorkbookReader;
  }
  // O worker também pode receber o adaptador sem depender do objeto Window.
  var __oliWorkbookWasmReader: WasmWorkbookReader | undefined;
}

export function workbookFormat(fileName: string): string {
  return fileName.split(".").at(-1)?.toLowerCase() || "desconhecido";
}

/**
 * Ponto de extensão para o núcleo Rust/WASM em shadow mode. O adaptador apenas
 * inventaria o arquivo depois da leitura validada em TypeScript; seu resultado
 * é medido, nunca usado para montar ou reparar a importação do usuário.
 */
export function registeredWasmWorkbookReader(): WasmWorkbookReader | undefined {
  return globalThis.__oliWorkbookWasmReader;
}

export function registerWasmWorkbookReader(reader: WasmWorkbookReader | undefined): void {
  globalThis.__oliWorkbookWasmReader = reader;
}

export function shouldTryWasm(fileName: string): boolean {
  return /\.(xlsx|xlsm|xltx|xltm)$/i.test(fileName) && !!registeredWasmWorkbookReader();
}

export function normalizeWasmSampleRate(value: string | number | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, parsed));
}

export function configuredWasmSampleRate(): number {
  return normalizeWasmSampleRate(import.meta.env["VITE_WASM_SHADOW_SAMPLE_RATE"]);
}

/**
 * Seleciona sempre o mesmo arquivo para a mesma taxa, sem persistir nome ou
 * conteúdo. A taxa 0 desliga a medição e a taxa 1 mede todo o corpus.
 */
export function shouldSampleWasm(fileName: string, bytes: Uint8Array, sampleRate: number): boolean {
  const rate = normalizeWasmSampleRate(sampleRate);
  if (rate <= 0) return false;
  if (rate >= 1) return true;

  let hash = 0x811c9dc5;
  const update = (value: number) => {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const char of fileName.toLowerCase()) update(char.charCodeAt(0));
  for (let shift = 0; shift < 32; shift += 8) update((bytes.length >>> shift) & 0xff);
  const edge = Math.min(64, bytes.length);
  for (let index = 0; index < edge; index++) update(bytes[index]!);
  for (let index = Math.max(edge, bytes.length - edge); index < bytes.length; index++)
    update(bytes[index]!);
  return hash / 0x1_0000_0000 < rate;
}

function sameValue(left: unknown, right: unknown): boolean {
  return typeof left === "number" && typeof right === "number"
    ? Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right))
    : left === right;
}

export function compareWasmInventory(
  inventory: WasmWorkbookInventory,
  inspection: OoxmlInspection,
): WasmShadowComparison {
  const rustSheets = new Map(inventory.sheets.map((sheet) => [sheet.name, sheet]));
  const sheetNames = new Set([...rustSheets.keys(), ...inspection.sheets.keys()]);
  let comparedCells = 0;
  let divergentCells = 0;
  let divergentSheets = 0;

  for (const sheetName of sheetNames) {
    const rustSheet = rustSheets.get(sheetName);
    const typescriptSheet = inspection.sheets.get(sheetName);
    if (!rustSheet || !typescriptSheet) {
      divergentSheets++;
      divergentCells += rustSheet?.cells.length ?? typescriptSheet?.size ?? 0;
      continue;
    }
    const rustCells = new Map(rustSheet.cells.map((cell) => [cell.address, cell]));
    const addresses = new Set([...rustCells.keys(), ...typescriptSheet.keys()]);
    let sheetDiverged = false;
    for (const address of addresses) {
      const rustCell = rustCells.get(address);
      const typescriptCell = typescriptSheet.get(address);
      comparedCells++;
      if (
        !rustCell ||
        !typescriptCell ||
        !sameValue(rustCell.rawValue, typescriptCell.rawValue) ||
        rustCell.displayValue !== typescriptCell.displayValue ||
        (rustCell.formula ?? "") !== (typescriptCell.formula ?? "")
      ) {
        divergentCells++;
        sheetDiverged = true;
      }
    }
    if (sheetDiverged) divergentSheets++;
  }

  return { comparedCells, divergentCells, divergentSheets };
}
