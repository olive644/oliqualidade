import type { SheetOption } from "@/lib/import";
import { readWorkbookBytes, type WorkbookReadProgress } from "@/lib/workbook-reader";

type WorkerResponse =
  | { id: string; type: "progress"; progress: WorkbookReadProgress }
  | { id: string; type: "result"; sheets: SheetOption[] }
  | { id: string; type: "error"; message: string };

export const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024;
export const WORKBOOK_READ_TIMEOUT_MS = 60_000;

export async function readWorkbookFile(
  file: File,
  onProgress?: (progress: WorkbookReadProgress) => void,
  signal?: AbortSignal,
): Promise<SheetOption[]> {
  if (file.size > MAX_WORKBOOK_BYTES)
    throw new Error("A planilha excede o limite de 100 MB. Divida o arquivo antes de importar.");
  if (signal?.aborted) throw new DOMException("Importação cancelada.", "AbortError");
  const bytes = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException("Importação cancelada.", "AbortError");
  if (typeof Worker === "undefined") return readWorkbookBytes(bytes, file.name, onProgress);

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/workbook.worker.ts", import.meta.url), {
      type: "module",
    });
    const id = crypto.randomUUID();
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
      if (event.data.type === "result") {
        if (!finish()) return;
        resolve(event.data.sheets);
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
