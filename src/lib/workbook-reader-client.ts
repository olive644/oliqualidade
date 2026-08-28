import type { SheetOption } from "@/lib/import";
import { readWorkbookBytesWithEngine, type WorkbookReadProgress } from "@/lib/workbook-reader";
import type { WorkbookReadResult } from "@/lib/workbook-reading-engine";

type WorkerResponse =
  | { id: string; type: "progress"; progress: WorkbookReadProgress }
  | { id: string; type: "sheet"; sheet: SheetOption }
  | { id: string; type: "result"; result: WorkbookReadResult }
  | { id: string; type: "error"; message: string };

export const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024;
export const WORKBOOK_READ_TIMEOUT_MS = 60_000;

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
  if (signal?.aborted) throw new DOMException("Importação cancelada.", "AbortError");
  const bytes = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException("Importação cancelada.", "AbortError");
  // Sem worker (ambiente de teste, navegador antigo) a leitura acontece no
  // mesmo thread. O escoamento continua valendo para quem quiser mostrar a
  // primeira aba antes do fim, mas aqui não há segunda cópia para economizar.
  if (typeof Worker === "undefined") {
    const collected: SheetOption[] = [];
    const result = await readWorkbookBytesWithEngine(bytes, file.name, onProgress, {
      onSheet: (sheet) => {
        collected.push(sheet);
        onSheet?.(sheet);
      },
    });
    return { ...result, sheets: collected };
  }

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
      reject(new DOMException("Importação cancelada.", "AbortError"));
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
    worker.postMessage({ id, bytes, fileName: file.name }, [bytes]);
  });
}
