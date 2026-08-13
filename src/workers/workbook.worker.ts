/// <reference lib="webworker" />

import { readWorkbookBytesWithEngine, type WorkbookReadProgress } from "@/lib/workbook-reader";

type Request = { id: string; bytes: ArrayBuffer; fileName: string };

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  const { id, bytes, fileName } = event.data;
  try {
    const result = await readWorkbookBytesWithEngine(
      bytes,
      fileName,
      (progress: WorkbookReadProgress) => self.postMessage({ id, type: "progress", progress }),
    );
    self.postMessage({ id, type: "result", result });
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      message: error instanceof Error ? error.message : "Não foi possível interpretar o arquivo.",
    });
  }
});

export {};
