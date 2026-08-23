import type { AutoDashboardPlan } from "@/lib/auto-dashboard";
import type { ExceptionDecisions, SpreadsheetIntelligence } from "@/lib/spreadsheet-intelligence";

export type AnalysisTrustSummary = {
  recommendationConfidence: number | null;
  semanticConfidence: number;
  pendingExceptionCount: number;
  criticalExceptionCount: number;
};

/**
 * Mantém separadas medidas que respondem a perguntas diferentes. A confiança
 * da recomendação diz se os gráficos sugeridos combinam com a estrutura. A
 * confiança semântica diz se papéis e unidades das colunas foram entendidos.
 * Exceções são pendências observadas e nunca viram uma terceira média opaca.
 */
export function buildAnalysisTrustSummary(
  plan: AutoDashboardPlan | undefined,
  intelligence: SpreadsheetIntelligence,
  decisions: ExceptionDecisions = {},
): AnalysisTrustSummary {
  const pending = intelligence.exceptions.filter((exception) => !decisions[exception.id]);
  return {
    recommendationConfidence: plan?.confidence ?? null,
    semanticConfidence: intelligence.confidence,
    pendingExceptionCount: pending.length,
    criticalExceptionCount: pending.filter((exception) => exception.severity === "critical").length,
  };
}
