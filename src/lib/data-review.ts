import type { Column, Row, Value } from "@/lib/types";
import type { SpreadsheetException } from "@/lib/spreadsheet-intelligence";

export type AuditEntry = {
  id: string;
  timestamp: number;
  action: "cell-correction" | "exception-resolved" | "exception-ignored" | "exception-reopened";
  exceptionId: string;
  address?: string;
  rowIndex?: number;
  columnKey?: string;
  before?: Value;
  after?: Value;
  reason: string;
};

export type CorrectionSuggestion = {
  value: string;
  reason: string;
};

export const SOURCE_ROW_INDEX = Symbol("source-row-index");
export type TraceableRow = Row & { [SOURCE_ROW_INDEX]?: number };

export function markSourceRows(rows: Row[]): TraceableRow[] {
  return rows.map((row, sourceRowIndex) => {
    const traceable = { ...row } as TraceableRow;
    Object.defineProperty(traceable, SOURCE_ROW_INDEX, {
      value: sourceRowIndex,
      enumerable: true,
    });
    return traceable;
  });
}

export const sourceRowIndexOf = (row: Row) => (row as TraceableRow)[SOURCE_ROW_INDEX] ?? null;

export function parseEditedValue(input: string, column?: Column): Value {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^(?:verdadeiro|true)$/i.test(trimmed)) return true;
  if (/^(?:falso|false)$/i.test(trimmed)) return false;
  if (column?.kind === "number" || column?.kind === "currency" || column?.kind === "percentage") {
    const normalized = trimmed
      .replace(/\s/g, "")
      .replace(/(?:R\$|US\$|%)/gi, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const number = Number(normalized);
    if (Number.isFinite(number))
      return column.kind === "percentage" && Math.abs(number) > 1 ? number / 100 : number;
  }
  return trimmed;
}

export function suggestCorrection(
  exception: SpreadsheetException,
  column: Column | undefined,
): CorrectionSuggestion | null {
  if (exception.value === undefined || !column) return null;
  if (column.kind === "number" || column.kind === "currency" || column.kind === "percentage") {
    const parsed = parseEditedValue(String(exception.value), column);
    if (typeof parsed === "number" && String(exception.value) !== String(parsed)) {
      return {
        value: String(parsed),
        reason: "Normalizar o valor para o formato numérico da coluna.",
      };
    }
  }
  if (typeof exception.value === "string" && exception.value !== exception.value.trim()) {
    return {
      value: exception.value.trim(),
      reason: "Remover espaços excedentes sem alterar o conteúdo.",
    };
  }
  return {
    value: String(exception.value ?? ""),
    reason: "Confirmar manualmente o valor observado antes de resolver.",
  };
}

export function auditEntry(
  entry: Omit<AuditEntry, "id" | "timestamp">,
  timestamp = Date.now(),
): AuditEntry {
  return { ...entry, id: `${entry.exceptionId}-${timestamp}`, timestamp };
}

export function applyCellEdit(
  rows: Row[],
  rowIndex: number,
  columnKey: string,
  value: Value,
): Row[] {
  if (rowIndex < 0 || rowIndex >= rows.length) return rows;
  return rows.map((row, index) => (index === rowIndex ? { ...row, [columnKey]: value } : row));
}

export type UndoHistory<T> = { undo: T[]; redo: T[] };

export function recordUndo<T>(history: UndoHistory<T>, current: T, limit = 50): UndoHistory<T> {
  return { undo: [...history.undo, current].slice(-limit), redo: [] };
}

export function stepUndo<T>(history: UndoHistory<T>, current: T) {
  const next = history.undo.at(-1);
  if (!next) return null;
  return {
    next,
    history: { undo: history.undo.slice(0, -1), redo: [...history.redo, current] },
  };
}

export function stepRedo<T>(history: UndoHistory<T>, current: T) {
  const next = history.redo.at(-1);
  if (!next) return null;
  return {
    next,
    history: { undo: [...history.undo, current], redo: history.redo.slice(0, -1) },
  };
}
