import { useEffect, useRef, useState } from "react";
import { analyzeReviewInBackground } from "@/lib/review-analysis-client";
import type { ReviewAnalysisProgress, ReviewAnalysisResult } from "@/lib/review-analysis";
import type { SemanticOverrides } from "@/lib/spreadsheet-intelligence";
import type { Column, Row } from "@/lib/types";

/**
 * Roda a análise de revisão (qualidade, comparação de versão) num worker em
 * segundo plano a cada mudança de dados/colunas, sem bloquear a interface.
 * Cancela a análise anterior sempre que uma nova começa (troca de aba,
 * correção de célula etc.), para nunca deixar duas análises concorrentes
 * pisando uma na resposta da outra.
 */
export function useBackgroundReviewAnalysis(
  rows: Row[],
  columns: Column[],
  semanticOverrides: SemanticOverrides | undefined,
  previousRows: Row[] | undefined,
) {
  const [backgroundReview, setBackgroundReview] = useState<ReviewAnalysisResult | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<ReviewAnalysisProgress | null>(null);
  const analysisAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    analysisAbort.current?.abort();
    const controller = new AbortController();
    analysisAbort.current = controller;
    setBackgroundReview(null);
    setAnalysisProgress({ percent: 0, phase: "preparing" });
    void analyzeReviewInBackground(
      {
        rows,
        columns,
        ...(semanticOverrides ? { semanticOverrides } : {}),
        ...(previousRows ? { previousRows } : {}),
      },
      setAnalysisProgress,
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setBackgroundReview(result);
        setAnalysisProgress(null);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAnalysisProgress(null);
      });
    return () => controller.abort();
  }, [rows, columns, semanticOverrides, previousRows]);

  const cancelAnalysis = () => {
    analysisAbort.current?.abort();
    setAnalysisProgress(null);
  };

  return { backgroundReview, analysisProgress, cancelAnalysis };
}
