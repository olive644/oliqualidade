import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_WORKBOOK_BYTES,
  readWorkbookFile,
  readWorkbookFileWithReport,
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

  it("permite cancelar manualmente uma importação pesada", async () => {
    const terminate = vi.fn();
    class StalledWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage() {}
      terminate = terminate;
    }
    vi.stubGlobal("Worker", StalledWorker);
    const file = {
      name: "grande.xlsx",
      size: 4,
      arrayBuffer: async () => new ArrayBuffer(4),
    } as unknown as File;
    const controller = new AbortController();
    const result = readWorkbookFile(file, undefined, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(terminate).toHaveBeenCalledOnce();
  });
});

describe("montagem das abas escoadas pelo worker", () => {
  class StreamingWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminate = vi.fn();

    postMessage(request: { id: string }) {
      const emit = (data: unknown) =>
        queueMicrotask(() => this.onmessage?.({ data } as MessageEvent));
      emit({
        id: request.id,
        type: "progress",
        progress: { stage: "analyzing", completed: 1, total: 2 },
      });
      emit({ id: request.id, type: "sheet", sheet: { name: "Primeira", rows: [{ A: 1 }] } });
      emit({ id: request.id, type: "sheet", sheet: { name: "Segunda", rows: [{ A: 2 }] } });
      emit({
        id: request.id,
        type: "result",
        // O motor devolve o conjunto vazio quando escoou: manter uma segunda
        // cópia aqui anularia a economia que o escoamento existe para dar.
        result: { sheets: [], report: { sheets: 2 } },
      });
    }
  }

  const arquivo = () =>
    ({
      name: "duas-abas.xlsx",
      size: 1_000,
      arrayBuffer: async () => new ArrayBuffer(8),
    }) as unknown as File;

  it("junta os pedaços na ordem de chegada e repassa cada aba a quem pediu", async () => {
    vi.stubGlobal("Worker", StreamingWorker);
    vi.stubGlobal("crypto", { randomUUID: () => "id-fixo" });

    const chegando: string[] = [];
    const progresso: unknown[] = [];
    const resultado = await readWorkbookFileWithReport(
      arquivo(),
      (p) => progresso.push(p),
      undefined,
      (sheet) => chegando.push(sheet.name),
    );

    expect(chegando).toEqual(["Primeira", "Segunda"]);
    expect(resultado.sheets.map((s) => s.name)).toEqual(["Primeira", "Segunda"]);
    expect(resultado.report.sheets).toBe(2);
    expect(progresso).toEqual([{ stage: "analyzing", completed: 1, total: 2 }]);
  });

  it("prefere o conjunto do motor quando ele vem preenchido", async () => {
    // Acontece no modo candidato do leitor Rust, único caso em que o motor
    // precisa do conjunto para comparar e por isso o devolve.
    class AuthoritativeWorker extends StreamingWorker {
      override postMessage(request: { id: string }) {
        const emit = (data: unknown) =>
          queueMicrotask(() => this.onmessage?.({ data } as MessageEvent));
        emit({ id: request.id, type: "sheet", sheet: { name: "Escoada", rows: [] } });
        emit({
          id: request.id,
          type: "result",
          result: { sheets: [{ name: "Autoritativa", rows: [] }], report: { sheets: 1 } },
        });
      }
    }
    vi.stubGlobal("Worker", AuthoritativeWorker);
    vi.stubGlobal("crypto", { randomUUID: () => "id-fixo" });

    const resultado = await readWorkbookFileWithReport(arquivo());

    expect(resultado.sheets.map((s) => s.name)).toEqual(["Autoritativa"]);
  });
});
