/// <reference lib="webworker" />

import {
  buildReviewAnalysis,
  type ReviewAnalysisInput,
  type ReviewAnalysisProgress,
} from "@/lib/review-analysis";

type Request = { id: string; input: ReviewAnalysisInput };

self.addEventListener("message", (event: MessageEvent<Request>) => {
  const { id, input } = event.data;
  try {
    const result = buildReviewAnalysis(input, (progress: ReviewAnalysisProgress) =>
      self.postMessage({ id, type: "progress", progress }),
    );
    self.postMessage({ id, type: "result", result });
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      message: error instanceof Error ? error.message : "Não foi possível analisar a planilha.",
    });
  }
});

export {};
