import type { SheetOption } from "@/lib/import";
import { readWorkbookBytes, type WorkbookReadProgress } from "@/lib/workbook-reader";

type WorkerResponse =
  | { id: string; type: "progress"; progress: WorkbookReadProgress }
  | { id: string; type: "result"; sheets: SheetOption[] }
  | { id: string; type: "error"; message: string };

export const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024;

export async function readWorkbookFile(
  file: File,
  onProgress?: (progress: WorkbookReadProgress) => void,
): Promise<SheetOption[]> {
  if (file.size > MAX_WORKBOOK_BYTES)
    throw new Error("A planilha excede o limite de 100 MB. Divida o arquivo antes de importar.");
  const bytes = await file.arrayBuffer();
  if (typeof Worker === "undefined") return readWorkbookBytes(bytes, file.name, onProgress);

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/workbook.worker.ts", import.meta.url), {
      type: "module",
    });
    const id = crypto.randomUUID();
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return;
      if (event.data.type === "progress") onProgress?.(event.data.progress);
      if (event.data.type === "result") {
        finish();
        resolve(event.data.sheets);
      }
      if (event.data.type === "error") {
        finish();
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "Falha ao processar a planilha."));
    };
    worker.postMessage({ id, bytes, fileName: file.name }, [bytes]);
  });
}
