import * as XLSX from "xlsx";

import { sheetsWithData, type SheetOption } from "@/lib/import";
import { unzipOoxmlArchive, type OoxmlArchive } from "@/lib/ooxml-archive";
import { attachWorkbookFeatures } from "@/lib/workbook-metadata";
import {
  compareAndRepairWithOoxml,
  inspectOoxml,
  type OoxmlInspection,
  type ReaderDivergence,
} from "@/lib/ooxml-reader";
import {
  canUseWasmCandidate,
  compareWasmInventory,
  configuredWasmCandidateFormats,
  configuredWasmReaderMode,
  configuredWasmSampleRate,
  normalizeWasmSampleRate,
  registeredWasmWorkbookReader,
  shouldSampleWasm,
  shouldTryWasm,
  workbookFormat,
  WASM_INVENTORY_SCHEMA_VERSION,
  type WorkbookReadResult,
  type WasmWorkbookInventory,
  type WasmCandidateStatus,
  type WasmFallbackReason,
  type WasmReaderMode,
  type WasmShadowStatus,
} from "@/lib/workbook-reading-engine";

export const WORKBOOK_ACCEPT =
  ".xlsx,.xlsm,.xlsb,.xls,.xltx,.xltm,.ods,.fods,.csv,.tsv,.txt,.xml,.html,.htm,.numbers";

export const WORKBOOK_FORMATS_LABEL = "XLSX, XLSM, XLSB, XLS, ODS, CSV, TSV, XML, HTML ou Numbers";

const TEXT_EXTENSIONS = /\.(csv|tsv|txt)$/i;
const ZIP_WORKBOOK_EXTENSIONS = /\.(xlsx|xlsm|xltx|xltm)$/i;
export const MAX_WORKBOOK_SHEETS = 100;
export const MAX_WORKBOOK_CELLS = 2_000_000;
export const MAX_ZIP_ENTRIES = 10_000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
export const MAX_ZIP_ENTRY_BYTES = 512 * 1024 * 1024;
export const MAX_SUSPICIOUS_COMPRESSION_RATIO = 1_000;

export type WorkbookReadProgress = "decoding" | "parsing" | "analyzing";

export type WorksheetWithReaderDiagnostics = XLSX.WorkSheet & {
  "!oliReaderDivergences"?: ReaderDivergence[];
  "!oliOoxmlFallback"?: boolean;
};

export type WorkbookReadEngineOptions = {
  wasmSampleRate?: number;
  wasmReaderMode?: WasmReaderMode;
  wasmCandidateFormats?: readonly string[];
};

/**
 * Lê somente o diretório central do ZIP, sem descompactar seu conteúdo.
 * XLSX/XLSM são pacotes ZIP e podem declarar poucos bytes compactados que
 * expandem para gigabytes. A checagem ocorre antes do SheetJS e do extrator
 * de metadados para evitar consumo abusivo de memória no navegador.
 */
export function validateZipWorkbook(bytes: Uint8Array): { totalUncompressedBytes: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const searchStart = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("O pacote da planilha está incompleto ou corrompido.");

  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entries > MAX_ZIP_ENTRIES) throw new Error("A planilha contém arquivos internos demais.");
  if (directoryOffset + directorySize > bytes.length)
    throw new Error("O pacote da planilha possui um diretório interno inválido.");

  let offset = directoryOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("O pacote da planilha possui uma entrada interna inválida.");
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (uncompressed > MAX_ZIP_ENTRY_BYTES)
      throw new Error("Uma parte interna da planilha é grande demais para leitura segura.");
    if (
      uncompressed > 50 * 1024 * 1024 &&
      uncompressed / Math.max(1, compressed) > MAX_SUSPICIOUS_COMPRESSION_RATIO
    )
      throw new Error("A planilha possui uma taxa de compressão potencialmente insegura.");
    totalUncompressed += uncompressed;
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES)
      throw new Error("A planilha ultrapassa o limite seguro após descompactação.");
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { totalUncompressedBytes: totalUncompressed };
}

export function validateWorkbookComplexity(workbook: XLSX.WorkBook): void {
  if (workbook.SheetNames.length > MAX_WORKBOOK_SHEETS)
    throw new Error(`A planilha possui mais de ${MAX_WORKBOOK_SHEETS} abas.`);
  let cells = 0;
  for (const name of workbook.SheetNames) {
    const range = workbook.Sheets[name]?.["!ref"];
    if (!range) continue;
    const decoded = XLSX.utils.decode_range(range);
    cells += (decoded.e.r - decoded.s.r + 1) * (decoded.e.c - decoded.s.c + 1);
    if (cells > MAX_WORKBOOK_CELLS)
      throw new Error(
        "A planilha ultrapassa 2 milhões de células. Divida o arquivo para evitar travamentos e perda de dados.",
      );
  }
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = bytes.subarray(2).slice();
    for (let i = 0; i + 1 < swapped.length; i += 2)
      [swapped[i], swapped[i + 1]] = [swapped[i + 1]!, swapped[i]!];
    return new TextDecoder("utf-16le").decode(swapped);
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const replacements = (utf8.match(/\uFFFD/g) ?? []).length;
  if (replacements <= Math.max(1, utf8.length * 0.001)) return utf8.replace(/^\uFEFF/, "");
  return new TextDecoder("windows-1252").decode(bytes).replace(/^\uFEFF/, "");
}

/**
 * Detecta o separador sem quebrar campos entre aspas ou com quebras de linha.
 * A pontuação mais estável nas primeiras linhas vence, não apenas a mais comum.
 */
export function detectDelimiter(text: string): "," | ";" | "\t" | "|" {
  const candidates = [",", ";", "\t", "|"] as const;
  const counts = new Map<(typeof candidates)[number], number[]>(
    candidates.map((candidate) => [candidate, []]),
  );
  let quote = false;
  let lineCounts = Object.fromEntries(candidates.map((candidate) => [candidate, 0])) as Record<
    (typeof candidates)[number],
    number
  >;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 25; i++) {
    const char = text[i]!;
    if (char === '"') {
      if (quote && text[i + 1] === '"') i++;
      else quote = !quote;
      continue;
    }
    if (!quote && candidates.includes(char as (typeof candidates)[number]))
      lineCounts[char as (typeof candidates)[number]]++;
    if (!quote && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      for (const candidate of candidates) counts.get(candidate)!.push(lineCounts[candidate]);
      lineCounts = Object.fromEntries(
        candidates.map((candidate) => [candidate, 0]),
      ) as typeof lineCounts;
      lines++;
    }
  }
  if (lines === 0 || Object.values(lineCounts).some(Boolean))
    for (const candidate of candidates) counts.get(candidate)!.push(lineCounts[candidate]);

  const score = (candidate: (typeof candidates)[number]) => {
    const allLines = counts.get(candidate)!;
    const nonZero = allLines.filter(Boolean);
    if (!nonZero.length) return -1;
    const mode = nonZero
      .map((value) => [value, nonZero.filter((other) => other === value).length] as const)
      .sort((a, b) => b[1] - a[1])[0]!;
    // Linhas sem o candidato também contam contra ele. Sem essa penalidade,
    // as vírgulas decimais de um CSV separado por ponto e vírgula parecem um
    // delimitador perfeitamente consistente nas linhas de dados, apesar de
    // não existirem no cabeçalho (ex.: Valor\n1.234,50\n2.000,00).
    return mode[0] * (mode[1] / Math.max(1, allLines.length));
  };
  return [...candidates].sort((a, b) => score(b) - score(a))[0]!;
}

function wasmCellValue(cell: WasmWorkbookInventory["sheets"][number]["cells"][number]) {
  if (cell.cellType !== "Date" || !cell.dateValue) return cell.rawValue ?? "";
  const parsed = new Date(cell.dateValue);
  return Number.isNaN(parsed.getTime()) ? (cell.rawValue ?? "") : parsed;
}

/**
 * Materializa um workbook SheetJS a partir do contrato Rust. O restante do
 * pipeline continua recebendo o mesmo tipo de worksheet, sem conhecer WASM.
 */
export function workbookFromWasmInventory(inventory: WasmWorkbookInventory): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  for (const sheet of inventory.sheets) {
    const worksheet: XLSX.WorkSheet = {};
    let calculatedRange: XLSX.Range | undefined;
    for (const sourceCell of sheet.cells) {
      const address = XLSX.utils.decode_cell(sourceCell.address);
      calculatedRange = calculatedRange
        ? {
            s: {
              r: Math.min(calculatedRange.s.r, address.r),
              c: Math.min(calculatedRange.s.c, address.c),
            },
            e: {
              r: Math.max(calculatedRange.e.r, address.r),
              c: Math.max(calculatedRange.e.c, address.c),
            },
          }
        : { s: address, e: address };
      const value = wasmCellValue(sourceCell);
      const cell: XLSX.CellObject = {
        t:
          value instanceof Date
            ? "d"
            : typeof value === "boolean"
              ? "b"
              : typeof value === "number"
                ? "n"
                : "s",
        v: value,
        w: sourceCell.displayValue,
        z: sourceCell.numberFormat ?? "General",
        ...(sourceCell.formula ? { f: sourceCell.formula.replace(/^=/, "") } : {}),
      };
      worksheet[sourceCell.address] = cell;
    }
    worksheet["!ref"] = sheet.actualDimension
      ? `${sheet.actualDimension.start}:${sheet.actualDimension.end}`
      : calculatedRange
        ? XLSX.utils.encode_range(calculatedRange)
        : "A1";
    if (sheet.mergedRanges.length)
      worksheet["!merges"] = sheet.mergedRanges.map((range) => XLSX.utils.decode_range(range));
    if (sheet.hiddenRows.length) {
      const rows: XLSX.RowInfo[] = [];
      for (const row of sheet.hiddenRows) rows[row - 1] = { hidden: true };
      worksheet["!rows"] = rows;
    }
    if (sheet.hiddenColumns.length) {
      const columns: XLSX.ColInfo[] = [];
      for (const { start, end } of sheet.hiddenColumns)
        for (let column = start; column <= end; column++) columns[column - 1] = { hidden: true };
      worksheet["!cols"] = columns;
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  return workbook;
}

function sameImportedValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (left instanceof Date || right instanceof Date)
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameImportedValue(value, right[index]))
    );
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        sameImportedValue(leftRecord[key], rightRecord[key]),
    )
  );
}

function sameImportedSheets(left: SheetOption[], right: SheetOption[]): boolean {
  return sameImportedValue(left, right);
}

function sharedOoxmlArchive(bytes: Uint8Array): OoxmlArchive | Uint8Array {
  try {
    return unzipOoxmlArchive(bytes);
  } catch {
    // Deixa cada consumidor tentar descompactar individualmente e tratar a
    // falha do próprio jeito, exatamente como antes de compartilhar o archive.
    return bytes;
  }
}

export async function readWorkbookBytesWithEngine(
  input: ArrayBuffer | Uint8Array,
  fileName: string,
  onProgress?: (progress: WorkbookReadProgress) => void,
  options: WorkbookReadEngineOptions = {},
): Promise<WorkbookReadResult> {
  const startedAt = performance.now();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  onProgress?.("decoding");
  const textFile = TEXT_EXTENSIONS.test(fileName);
  const zipInfo = ZIP_WORKBOOK_EXTENSIONS.test(fileName) ? validateZipWorkbook(bytes) : null;
  const source = textFile ? decodeText(bytes) : bytes;
  onProgress?.("parsing");
  const parseStartedAt = performance.now();
  let wb: XLSX.WorkBook;
  let fallbackUsed = false;
  try {
    wb = XLSX.read(source, {
      type: textFile ? "string" : "array",
      ...(textFile ? { FS: detectDelimiter(source as string), raw: true } : {}),
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      cellText: true,
      cellStyles: true,
      sheetStubs: true,
      bookDeps: true,
      dense: true,
      nodim: true,
      UTC: false,
    });
    if (
      ZIP_WORKBOOK_EXTENSIONS.test(fileName) &&
      (!wb.SheetNames.length || wb.SheetNames.every((name) => !wb.Sheets[name]?.["!ref"]))
    )
      throw new Error("O leitor principal não encontrou células no pacote OOXML.");
  } catch (error) {
    if (!ZIP_WORKBOOK_EXTENSIONS.test(fileName)) throw error;
    const fallback = inspectOoxml(bytes);
    wb = fallback.workbook;
    fallbackUsed = true;
    for (const sheet of Object.values(wb.Sheets))
      (sheet as WorksheetWithReaderDiagnostics)["!oliOoxmlFallback"] = true;
  }
  validateWorkbookComplexity(wb);
  const parseMs = Math.round(performance.now() - parseStartedAt);
  let repairedCells = 0;
  let divergentCells = 0;
  let independentInspection: OoxmlInspection | undefined;
  const verificationStartedAt = performance.now();
  if (ZIP_WORKBOOK_EXTENSIONS.test(fileName)) {
    const archive = sharedOoxmlArchive(bytes);
    attachWorkbookFeatures(wb, archive);
    try {
      independentInspection = inspectOoxml(archive);
      const divergences = compareAndRepairWithOoxml(wb, independentInspection);
      repairedCells = divergences.filter((item) => item.repaired).length;
      divergentCells = divergences.length;
      for (const sheetName of wb.SheetNames) {
        const perSheet = divergences.filter((item) => item.sheet === sheetName);
        if (perSheet.length)
          (wb.Sheets[sheetName] as WorksheetWithReaderDiagnostics)["!oliReaderDivergences"] =
            perSheet;
      }
    } catch {
      // O leitor principal continua válido. O fallback é uma camada de
      // verificação e nunca pode impedir a importação de um arquivo legível.
    }
  }
  onProgress?.("analyzing");
  let sheets = sheetsWithData(wb);
  const format = workbookFormat(fileName);
  const wasmReaderMode = options.wasmReaderMode ?? configuredWasmReaderMode();
  const wasmCandidateFormats = options.wasmCandidateFormats ?? configuredWasmCandidateFormats();
  const candidateEligible =
    wasmReaderMode === "candidate" && canUseWasmCandidate(format, wasmCandidateFormats);
  const wasmSampleRate = candidateEligible
    ? 1
    : options.wasmSampleRate === undefined
      ? configuredWasmSampleRate()
      : normalizeWasmSampleRate(options.wasmSampleRate);
  const registeredReader = shouldTryWasm(fileName) ? registeredWasmWorkbookReader() : undefined;
  const sampled = registeredReader
    ? candidateEligible || shouldSampleWasm(fileName, bytes, wasmSampleRate)
    : false;
  const wasmReader = sampled ? registeredReader : undefined;
  let wasmShadowStatus: WasmShadowStatus = registeredReader
    ? sampled
      ? "failed"
      : "sampled-out"
    : "unavailable";
  let wasmShadowMs = 0;
  let wasmComparedCells = 0;
  let wasmDivergentCells = 0;
  let wasmComparedStructures = 0;
  let wasmDivergentStructures = 0;
  let wasmDivergentSheets = 0;
  let wasmSchemaVersion: string | null = null;
  let wasmCandidateStatus: WasmCandidateStatus =
    wasmReaderMode === "shadow" ? "shadow" : candidateEligible ? "fallback" : "not-eligible";
  let wasmFallbackReason: WasmFallbackReason | null =
    candidateEligible && !registeredReader ? "unavailable" : null;
  let wasmOutputUsed = false;
  if (wasmReader) {
    const wasmStartedAt = performance.now();
    try {
      const inventory = await wasmReader.inventory(bytes);
      wasmSchemaVersion = inventory.schemaVersion;
      const comparison = compareWasmInventory(
        inventory,
        independentInspection ?? inspectOoxml(bytes),
      );
      wasmComparedCells = comparison.comparedCells;
      wasmDivergentCells = comparison.divergentCells;
      wasmComparedStructures = comparison.comparedStructures;
      wasmDivergentStructures = comparison.divergentStructures;
      wasmDivergentSheets = comparison.divergentSheets;
      wasmShadowStatus =
        comparison.divergentCells || comparison.divergentStructures || comparison.divergentSheets
          ? "diverged"
          : "matched";
      if (candidateEligible) {
        if (inventory.schemaVersion !== WASM_INVENTORY_SCHEMA_VERSION) {
          wasmFallbackReason = "schema-mismatch";
        } else if (wasmShadowStatus === "diverged") {
          wasmFallbackReason = "diverged";
        } else {
          const wasmWorkbook = attachWorkbookFeatures(workbookFromWasmInventory(inventory), bytes);
          const wasmSheets = sheetsWithData(wasmWorkbook);
          if (sameImportedSheets(wasmSheets, sheets)) {
            sheets = wasmSheets;
            wasmCandidateStatus = "primary";
            wasmFallbackReason = null;
            wasmOutputUsed = true;
          } else {
            wasmFallbackReason = "output-diverged";
          }
        }
      }
    } catch {
      if (candidateEligible) wasmFallbackReason = "failed";
      // Shadow e candidate mode nunca descartam o resultado do leitor validado.
    } finally {
      wasmShadowMs = Math.round(performance.now() - wasmStartedAt);
    }
  }
  return {
    sheets,
    report: {
      reader: fallbackUsed
        ? "ooxml-recovery"
        : wasmOutputUsed
          ? "rust-wasm"
          : ZIP_WORKBOOK_EXTENSIONS.test(fileName)
            ? "sheetjs-verified"
            : "sheetjs",
      format,
      elapsedMs: Math.round(performance.now() - startedAt),
      parseMs,
      verificationMs: Math.round(performance.now() - verificationStartedAt),
      sourceBytes: bytes.length,
      expandedBytes: zipInfo?.totalUncompressedBytes ?? bytes.length,
      sheets: sheets.length,
      repairedCells,
      divergentCells,
      fallbackUsed,
      wasmAvailable: !!registeredWasmWorkbookReader(),
      wasmReaderMode,
      wasmCandidateStatus,
      wasmFallbackReason,
      wasmOutputUsed,
      wasmSampleRate,
      wasmShadowStatus,
      wasmShadowMs,
      wasmComparedCells,
      wasmDivergentCells,
      wasmComparedStructures,
      wasmDivergentStructures,
      wasmDivergentSheets,
      wasmSchemaVersion,
    },
  };
}

export function readWorkbookBytes(
  input: ArrayBuffer | Uint8Array,
  fileName: string,
  onProgress?: (progress: WorkbookReadProgress) => void,
): SheetOption[] {
  // Mantém o contrato síncrono usado pelo motor, testes e SSR. O leitor WASM
  // é usado exclusivamente pelo cliente assíncrono para não forçar await em
  // todo o ecossistema existente.
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const textFile = TEXT_EXTENSIONS.test(fileName);
  if (ZIP_WORKBOOK_EXTENSIONS.test(fileName)) validateZipWorkbook(bytes);
  onProgress?.("decoding");
  const source = textFile ? decodeText(bytes) : bytes;
  onProgress?.("parsing");
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(source, {
      type: textFile ? "string" : "array",
      ...(textFile ? { FS: detectDelimiter(source as string), raw: true } : {}),
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      cellText: true,
      cellStyles: true,
      sheetStubs: true,
      bookDeps: true,
      dense: true,
      nodim: true,
      UTC: false,
    });
    if (
      ZIP_WORKBOOK_EXTENSIONS.test(fileName) &&
      (!wb.SheetNames.length || wb.SheetNames.every((name) => !wb.Sheets[name]?.["!ref"]))
    )
      throw new Error("O leitor principal não encontrou células no pacote OOXML.");
  } catch (error) {
    if (!ZIP_WORKBOOK_EXTENSIONS.test(fileName)) throw error;
    wb = inspectOoxml(bytes).workbook;
    for (const sheet of Object.values(wb.Sheets))
      (sheet as WorksheetWithReaderDiagnostics)["!oliOoxmlFallback"] = true;
  }
  validateWorkbookComplexity(wb);
  if (ZIP_WORKBOOK_EXTENSIONS.test(fileName)) {
    const archive = sharedOoxmlArchive(bytes);
    attachWorkbookFeatures(wb, archive);
    try {
      const independent = inspectOoxml(archive);
      const divergences = compareAndRepairWithOoxml(wb, independent);
      for (const sheetName of wb.SheetNames) {
        const perSheet = divergences.filter((item) => item.sheet === sheetName);
        if (perSheet.length)
          (wb.Sheets[sheetName] as WorksheetWithReaderDiagnostics)["!oliReaderDivergences"] =
            perSheet;
      }
    } catch {
      // A verificação independente não bloqueia um arquivo legível.
    }
  }
  onProgress?.("analyzing");
  return sheetsWithData(wb);
}
