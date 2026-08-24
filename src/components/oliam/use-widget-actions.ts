import { toast } from "sonner";
import { decodeCellAddress } from "@/lib/cell-address";
import type { SpreadsheetException } from "@/lib/spreadsheet-intelligence";
import { buildDefaultWidgets, createWidget, duplicateWidget } from "@/lib/widgets";
import type { FilterRule, SheetData, Widget, WidgetType } from "@/lib/types";

/**
 * Mutações de widgets do painel (adicionar, copiar/colar, atualizar,
 * remover, mover, reordenar) e `traceException`, que cruza busca, filtro,
 * célula focada e histórico ao mesmo tempo para levar o usuário até a linha
 * de origem de uma exceção — por isso recebe os setters de UI como
 * parâmetros em vez de reimplementá-los aqui.
 */
export function useWidgetActions(p: {
  sheet: SheetData;
  updateSheet: (patch: Partial<SheetData>) => void;
  recordHistory: () => void;
  widgetClipboard: Widget | null;
  setWidgetClipboard: (widget: Widget | null) => void;
  setSearch: (value: string) => void;
  setSort: (value: { key: string; dir: "asc" | "desc" } | null) => void;
  setFilters: (filters: FilterRule[]) => void;
  setFocusedCell: (cell: { rowIndex: number; columnKey?: string; address?: string } | null) => void;
}) {
  const { sheet } = p;
  const widgets =
    sheet.widgets ??
    buildDefaultWidgets(sheet.columns, sheet.chartConfig, sheet.rows, sheet.intelligence?.columns);

  const setWidgets = (next: Widget[]) => {
    p.recordHistory();
    p.updateSheet({ widgets: next });
  };

  // `patch` existe para quem já sabe o que o widget deve mostrar — a busca
  // global cria um indicador direto da métrica escolhida, sem passar pelo
  // seletor e sem depender do palpite de `createWidget`.
  const addWidget = (type: WidgetType, patch?: Partial<Widget>) =>
    setWidgets([
      ...widgets,
      {
        ...createWidget(type, sheet.columns, undefined, sheet.rows, sheet.intelligence?.columns),
        ...patch,
      },
    ]);

  const copyCurrentWidget = (widget: Widget) => {
    p.setWidgetClipboard({ ...widget });
    toast.success("Widget copiado. Agora é só colar onde quiser.");
  };

  const pasteCopiedWidget = (afterId?: string) => {
    if (!p.widgetClipboard) return;
    const copy = duplicateWidget(p.widgetClipboard);
    const next = [...widgets];
    const afterIndex = afterId ? next.findIndex((widget) => widget.id === afterId) : -1;
    next.splice(afterIndex >= 0 ? afterIndex + 1 : next.length, 0, copy);
    setWidgets(next);
    toast.success("Cópia do widget adicionada ao painel.");
  };

  const updateWidget = (id: string, patch: Partial<Widget>) =>
    setWidgets(widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const traceException = (exception: SpreadsheetException) => {
    let columnKey = exception.columnKey;
    let rowIndex = exception.rowIndex ?? 1;
    if (exception.address) {
      try {
        const decoded = decodeCellAddress(exception.address);
        columnKey ??= sheet.columns[decoded.column]?.key;
        if (!exception.rowIndex) rowIndex = Math.max(1, decoded.row);
      } catch {
        // Endereço textual continua visível no painel mesmo quando não é uma célula A1 válida.
      }
    }
    p.setSearch("");
    p.setSort(null);
    p.setFilters([]);
    p.setFocusedCell({
      rowIndex,
      ...(columnKey ? { columnKey } : {}),
      ...(exception.address ? { address: exception.address } : {}),
    });
    if (!widgets.some((widget) => widget.type === "table")) {
      setWidgets([...widgets, createWidget("table", sheet.columns, undefined, sheet.rows)]);
    }
    setTimeout(() => {
      document.querySelector("[data-detailed-table]")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  };

  const removeWidget = (id: string) => setWidgets(widgets.filter((w) => w.id !== id));

  const moveWidget = (id: string, dir: -1 | 1) => {
    const i = widgets.findIndex((w) => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    const a = next[i],
      b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    setWidgets(next);
  };

  const reorderWidget = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = widgets.findIndex((w) => w.id === fromId);
    const to = widgets.findIndex((w) => w.id === toId);
    if (from < 0 || to < 0) return;
    const next = [...widgets];
    const moved = next.splice(from, 1)[0];
    if (!moved) return;
    next.splice(to, 0, moved);
    setWidgets(next);
  };

  return {
    widgets,
    setWidgets,
    addWidget,
    copyCurrentWidget,
    pasteCopiedWidget,
    updateWidget,
    traceException,
    removeWidget,
    moveWidget,
    reorderWidget,
  };
}
