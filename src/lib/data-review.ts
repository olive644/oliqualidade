import type { Column, Value } from "@/lib/types";
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
