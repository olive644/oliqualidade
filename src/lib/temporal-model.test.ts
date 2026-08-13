import { describe, expect, it } from "vitest";
import type * as XLSX from "xlsx";

import { buildTemporalCellModel, temporalGranularity } from "@/lib/temporal-model";

describe("modelo temporal com granularidade", () => {
  it("não inventa dia em células mês/ano", () => {
    const cell = {
      t: "d",
      v: new Date(Date.UTC(2025, 5, 1)),
      w: "Jun-25",
      z: "mmm-yy",
    } as XLSX.CellObject;
    expect(buildTemporalCellModel("B2", cell)).toMatchObject({
      granularity: "month",
      normalizedValue: "2025-06",
      year: 2025,
      month: 6,
      timeZoneIndependent: true,
    });
  });

  it("distingue hora de duração", () => {
    expect(temporalGranularity("hh:mm")).toBe("time");
    expect(temporalGranularity("[h]:mm")).toBe("duration");
    expect(temporalGranularity("dd/mm/yyyy hh:mm")).toBe("datetime");
  });
});
