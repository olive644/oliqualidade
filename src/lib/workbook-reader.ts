import * as XLSX from "xlsx";

import { sheetsWithData, type SheetOption } from "@/lib/import";
import { attachWorkbookFeatures } from "@/lib/workbook-metadata";
import { compareAndRepairWithOoxml, inspectOoxml, type ReaderDivergence } from "@/lib/ooxml-reader";
import {
  registeredWasmWorkbookReader,
  shouldTryWasm,
  workbookFormat,
  type WorkbookReadResult,
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

/**
 * Lê somente o diretório central do ZIP, sem descompactar seu conteúdo.
 * XLSX/XLSM são pacotes ZIP e podem declarar poucos bytes compactados que
 * expandem para gigabytes. A checagem ocorre antes do SheetJS e do extrator
 * de metadados para evitar consumo abusivo de memória no navegador.
 */
export function validateZipWorkbook(bytes: Uint8Array): void {
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

export async function readWorkbookBytesWithEngine(
  input: ArrayBuffer | Uint8Array,
  fileName: string,
  onProgress?: (progress: WorkbookReadProgress) => void,
): Promise<WorkbookReadResult> {
  const startedAt = performance.now();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  onProgress?.("decoding");
  if (shouldTryWasm(fileName)) {
    const wasmStartedAt = performance.now();
    try {
      const result = await registeredWasmWorkbookReader()!.read(bytes, fileName);
      return {
        sheets: result.sheets,
        report: {
          reader: "wasm",
          format: workbookFormat(fileName),
          elapsedMs: Math.round(performance.now() - startedAt),
          parseMs: Math.round(performance.now() - wasmStartedAt),
          verificationMs: 0,
          sheets: result.sheets.length,
          repairedCells: result.repairedCells ?? 0,
          divergentCells: result.divergentCells ?? 0,
          fallbackUsed: false,
          wasmAvailable: true,
        },
      };
    } catch {
      // A integração WASM é opcional: uma falha nela nunca pode tirar o
      // fallback comprovado de produção nem bloquear a importação do usuário.
    }
  }
  const textFile = TEXT_EXTENSIONS.test(fileName);
  if (ZIP_WORKBOOK_EXTENSIONS.test(fileName)) validateZipWorkbook(bytes);
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
  const verificationStartedAt = performance.now();
  if (ZIP_WORKBOOK_EXTENSIONS.test(fileName)) {
    attachWorkbookFeatures(wb, bytes);
    try {
      const independent = inspectOoxml(bytes);
      const divergences = compareAndRepairWithOoxml(wb, independent);
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
  const sheets = sheetsWithData(wb);
  return {
    sheets,
    report: {
      reader: fallbackUsed
        ? "ooxml-recovery"
        : ZIP_WORKBOOK_EXTENSIONS.test(fileName)
          ? "sheetjs-verified"
          : "sheetjs",
      format: workbookFormat(fileName),
      elapsedMs: Math.round(performance.now() - startedAt),
      parseMs,
      verificationMs: Math.round(performance.now() - verificationStartedAt),
      sheets: sheets.length,
      repairedCells,
      divergentCells,
      fallbackUsed,
      wasmAvailable: !!registeredWasmWorkbookReader(),
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
    attachWorkbookFeatures(wb, bytes);
    try {
      const independent = inspectOoxml(bytes);
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
