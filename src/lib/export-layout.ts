export const EXPORT_SURFACE_WIDTH = 1440;
export const MAX_EXPORT_PIXELS = 18_000_000;

export function captureScale(
  width: number,
  height: number,
  preferredScale = 2,
  maxPixels = MAX_EXPORT_PIXELS,
) {
  if (width <= 0 || height <= 0) return 1;
  return Math.max(1, Math.min(preferredScale, Math.sqrt(maxPixels / (width * height))));
}

export function pdfPageSlices(
  canvasWidth: number,
  canvasHeight: number,
  contentWidthPt: number,
  contentHeightPt: number,
  breakpoints: number[] = [],
) {
  if (canvasWidth <= 0 || canvasHeight <= 0 || contentWidthPt <= 0 || contentHeightPt <= 0) {
    return [];
  }
  const targetHeight = Math.max(1, Math.floor((canvasWidth * contentHeightPt) / contentWidthPt));
  const sortedBreakpoints = [...new Set(breakpoints)]
    .filter((point) => point > 0 && point < canvasHeight)
    .sort((a, b) => a - b);
  const slices: Array<{ start: number; height: number }> = [];
  let start = 0;

  while (start < canvasHeight) {
    const idealEnd = Math.min(canvasHeight, start + targetHeight);
    if (idealEnd === canvasHeight) {
      slices.push({ start, height: canvasHeight - start });
      break;
    }
    const minimumUsefulEnd = start + targetHeight * 0.58;
    const cleanEnd = sortedBreakpoints
      .filter((point) => point >= minimumUsefulEnd && point <= idealEnd)
      .at(-1);
    const end = Math.max(start + 1, cleanEnd ?? idealEnd);
    slices.push({ start, height: end - start });
    start = end;
  }
  return slices;
}

export type PdfTablePage = {
  columnStart: number;
  columnEnd: number;
  rowStart: number;
  rowEnd: number;
};

/**
 * Divide uma tabela em páginas legíveis, tanto por linhas quanto por
 * colunas. Os limites são exclusivos no fim e nunca repartem uma célula.
 */
export function pdfTablePages(
  rowCount: number,
  columnCount: number,
  contentWidthPt: number,
  contentHeightPt: number,
  options: {
    minColumnWidthPt?: number;
    rowHeightPt?: number;
    tableHeaderHeightPt?: number;
    titleHeightPt?: number;
  } = {},
): PdfTablePage[] {
  if (rowCount < 0 || columnCount <= 0 || contentWidthPt <= 0 || contentHeightPt <= 0) return [];
  const minColumnWidth = options.minColumnWidthPt ?? 92;
  const rowHeight = options.rowHeightPt ?? 18;
  const tableHeaderHeight = options.tableHeaderHeightPt ?? 24;
  const titleHeight = options.titleHeightPt ?? 24;
  const columnsPerPage = Math.max(1, Math.floor(contentWidthPt / minColumnWidth));
  const rowsPerPage = Math.max(
    1,
    Math.floor((contentHeightPt - tableHeaderHeight - titleHeight) / rowHeight),
  );
  const pages: PdfTablePage[] = [];

  for (let columnStart = 0; columnStart < columnCount; columnStart += columnsPerPage) {
    const columnEnd = Math.min(columnCount, columnStart + columnsPerPage);
    const rowPages = Math.max(1, Math.ceil(rowCount / rowsPerPage));
    for (let page = 0; page < rowPages; page++) {
      const rowStart = page * rowsPerPage;
      pages.push({
        columnStart,
        columnEnd,
        rowStart,
        rowEnd: Math.min(rowCount, rowStart + rowsPerPage),
      });
    }
  }
  return pages;
}
