import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  decryptDashboardBackup,
  encryptDashboardBackup,
  safeRowsForSpreadsheet,
} from "@/lib/encrypted-backup";
import {
  auditExportRows,
  comparisonExportRows,
  reviewReportSections,
  rowsToCsv,
} from "@/lib/review-export";
import { exportDashboardPdf, exportDashboardPng } from "@/lib/dashboard-export";
import type { Column, Dashboard, Row, Widget } from "@/lib/types";

/**
 * Todas as exportações do painel (planilha, cópia corrigida, CSVs de
 * auditoria/comparação, PDF de revisão, PNG/PDF do painel, backup
 * criptografado e sua restauração). Bibliotecas pesadas (xlsx, jspdf) só
 * carregam quando a exportação correspondente é usada de fato.
 */
export function useDashboardExport(p: {
  dashboard: Dashboard;
  sheetName: string;
  data: Row[];
  sourceRowCount: number;
  columns: Column[];
  widgets: Widget[];
  contentRef: React.RefObject<HTMLDivElement | null>;
  onRestore: (restored: Dashboard) => void;
}) {
  const { dashboard: d } = p;
  const [exporting, setExporting] = useState<"png" | "pdf" | "review" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!exportError) return;
    const id = setTimeout(() => setExportError(null), 5000);
    return () => clearTimeout(id);
  }, [exportError]);

  const slug = d.name.toLowerCase().replaceAll(" ", "-");

  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(safeRowsForSpreadsheet(p.data)),
      wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório");
    XLSX.writeFile(wb, `${slug}.xlsx`);
  };

  const downloadText = (content: string, fileName: string, type = "text/csv;charset=utf-8") => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  };

  const exportAuditCsv = () => {
    const rows = auditExportRows(d);
    if (!rows.length) {
      toast.info("Ainda não há ajustes registrados para exportar.");
      return;
    }
    downloadText(rowsToCsv(rows), `${slug}-auditoria.csv`);
    toast.success("Auditoria exportada com origem, antes, depois e motivo.");
  };

  const exportComparisonCsv = () => {
    const rows = comparisonExportRows(d);
    if (!rows.length) {
      toast.info("Importe uma nova versão para gerar o comparador.");
      return;
    }
    downloadText(rowsToCsv(rows), `${slug}-comparacao.csv`);
    toast.success("Comparação exportada célula por célula.");
  };

  const exportCorrectedWorkbook = async () => {
    const [{ buildCorrectedWorkbook }, XLSX] = await Promise.all([
      import("@/lib/review-workbook"),
      import("xlsx"),
    ]);
    XLSX.writeFile(buildCorrectedWorkbook(d), `${slug}-copia-corrigida.xlsx`, {
      compression: true,
    });
    toast.success("Cópia corrigida criada. O arquivo original permaneceu intacto.");
  };

  const exportReviewPdf = async () => {
    setExporting("review");
    try {
      const { jsPDF } = await import("jspdf");
      const report = reviewReportSections(d);
      if (!report.audit.length && !report.comparison.length) {
        toast.info("Ainda não há auditoria nem comparação para incluir no relatório.");
        return;
      }
      const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const margin = 36;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let y = margin;
      const newPage = () => {
        pdf.addPage();
        y = margin;
      };
      const line = (text: string, indent = 0, bold = false) => {
        pdf.setFont("helvetica", bold ? "bold" : "normal");
        pdf.setFontSize(bold ? 11 : 8);
        const parts = pdf.splitTextToSize(text, pageWidth - margin * 2 - indent) as string[];
        if (y + parts.length * 11 > pageHeight - margin) newPage();
        pdf.text(parts, margin + indent, y);
        y += parts.length * 11 + (bold ? 5 : 2);
      };
      line(`Relatório de revisão — ${d.name}`, 0, true);
      line(
        `Origem: ${d.sourceFileName ?? d.name} · Gerado em ${new Date(report.generatedAt).toLocaleString("pt-BR")}`,
      );
      y += 8;
      line(`Auditoria (${report.audit.length})`, 0, true);
      for (const item of report.audit)
        line(
          `${item.Aba} · ${item.Local || "sem endereço"} · ${item.Ação} · ${String(item.Antes)} → ${String(item.Depois)} · ${item.Motivo}`,
          10,
        );
      y += 8;
      line(`Comparação de versões (${report.comparison.length})`, 0, true);
      for (const item of report.comparison)
        line(
          `${item.Aba} · ${item.Tipo}${item.Coluna ? ` · ${item.Coluna}` : ""}${item.Linha ? ` · linha ${item.Linha}` : ""} · ${String(item.Antes)} → ${String(item.Depois)} · ${item.Observação}`,
          10,
        );
      pdf.save(`${slug}-relatorio-revisao.pdf`);
      toast.success("Relatório PDF de revisão criado.");
    } catch {
      toast.error("Não foi possível gerar o relatório de revisão.");
    } finally {
      setExporting(null);
    }
  };

  const exportEncryptedBackup = async () => {
    const password = window.prompt(
      "Crie uma senha para proteger este backup (mínimo 12 caracteres)",
    );
    if (!password) return;
    try {
      const content = await encryptDashboardBackup(d, password);
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug}.oli-backup`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Backup criptografado criado. Guarde a senha separadamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o backup.");
    }
  };

  const restoreEncryptedBackup = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      toast.error("O backup excede o limite de 50 MB.");
      return;
    }
    const password = window.prompt("Digite a senha deste backup");
    if (!password) return;
    try {
      const restored = await decryptDashboardBackup(await file.text(), password);
      const copy = {
        ...restored,
        id: d.id,
        name: `${restored.name} (restaurado)`,
        createdAt: d.createdAt,
        updatedAt: Date.now(),
      };
      p.onRestore(copy);
      toast.success(`Backup “${copy.name}” restaurado neste painel.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível restaurar o backup.");
    }
  };

  const dashboardExportOptions = () => {
    const element = p.contentRef.current;
    if (!element) return null;
    return {
      element,
      dashboardId: d.id,
      dashboardName: d.name,
      sheetName: p.sheetName,
      rows: p.data,
      sourceRowCount: p.sourceRowCount,
      columns: p.columns,
      widgets: p.widgets,
      slug,
    };
  };

  const exportPng = async () => {
    setExporting("png");
    setExportError(null);
    try {
      const options = dashboardExportOptions();
      if (!options) return;
      await exportDashboardPng(options);
      toast.success("PNG completo exportado com assinatura OliQualidade.");
    } catch (err) {
      console.error("Falha ao exportar PNG:", err);
      setExportError("Não foi possível gerar o PNG. Tente novamente.");
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    setExporting("pdf");
    setExportError(null);
    try {
      const options = dashboardExportOptions();
      if (!options) return;
      await exportDashboardPdf(options);
      toast.success("PDF exportado com paginação e assinatura OliQualidade.");
    } catch (err) {
      console.error("Falha ao exportar PDF:", err);
      setExportError("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setExporting(null);
    }
  };

  return {
    exporting,
    exportError,
    exportXlsx,
    exportAuditCsv,
    exportComparisonCsv,
    exportCorrectedWorkbook,
    exportReviewPdf,
    exportEncryptedBackup,
    restoreEncryptedBackup,
    exportPng,
    exportPdf,
  };
}
