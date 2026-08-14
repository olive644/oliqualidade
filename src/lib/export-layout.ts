export const EXPORT_SURFACE_WIDTH = 1440;
export const MAX_EXPORT_PIXELS = 18_000_000;
export const MAX_EXPORT_DIMENSION = 28_000;

export function captureScale(
  width: number,
  height: number,
  preferredScale = 2,
  maxPixels = MAX_EXPORT_PIXELS,
  maxDimension = MAX_EXPORT_DIMENSION,
) {
  if (width <= 0 || height <= 0) return 1;
  const pixelScale = Math.sqrt(maxPixels / (width * height));
  const dimensionScale = Math.min(maxDimension / width, maxDimension / height);
  // Escalas menores que 1 são necessárias em painéis muito altos. Forçar 1
  // ultrapassava o limite do canvas e fazia o PNG terminar no meio.
  return Math.max(0.01, Math.min(preferredScale, pixelScale, dimensionScale));
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


export type PdfRowPage = {
  rowStart: number;
  rowEnd: number;
  heights: number[];
};

/**
 * Pagina linhas de altura variável sem repartir uma linha entre páginas.
 * Textos longos podem aumentar a altura da própria linha até o limite
 * definido por quem renderiza a tabela.
 */
export function pdfVariableRowPages(
  rowHeights: number[],
  availableHeightPt: number,
): PdfRowPage[] {
  if (availableHeightPt <= 0) return [];
  if (!rowHeights.length) return [{ rowStart: 0, rowEnd: 0, heights: [] }];

  const pages: PdfRowPage[] = [];
  let rowStart = 0;
  let heights: number[] = [];
  let used = 0;

  rowHeights.forEach((rawHeight, index) => {
    const height = Math.max(1, Math.min(rawHeight, availableHeightPt));
    if (heights.length && used + height > availableHeightPt) {
      pages.push({ rowStart, rowEnd: index, heights });
      rowStart = index;
      heights = [];
      used = 0;
    }
    heights.push(height);
    used += height;
  });

  pages.push({ rowStart, rowEnd: rowHeights.length, heights });
  return pages;
}

export type PdfColumnRange = {
  columnStart: number;
  columnEnd: number;
};

export function pdfColumnRanges(
  columnCount: number,
  contentWidthPt: number,
  minColumnWidthPt = 112,
): PdfColumnRange[] {
  if (columnCount <= 0 || contentWidthPt <= 0 || minColumnWidthPt <= 0) return [];
  const columnsPerPage = Math.max(1, Math.floor(contentWidthPt / minColumnWidthPt));
  const ranges: PdfColumnRange[] = [];
  for (let start = 0; start < columnCount; start += columnsPerPage) {
    ranges.push({ columnStart: start, columnEnd: Math.min(columnCount, start + columnsPerPage) });
  }
  return ranges;
}
