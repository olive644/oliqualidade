import * as XLSX from "xlsx";

import { sheetsWithData, type SheetOption } from "@/lib/import";
import { attachWorkbookFeatures } from "@/lib/workbook-metadata";

export const WORKBOOK_ACCEPT =
  ".xlsx,.xlsm,.xlsb,.xls,.xltx,.xltm,.ods,.fods,.csv,.tsv,.txt,.xml,.html,.htm,.numbers";

export const WORKBOOK_FORMATS_LABEL = "XLSX, XLSM, XLSB, XLS, ODS, CSV, TSV, XML, HTML ou Numbers";

const TEXT_EXTENSIONS = /\.(csv|tsv|txt)$/i;
const ZIP_WORKBOOK_EXTENSIONS = /\.(xlsx|xlsm|xltx|xltm)$/i;
export const MAX_WORKBOOK_SHEETS = 100;
export const MAX_WORKBOOK_CELLS = 2_000_000;

export type WorkbookReadProgress = "decoding" | "parsing" | "analyzing";

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

export function readWorkbookBytes(
  input: ArrayBuffer | Uint8Array,
  fileName: string,
  onProgress?: (progress: WorkbookReadProgress) => void,
): SheetOption[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  onProgress?.("decoding");
  const textFile = TEXT_EXTENSIONS.test(fileName);
  const source = textFile ? decodeText(bytes) : bytes;
  onProgress?.("parsing");
  const wb = XLSX.read(source, {
    type: textFile ? "string" : "array",
    ...(textFile ? { FS: detectDelimiter(source as string), raw: true } : {}),
    cellDates: true,
    cellFormula: true,
    cellNF: true,
    cellText: true,
    sheetStubs: true,
    bookDeps: true,
    dense: true,
    nodim: true,
    UTC: false,
  });
  validateWorkbookComplexity(wb);
  if (ZIP_WORKBOOK_EXTENSIONS.test(fileName)) attachWorkbookFeatures(wb, bytes);
  onProgress?.("analyzing");
  return sheetsWithData(wb);
}
