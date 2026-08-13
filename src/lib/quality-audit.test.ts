import { describe, expect, it } from "vitest";

import { buildAdaptedQualityAudit } from "@/lib/quality-audit";

describe("auditoria adaptada ao Oli", () => {
  it("não penaliza períodos futuros vazios como dados perdidos", () => {
    const audit = buildAdaptedQualityAudit({
      rows: [
        { Item: "A", "jun/2025": 3, "set/2025": null },
        { Item: "B", "jun/2025": 4, "set/2025": null },
      ],
      columnConsistency: [
        { key: "Item", score: 100 },
        { key: "jun/2025", score: 100 },
        { key: "set/2025", score: 100 },
      ],
      duplicateRows: 0,
      interpretationScore: 100,
      unresolvedReaderDivergences: 0,
    });
    expect(audit.dimensions.completeness.score).toBe(100);
    expect(audit.intentionalBlankCells).toBe(2);
    expect(audit.score).toBe(100);
  });

  it("reduz fidelidade quando leitores discordam", () => {
    const audit = buildAdaptedQualityAudit({
      rows: [{ Item: "A" }],
      columnConsistency: [{ key: "Item", score: 100 }],
      duplicateRows: 0,
      interpretationScore: 100,
      unresolvedReaderDivergences: 3,
    });
    expect(audit.dimensions.fidelity.score).toBe(94);
  });
});
