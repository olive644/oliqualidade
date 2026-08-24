import { Calculator, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Column, type Row, type Widget } from "@/lib/types";
import { sizeClass, spanClass } from "@/lib/widgets";
import { fmt } from "@/lib/format";
import { aggregationLabels, semanticAggregationOps, type AggregationOp } from "@/lib/data-pipeline";
import { buildPivotMatrix, type ColumnSemanticProfile } from "@/lib/spreadsheet-intelligence";
import {
  CalculationButton,
  EmptyWidget,
  WidgetHead,
  type WidgetDragProps,
  WidgetEvidencePanel,
} from "./widget-support";
import { WidgetConfigBar } from "./widget-config-context";

export function PivotWidgetBody({
  widget: w,
  data,
  groupableCols,
  numericCols,
  semanticProfiles,
  onConfigure,
  dragProps,
  sizeControls,
  animationDelay,
}: {
  widget: Widget;
  data: Row[];
  groupableCols: Column[];
  numericCols: Column[];
  semanticProfiles: ColumnSemanticProfile[];
  onConfigure: (patch: Partial<Widget>) => void;
  dragProps: WidgetDragProps;
  sizeControls: React.ReactNode;
  animationDelay: number;
}) {
  const rowDimension =
    groupableCols.find((column) => column.key === w.groupKey) ?? groupableCols[0];
  const columnDimension =
    groupableCols.find(
      (column) => column.key === w.columnKey && column.key !== rowDimension?.key,
    ) ?? groupableCols.find((column) => column.key !== rowDimension?.key);
  const metric = numericCols.find((column) => column.key === w.valueKey) ?? numericCols[0];
  const metricProfile = semanticProfiles.find((profile) => profile.key === metric?.key);
  const pivotOps: AggregationOp[] = metric
    ? semanticAggregationOps(["sum", "avg", "count", "min", "max"], metric, metricProfile)
    : ["count"];
  const requestedPivotOp: AggregationOp = w.op ?? (metric ? "sum" : "count");
  const pivotOp = (
    pivotOps.includes(requestedPivotOp) ? requestedPivotOp : (pivotOps[0] ?? "count")
  ) as "sum" | "avg" | "count" | "min" | "max";
  if (!rowDimension || !columnDimension) {
    return (
      <EmptyWidget
        {...dragProps}
        title={w.type === "pivot-table" ? "Tabela dinâmica" : "Matriz de cruzamento"}
        span={w.span}
        size={w.size}
        type={w.type}
        animationDelay={animationDelay}
        message="São necessárias duas colunas categóricas ou de data."
      />
    );
  }
  const matrix = buildPivotMatrix(
    data,
    rowDimension.key,
    columnDimension.key,
    metric?.key,
    pivotOp,
    semanticProfiles.find((profile) => profile.key === metric?.key)?.unit,
  );
  const visibleRows = matrix.rows.slice(0, 30);
  const visibleColumns = matrix.columns.slice(0, 24);
  const max = Math.max(1, ...matrix.values.flat().map(Math.abs));
  const metricKind = metric?.kind ?? "number";
  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={
          w.title ||
          `${w.type === "pivot-table" ? "Tabela dinâmica" : "Matriz de cruzamento"} · ${metric ? `${aggregationLabels[pivotOp]} de ${metric.label}` : "contagem de registros"}`
        }
        icon={<Columns3 className="size-3.5 text-primary" />}
        {...dragProps}
      />
      <WidgetConfigBar>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Linhas
          <select
            className="oliam-select h-7 max-w-40"
            value={rowDimension.key}
            onChange={(event) => onConfigure({ groupKey: event.target.value })}
          >
            {groupableCols.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Colunas
          <select
            className="oliam-select h-7 max-w-40"
            value={columnDimension.key}
            onChange={(event) => onConfigure({ columnKey: event.target.value })}
          >
            {groupableCols
              .filter((column) => column.key !== rowDimension.key)
              .map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Valor
          <select
            className="oliam-select h-7 max-w-40"
            value={metric?.key ?? ""}
            onChange={(event) =>
              onConfigure({
                valueKey: event.target.value,
                op: event.target.value ? "sum" : "count",
              })
            }
          >
            <option value="">Contar registros</option>
            {numericCols.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        <CalculationButton
          operation={pivotOp}
          operations={pivotOps}
          metric={metric?.label ?? "registros"}
          group={`${rowDimension.label} × ${columnDimension.label}`}
          onOperation={(operation) => onConfigure({ op: operation })}
        />
      </WidgetConfigBar>
      {sizeControls}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border bg-card px-4 py-3 text-xs">
        <span>
          <strong>Métrica:</strong> {metric ? metric.label : "Quantidade de registros"}
        </span>
        <span>
          <strong>Cálculo:</strong> {aggregationLabels[pivotOp]}
        </span>
        <span>
          <strong>Total geral:</strong>{" "}
          <span className="font-mono font-semibold tabular-nums">
            {fmt(matrix.grandTotal, metricKind)}
          </span>
        </span>
        <span className="text-muted-foreground">
          Cada célula cruza {rowDimension.label} com {columnDimension.label}.
        </span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Calculator className="size-3" /> Toque para mudar o cálculo
        </span>
      </div>
      <div className="max-h-[32rem] overflow-auto p-3">
        <table className="w-max min-w-full border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-40 rounded-lg bg-card px-3 py-2 text-left shadow-[1px_1px_0_var(--border)]">
                {rowDimension.label}
              </th>
              {visibleColumns.map((label) => (
                <th
                  key={label}
                  className="sticky top-0 z-10 min-w-24 rounded-lg bg-card px-2 py-2 text-center shadow-[0_1px_0_var(--border)]"
                >
                  {label}
                </th>
              ))}
              {w.type === "pivot-table" && (
                <th className="sticky right-0 top-0 z-20 rounded-lg bg-muted px-3 py-2">Total</th>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((rowLabel, rowIndex) => (
              <tr key={rowLabel}>
                <th className="sticky left-0 z-10 max-w-64 rounded-lg bg-card px-3 py-2 text-left font-medium shadow-[1px_0_0_var(--border)]">
                  {rowLabel}
                </th>
                {visibleColumns.map((columnLabel, columnIndex) => {
                  const value = matrix.values[rowIndex]?.[columnIndex] ?? 0;
                  const intensity = Math.max(8, Math.round((Math.abs(value) / max) * 72));
                  return (
                    <td
                      key={columnLabel}
                      className="rounded-lg px-3 py-2 text-right font-mono"
                      style={
                        w.type === "matrix-heatmap"
                          ? {
                              background: `color-mix(in srgb, var(--primary) ${intensity}%, transparent)`,
                            }
                          : undefined
                      }
                    >
                      {fmt(value, metricKind)}
                    </td>
                  );
                })}
                {w.type === "pivot-table" && (
                  <td className="sticky right-0 rounded-lg bg-muted px-3 py-2 text-right font-mono font-semibold">
                    {fmt(matrix.rowTotals[rowIndex] ?? 0, metricKind)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {w.type === "pivot-table" && (
            <tfoot>
              <tr>
                <th className="sticky bottom-0 left-0 z-20 rounded-lg bg-muted px-3 py-2 text-left">
                  Total
                </th>
                {visibleColumns.map((label, index) => (
                  <td
                    key={label}
                    className="sticky bottom-0 rounded-lg bg-muted px-3 py-2 text-right font-mono font-semibold"
                  >
                    {fmt(matrix.columnTotals[index] ?? 0, metricKind)}
                  </td>
                ))}
                <td className="sticky bottom-0 right-0 z-20 rounded-lg bg-primary px-3 py-2 text-right font-mono font-bold text-primary-foreground">
                  {fmt(matrix.grandTotal, metricKind)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        {(matrix.rows.length > visibleRows.length ||
          matrix.columns.length > visibleColumns.length) && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Prévia limitada a 30 linhas × 24 colunas; use filtros para reduzir o cruzamento.
          </p>
        )}
      </div>
      <WidgetEvidencePanel />
    </article>
  );
}
