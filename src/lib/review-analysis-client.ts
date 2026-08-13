import {
  buildReviewAnalysis,
  type ReviewAnalysisInput,
  type ReviewAnalysisProgress,
  type ReviewAnalysisResult,
} from "@/lib/review-analysis";

type WorkerResponse =
  | { id: string; type: "progress"; progress: ReviewAnalysisProgress }
  | { id: string; type: "result"; result: ReviewAnalysisResult }
  | { id: string; type: "error"; message: string };

export const REVIEW_ANALYSIS_TIMEOUT_MS = 60_000;

export async function analyzeReviewInBackground(
  input: ReviewAnalysisInput,
  onProgress?: (progress: ReviewAnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<ReviewAnalysisResult> {
  if (signal?.aborted) throw new DOMException("Análise cancelada.", "AbortError");
  if (typeof Worker === "undefined") return buildReviewAnalysis(input, onProgress);

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/review-analysis.worker.ts", import.meta.url), {
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
      reject(new DOMException("Análise cancelada.", "AbortError"));
    };
    const timeout = setTimeout(() => {
      if (!finish()) return;
      reject(new Error("A análise ultrapassou 60 segundos e foi cancelada."));
    }, REVIEW_ANALYSIS_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return;
      if (event.data.type === "progress") onProgress?.(event.data.progress);
      if (event.data.type === "result") {
        if (!finish()) return;
        resolve(event.data.result);
      }
      if (event.data.type === "error") {
        if (!finish()) return;
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      if (!finish()) return;
      reject(new Error(event.message || "Falha ao analisar a planilha."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.postMessage({ id, input });
  });
}
