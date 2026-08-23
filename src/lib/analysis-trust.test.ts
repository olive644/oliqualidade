import { describe, expect, it } from "vitest";

import { buildAnalysisTrustSummary } from "@/lib/analysis-trust";
import type { AutoDashboardPlan } from "@/lib/auto-dashboard";
import type { SpreadsheetIntelligence } from "@/lib/spreadsheet-intelligence";

const plan: AutoDashboardPlan = {
  classifications: [],
  recommendations: [],
  confidence: 82,
  reasons: [],
  warnings: [],
};

const intelligence: SpreadsheetIntelligence = {
  columns: [],
  regions: [],
  confidence: 94,
  warnings: [],
  exceptions: [
    {
      id: "critical-1",
      kind: "reader-divergence",
      severity: "critical",
      title: "Divergência de leitura",
      detail: "Leitores divergiram.",
    },
    {
      id: "warning-1",
      kind: "outlier",
      severity: "warning",
      title: "Valor atípico",
      detail: "Valor fora do padrão.",
    },
  ],
};

describe("buildAnalysisTrustSummary", () => {
  it("não mistura confiança da recomendação, confiança semântica e pendências", () => {
    expect(buildAnalysisTrustSummary(plan, intelligence)).toEqual({
      recommendationConfidence: 82,
      semanticConfidence: 94,
      pendingExceptionCount: 2,
      criticalExceptionCount: 1,
    });
  });

  it("remove da contagem as pendências já decididas pelo usuário", () => {
    expect(
      buildAnalysisTrustSummary(plan, intelligence, {
        "critical-1": { status: "resolved", updatedAt: 1 },
      }),
    ).toMatchObject({
      pendingExceptionCount: 1,
      criticalExceptionCount: 0,
    });
  });
});
