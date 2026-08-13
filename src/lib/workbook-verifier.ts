import ExcelJS from "exceljs";
import type * as XLSX from "xlsx";

import type { ReaderDivergence } from "@/lib/ooxml-reader";
import { worksheetCellAtAddress } from "@/lib/worksheet-cell";

function normalized(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "result" in value)
    return normalized((value as { result?: unknown }).result);
  if (value && typeof value === "object" && "richText" in value)
    return (value as { richText: Array<{ text: string }> }).richText
      .map((part) => part.text)
      .join("");
  return String(value ?? "").trim();
}

/** Leitor independente usado na suíte e em diagnósticos sob demanda. */
export async function verifyWorkbookWithExcelJs(
  input: ArrayBuffer | Uint8Array,
  primary: XLSX.WorkBook,
): Promise<ReaderDivergence[]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const divergences: ReaderDivergence[] = [];
  workbook.eachSheet((sheet) => {
    const primarySheet = primary.Sheets[sheet.name];
    if (!primarySheet) return;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const address = cell.address;
        // ExcelJS expõe o valor da célula mestre em todas as células de um
        // intervalo mesclado. SheetJS mantém apenas a mestre, conforme OOXML.
        // Isso é diferença de representação, não perda de dados.
        if (cell.isMerged && cell.master.address !== address) return;
        const first = normalized(worksheetCellAtAddress(primarySheet, address)?.v);
        const second = normalized(cell.value);
        if (
          first === second ||
          normalized(worksheetCellAtAddress(primarySheet, address)?.w) === cell.text
        )
          return;
        divergences.push({
          sheet: sheet.name,
          address,
          primary: first,
          independent: second,
          severity: !first && second ? "error" : "warning",
          repaired: false,
        });
      });
    });
  });
  return divergences.slice(0, 2_000);
}
