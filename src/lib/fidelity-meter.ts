import * as XLSX from "xlsx";

import { compareAndRepairWithOoxml, inspectOoxml, type ReaderDivergence } from "@/lib/ooxml-reader";
import { verifyWorkbookWithExcelJs } from "@/lib/workbook-verifier";

export type WorkbookFidelityReport = {
  score: number;
  sourceCells: number;
  divergentCells: number;
  divergences: ReaderDivergence[];
  readers: ["SheetJS", "OOXML", "ExcelJS"];
};

/** Mede preservação de células, sem confundir vazio legítimo com falha. */
export async function measureWorkbookFidelity(
  input: ArrayBuffer | Uint8Array,
): Promise<WorkbookFidelityReport> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const primary = XLSX.read(bytes, {
    type: "array",
    cellDates: true,
    cellFormula: true,
    cellNF: true,
    cellText: true,
    sheetStubs: true,
    nodim: true,
    UTC: false,
  });
  const ooxml = inspectOoxml(bytes);
  const ooxmlDivergences = compareAndRepairWithOoxml(primary, ooxml);
  const excelJsDivergences = await verifyWorkbookWithExcelJs(bytes, primary);
  const byCell = new Map<string, ReaderDivergence>();
  for (const divergence of [...ooxmlDivergences, ...excelJsDivergences]) {
    if (divergence.severity === "error")
      byCell.set(`${divergence.sheet}!${divergence.address}`, divergence);
  }
  const sourceCells = [...ooxml.sheets.values()].reduce((sum, cells) => sum + cells.size, 0);
  const divergentCells = byCell.size;
  return {
    score: Math.round((1 - divergentCells / Math.max(1, sourceCells)) * 10_000) / 100,
    sourceCells,
    divergentCells,
    divergences: [...byCell.values()],
    readers: ["SheetJS", "OOXML", "ExcelJS"],
  };
}
