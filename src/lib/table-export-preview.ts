import { fmt } from "@/lib/format";
import type { Column, Row } from "@/lib/types";
import { numericKinds } from "@/lib/types";

export const EXPORT_TABLE_PREVIEW_LIMIT = 18;

export function exportTablePreviewRows(rows: Row[], limit = EXPORT_TABLE_PREVIEW_LIMIT) {
  return rows.slice(0, Math.max(0, limit));
}

export function exportTableColumnWidths(columns: Column[], rows: Row[]) {
  const weights = columns.map((column) => {
    if (numericKinds.includes(column.kind) || column.kind === "date") return 0.8;
    const longest = rows.reduce((length, row) => {
      const shown = fmt(row[column.key] ?? null, column.kind) ?? "—";
      return Math.max(length, shown.length);
    }, column.label.length);
    return Math.min(2.6, Math.max(1, longest / 18));
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights.map((weight) => `${((weight / total) * 100).toFixed(3)}%`);
}
