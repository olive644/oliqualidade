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
