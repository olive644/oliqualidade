import * as XLSX from "xlsx";
import { checkWorkbookContent } from "@/lib/file-signature";

import { streamSheetsWithData, type SheetOption } from "@/lib/import";
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
  estimateWorkbookPeakMemoryBytes,
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

export type WorkbookReadStage =
  "decoding" | "parsing" | "verifying" | "analyzing" | "comparing" | "complete";

/**
 * Etapa da leitura e, quando dá para saber, o quanto dela já passou.
 *
 * `completed`/`total` contam abas, e vêm ausentes de propósito nas etapas que
 * não conseguem medir. `parsing` é a principal delas: é uma chamada única ao
 * leitor principal, que não expõe progresso, e medida em 32% do tempo de um
 * arquivo de 61 MiB. Inventar uma porcentagem ali seria pior que assumir a
 * indeterminação, porque a barra andaria sem relação com o trabalho real.
 *
 * As duas etapas que somam os outros 68% (`verifying` e `analyzing`) percorrem
 * abas uma a uma e reportam fração de verdade.
 */
export type WorkbookReadProgress = {
  stage: WorkbookReadStage;
  completed?: number;
  total?: number;
};

export type WorksheetWithReaderDiagnostics = XLSX.WorkSheet & {
  "!oliReaderDivergences"?: ReaderDivergence[];
  "!oliOoxmlFallback"?: boolean;
};

export type WorkbookReadEngineOptions = {
  wasmSampleRate?: number;
  wasmReaderMode?: WasmReaderMode;
  wasmCandidateFormats?: readonly string[];
  /**
   * Recebe cada aba assim que ela fica pronta, em vez de todas no fim.
   *
   * Quando presente, o resultado volta com `sheets` vazio: quem recebeu os
   * pedaços já tem o conjunto, e manter uma segunda cópia aqui anularia a
   * economia de memória que o escoamento existe para dar.
   *
   * Em modo candidato o conjunto ainda pode ser trocado pelo resultado do
   * leitor Rust, mas só por um que `sameImportedSheets` provou idêntico, então
   * o escoamento continua valendo; nesse caso o resultado volta com o conjunto
   * preenchido, porque a comparação precisou dele.
   */
  onSheet?: (sheet: SheetOption) => void;
};

/**
 * Lê somente o diretório central do ZIP, sem descompactar seu conteúdo.
 * XLSX/XLSM são pacotes ZIP e podem declarar poucos bytes compactados que
 * expandem para gigabytes. A checagem ocorre antes do SheetJS e do extrator
 * de metadados para evitar consumo abusivo de memória no navegador.
 */
/**
 * Decide como ler o arquivo a partir do conteúdo, e não da extensão.
 *
 * A verificação estrutural do ZIP era feita só para quatro extensões, o que
 * deixava `.ods`, `.numbers` e `.xlsb` sem nenhuma conferência, e um arquivo
 * renomeado tomava o caminho errado antes de qualquer validação. Ligando as
 * duas coisas à assinatura real, cada caminho passa a valer para o que o
 * arquivo é, e não para o nome que ele recebeu.
 */
function resolveWorkbookContent(bytes: Uint8Array, fileName: string) {
  const check = checkWorkbookContent(bytes, fileName);
  if (!check.ok) throw new Error(check.message);
  return check;
}

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

export function validateWorkbookComplexity(workbook: XLSX.WorkBook): number {
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
  return cells;
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
  onProgress?.({ stage: "decoding" });
  const content = resolveWorkbookContent(bytes, fileName);
  const textFile = content.container === "text";
  const zipInfo = content.container === "zip" ? validateZipWorkbook(bytes) : null;
  const source = textFile ? decodeText(bytes) : bytes;
  onProgress?.({ stage: "parsing" });
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
  const visitedCells = validateWorkbookComplexity(wb);
  const parseMs = Math.round(performance.now() - parseStartedAt);
  let repairedCells = 0;
  let divergentCells = 0;
  let independentInspection: OoxmlInspection | undefined;
  // A verificação passa por cada aba duas vezes: uma lendo o XML original e
  // outra comparando com o leitor principal. As duas viram uma fração só, com
  // denominador dobrado, para a barra andar sem voltar ao meio da etapa.
  onProgress?.({ stage: "verifying", completed: 0, total: wb.SheetNames.length * 2 });
  const verificationStartedAt = performance.now();
  if (ZIP_WORKBOOK_EXTENSIONS.test(fileName)) {
    const archive = sharedOoxmlArchive(bytes);
    attachWorkbookFeatures(wb, archive);
    try {
      let inspectedSheets = 0;
      independentInspection = inspectOoxml(archive, (done, total) => {
        inspectedSheets = total;
        onProgress?.({ stage: "verifying", completed: done, total: total * 2 });
      });
      const divergences = compareAndRepairWithOoxml(wb, independentInspection, (done, total) =>
        onProgress?.({
          stage: "verifying",
          completed: (inspectedSheets || total) + done,
          total: (inspectedSheets || total) + total,
        }),
      );
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
  const verificationMs = Math.round(performance.now() - verificationStartedAt);
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
  // Só o modo candidato com leitor Rust presente pode trocar o conjunto de abas
  // depois desta etapa, e mesmo assim apenas por um conjunto que
  // `sameImportedSheets` provou idêntico. Por isso o escoamento acontece sempre:
  // o que a pessoa vê chegando nunca é uma aba que será desmentida. O que muda
  // é só poder descartar a cópia daqui, e isso exige que ninguém mais precise
  // dela para a comparação.
  const mayReplaceSheets = candidateEligible && Boolean(wasmReader);
  const collectSheets = !options.onSheet || mayReplaceSheets;
  onProgress?.({ stage: "analyzing", completed: 0, total: wb.SheetNames.length });
  const analysisStartedAt = performance.now();
  let sheets: SheetOption[] = [];
  // Contada à parte porque `sheets` pode ficar vazio de propósito quando o
  // conjunto é escoado. O relatório precisa continuar dizendo quantas abas
  // foram importadas, e não quantas sobraram em memória aqui.
  let emittedSheets = 0;
  streamSheetsWithData(
    wb,
    (option) => {
      emittedSheets += 1;
      options.onSheet?.(option);
      if (collectSheets) sheets.push(option);
    },
    (done, total) => onProgress?.({ stage: "analyzing", completed: done, total }),
  );
  const analysisMs = Math.round(performance.now() - analysisStartedAt);
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
    onProgress?.({ stage: "comparing" });
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
          const wasmSheets: SheetOption[] = [];
          streamSheetsWithData(wasmWorkbook, (option) => wasmSheets.push(option));
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
  onProgress?.({ stage: "complete" });
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
      verificationMs,
      analysisMs,
      sourceBytes: bytes.length,
      expandedBytes: zipInfo?.totalUncompressedBytes ?? bytes.length,
      visitedCells,
      estimatedPeakMemoryBytes: estimateWorkbookPeakMemoryBytes({
        sourceBytes: bytes.length,
        expandedBytes: zipInfo?.totalUncompressedBytes ?? bytes.length,
        visitedCells,
      }),
      sheets: sheets.length || emittedSheets,
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
  const content = resolveWorkbookContent(bytes, fileName);
  const textFile = content.container === "text";
  if (content.container === "zip") validateZipWorkbook(bytes);
  onProgress?.({ stage: "decoding" });
  const source = textFile ? decodeText(bytes) : bytes;
  onProgress?.({ stage: "parsing" });
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
  onProgress?.({ stage: "verifying", completed: 0, total: wb.SheetNames.length * 2 });
  if (ZIP_WORKBOOK_EXTENSIONS.test(fileName)) {
    const archive = sharedOoxmlArchive(bytes);
    attachWorkbookFeatures(wb, archive);
    try {
      let inspectedSheets = 0;
      const independent = inspectOoxml(archive, (done, total) => {
        inspectedSheets = total;
        onProgress?.({ stage: "verifying", completed: done, total: total * 2 });
      });
      const divergences = compareAndRepairWithOoxml(wb, independent, (done, total) =>
        onProgress?.({
          stage: "verifying",
          completed: (inspectedSheets || total) + done,
          total: (inspectedSheets || total) + total,
        }),
      );
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
  onProgress?.({ stage: "analyzing", completed: 0, total: wb.SheetNames.length });
  const sheets: SheetOption[] = [];
  streamSheetsWithData(
    wb,
    (option) => sheets.push(option),
    (done, total) => onProgress?.({ stage: "analyzing", completed: done, total }),
  );
  onProgress?.({ stage: "complete" });
  return sheets;
}
