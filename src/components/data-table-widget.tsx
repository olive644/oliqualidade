import { useVirtualizer } from "@tanstack/react-virtual";
import { Calculator, ArrowDown, ArrowUp, Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ColorGroupLabel, SourceCellFill } from "@/lib/cell-fill-provenance";
import { parseEditedValue, sourceRowIndexOf } from "@/lib/data-review";
import { conditionalStyle, fmt } from "@/lib/format";
import { exportTableColumnWidths, exportTablePreviewRows } from "@/lib/table-export-preview";
import type { Column, Row, Value } from "@/lib/types";
import { numericKinds } from "@/lib/types";
import { cn } from "@/lib/utils";

type DataTableProps = {
  rows: Row[];
  columns: Column[];
  sort: { key: string; dir: "asc" | "desc" } | null;
  setSort: (sort: { key: string; dir: "asc" | "desc" }) => void;
  interpolated?: Set<string>;
  focusedCell?: { rowIndex: number; columnKey?: string; address?: string } | null;
  onEditCell?: (sourceRowIndex: number, columnKey: string, value: string, reason: string) => void;
  /** Cor de preenchimento original do Excel, por (linha de origem, coluna). Sem regra explícita de formatação condicional, prevalece sobre ela. */
  sourceCellFills?: SourceCellFill[];
  /** Rótulo inferido por banda de cor de preenchimento sem mesclagem real. Só exibição — a célula continua vazia nos dados/exportação. */
  colorGroupLabels?: ColorGroupLabel[];
};

export function DataTable({
  rows,
  columns,
  sort,
  setSort,
  interpolated,
  focusedCell,
  onEditCell,
  sourceCellFills,
  colorGroupLabels,
}: DataTableProps) {
  const fillByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const fill of sourceCellFills ?? [])
      map.set(`${fill.rowIndex}:${fill.columnKey}`, fill.color);
    return map;
  }, [sourceCellFills]);
  const groupLabelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of colorGroupLabels ?? [])
      map.set(`${group.rowIndex}:${group.columnKey}`, group.label);
    return map;
  }, [colorGroupLabels]);
  const [editing, setEditing] = useState<{
    sourceRowIndex: number;
    columnKey: string;
    value: string;
    reason: string;
    before: Value;
  } | null>(null);
  const parent = useRef<HTMLDivElement>(null);
  const visible = columns.filter((column) => column.visible);
  const previewRows = exportTablePreviewRows(rows);
  const previewWidths = exportTableColumnWidths(visible, previewRows);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 36,
    overscan: 8,
  });
  useEffect(() => {
    if (!focusedCell) return;
    const visibleIndex = rows.findIndex(
      (row) => sourceRowIndexOf(row) === focusedCell.rowIndex - 1,
    );
    if (visibleIndex < 0) return;
    virtualizer.scrollToIndex(visibleIndex, { align: "center" });
  }, [focusedCell, rows, virtualizer]);
  const beginEdit = (row: Row, column: Column) => {
    if (column.formula || !onEditCell) return;
    const sourceRowIndex = sourceRowIndexOf(row);
    if (sourceRowIndex === null) return;
    const before = row[column.key] ?? null;
    setEditing({
      sourceRowIndex,
      columnKey: column.key,
      value: before === null ? "" : String(before),
      reason: "",
      before,
    });
  };
  const editingColumn = editing
    ? columns.find((column) => column.key === editing.columnKey)
    : undefined;

  return (
    <div>
      {onEditCell && (
        <div
          className="flex items-center gap-2 border-b border-border bg-muted/15 px-3 py-2 text-[11px] text-muted-foreground"
          data-export-controls
        >
          <Pencil className="size-3.5" />
          Toque, dê duplo clique ou pressione Enter em uma célula para editar. Colunas calculadas
          são protegidas.
        </div>
      )}
      <div ref={parent} className="oliam-data-table h-[360px] overflow-auto">
        <div className="oliam-data-table-virtual">
          <div className="sticky top-0 z-10 flex min-w-max border-b border-border bg-muted/60 backdrop-blur-sm">
            {visible.map((column) => {
              const header = (
                <button
                  key={column.key}
                  className="flex w-44 items-center gap-2 border-r border-border px-3 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() =>
                    setSort({
                      key: column.key,
                      dir: sort?.key === column.key && sort.dir === "asc" ? "desc" : "asc",
                    })
                  }
                >
                  <span className="truncate">{column.label}</span>
                  {column.formula && (
                    <Calculator
                      className="size-3 shrink-0 text-secondary-accent"
                      aria-hidden="true"
                    />
                  )}
                  {sort?.key === column.key &&
                    (sort.dir === "asc" ? (
                      <ArrowUp className="size-3 shrink-0 text-primary" />
                    ) : (
                      <ArrowDown className="size-3 shrink-0 text-primary" />
                    ))}
                </button>
              );
              if (!column.description) return header;
              return (
                <Tooltip key={column.key}>
                  <TooltipTrigger asChild>{header}</TooltipTrigger>
                  <TooltipContent>{column.description}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          <div className="relative min-w-max" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index] ?? {};
              const sourceRowIndex = sourceRowIndexOf(row);
              const isFocusedRow =
                focusedCell &&
                sourceRowIndex !== null &&
                focusedCell.rowIndex === sourceRowIndex + 1;
              return (
                <div
                  key={item.key}
                  className={cn(
                    "absolute left-0 flex border-b border-border transition-colors hover:bg-accent/60",
                    item.index % 2 === 1 && "bg-muted/25",
                    isFocusedRow && "bg-primary/8",
                  )}
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  {visible.map((column) => {
                    const shown = fmt(row[column.key] ?? null, column.kind);
                    const numeric = numericKinds.includes(column.kind);
                    const isInterpolated = interpolated?.has(`${item.index}-${column.key}`);
                    const groupLabel =
                      shown === null && sourceRowIndex !== null
                        ? groupLabelByKey.get(`${sourceRowIndex}:${column.key}`)
                        : undefined;
                    const cellStyle =
                      conditionalStyle(
                        row[column.key] ?? null,
                        column.kind,
                        column.conditionalFormat,
                      ) ??
                      (sourceRowIndex !== null && fillByKey.get(`${sourceRowIndex}:${column.key}`)
                        ? { background: fillByKey.get(`${sourceRowIndex}:${column.key}`) }
                        : null);
                    return (
                      <div
                        key={column.key}
                        data-assistant-cell
                        data-assistant-row-index={(sourceRowIndex ?? item.index) + 1}
                        data-assistant-column-key={column.key}
                        role={column.formula ? undefined : "button"}
                        tabIndex={column.formula ? undefined : 0}
                        aria-label={
                          column.formula
                            ? undefined
                            : `Editar ${column.label}, linha ${(sourceRowIndex ?? item.index) + 1}`
                        }
                        onDoubleClick={() => beginEdit(row, column)}
                        onPointerUp={(event) => {
                          if (event.pointerType === "touch" && !column.formula)
                            beginEdit(row, column);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" || column.formula) return;
                          event.preventDefault();
                          beginEdit(row, column);
                        }}
                        title={
                          isInterpolated
                            ? "Valor estimado por interpolação"
                            : groupLabel
                              ? `Agrupamento visual por cor de preenchimento no Excel original (sem mesclagem de célula): "${groupLabel}"`
                              : (shown ?? undefined)
                        }
                        style={cellStyle ?? undefined}
                        className={cn(
                          "w-44 truncate border-r border-border px-3 py-2 text-xs",
                          numeric && "text-right font-mono",
                          shown === null && "text-muted-foreground",
                          groupLabel && "italic",
                          isInterpolated &&
                            "outline outline-1 -outline-offset-1 outline-secondary-accent",
                          isFocusedRow &&
                            (!focusedCell.columnKey || focusedCell.columnKey === column.key) &&
                            "relative z-[1] bg-primary/12 outline outline-2 -outline-offset-2 outline-primary",
                          editing?.sourceRowIndex === sourceRowIndex &&
                            editing?.columnKey === column.key &&
                            "relative z-[1] bg-tint outline outline-2 -outline-offset-2 outline-primary",
                          !column.formula &&
                            "cursor-text focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                        )}
                      >
                        <span>{groupLabel ?? shown ?? "—"}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <table className="oliam-export-table-preview" aria-hidden="true">
          <colgroup>
            {visible.map((column, index) => (
              <col key={column.key} style={{ width: previewWidths[index] }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {visible.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, rowIndex) => {
              const previewSourceRowIndex = sourceRowIndexOf(row);
              return (
                <tr key={rowIndex}>
                  {visible.map((column) => {
                    const raw = row[column.key] ?? null;
                    const shown = fmt(raw, column.kind);
                    const fillColor =
                      previewSourceRowIndex !== null
                        ? fillByKey.get(`${previewSourceRowIndex}:${column.key}`)
                        : undefined;
                    return (
                      <td
                        key={column.key}
                        className={cn(numericKinds.includes(column.kind) && "is-numeric")}
                        style={
                          conditionalStyle(raw, column.kind, column.conditionalFormat) ??
                          (fillColor ? { background: fillColor } : undefined)
                        }
                      >
                        {shown ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {rows.length > previewRows.length && (
            <caption>
              Prévia de {previewRows.length.toLocaleString("pt-BR")} de{" "}
              {rows.length.toLocaleString("pt-BR")} linhas. A base completa continua nas páginas
              detalhadas do PDF.
            </caption>
          )}
        </table>
      </div>
      {editing && editingColumn && onEditCell && (
        <div
          className="border-t border-primary/30 bg-tint/35 p-3"
          aria-live="polite"
          data-export-controls
        >
          <div className="grid gap-3 lg:grid-cols-[minmax(10rem,0.7fr)_minmax(16rem,1.3fr)_auto] lg:items-end">
            <label className="grid gap-1 text-[11px] font-medium">
              {editingColumn.label} · linha {editing.sourceRowIndex + 1}
              <input
                autoFocus
                className="oliam-input h-9"
                value={editing.value}
                onChange={(event) =>
                  setEditing((current) =>
                    current ? { ...current, value: event.target.value } : current,
                  )
                }
              />
            </label>
            <label className="grid gap-1 text-[11px] font-medium">
              Justificativa da alteração
              <input
                className="oliam-input h-9"
                value={editing.reason}
                onChange={(event) =>
                  setEditing((current) =>
                    current ? { ...current, reason: event.target.value } : current,
                  )
                }
                placeholder="Ex.: valor conferido no laudo original"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={!editing.reason.trim()}
                onClick={() => {
                  onEditCell(
                    editing.sourceRowIndex,
                    editing.columnKey,
                    editing.value,
                    editing.reason,
                  );
                  setEditing(null);
                }}
              >
                Salvar alteração
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Prévia:{" "}
            <span className="font-mono text-destructive line-through">
              {String(editing.before ?? "vazio")}
            </span>{" "}
            →{" "}
            <span className="font-mono text-emerald-700 dark:text-emerald-300">
              {String(parseEditedValue(editing.value, editingColumn) ?? "vazio")}
            </span>
            . O valor anterior e a justificativa ficarão no histórico.
          </p>
        </div>
      )}
    </div>
  );
}
