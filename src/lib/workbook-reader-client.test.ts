import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_WORKBOOK_BYTES,
  readWorkbookFile,
  WORKBOOK_READ_TIMEOUT_MS,
} from "./workbook-reader-client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("limite de arquivo", () => {
  it("rejeita arquivo enorme antes de alocar o ArrayBuffer", async () => {
    const file = {
      name: "enorme.xlsx",
      size: MAX_WORKBOOK_BYTES + 1,
      arrayBuffer: () => {
        throw new Error("não deveria ler");
      },
    } as unknown as File;
    await expect(readWorkbookFile(file)).rejects.toThrow("limite de 100 MB");
  });

  it("cancela e encerra o worker quando a leitura fica travada", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    class StalledWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage() {}
      terminate = terminate;
    }
    vi.stubGlobal("Worker", StalledWorker);
    const file = {
      name: "travada.xlsx",
      size: 4,
      arrayBuffer: async () => new ArrayBuffer(4),
    } as unknown as File;

    const result = expect(readWorkbookFile(file)).rejects.toThrow("ultrapassou 60 segundos");
    await vi.advanceTimersByTimeAsync(WORKBOOK_READ_TIMEOUT_MS);
    await result;
    expect(terminate).toHaveBeenCalledOnce();
  });
});
