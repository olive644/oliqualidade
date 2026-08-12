/// <reference lib="webworker" />

import { readWorkbookBytes, type WorkbookReadProgress } from "@/lib/workbook-reader";

type Request = { id: string; bytes: ArrayBuffer; fileName: string };

self.addEventListener("message", (event: MessageEvent<Request>) => {
  const { id, bytes, fileName } = event.data;
  try {
    const sheets = readWorkbookBytes(bytes, fileName, (progress: WorkbookReadProgress) =>
      self.postMessage({ id, type: "progress", progress }),
    );
    self.postMessage({ id, type: "result", sheets });
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      message: error instanceof Error ? error.message : "Não foi possível interpretar o arquivo.",
    });
  }
});

export {};
