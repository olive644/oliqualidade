import { describe, expect, it } from "vitest";
import { captureScale, pdfPageSlices, pdfTablePages } from "@/lib/export-layout";

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

  it("pagina tabelas largas e longas sem cortar linhas ou colunas", () => {
    const pages = pdfTablePages(55, 12, 700, 500, {
      minColumnWidthPt: 100,
      rowHeightPt: 20,
      tableHeaderHeightPt: 30,
      titleHeightPt: 30,
    });

    expect(pages).toEqual([
      { columnStart: 0, columnEnd: 7, rowStart: 0, rowEnd: 22 },
      { columnStart: 0, columnEnd: 7, rowStart: 22, rowEnd: 44 },
      { columnStart: 0, columnEnd: 7, rowStart: 44, rowEnd: 55 },
      { columnStart: 7, columnEnd: 12, rowStart: 0, rowEnd: 22 },
      { columnStart: 7, columnEnd: 12, rowStart: 22, rowEnd: 44 },
      { columnStart: 7, columnEnd: 12, rowStart: 44, rowEnd: 55 },
    ]);
  });

  it("gera uma página de cabeçalho para uma tabela vazia", () => {
    expect(pdfTablePages(0, 3, 700, 500)).toEqual([
      { columnStart: 0, columnEnd: 3, rowStart: 0, rowEnd: 0 },
    ]);
  });
});
