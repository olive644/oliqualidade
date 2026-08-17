import * as XLSX from "xlsx";
import type { ImportAudit, SourceGrid } from "@/lib/import";
import type { ImportDiagnostics } from "@/lib/import-intelligence";
import type { Column, Row } from "@/lib/types";

export type SourceCellFill = {
  rowIndex: number;
  columnKey: string;
  color: string;
};

/**
 * Resolve a cor de preenchimento original do Excel por (linha final, coluna
 * final), casando o rótulo de cada coluna com o texto literal da linha de
 * cabeçalho na grade de origem e assumindo que os dados seguem o cabeçalho
 * sequencialmente, sem lacuna.
 *
 * Deliberadamente conservador: só resolve quando a aba é "simples" o
 * bastante pra essa suposição sequencial ser segura (nenhuma linha oculta,
 * em branco, de rodapé ou de cabeçalho repetido foi descartada; a grade de
 * origem não foi truncada; o rótulo da coluna bate com exatamente uma
 * célula do cabeçalho). Fora dessas condições, devolve `[]` — nunca associa
 * uma cor a uma célula sem ter certeza de qual célula é essa. Ver seção 79
 * do CURRENT_STATE_AUDIT.md para o porquê dessa cautela.
 */
export function resolveSourceCellFills(
  rows: Row[],
  columns: Column[],
  diagnostics: ImportDiagnostics | undefined,
  audit: ImportAudit | undefined,
  sourceGrid: SourceGrid | undefined,
): SourceCellFill[] {
  if (!diagnostics?.cellFills.length || !audit || !sourceGrid) return [];
  if (
    audit.hiddenRowsIgnored ||
    audit.blankRowsIgnored ||
    audit.trailingRowsIgnored ||
    audit.repeatedHeaderRowsIgnored ||
    sourceGrid.truncatedRows ||
    sourceGrid.truncatedColumns
  )
    return [];
  const headerRowIndex = diagnostics.header.row - 1;
  const headerRow = sourceGrid.rows[headerRowIndex];
  if (!headerRow) return [];

  const columnIndexByKey = new Map<string, number>();
  for (const column of columns) {
    const matches = headerRow
      .map((value, index) =>
        typeof value === "string" && value.trim() === column.label.trim() ? index : null,
      )
      .filter((index): index is number => index !== null);
    if (matches.length === 1) columnIndexByKey.set(column.key, matches[0]!);
  }
  if (!columnIndexByKey.size) return [];

  const fillByAddress = new Map(diagnostics.cellFills.map((fill) => [fill.address, fill.color]));
  if (!fillByAddress.size) return [];

  const results: SourceCellFill[] = [];
  rows.forEach((_, rowIndex) => {
    const sheetRow = headerRowIndex + 1 + rowIndex;
    for (const [columnKey, columnIndex] of columnIndexByKey) {
      const address = XLSX.utils.encode_cell({ r: sheetRow, c: columnIndex });
      const color = fillByAddress.get(address);
      if (color) results.push({ rowIndex, columnKey, color });
    }
  });
  return results;
}
