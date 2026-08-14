import { useVirtualizer } from "@tanstack/react-virtual";
import { Calculator, ArrowDown, ArrowUp } from "lucide-react";
import { useRef } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { conditionalStyle, fmt } from "@/lib/format";
import { exportTableColumnWidths, exportTablePreviewRows } from "@/lib/table-export-preview";
import type { Column, Row } from "@/lib/types";
import { numericKinds } from "@/lib/types";
import { cn } from "@/lib/utils";

type DataTableProps = {
  rows: Row[];
  columns: Column[];
  sort: { key: string; dir: "asc" | "desc" } | null;
  setSort: (sort: { key: string; dir: "asc" | "desc" }) => void;
  interpolated?: Set<string>;
};

export function DataTable({ rows, columns, sort, setSort, interpolated }: DataTableProps) {
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

  return (
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
            return (
              <div
                key={item.key}
                className={cn(
                  "absolute left-0 flex border-b border-border transition-colors hover:bg-accent/60",
                  item.index % 2 === 1 && "bg-muted/25",
                )}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                {visible.map((column) => {
                  const shown = fmt(row[column.key] ?? null, column.kind);
                  const numeric = numericKinds.includes(column.kind);
                  const isInterpolated = interpolated?.has(`${item.index}-${column.key}`);
                  const cellStyle = conditionalStyle(
                    row[column.key] ?? null,
                    column.kind,
                    column.conditionalFormat,
                  );
                  return (
                    <div
                      key={column.key}
                      title={
                        isInterpolated ? "Valor estimado por interpolação" : (shown ?? undefined)
                      }
                      style={cellStyle ?? undefined}
                      className={cn(
                        "w-44 truncate border-r border-border px-3 py-2 text-xs",
                        numeric && "text-right font-mono",
                        shown === null && "text-muted-foreground",
                        isInterpolated &&
                          "outline outline-1 -outline-offset-1 outline-secondary-accent",
                      )}
                    >
                      <span>{shown ?? "—"}</span>
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
          {previewRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {visible.map((column) => {
                const raw = row[column.key] ?? null;
                const shown = fmt(raw, column.kind);
                return (
                  <td
                    key={column.key}
                    className={cn(numericKinds.includes(column.kind) && "is-numeric")}
                    style={
                      conditionalStyle(raw, column.kind, column.conditionalFormat) ?? undefined
                    }
                  >
                    {shown ?? "—"}
                  </td>
                );
              })}
            </tr>
          ))}
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
  );
}
