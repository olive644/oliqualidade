import {
  captureScale,
  EXPORT_SURFACE_WIDTH,
  pdfColumnRanges,
  pdfPageSlices,
  pdfVariableRowPages,
} from "@/lib/export-layout";
import { conditionalStyle, fmt } from "@/lib/format";
import type { Column, Row, Widget } from "@/lib/types";

export type DashboardExportOptions = {
  element: HTMLElement;
  dashboardId: string;
  dashboardName: string;
  sheetName: string;
  rows: Row[];
  sourceRowCount: number;
  columns: Column[];
  widgets: Widget[];
  slug: string;
};

type DashboardCapture = {
  canvas: HTMLCanvasElement;
  breakpoints: number[];
};

type ChartSvgSnapshot = {
  dataUrl: string;
  height: number;
  width: number;
};

const SVG_PRESENTATION_PROPERTIES = [
  "color",
  "display",
  "fill",
  "fill-opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "stroke-width",
  "stop-color",
  "stop-opacity",
  "text-anchor",
  "visibility",
] as const;

const SVG_COLOR_PROPERTIES = new Set<string>(["color", "fill", "stroke", "stop-color"]);

/**
 * O Recharts 3 separa as camadas do gráfico em grupos SVG com z-index. O
 * html2canvas não preserva essas camadas de forma confiável ao clonar um DOM
 * grande para PNG/PDF. Congelamos cada SVG como uma imagem autocontida, com
 * variáveis CSS já resolvidas, apenas dentro do clone usado na exportação.
 */
async function chartSvgSnapshots(element: HTMLElement): Promise<ChartSvgSnapshot[]> {
  const { Canvg } = await import("canvg");
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = 1;
  colorCanvas.height = 1;
  const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
  if (!colorContext) throw new Error("chart-svg-color-context");
  const portableColor = (value: string) => {
    if (value === "none" || value.startsWith("url(")) return value;
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = "#000";
    colorContext.fillStyle = value;
    colorContext.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0, alpha = 255] = colorContext.getImageData(0, 0, 1, 1).data;
    return alpha === 255
      ? `rgb(${red}, ${green}, ${blue})`
      : `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
  };
  return Promise.all(
    [...element.querySelectorAll<SVGSVGElement>("svg.recharts-surface")].map(async (svg) => {
      const rect = svg.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(width));
      clone.setAttribute("height", String(height));
      if (!clone.hasAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);

      const sourceNodes = [svg, ...svg.querySelectorAll<SVGElement>("*")];
      const clonedNodes = [clone, ...clone.querySelectorAll<SVGElement>("*")];
      sourceNodes.forEach((source, index) => {
        const target = clonedNodes[index];
        if (!target) return;
        const computed = getComputedStyle(source);
        SVG_PRESENTATION_PROPERTIES.forEach((property) => {
          const value = computed.getPropertyValue(property);
          if (value) {
            target.style.setProperty(
              property,
              SVG_COLOR_PROPERTIES.has(property) ? portableColor(value) : value,
            );
          }
        });
      });

      const serialized = new XMLSerializer().serializeToString(clone);
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("chart-svg-canvas-context");
      const renderer = Canvg.fromString(context, serialized, {
        ignoreAnimation: true,
        ignoreMouse: true,
      });
      await renderer.render({
        ignoreAnimation: true,
        ignoreMouse: true,
        scaleHeight: height * scale,
        scaleWidth: width * scale,
      });

      // Uma regressão do renderizador não pode produzir silenciosamente um
      // arquivo válido, porém sem gráfico. O limite baixo também contempla
      // sparklines de um único traço, sem confundir transparência com sucesso.
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let paintedPixels = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 0) paintedPixels += 1;
      }
      if (paintedPixels < 4) throw new Error("chart-svg-rasterization-empty");
      const dataUrl = canvas.toDataURL("image/png");
      canvas.width = 1;
      canvas.height = 1;
      return {
        dataUrl,
        height,
        width,
      };
    }),
  );
}

async function replaceChartSvgsForCapture(
  element: HTMLElement,
  snapshots: ChartSvgSnapshot[],
): Promise<() => void> {
  const originals = [...element.querySelectorAll<SVGSVGElement>("svg.recharts-surface")];
  const replacements = await Promise.all(
    originals.map(async (svg, index) => {
      const snapshot = snapshots[index];
      if (!snapshot) return null;
      const image = document.createElement("img");
      image.alt = "";
      image.setAttribute("aria-hidden", "true");
      image.setAttribute("data-export-chart", "true");
      image.style.width = `${snapshot.width}px`;
      image.style.height = `${snapshot.height}px`;
      image.style.maxWidth = "100%";
      image.style.display = "block";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("chart-png-loading-failed"));
        image.src = snapshot.dataUrl;
      });
      return { image, svg };
    }),
  );
  replacements.forEach((replacement) => replacement?.svg.replaceWith(replacement.image));
  return () => {
    replacements.forEach((replacement) => {
      if (replacement?.image.isConnected) replacement.image.replaceWith(replacement.svg);
    });
  };
}

async function settleExportLayout() {
  await document.fonts?.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => setTimeout(resolve, 120));
}

function exportBreakpoints(element: HTMLElement) {
  const rootTop = element.getBoundingClientRect().top;
  const rows = new Map<number, number>();
  const points = new Set<number>();
  for (const widget of element.querySelectorAll<HTMLElement>(".oliam-widget")) {
    const rect = widget.getBoundingClientRect();
    const rowTop = Math.round(rect.top - rootTop);
    rows.set(rowTop, Math.max(rows.get(rowTop) ?? 0, rect.bottom - rootTop + 12));
  }
  rows.forEach((point) => points.add(point));
  for (const block of element.querySelectorAll<HTMLElement>(
    ".oliam-export-header, details li, [data-export-break-after], .oliam-export-footer",
  )) {
    const rect = block.getBoundingClientRect();
    points.add(Math.round(rect.bottom - rootTop + 6));
  }
  return [...points].filter((point) => point > 0).sort((a, b) => a - b);
}

async function captureDashboard(element: HTMLElement): Promise<DashboardCapture> {
  const previousScroll = { left: element.scrollLeft, top: element.scrollTop };
  let restoreChartSvgs = () => {};
  element.classList.add("oliam-export-mode");
  element.scrollTo(0, 0);
  // <details> fechado (ex.: "Observações da planilha") esconde o conteúdo
  // nativamente no navegador, mas exportBreakpoints() já assume que está
  // aberto (usa "details li" para calcular quebra de página) — sem abrir de
  // verdade aqui, o html2canvas captura um estado inconsistente (conteúdo
  // parcialmente visível/sobreposto ao resumo em vez de escondido ou
  // mostrado por completo). Restaurado no finally para não afetar a UI viva.
  const detailsElements = [...element.querySelectorAll<HTMLDetailsElement>("details")];
  const previousDetailsOpen = detailsElements.map((node) => node.open);
  detailsElements.forEach((node) => (node.open = true));
  try {
    await settleExportLayout();
    window.dispatchEvent(new Event("resize"));
    await settleExportLayout();
    const cssWidth = Math.ceil(element.getBoundingClientRect().width);
    const cssHeight = element.scrollHeight;
    const cleanBreakpoints = exportBreakpoints(element);
    const chartSnapshots = await chartSvgSnapshots(element);
    restoreChartSvgs = await replaceChartSvgsForCapture(element, chartSnapshots);
    await settleExportLayout();
    const { default: html2canvas } = await import("html2canvas-pro");
    const canvas = await html2canvas(element, {
      backgroundColor: getComputedStyle(element).backgroundColor,
      scale: captureScale(cssWidth, cssHeight),
      width: cssWidth,
      height: cssHeight,
      windowWidth: EXPORT_SURFACE_WIDTH,
      windowHeight: cssHeight,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      allowTaint: false,
      imageTimeout: 12_000,
      logging: false,
      onclone: (clonedDocument, clonedElement) => {
        clonedElement.classList.add("oliam-export-mode");
        clonedDocument.querySelectorAll("[data-export-controls]").forEach((node) => node.remove());
      },
    });
    const renderedScale = canvas.width / cssWidth;
    return {
      canvas,
      breakpoints: cleanBreakpoints.map((point) => Math.round(point * renderedScale)),
    };
  } finally {
    restoreChartSvgs();
    element.classList.remove("oliam-export-mode");
    element.scrollTo(previousScroll.left, previousScroll.top);
    detailsElements.forEach((node, index) => (node.open = previousDetailsOpen[index] ?? false));
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas-blob-failed"))),
      type,
      quality,
    ),
  );
}

async function rasterizeExportMark(opacity = 1) {
  const image = new Image();
  image.src = "/oli-mark.svg";
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("export-mark-context");
  context.globalAlpha = opacity;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/png");
  canvas.width = 1;
  canvas.height = 1;
  return dataUrl;
}

export async function exportDashboardPng({ element, slug }: DashboardExportOptions) {
  const capture = await captureDashboard(element);
  downloadBlob(await canvasBlob(capture.canvas, "image/png"), `${slug}.png`);
}

export async function exportDashboardPdf(options: DashboardExportOptions) {
  const { element, dashboardId, dashboardName, rows, columns, widgets, slug } = options;
  const capture = await captureDashboard(element);
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 28;
  const headerHeight = 34;
  const footerHeight = 30;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2 - headerHeight - footerHeight;
  const generatedAt = new Date();
  const compactDate = generatedAt
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const reportId = `OQ-${compactDate}-${dashboardId.slice(0, 8).toUpperCase()}`;
  const markDataUrl = await rasterizeExportMark();
  const watermarkDataUrl = await rasterizeExportMark(0.055);
  const slices = pdfPageSlices(
    capture.canvas.width,
    capture.canvas.height,
    contentWidth,
    contentHeight,
    capture.breakpoints,
  );
  const tableColumns = widgets.some((widget) => widget.type === "table")
    ? columns.filter((column) => column.visible)
    : [];

  const fitPdfText = (value: string, maxWidth: number) => {
    if (pdf.getTextWidth(value) <= maxWidth) return value;
    let low = 0;
    let high = value.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (pdf.getTextWidth(`${value.slice(0, middle)}…`) <= maxWidth) low = middle;
      else high = middle - 1;
    }
    return `${value.slice(0, low)}…`;
  };
  const hexRgb = (color: string): [number, number, number] | null => {
    const match = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
    return match
      ? [
          Number.parseInt(match[1]!, 16),
          Number.parseInt(match[2]!, 16),
          Number.parseInt(match[3]!, 16),
        ]
      : null;
  };

  type TableExportPage = {
    columnStart: number;
    columnEnd: number;
    rowStart: number;
    rowEnd: number;
    heights: number[];
    cells: string[][][];
  };
  const tablePages: TableExportPage[] = [];
  const tableTitleHeight = 24;
  const tableHeaderHeight = 26;
  const tableBodyHeight = contentHeight - tableTitleHeight - tableHeaderHeight;
  const lineHeight = 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  for (const range of pdfColumnRanges(tableColumns.length, contentWidth, 112)) {
    const columnsOnPage = tableColumns.slice(range.columnStart, range.columnEnd);
    const columnWidth = contentWidth / columnsOnPage.length;
    const maximumLines = Math.max(1, Math.floor((tableBodyHeight - 8) / lineHeight));
    const allCells = rows.map((row) =>
      columnsOnPage.map((column) => {
        const shown = fmt(row[column.key] ?? null, column.kind) ?? "—";
        const lines = pdf.splitTextToSize(shown, columnWidth - 10) as string[];
        if (lines.length <= maximumLines) return lines;
        const visible = lines.slice(0, maximumLines);
        visible[visible.length - 1] = fitPdfText(
          `${visible[visible.length - 1] ?? ""}…`,
          columnWidth - 10,
        );
        return visible;
      }),
    );
    const rowHeights = allCells.map((cells) =>
      Math.max(20, Math.max(1, ...cells.map((lines) => lines.length)) * lineHeight + 8),
    );
    for (const page of pdfVariableRowPages(rowHeights, tableBodyHeight)) {
      tablePages.push({
        ...range,
        rowStart: page.rowStart,
        rowEnd: page.rowEnd,
        heights: page.heights,
        cells: allCells.slice(page.rowStart, page.rowEnd),
      });
    }
  }

  const totalPages = slices.length + tablePages.length;
  const drawPageBranding = (index: number, detail: string) => {
    const finalPage = index === totalPages - 1;
    const watermarkSize = 124;
    pdf.addImage(
      watermarkDataUrl,
      "PNG",
      (pageWidth - watermarkSize) / 2,
      (pageHeight - watermarkSize) / 2,
      watermarkSize,
      watermarkSize,
      undefined,
      "FAST",
    );
    pdf.addImage(markDataUrl, "PNG", margin, margin - 2, 22, 22, undefined, "FAST");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(20, 42, 50);
    pdf.text(fitPdfText(dashboardName, pageWidth * 0.42), margin + 28, margin + 10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(
      `${detail} · ${generatedAt.toLocaleString("pt-BR")}`,
      pageWidth - margin,
      margin + 10,
      { align: "right" },
    );
    const footerLineY = pageHeight - margin - 11;
    pdf.setDrawColor(14, 138, 141);
    pdf.line(margin, footerLineY, pageWidth - margin, footerLineY);
    pdf.addImage(markDataUrl, "PNG", margin, footerLineY + 4, 13, 13, undefined, "FAST");
    pdf.setFontSize(7);
    pdf.setTextColor(71, 85, 105);
    pdf.text(
      finalPage
        ? "Assinatura de origem OliQualidade · uso licenciado · documento gerado pela plataforma"
        : "Documento gerado por OliQualidade",
      margin + 17,
      footerLineY + 13,
    );
    pdf.setFont("courier", "normal");
    pdf.text(reportId, pageWidth / 2, footerLineY + 13, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.text(`Página ${index + 1} de ${totalPages}`, pageWidth - margin, footerLineY + 13, {
      align: "right",
    });
  };

  for (const [index, slice] of slices.entries()) {
    if (index > 0) pdf.addPage();
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = capture.canvas.width;
    pageCanvas.height = slice.height;
    const context = pageCanvas.getContext("2d");
    if (!context) throw new Error("pdf-canvas-context");
    context.drawImage(
      capture.canvas,
      0,
      slice.start,
      capture.canvas.width,
      slice.height,
      0,
      0,
      pageCanvas.width,
      pageCanvas.height,
    );
    const imageHeight = (slice.height * contentWidth) / capture.canvas.width;
    pdf.addImage(
      pageCanvas.toDataURL("image/jpeg", 0.94),
      "JPEG",
      margin,
      margin + headerHeight,
      contentWidth,
      imageHeight,
      undefined,
      "FAST",
    );
    drawPageBranding(index, `${rows.length} linhas na visão atual`);
    pageCanvas.width = 1;
    pageCanvas.height = 1;
  }

  for (const [tableIndex, plan] of tablePages.entries()) {
    const pageIndex = slices.length + tableIndex;
    if (pageIndex > 0) pdf.addPage();
    const columnsOnPage = tableColumns.slice(plan.columnStart, plan.columnEnd);
    const columnWidth = contentWidth / columnsOnPage.length;
    const contentTop = margin + headerHeight;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(30, 41, 59);
    const rowRange =
      plan.rowEnd > plan.rowStart ? `linhas ${plan.rowStart + 1}–${plan.rowEnd}` : "sem linhas";
    pdf.text(
      `Base detalhada · ${rowRange} · colunas ${plan.columnStart + 1}–${plan.columnEnd}`,
      margin,
      contentTop + 15,
    );
    const headerY = contentTop + tableTitleHeight;
    pdf.setFillColor(234, 245, 244);
    pdf.setDrawColor(173, 211, 211);
    pdf.rect(margin, headerY, contentWidth, tableHeaderHeight, "FD");
    pdf.setFontSize(7.5);
    columnsOnPage.forEach((column, columnIndex) => {
      const x = margin + columnIndex * columnWidth;
      if (columnIndex > 0) pdf.line(x, headerY, x, headerY + tableHeaderHeight);
      pdf.text(fitPdfText(column.label, columnWidth - 10), x + 5, headerY + 16);
    });

    let y = headerY + tableHeaderHeight;
    plan.cells.forEach((cells, rowOffset) => {
      const height = plan.heights[rowOffset] ?? 20;
      if ((plan.rowStart + rowOffset) % 2 === 1) {
        pdf.setFillColor(248, 250, 252);
        pdf.rect(margin, y, contentWidth, height, "F");
      }
      pdf.setDrawColor(226, 232, 240);
      pdf.line(margin, y + height, margin + contentWidth, y + height);
      columnsOnPage.forEach((column, columnIndex) => {
        const x = margin + columnIndex * columnWidth;
        if (columnIndex > 0) pdf.line(x, y, x, y + height);
        const raw = rows[plan.rowStart + rowOffset]?.[column.key] ?? null;
        const style = conditionalStyle(raw, column.kind, column.conditionalFormat);
        const textColor = style?.color ? hexRgb(style.color) : null;
        if (textColor) pdf.setTextColor(...textColor);
        else pdf.setTextColor(30, 41, 59);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.5);
        pdf.text(cells[columnIndex] ?? ["—"], x + 5, y + 11, {
          lineHeightFactor: 1.05,
        });
      });
      y += height;
    });
    drawPageBranding(pageIndex, `${rows.length} linhas na tabela completa`);
  }
  downloadBlob(pdf.output("blob"), `${slug}.pdf`);
}
