import * as XLSX from "xlsx";

import { safeRowsForSpreadsheet } from "@/lib/encrypted-backup";
import { auditExportRows, comparisonExportRows } from "@/lib/review-export";
import type { Dashboard, Row, SheetData } from "@/lib/types";

function uniqueSheetName(name: string, used: Set<string>): string {
  const clean = name.replace(/[\\/?*[\]:]/g, " ").trim() || "Aba";
  let candidate = clean.slice(0, 31);
  let suffix = 2;
  while (used.has(candidate)) {
    const marker = ` (${suffix++})`;
    candidate = `${clean.slice(0, 31 - marker.length)}${marker}`;
  }
  used.add(candidate);
  return candidate;
}

function sheetRows(sheet: SheetData): Row[] {
  return sheet.rows.map((row) =>
    Object.fromEntries(
      sheet.columns.map((column) => [column.label || column.key, row[column.key] ?? null]),
    ),
  );
}

export function buildCorrectedWorkbook(dashboard: Dashboard): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sheet of dashboard.sheets) {
    const worksheet = XLSX.utils.json_to_sheet(safeRowsForSpreadsheet(sheetRows(sheet)), {
      skipHeader: false,
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, uniqueSheetName(sheet.name, used));
  }
  const audit = auditExportRows(dashboard);
  if (audit.length) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(safeRowsForSpreadsheet(audit)),
      uniqueSheetName("Histórico de auditoria", used),
    );
  }
  const comparison = comparisonExportRows(dashboard);
  if (comparison.length) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(safeRowsForSpreadsheet(comparison)),
      uniqueSheetName("Comparação de versões", used),
    );
  }
  workbook.Props = {
    Title: `${dashboard.name} — cópia corrigida`,
    Subject:
      `Cópia reconstruída sem alteração do arquivo de origem ${dashboard.sourceFileName ?? ""}`.trim(),
    Author: "Oli.Qualidade",
    CreatedDate: new Date(),
  };
  return workbook;
}
