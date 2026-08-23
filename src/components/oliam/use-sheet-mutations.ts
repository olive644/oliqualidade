import { toast } from "sonner";
import { applyCellEdit, auditEntry, parseEditedValue } from "@/lib/data-review";
import {
  analyzeSpreadsheet,
  type ExceptionDecision,
  type SemanticRole,
} from "@/lib/spreadsheet-intelligence";
import type { SpreadsheetException } from "@/lib/spreadsheet-intelligence";
import type { Column, FilterRule, SheetData } from "@/lib/types";

/**
 * Mutações de dados da aba (filtros, colunas, overrides semânticos, decisões
 * de exceção, correção de célula) que ainda chamavam `recordHistory()`
 * manualmente dentro de `Dashboard`, seguindo o mesmo padrão já provado em
 * `useWidgetActions`. `editTableCell` recebe `setFocusedCell` porque foca a
 * célula editada depois de salvar.
 */
export function useSheetMutations(p: {
  sheet: SheetData;
  updateSheet: (patch: Partial<SheetData>) => void;
  recordHistory: () => void;
  setFocusedCell: (cell: { rowIndex: number; columnKey?: string; address?: string } | null) => void;
}) {
  const { sheet, updateSheet, recordHistory, setFocusedCell } = p;

  const setFilters = (filters: FilterRule[]) => {
    recordHistory();
    updateSheet({ filters });
  };

  const setColumns = (columns: Column[]) => {
    recordHistory();
    const intelligence = analyzeSpreadsheet(
      sheet.rows,
      columns,
      undefined,
      sheet.semanticOverrides,
    );
    updateSheet({ columns, intelligence });
  };

  const setSemanticOverride = (
    columnKey: string,
    patch: { role?: SemanticRole; unit?: string | null },
  ) => {
    recordHistory();
    const current = sheet.semanticOverrides ?? {};
    const next = { ...current, [columnKey]: { ...current[columnKey], ...patch } };
    const intelligence = analyzeSpreadsheet(sheet.rows, sheet.columns, undefined, next);
    updateSheet({ semanticOverrides: next, intelligence });
  };

  const resetSemanticOverride = (columnKey: string) => {
    recordHistory();
    const next = { ...(sheet.semanticOverrides ?? {}) };
    delete next[columnKey];
    const intelligence = analyzeSpreadsheet(sheet.rows, sheet.columns, undefined, next);
    updateSheet({ semanticOverrides: next, intelligence });
  };

  const setExceptionDecision = (
    exceptionId: string,
    status: ExceptionDecision["status"] | null,
  ) => {
    recordHistory();
    const next = { ...(sheet.exceptionDecisions ?? {}) };
    if (status) next[exceptionId] = { status, updatedAt: Date.now() };
    else delete next[exceptionId];
    const action =
      status === "resolved"
        ? "exception-resolved"
        : status === "ignored"
          ? "exception-ignored"
          : "exception-reopened";
    updateSheet({
      exceptionDecisions: next,
      auditTrail: [
        ...(sheet.auditTrail ?? []),
        auditEntry({
          action,
          exceptionId,
          reason:
            status === "ignored"
              ? "Exceção ignorada pelo usuário."
              : status === "resolved"
                ? "Exceção marcada como revisada pelo usuário."
                : "Exceção reaberta para nova revisão.",
        }),
      ].slice(-1000),
    });
  };

  const correctException = (exception: SpreadsheetException, input: string, reason: string) => {
    if (!exception.columnKey || !exception.rowIndex) return;
    const rowOffset = exception.rowIndex - 1;
    const column = sheet.columns.find((item) => item.key === exception.columnKey);
    const before = sheet.rows[rowOffset]?.[exception.columnKey] ?? null;
    const after = parseEditedValue(input, column);
    if (Object.is(before, after)) {
      toast.info("O valor informado é igual ao valor atual.");
      return;
    }
    recordHistory();
    const rows = applyCellEdit(sheet.rows, rowOffset, exception.columnKey, after);
    const nextDecisions = {
      ...(sheet.exceptionDecisions ?? {}),
      [exception.id]: { status: "resolved" as const, updatedAt: Date.now() },
    };
    const intelligence = analyzeSpreadsheet(
      rows,
      sheet.columns,
      undefined,
      sheet.semanticOverrides,
    );
    updateSheet({
      rows,
      intelligence,
      exceptionDecisions: nextDecisions,
      auditTrail: [
        ...(sheet.auditTrail ?? []),
        auditEntry({
          action: "cell-correction",
          exceptionId: exception.id,
          ...(exception.address ? { address: exception.address } : {}),
          rowIndex: exception.rowIndex,
          columnKey: exception.columnKey,
          before,
          after,
          reason: reason.trim() || "Correção manual confirmada pelo usuário.",
        }),
      ].slice(-1000),
    });
    toast.success("Célula corrigida e registrada no histórico.");
  };

  const editTableCell = (
    sourceRowIndex: number,
    columnKey: string,
    input: string,
    reason: string,
  ) => {
    const column = sheet.columns.find((item) => item.key === columnKey);
    if (!column || column.formula || sourceRowIndex < 0 || sourceRowIndex >= sheet.rows.length)
      return;
    const before = sheet.rows[sourceRowIndex]?.[columnKey] ?? null;
    const after = parseEditedValue(input, column);
    if (Object.is(before, after)) {
      toast.info("O valor informado é igual ao valor atual.");
      return;
    }
    recordHistory();
    const rows = applyCellEdit(sheet.rows, sourceRowIndex, columnKey, after);
    const intelligence = analyzeSpreadsheet(
      rows,
      sheet.columns,
      undefined,
      sheet.semanticOverrides,
    );
    updateSheet({
      rows,
      intelligence,
      auditTrail: [
        ...(sheet.auditTrail ?? []),
        auditEntry({
          action: "cell-correction",
          exceptionId: `manual-${sourceRowIndex + 1}-${columnKey}`,
          rowIndex: sourceRowIndex + 1,
          columnKey,
          before,
          after,
          reason: reason.trim(),
        }),
      ].slice(-1000),
    });
    setFocusedCell({ rowIndex: sourceRowIndex + 1, columnKey });
    toast.success("Célula atualizada. Use Ctrl+Z para desfazer.");
  };

  return {
    setFilters,
    setColumns,
    setSemanticOverride,
    resetSemanticOverride,
    setExceptionDecision,
    correctException,
    editTableCell,
  };
}
