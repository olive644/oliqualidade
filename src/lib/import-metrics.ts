import {
  clearImportMetrics as clearStoredImportMetrics,
  loadImportMetrics,
  saveImportMetrics,
} from "@/lib/storage";
import type {
  WasmFallbackReason,
  WasmShadowStatus,
  WorkbookReaderId,
  WorkbookReadReport,
} from "@/lib/workbook-reading-engine";

// Nunca guarda nome de arquivo, conteúdo de célula/linha ou qualquer texto
// vindo da planilha — só contagens, durações, tamanhos em bytes e
// identificadores fixos já calculados pelo motor de leitura (reader/
// wasmFallbackReason/wasmShadowStatus) ou pela própria biblioteca de leitura
// (mensagens de erro estáticas, nunca interpoladas com dado do arquivo).
export type ImportMetricEntry = {
  timestamp: number;
  format: string;
  failed: boolean;
  reader: WorkbookReaderId | null;
  elapsedMs: number;
  parseMs: number;
  verificationMs: number;
  analysisMs: number;
  sourceBytes: number;
  expandedBytes: number;
  visitedCells: number;
  estimatedPeakMemoryBytes: number;
  sheets: number;
  repairedCells: number;
  divergentCells: number;
  fallbackUsed: boolean;
  wasmAvailable: boolean;
  wasmOutputUsed: boolean;
  wasmShadowStatus: WasmShadowStatus | null;
  wasmShadowMs: number;
  wasmFallbackReason: WasmFallbackReason | null;
  wasmComparedCells: number;
  wasmDivergentCells: number;
  // Mensagem estática do leitor (ex.: "A planilha possui mais de 100 abas."),
  // truncada por segurança; nunca é montada a partir de nome de arquivo ou
  // conteúdo de célula.
  errorMessage: string | null;
};

const MAX_STORED_ENTRIES = 200;
const MAX_ERROR_MESSAGE_LENGTH = 200;

export function buildImportMetricEntry(
  report: WorkbookReadReport,
  now: number = Date.now(),
): ImportMetricEntry {
  return {
    timestamp: now,
    format: report.format,
    failed: false,
    reader: report.reader,
    elapsedMs: report.elapsedMs,
    parseMs: report.parseMs,
    verificationMs: report.verificationMs,
    analysisMs: report.analysisMs,
    sourceBytes: report.sourceBytes,
    expandedBytes: report.expandedBytes,
    visitedCells: report.visitedCells,
    estimatedPeakMemoryBytes: report.estimatedPeakMemoryBytes,
    sheets: report.sheets,
    repairedCells: report.repairedCells,
    divergentCells: report.divergentCells,
    fallbackUsed: report.fallbackUsed,
    wasmAvailable: report.wasmAvailable,
    wasmOutputUsed: report.wasmOutputUsed,
    wasmShadowStatus: report.wasmShadowStatus,
    wasmShadowMs: report.wasmShadowMs,
    wasmFallbackReason: report.wasmFallbackReason,
    wasmComparedCells: report.wasmComparedCells,
    wasmDivergentCells: report.wasmDivergentCells,
    errorMessage: null,
  };
}

export function buildFailedImportMetricEntry(
  error: unknown,
  format: string,
  now: number = Date.now(),
): ImportMetricEntry {
  const message = error instanceof Error ? error.message : "Erro desconhecido na importação.";
  return {
    timestamp: now,
    format,
    failed: true,
    reader: null,
    elapsedMs: 0,
    parseMs: 0,
    verificationMs: 0,
    analysisMs: 0,
    sourceBytes: 0,
    expandedBytes: 0,
    visitedCells: 0,
    estimatedPeakMemoryBytes: 0,
    sheets: 0,
    repairedCells: 0,
    divergentCells: 0,
    fallbackUsed: false,
    wasmAvailable: false,
    wasmOutputUsed: false,
    wasmShadowStatus: null,
    wasmShadowMs: 0,
    wasmFallbackReason: null,
    wasmComparedCells: 0,
    wasmDivergentCells: 0,
    errorMessage: message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
  };
}

/**
 * Registra uma importação (sucesso ou falha) no histórico local, mantendo
 * só as últimas `MAX_STORED_ENTRIES` entradas. Respeita modo privado por
 * herança de `loadImportMetrics`/`saveImportMetrics` (`storage.ts`).
 */
export async function recordImportMetric(entry: ImportMetricEntry): Promise<void> {
  const existing = await loadImportMetrics();
  const next = [...existing, entry].slice(-MAX_STORED_ENTRIES);
  await saveImportMetrics(next);
}

export async function clearImportMetrics(): Promise<void> {
  await clearStoredImportMetrics();
}

export type ImportMetricsSummary = {
  totalImports: number;
  failedImports: number;
  byReader: Partial<Record<WorkbookReaderId, number>>;
  fallbackCount: number;
  wasmShadowMatched: number;
  wasmShadowDiverged: number;
  wasmShadowFailed: number;
  avgElapsedMsByReader: Partial<Record<WorkbookReaderId, number>>;
  avgVisitedCells: number;
  maxEstimatedPeakMemoryBytes: number;
  avgParseMs: number;
  avgVerificationMs: number;
  avgAnalysisMs: number;
};

/**
 * Agrega o histórico de métricas para responder à pergunta central: o
 * candidato Rust/WASM está ajudando (menos tempo, poucas divergências) ou só
 * adicionando custo? Não interpreta nem lê nenhum dado de planilha, só os
 * campos numéricos/enumerados já coletados por entrada.
 */
export function summarizeImportMetrics(entries: ImportMetricEntry[]): ImportMetricsSummary {
  const successful = entries.filter((entry) => !entry.failed);
  const byReader: Partial<Record<WorkbookReaderId, number>> = {};
  const elapsedByReader: Partial<Record<WorkbookReaderId, number[]>> = {};
  let fallbackCount = 0;
  let wasmShadowMatched = 0;
  let wasmShadowDiverged = 0;
  let wasmShadowFailed = 0;

  for (const entry of successful) {
    if (entry.reader) {
      byReader[entry.reader] = (byReader[entry.reader] ?? 0) + 1;
      (elapsedByReader[entry.reader] ??= []).push(entry.elapsedMs);
    }
    if (entry.fallbackUsed) fallbackCount += 1;
    if (entry.wasmShadowStatus === "matched") wasmShadowMatched += 1;
    else if (entry.wasmShadowStatus === "diverged") wasmShadowDiverged += 1;
    else if (entry.wasmShadowStatus === "failed") wasmShadowFailed += 1;
  }

  const avgElapsedMsByReader: Partial<Record<WorkbookReaderId, number>> = {};
  for (const [reader, timings] of Object.entries(elapsedByReader) as [
    WorkbookReaderId,
    number[],
  ][]) {
    avgElapsedMsByReader[reader] = timings.reduce((sum, ms) => sum + ms, 0) / timings.length;
  }

  return {
    totalImports: entries.length,
    failedImports: entries.length - successful.length,
    byReader,
    fallbackCount,
    wasmShadowMatched,
    wasmShadowDiverged,
    wasmShadowFailed,
    avgElapsedMsByReader,
    avgVisitedCells: successful.length
      ? successful.reduce((sum, entry) => sum + (entry.visitedCells ?? 0), 0) / successful.length
      : 0,
    maxEstimatedPeakMemoryBytes: Math.max(
      0,
      ...successful.map((entry) => entry.estimatedPeakMemoryBytes ?? 0),
    ),
    avgParseMs: successful.length
      ? successful.reduce((sum, entry) => sum + (entry.parseMs ?? 0), 0) / successful.length
      : 0,
    avgVerificationMs: successful.length
      ? successful.reduce((sum, entry) => sum + (entry.verificationMs ?? 0), 0) / successful.length
      : 0,
    avgAnalysisMs: successful.length
      ? successful.reduce((sum, entry) => sum + (entry.analysisMs ?? 0), 0) / successful.length
      : 0,
  };
}
