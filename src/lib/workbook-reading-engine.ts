import type { SheetOption } from "@/lib/import";
import type { OoxmlInspection } from "@/lib/ooxml-reader";

export type WorkbookReaderId =
  "sheetjs" | "sheetjs-verified" | "rust-wasm" | "ooxml-recovery" | "csv-progressivo";
export type WasmShadowStatus = "unavailable" | "sampled-out" | "matched" | "diverged" | "failed";
export type WasmReaderMode = "shadow" | "candidate";
export type WasmCandidateStatus = "shadow" | "not-eligible" | "primary" | "fallback";
export type WasmFallbackReason =
  "unavailable" | "schema-mismatch" | "diverged" | "output-diverged" | "failed";

export const WASM_INVENTORY_SCHEMA_VERSION = "3.0.0";
const WASM_CANDIDATE_FORMATS = new Set(["xlsx"]);

export type WorkbookReadReport = {
  reader: WorkbookReaderId;
  format: string;
  elapsedMs: number;
  parseMs: number;
  verificationMs: number;
  analysisMs: number;
  /** Tamanho em bytes do arquivo como recebido (compactado, para ZIP/OOXML). */
  sourceBytes: number;
  /** Tamanho descompactado estimado a partir do diretório central do ZIP; igual a `sourceBytes` para formatos sem compressão (CSV/TXT). */
  expandedBytes: number;
  /** Quantidade de posições percorridas dentro dos intervalos usados das abas. */
  visitedCells: number;
  /** Estimativa conservadora do pico de memória, nunca apresentada como medição real. */
  estimatedPeakMemoryBytes: number;
  sheets: number;
  repairedCells: number;
  divergentCells: number;
  fallbackUsed: boolean;
  wasmAvailable: boolean;
  wasmReaderMode: WasmReaderMode;
  wasmCandidateStatus: WasmCandidateStatus;
  wasmFallbackReason: WasmFallbackReason | null;
  wasmOutputUsed: boolean;
  wasmSampleRate: number;
  wasmShadowStatus: WasmShadowStatus;
  wasmShadowMs: number;
  wasmComparedCells: number;
  wasmDivergentCells: number;
  wasmComparedStructures: number;
  wasmDivergentStructures: number;
  wasmDivergentSheets: number;
  wasmSchemaVersion: string | null;
};

export function estimateWorkbookPeakMemoryBytes({
  sourceBytes,
  expandedBytes,
  visitedCells,
}: {
  sourceBytes: number;
  expandedBytes: number;
  visitedCells: number;
}): number {
  // O pacote de origem, até duas representações descompactadas e uma margem
  // de 160 bytes por célula cobrem XML, objetos do parser e dados normalizados.
  // É uma estimativa de planejamento, não uma leitura da memória do navegador.
  return Math.round(
    Math.max(0, sourceBytes) + Math.max(0, expandedBytes) * 2 + Math.max(0, visitedCells) * 160,
  );
}

/**
 * Estimativa de pico para o caminho progressivo de CSV.
 *
 * A formula acima descreve outro programa: ela soma o pacote de origem e duas
 * representacoes descompactadas porque, no caminho atual, as tres existem ao
 * mesmo tempo. No caminho progressivo nenhuma delas existe. O arquivo atravessa
 * como fluxo e nunca vira `ArrayBuffer`, a worksheet do SheetJS nao e
 * construida, e o que fica vivo ao mesmo tempo e a grade mais as linhas
 * normalizadas.
 *
 * Os bytes por celula sao medidos, e nao estimados: em 120 mil linhas por 8
 * colunas (960 mil celulas) o ponto mais largo do caminho progressivo ficou em
 * 34,9 MiB, ou 38,1 bytes por celula, medido em
 * `src/lib/csv-progressive-benchmark.test.ts`. O valor usado e arredondado para
 * cima, pelo mesmo motivo conservador da razao de 6x do seletor: numa
 * estimativa de pico, errar para baixo e o erro caro.
 *
 * Reaproveitar a constante do caminho atual apresentaria um pico varias vezes
 * maior do que este programa produz, e o numero apareceria no diagnostico de
 * importacao como se fosse deste caminho.
 */
export function estimateProgressiveCsvPeakMemoryBytes({ cells }: { cells: number }): number {
  return Math.round(Math.max(0, cells) * 40);
}

export type WorkbookReadResult = {
  sheets: SheetOption[];
  report: WorkbookReadReport;
};

export type WasmInventoryCell = {
  address: string;
  rawValue: string | number | boolean | null;
  displayValue: string;
  cellType?: "Blank" | "Number" | "Boolean" | "String" | "Error" | "Date";
  styleIndex?: number;
  numberFormat?: string;
  dateValue?: string;
  formula?: string;
};

export type WasmWorkbookInventory = {
  schemaVersion: string;
  dateSystem?: "1900" | "1904";
  sheets: Array<{
    name: string;
    actualDimension?: {
      start: string;
      end: string;
      rows: number;
      columns: number;
      cellCount: number;
    };
    mergedRanges: string[];
    hiddenRows: number[];
    hiddenColumns: Array<{ start: number; end: number }>;
    cells: WasmInventoryCell[];
  }>;
};

export type WasmWorkbookReader = {
  inventory: (bytes: Uint8Array) => Promise<WasmWorkbookInventory>;
};

export type WasmShadowComparison = {
  comparedCells: number;
  divergentCells: number;
  comparedStructures: number;
  divergentStructures: number;
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
 * Ponto de extensão para o núcleo Rust/WASM. Em candidate mode o inventário
 * pode materializar a saída depois de passar pelas comparações de paridade; em
 * shadow mode ele continua sendo apenas medido.
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

export function normalizeWasmReaderMode(value: string | undefined): WasmReaderMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "candidate") return "candidate";
  return "shadow";
}

export function configuredWasmReaderMode(): WasmReaderMode {
  return normalizeWasmReaderMode(import.meta.env["VITE_WASM_READER_MODE"]);
}

export function normalizeWasmCandidateFormats(
  value: string | readonly string[] | undefined,
): string[] {
  const formats: readonly string[] =
    typeof value === "string" ? value.split(",") : (value ?? ["xlsx"]);
  return [
    ...new Set(
      formats
        .map((format) => format.trim().toLowerCase())
        .filter((format) => WASM_CANDIDATE_FORMATS.has(format)),
    ),
  ].sort();
}

export function configuredWasmCandidateFormats(): string[] {
  return normalizeWasmCandidateFormats(import.meta.env["VITE_WASM_CANDIDATE_FORMATS"]);
}

export function canUseWasmCandidate(format: string, candidateFormats: readonly string[]): boolean {
  return WASM_CANDIDATE_FORMATS.has(format) && candidateFormats.includes(format);
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
  let comparedStructures = 0;
  let divergentStructures = 0;
  let divergentSheets = 0;

  for (const sheetName of sheetNames) {
    const rustSheet = rustSheets.get(sheetName);
    const typescriptSheet = inspection.sheets.get(sheetName);
    const typescriptStructure = inspection.structures.get(sheetName);
    if (!rustSheet || !typescriptSheet) {
      divergentSheets++;
      divergentCells += rustSheet?.cells.length ?? typescriptSheet?.size ?? 0;
      divergentStructures += rustSheet
        ? rustSheet.mergedRanges.length +
          rustSheet.hiddenRows.length +
          rustSheet.hiddenColumns.length
        : (typescriptStructure?.mergedRanges.length ?? 0) +
          (typescriptStructure?.hiddenRows.length ?? 0) +
          (typescriptStructure?.hiddenColumns.length ?? 0);
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
    const rustStructures = new Set([
      ...rustSheet.mergedRanges.map((range) => `merge:${range.replaceAll("$", "").toUpperCase()}`),
      ...rustSheet.hiddenRows.map((row) => `row:${row}`),
      ...rustSheet.hiddenColumns.map(({ start, end }) => `column:${start}:${end}`),
    ]);
    const typescriptStructures = new Set([
      ...(typescriptStructure?.mergedRanges ?? []).map(
        (range) => `merge:${range.replaceAll("$", "").toUpperCase()}`,
      ),
      ...(typescriptStructure?.hiddenRows ?? []).map((row) => `row:${row}`),
      ...(typescriptStructure?.hiddenColumns ?? []).map(
        ({ start, end }) => `column:${start}:${end}`,
      ),
    ]);
    for (const structure of new Set([...rustStructures, ...typescriptStructures])) {
      comparedStructures++;
      if (!rustStructures.has(structure) || !typescriptStructures.has(structure)) {
        divergentStructures++;
        sheetDiverged = true;
      }
    }
    if (sheetDiverged) divergentSheets++;
  }

  return {
    comparedCells,
    divergentCells,
    comparedStructures,
    divergentStructures,
    divergentSheets,
  };
}

/**
 * Qual motor produziu o resultado e se houve fallback é calculado pelo
 * Reading Engine em toda importação, mas nunca chegava à interface —
 * informação de confiança (leitor usado, fallback utilizado) que o
 * usuário não conseguia ver. Só descreve estados informativos: o caminho
 * comum (`sheetjs-verified` sem fallback) não gera nenhuma linha.
 */
export function describeReaderOutcome(report: WorkbookReadReport): string[] {
  const messages: string[] = [];
  if (report.repairedCells) {
    messages.push(
      `Leitura conferida por dois motores: ${report.repairedCells} célula(s) recuperada(s) automaticamente.`,
    );
  }
  if (report.reader === "rust-wasm") {
    messages.push(
      "Processado pelo núcleo Rust, validado célula a célula contra o motor TypeScript antes de ser aceito.",
    );
  } else if (report.fallbackUsed) {
    messages.push(
      "O leitor rápido em Rust não pôde ser usado para este arquivo; a leitura seguiu pelo motor TypeScript padrão, sem perda de dados.",
    );
  }
  return messages;
}
