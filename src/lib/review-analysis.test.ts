import { describe, expect, it } from "vitest";

import { buildReviewAnalysis } from "@/lib/review-analysis";

describe("background review analysis", () => {
  it("reports deterministic phases and compares versions", () => {
    const progress: number[] = [];
    const result = buildReviewAnalysis(
      {
        rows: [{ item: "A", valor: 0 }],
        previousRows: [{ item: "A", valor: 4 }],
        columns: [
          { key: "item", label: "Item", kind: "category", visible: true, description: "" },
          { key: "valor", label: "Valor", kind: "number", visible: true, description: "" },
        ],
      },
      (state) => progress.push(state.percent),
    );
    expect(progress).toEqual([5, 65, 90, 100]);
    expect(result.versionDiff?.cellChanges[0]).toMatchObject({
      column: "valor",
      before: 4,
      after: 0,
    });
    expect(result.intelligence.columns).toHaveLength(2);
  });
});
