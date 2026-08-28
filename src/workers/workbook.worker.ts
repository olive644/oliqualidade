/// <reference lib="webworker" />

import type { SheetOption } from "@/lib/import";
import { readWorkbookBytesWithEngine, type WorkbookReadProgress } from "@/lib/workbook-reader";
import "@/lib/ooxml-wasm-shadow";

type Request = { id: string; bytes: ArrayBuffer; fileName: string };

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  const { id, bytes, fileName } = event.data;
  try {
    // Cada aba sai daqui assim que fica pronta. Antes, o worker montava o
    // conjunto inteiro e mandava num `postMessage` só: naquele instante o
    // modelo existia em dobro, a cópia daqui e o clone estrutural da aba.
    const result = await readWorkbookBytesWithEngine(
      bytes,
      fileName,
      (progress: WorkbookReadProgress) => self.postMessage({ id, type: "progress", progress }),
      { onSheet: (sheet: SheetOption) => self.postMessage({ id, type: "sheet", sheet }) },
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
