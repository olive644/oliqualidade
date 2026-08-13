import type { SheetOption } from "@/lib/import";

export type WorkbookReaderId = "sheetjs" | "sheetjs-verified" | "ooxml-recovery" | "wasm";

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
};

export type WorkbookReadResult = {
  sheets: SheetOption[];
  report: WorkbookReadReport;
};

export type WasmWorkbookReader = {
  read: (
    bytes: Uint8Array,
    fileName: string,
  ) => Promise<{ sheets: SheetOption[]; repairedCells?: number; divergentCells?: number }>;
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
 * Ponto de extensão para o núcleo Rust/WASM. O app nunca depende dele para
 * importar: quando não estiver presente, o motor validado em TypeScript segue
 * sendo usado. Isso permite promover o WASM por formato e por corpus, sem
 * trocar o leitor de todos os usuários de uma vez.
 */
export function registeredWasmWorkbookReader(): WasmWorkbookReader | undefined {
  return globalThis.__oliWorkbookWasmReader;
}

export function shouldTryWasm(fileName: string): boolean {
  return /\.(xlsx|xlsm|xltx|xltm|ods)$/i.test(fileName) && !!registeredWasmWorkbookReader();
}
