import { useEffect, useRef, useState } from "react";
import {
  recordUndo,
  stepRedo,
  stepUndo,
  type AuditEntry,
  type UndoHistory,
} from "@/lib/data-review";
import {
  analyzeSpreadsheet,
  type ExceptionDecisions,
  type SemanticOverrides,
  type SpreadsheetIntelligence,
} from "@/lib/spreadsheet-intelligence";
import { buildDefaultWidgets } from "@/lib/widgets";
import type { Column, FilterRule, Row, SheetData, Widget } from "@/lib/types";

// Pilha de desfazer/refazer, com escopo na aba atual. Inclui dados e
// auditoria para que uma correção nunca seja parcialmente desfeita.
type HistorySnapshot = {
  rows: Row[];
  filters: FilterRule[];
  columns: Column[];
  widgets: Widget[];
  intelligence?: SpreadsheetIntelligence;
  semanticOverrides: SemanticOverrides;
  exceptionDecisions: ExceptionDecisions;
  auditTrail: AuditEntry[];
};

/**
 * Núcleo de undo/redo do painel: hub que dezenas de mutadores em `Dashboard`
 * chamam (via `recordHistory()`) antes de alterar linhas, filtros, colunas,
 * widgets ou decisões de exceção. A pilha reseta ao trocar de painel ou de
 * aba (`dashboardId`/`activeSheetIndex` como dependências).
 */
export function useUndoRedoHistory(
  sheet: SheetData,
  dashboardId: string,
  activeSheetIndex: number,
  updateSheet: (patch: Partial<SheetData>) => void,
) {
  const historyRef = useRef<UndoHistory<HistorySnapshot>>({ undo: [], redo: [] });
  const [, forceHistoryUpdate] = useState(0);

  useEffect(() => {
    historyRef.current = { undo: [], redo: [] };
    forceHistoryUpdate((t) => t + 1);
  }, [dashboardId, activeSheetIndex]);

  const dashboardSnapshot = (): HistorySnapshot => ({
    rows: sheet.rows,
    filters: sheet.filters,
    columns: sheet.columns,
    widgets:
      sheet.widgets ??
      buildDefaultWidgets(
        sheet.columns,
        sheet.chartConfig,
        sheet.rows,
        sheet.intelligence?.columns,
      ),
    ...(sheet.intelligence ? { intelligence: sheet.intelligence } : {}),
    semanticOverrides: sheet.semanticOverrides ?? {},
    exceptionDecisions: sheet.exceptionDecisions ?? {},
    auditTrail: sheet.auditTrail ?? [],
  });

  const recordHistory = () => {
    historyRef.current = recordUndo(historyRef.current, dashboardSnapshot());
    forceHistoryUpdate((t) => t + 1);
  };

  const undo = () => {
    const result = stepUndo(historyRef.current, dashboardSnapshot());
    if (!result) return;
    historyRef.current = result.history;
    const prev = result.next;
    updateSheet({
      ...prev,
      intelligence:
        prev.intelligence ??
        analyzeSpreadsheet(prev.rows, prev.columns, undefined, prev.semanticOverrides),
    });
    forceHistoryUpdate((t) => t + 1);
  };

  const redo = () => {
    const result = stepRedo(historyRef.current, dashboardSnapshot());
    if (!result) return;
    historyRef.current = result.history;
    const next = result.next;
    updateSheet({
      ...next,
      intelligence:
        next.intelligence ??
        analyzeSpreadsheet(next.rows, next.columns, undefined, next.semanticOverrides),
    });
    forceHistoryUpdate((t) => t + 1);
  };

  const canUndo = historyRef.current.undo.length > 0;
  const canRedo = historyRef.current.redo.length > 0;

  return { canUndo, canRedo, undo, redo, recordHistory };
}
