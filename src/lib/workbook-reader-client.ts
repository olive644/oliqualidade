import {
  PROGRESSIVE_IMPORT_SUPPORT,
  ProgressiveImportFallback,
  readCsvWorkbookProgressively,
} from "@/lib/csv-progressive-import";
import type { SheetOption } from "@/lib/import";
import { chooseImportStrategy, isConstrainedDevice } from "@/lib/import-strategy";
import { readOoxmlWorkbookProgressively } from "@/lib/ooxml-progressive-import";
import { readWorkbookBytesWithEngine, type WorkbookReadProgress } from "@/lib/workbook-reader";
import type { WorkbookReadResult } from "@/lib/workbook-reading-engine";

type WorkerResponse =
  | { id: string; type: "progress"; progress: WorkbookReadProgress }
  | { id: string; type: "sheet"; sheet: SheetOption }
  | { id: string; type: "result"; result: WorkbookReadResult }
  | { id: string; type: "fallback"; message: string }
  | { id: string; type: "error"; message: string };

type WorkerRequestBody =
  | { strategy: "atual"; bytes: ArrayBuffer; fileName: string }
  | { strategy: "csv-progressivo"; file: Blob; fileName: string }
  | { strategy: "ooxml-progressivo"; bytes: ArrayBuffer; fileName: string };

export const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024;
export const WORKBOOK_READ_TIMEOUT_MS = 60_000;

/**
 * Sinais de aparelho, lidos uma vez por importação.
 *
 * Ficam aqui e não no seletor porque o seletor é uma função pura: ele recebe o
 * resultado da leitura do ambiente, e por isso pode ser reproduzido num teste
 * com um número.
 */
function deviceSignals(): {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  userAgent?: string;
} {
  if (typeof navigator === "undefined") return {};
  const source = navigator as Navigator & { deviceMemory?: number };
  return {
    ...(typeof source.deviceMemory === "number" ? { deviceMemory: source.deviceMemory } : {}),
    ...(typeof source.hardwareConcurrency === "number"
      ? { hardwareConcurrency: source.hardwareConcurrency }
      : {}),
    ...(typeof source.userAgent === "string" ? { userAgent: source.userAgent } : {}),
  };
}

const cancelled = () => new DOMException("Importação cancelada.", "AbortError");

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export async function readWorkbookFile(
  file: File,
  onProgress?: (progress: WorkbookReadProgress) => void,
  signal?: AbortSignal,
): Promise<SheetOption[]> {
  return (await readWorkbookFileWithReport(file, onProgress, signal)).sheets;
}

export async function readWorkbookFileWithReport(
  file: File,
  onProgress?: (progress: WorkbookReadProgress) => void,
  signal?: AbortSignal,
  onSheet?: (sheet: SheetOption) => void,
): Promise<WorkbookReadResult> {
  if (file.size > MAX_WORKBOOK_BYTES)
    throw new Error("A planilha excede o limite de 100 MB. Divida o arquivo antes de importar.");
  if (signal?.aborted) throw cancelled();

  const decision = chooseImportStrategy({
    fileName: file.name,
    bytes: file.size,
    constrained: isConstrainedDevice(deviceSignals()),
    support: PROGRESSIVE_IMPORT_SUPPORT,
  });

  if (decision.strategy === "csv-progressivo" || decision.strategy === "ooxml-progressivo") {
    // Uma aba já entregue não pode ser entregue de novo pelo outro caminho, e
    // por isso o fallback só é aceito enquanto nada saiu. Hoje ele só acontece
    // no reconhecimento do conteúdo, antes de qualquer leitura, mas essa
    // garantia mora aqui e não na ordem interna do coordenador.
    let streamed = false;
    const wrappedOnSheet =
      onSheet &&
      ((sheet: SheetOption) => {
        streamed = true;
        onSheet(sheet);
      });
    try {
      return decision.strategy === "csv-progressivo"
        ? await readProgressively(file, onProgress, signal, wrappedOnSheet)
        : await readOoxmlProgressively(file, onProgress, signal, wrappedOnSheet);
    } catch (error) {
      if (isAbort(error) || streamed) throw error;
      if (!(error instanceof ProgressiveImportFallback)) throw error;
      // O caminho novo não se aplica a este arquivo. O leitor validado assume,
      // e quem importa não vê diferença nenhuma.
    }
  }

  return readCurrentPath(file, onProgress, signal, onSheet);
}

/**
 * Caminho progressivo de CSV: o arquivo atravessa como `Blob`.
 *
 * O worker continua obrigatório, como em toda leitura de planilha do projeto.
 * O que muda é o que ele recebe: uma referência ao arquivo, e não os bytes. Um
 * `ArrayBuffer` aqui traria o arquivo inteiro para a memória e anularia o
 * streaming antes de ele começar.
 */
async function readProgressively(
  file: File,
  onProgress?: (progress: WorkbookReadProgress) => void,
  signal?: AbortSignal,
  onSheet?: (sheet: SheetOption) => void,
): Promise<WorkbookReadResult> {
  if (typeof Worker === "undefined")
    return withStreamedSheets((collect) =>
      readCsvWorkbookProgressively(file, {
        fileName: file.name,
        ...(signal ? { signal } : {}),
        ...(onProgress ? { onProgress } : {}),
        onSheet: (sheet) => {
          collect(sheet);
          onSheet?.(sheet);
        },
      }),
    );

  return runInWorker(
    { strategy: "csv-progressivo", file, fileName: file.name },
    [],
    onProgress,
    signal,
    onSheet,
  );
}

/**
 * Caminho progressivo de OOXML: o arquivo ainda atravessa como bytes.
 *
 * Ao contrário do CSV, `readOoxmlSheetGrids` expande o ZIP inteiro em memória
 * (ver `ooxml-progressive-import.ts`), então não há ganho em mandar o `File`
 * como referência aqui: o worker precisaria do `ArrayBuffer` de qualquer jeito.
 * O que este caminho evita é só a construção do workbook do SheetJS, que é a
 * cópia que domina o pico.
 */
async function readOoxmlProgressively(
  file: File,
  onProgress?: (progress: WorkbookReadProgress) => void,
  signal?: AbortSignal,
  onSheet?: (sheet: SheetOption) => void,
): Promise<WorkbookReadResult> {
  const bytes = await file.arrayBuffer();
  if (signal?.aborted) throw cancelled();
  if (typeof Worker === "undefined")
    return withStreamedSheets((collect) =>
      Promise.resolve(
        readOoxmlWorkbookProgressively(bytes, {
          fileName: file.name,
          ...(signal ? { signal } : {}),
          ...(onProgress ? { onProgress } : {}),
          onSheet: (sheet) => {
            collect(sheet);
            onSheet?.(sheet);
          },
        }),
      ),
    );

  return runInWorker(
    { strategy: "ooxml-progressivo", bytes, fileName: file.name },
    [bytes],
    onProgress,
    signal,
    onSheet,
  );
}

async function readCurrentPath(
  file: File,
  onProgress?: (progress: WorkbookReadProgress) => void,
  signal?: AbortSignal,
  onSheet?: (sheet: SheetOption) => void,
): Promise<WorkbookReadResult> {
  const bytes = await file.arrayBuffer();
  if (signal?.aborted) throw cancelled();
  // Sem worker (ambiente de teste, navegador antigo) a leitura acontece no
  // mesmo thread. O escoamento continua valendo para quem quiser mostrar a
  // primeira aba antes do fim, mas aqui não há segunda cópia para economizar.
  if (typeof Worker === "undefined")
    return withStreamedSheets((collect) =>
      readWorkbookBytesWithEngine(bytes, file.name, onProgress, {
        onSheet: (sheet) => {
          collect(sheet);
          onSheet?.(sheet);
        },
      }),
    );

  return runInWorker(
    { strategy: "atual", bytes, fileName: file.name },
    [bytes],
    onProgress,
    signal,
    onSheet,
  );
}

/** Remonta o conjunto a partir do escoamento, quando a leitura roda sem worker. */
async function withStreamedSheets(
  read: (collect: (sheet: SheetOption) => void) => Promise<WorkbookReadResult>,
): Promise<WorkbookReadResult> {
  const collected: SheetOption[] = [];
  const result = await read((sheet) => collected.push(sheet));
  return { ...result, sheets: collected };
}

function runInWorker(
  request: WorkerRequestBody,
  transfer: Transferable[],
  onProgress?: (progress: WorkbookReadProgress) => void,
  signal?: AbortSignal,
  onSheet?: (sheet: SheetOption) => void,
): Promise<WorkbookReadResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/workbook.worker.ts", import.meta.url), {
      type: "module",
    });
    const id = crypto.randomUUID();
    // O worker entrega as abas em pedaços e devolve o relatório no fim, com
    // `sheets` vazio. A montagem do conjunto acontece aqui, na ordem de
    // chegada, que é a ordem das abas do arquivo.
    const streamed: SheetOption[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      signal?.removeEventListener("abort", abort);
      return true;
    };
    const abort = () => {
      if (!finish()) return;
      reject(cancelled());
    };
    const timeout = setTimeout(() => {
      if (!finish()) return;
      reject(
        new Error(
          "A leitura ultrapassou 60 segundos e foi cancelada. Divida o arquivo ou remova formatações excedentes.",
        ),
      );
    }, WORKBOOK_READ_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return;
      if (event.data.type === "progress") onProgress?.(event.data.progress);
      if (event.data.type === "sheet") {
        streamed.push(event.data.sheet);
        onSheet?.(event.data.sheet);
      }
      if (event.data.type === "result") {
        if (!finish()) return;
        // O motor devolve o conjunto preenchido quando ele mesmo precisou
        // dele (modo candidato do leitor Rust). Nesse caso ele é a versão
        // autoritativa; nos outros vem vazio e vale o que foi escoado.
        const { result } = event.data;
        resolve(result.sheets.length ? result : { ...result, sheets: streamed });
      }
      if (event.data.type === "fallback") {
        if (!finish()) return;
        reject(new ProgressiveImportFallback(event.data.message));
      }
      if (event.data.type === "error") {
        if (!finish()) return;
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      if (!finish()) return;
      reject(new Error(event.message || "Falha ao processar a planilha."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.postMessage({ ...request, id }, transfer);
  });
}
