import { describe, expect, it } from "vitest";
import { captureScale, pdfPageSlices } from "@/lib/export-layout";

describe("export layout", () => {
  it("mantém alta resolução sem ultrapassar o limite seguro de pixels", () => {
    expect(captureScale(1000, 1000)).toBe(2);
    expect(captureScale(2000, 8000)).toBeCloseTo(Math.sqrt(18_000_000 / 16_000_000));
    expect(captureScale(0, 100)).toBe(1);
  });

  it("prefere quebrar o PDF entre widgets", () => {
    const slices = pdfPageSlices(1000, 2600, 700, 500, [680, 1380, 2060]);
    expect(slices).toEqual([
      { start: 0, height: 680 },
      { start: 680, height: 700 },
      { start: 1380, height: 680 },
      { start: 2060, height: 540 },
    ]);
  });

  it("cobre toda a imagem sem lacunas quando não há quebra adequada", () => {
    const slices = pdfPageSlices(1000, 1900, 700, 500);
    expect(slices.reduce((total, slice) => total + slice.height, 0)).toBe(1900);
    expect(slices[0]).toEqual({ start: 0, height: 714 });
  });
});
