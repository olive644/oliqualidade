import { compareVersions, type VersionDiff } from "@/lib/import-workbench";
import {
  analyzeSpreadsheet,
  type SemanticOverrides,
  type SpreadsheetIntelligence,
} from "@/lib/spreadsheet-intelligence";
import type { Column, Row } from "@/lib/types";

export type ReviewAnalysisInput = {
  rows: Row[];
  columns: Column[];
  semanticOverrides?: SemanticOverrides;
  previousRows?: Row[];
};

export type ReviewAnalysisResult = {
  intelligence: SpreadsheetIntelligence;
  versionDiff: VersionDiff | null;
};

export type ReviewAnalysisProgress = {
  percent: number;
  phase: "preparing" | "analyzing" | "comparing" | "complete";
};

export function buildReviewAnalysis(
  input: ReviewAnalysisInput,
  onProgress?: (progress: ReviewAnalysisProgress) => void,
): ReviewAnalysisResult {
  onProgress?.({ percent: 5, phase: "preparing" });
  const intelligence = analyzeSpreadsheet(
    input.rows,
    input.columns,
    undefined,
    input.semanticOverrides,
  );
  onProgress?.({ percent: 65, phase: "analyzing" });
  const versionDiff = input.previousRows ? compareVersions(input.previousRows, input.rows) : null;
  onProgress?.({ percent: 90, phase: "comparing" });
  onProgress?.({ percent: 100, phase: "complete" });
  return { intelligence, versionDiff };
}
