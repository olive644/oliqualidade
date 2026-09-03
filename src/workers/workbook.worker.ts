/// <reference lib="webworker" />

import {
  ProgressiveImportFallback,
  readCsvWorkbookProgressively,
} from "@/lib/csv-progressive-import";
import type { SheetOption } from "@/lib/import";
import { readOoxmlWorkbookProgressively } from "@/lib/ooxml-progressive-import";
import { readWorkbookBytesWithEngine, type WorkbookReadProgress } from "@/lib/workbook-reader";
import "@/lib/ooxml-wasm-shadow";

/**
 * O caminho progressivo de CSV recebe o próprio `Blob`, e não os bytes.
 *
 * Um `File` atravessa o `postMessage` como referência ao conteúdo no disco, sem
 * cópia e sem materialização: é isso que permite ao worker ler o arquivo por
 * streaming em vez de recebê-lo inteiro na memória. Mandar `ArrayBuffer` aqui
 * anularia o trabalho antes de ele começar.
 *
 * O caminho progressivo de OOXML recebe bytes, como o caminho atual: o leitor
 * de grade (`readOoxmlSheetGrids`) ainda expande o ZIP inteiro em memória, e
 * não lê por posição a partir de um `Blob`. Ver `ooxml-progressive-import.ts`
 * para o que essa ligação já economiza e o que ainda falta para virar
 * streaming verdadeiro.
 */
type Request =
  | { id: string; strategy?: "atual"; bytes: ArrayBuffer; fileName: string }
  | { id: string; strategy: "csv-progressivo"; file: Blob; fileName: string }
  | { id: string; strategy: "ooxml-progressivo"; bytes: ArrayBuffer; fileName: string };

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  const { id, fileName } = event.data;
  const onProgress = (progress: WorkbookReadProgress) =>
    self.postMessage({ id, type: "progress", progress });
  const onSheet = (sheet: SheetOption) => self.postMessage({ id, type: "sheet", sheet });
  try {
    if (event.data.strategy === "csv-progressivo") {
      const result = await readCsvWorkbookProgressively(event.data.file, {
        fileName,
        onProgress,
        onSheet,
      });
      self.postMessage({ id, type: "result", result });
      return;
    }
    if (event.data.strategy === "ooxml-progressivo") {
      const result = readOoxmlWorkbookProgressively(event.data.bytes, {
        fileName,
        onProgress,
        onSheet,
      });
      self.postMessage({ id, type: "result", result });
      return;
    }
    // Cada aba sai daqui assim que fica pronta. Antes, o worker montava o
    // conjunto inteiro e mandava num `postMessage` só: naquele instante o
    // modelo existia em dobro, a cópia daqui e o clone estrutural da aba.
    const result = await readWorkbookBytesWithEngine(event.data.bytes, fileName, onProgress, {
      onSheet,
    });
    self.postMessage({ id, type: "result", result });
  } catch (error) {
    // Indisponibilidade do caminho novo não é falha do arquivo: quem chamou
    // repete a leitura pelo leitor validado, e a pessoa não vê nada disso.
    if (error instanceof ProgressiveImportFallback) {
      self.postMessage({ id, type: "fallback", message: error.message });
      return;
    }
    self.postMessage({
      id,
      type: "error",
      message: error instanceof Error ? error.message : "Não foi possível interpretar o arquivo.",
    });
  }
});

export {};
