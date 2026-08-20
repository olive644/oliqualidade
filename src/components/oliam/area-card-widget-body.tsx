import { Activity, TrendingDown, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  kinds,
  numericKinds,
  type ChartDataMode,
  type Column,
  type FilterRule,
  type Kind,
  type Row,
  type Widget,
} from "@/lib/types";
import { groupableKinds, sizeClass, spanClass } from "@/lib/widgets";
import { conditionalColor, fmt, sortChronologically } from "@/lib/format";
import {
  aggregationLabels,
  chartSeries,
  limitChartSeriesForRendering,
  relevantAggregationOps,
  semanticAggregationOps,
  toggleClickFilter,
  trendSummaryFor,
  type AggregationOp,
} from "@/lib/data-pipeline";
import type { ColumnSemanticProfile } from "@/lib/spreadsheet-intelligence";
import {
  AxisTick,
  CalculationButton,
  ChartReadingGuide,
  compactAxisValue,
  FieldDropSlot,
  FilterChip,
  WidgetHead,
  type WidgetDragProps,
} from "./widget-support";

/**
 * Variante visual do gráfico de área: mesmo pipeline de dados de "area"
 * (uma coluna de agrupamento + uma métrica agregada), mas apresentado como
 * um cartão elevado com legenda e um resumo de 3 métricas (valor atual,
 * média e variação do período) abaixo do gráfico — no lugar do gráfico
 * "solto" que o widget "area" usa.
 */
export function AreaCardWidgetBody({
  widget: w,
  data,
  columns,
  numericCols,
  groupableCols,
  semanticProfiles,
  filters,
  setFilters,
  onConfigure,
  dragProps,
  sizeControls,
  animationDelay,
}: {
  widget: Widget;
  data: Row[];
  columns: Column[];
  numericCols: Column[];
  groupableCols: Column[];
  semanticProfiles: ColumnSemanticProfile[];
  filters: FilterRule[];
  setFilters: (filters: FilterRule[]) => void;
  onConfigure: (patch: Partial<Widget>) => void;
  dragProps: WidgetDragProps;
  sizeControls: React.ReactNode;
  animationDelay: number;
}) {
  const handleGroupClick = (groupKey: string, value: string) => {
    setFilters(toggleClickFilter(filters, groupKey, value));
  };

  const groupCol = columns.find((c) => c.key === w.groupKey);
  const requestedOp = w.op ?? "sum";
  const configuredValueCol = columns.find((c) => c.key === w.valueKey);
  const valueCol =
    (configuredValueCol &&
    (requestedOp === "count" || numericKinds.includes(configuredValueCol.kind))
      ? configuredValueCol
      : undefined) ?? (requestedOp === "count" ? columns[0] : numericCols[0]);
  const relevantOps =
    groupCol && valueCol
      ? semanticAggregationOps(
          relevantAggregationOps(data, groupCol.key, valueCol.key),
          valueCol,
          semanticProfiles.find((profile) => profile.key === valueCol.key),
        )
      : (Object.keys(aggregationLabels) as AggregationOp[]);
  const op: AggregationOp = relevantOps.includes(w.op ?? "sum")
    ? (w.op ?? "sum")
    : (relevantOps[0] ?? "sum");
  const dataMode: ChartDataMode = w.dataMode ?? (op === "count" ? "aggregate" : "raw");
  const title =
    op === "count"
      ? `Cartão de área · Registros por ${groupCol?.label ?? ""}`
      : `Cartão de área · ${aggregationLabels[op]} de ${valueCol?.label ?? ""} por ${groupCol?.label ?? ""}`;

  const grouped =
    groupCol && valueCol ? chartSeries(data, groupCol.key, valueCol.key, op, dataMode) : [];
  const completeSeries = groupCol?.kind === "date" ? sortChronologically(grouped) : grouped;
  const renderableSeries = limitChartSeriesForRendering(completeSeries);
  const series = renderableSeries.items;
  const seriesColor = valueCol
    ? (conditionalColor(series.at(-1)?.total ?? null, valueCol.kind, valueCol.conditionalFormat) ??
      "var(--primary)")
    : "var(--primary)";
  const trendSummary = series.length >= 2 ? trendSummaryFor(series) : null;
  const insufficient = series.length < 1;

  const metricRows = trendSummary
    ? [
        {
          id: "current",
          label: "Valor atual",
          value:
            fmt(trendSummary.last.total, valueCol?.kind ?? "number") ??
            String(trendSummary.last.total),
          up: trendSummary.last.total >= trendSummary.average,
        },
        {
          id: "average",
          label: "Média do período",
          value:
            fmt(trendSummary.average, valueCol?.kind ?? "number") ?? String(trendSummary.average),
          up: trendSummary.average >= trendSummary.first.total,
        },
        {
          id: "change",
          label: "Variação no período",
          value:
            trendSummary.relativeChange !== null
              ? `${trendSummary.relativeChange >= 0 ? "+" : ""}${(
                  trendSummary.relativeChange * 100
                ).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
              : (fmt(trendSummary.change, valueCol?.kind ?? "number") ??
                String(trendSummary.change)),
          up: trendSummary.change >= 0,
        },
      ]
    : [];

  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={title}
        icon={<Activity className="size-3.5 shrink-0 text-muted-foreground" />}
        {...dragProps}
      />
      <div
        className="oliam-widget-config-bar flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
        data-export-controls
      >
        <FilterChip groupKey={groupCol?.key} filters={filters} setFilters={setFilters} />
        <FieldDropSlot
          accepts={groupableKinds}
          onDropColumn={(key) => onConfigure({ groupKey: key })}
        >
          <label className="flex max-w-56 items-center gap-1 rounded-lg border border-border bg-card pl-1.5 text-[10px] text-muted-foreground">
            <span className="font-mono font-bold text-foreground">X</span>
            <select
              aria-label="Coluna do eixo X"
              className="oliam-select h-7 min-w-0 max-w-48 border-0 bg-transparent px-1.5 shadow-none"
              value={groupCol?.key ?? ""}
              onChange={(e) => onConfigure({ groupKey: e.target.value })}
            >
              {!groupCol && <option value="">Selecione…</option>}
              {groupableCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </FieldDropSlot>
        <FieldDropSlot
          accepts={op === "count" ? (Object.keys(kinds) as Kind[]) : numericKinds}
          onDropColumn={(key) => onConfigure({ valueKey: key })}
        >
          <label className="flex max-w-56 items-center gap-1 rounded-lg border border-border bg-card pl-1.5 text-[10px] text-muted-foreground">
            <span className="font-mono font-bold text-foreground">Y</span>
            <select
              aria-label={op === "count" ? "Coluna usada para contar" : "Métrica do eixo Y"}
              className="oliam-select h-7 min-w-0 max-w-48 border-0 bg-transparent px-1.5 shadow-none"
              value={valueCol?.key ?? ""}
              onChange={(e) => onConfigure({ valueKey: e.target.value })}
            >
              {!valueCol && <option value="">Selecione…</option>}
              {(op === "count" ? columns : numericCols).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </FieldDropSlot>
        <CalculationButton
          mode={dataMode}
          operation={op}
          operations={relevantOps}
          metric={op === "count" ? "os registros" : (valueCol?.label ?? "a métrica")}
          group={groupCol?.label}
          allowRaw
          onRaw={() => onConfigure({ dataMode: "raw" })}
          onOperation={(operation) => onConfigure({ dataMode: "aggregate", op: operation })}
        />
      </div>
      {sizeControls}
      {groupCol && valueCol && (
        <ChartReadingGuide
          group={groupCol.label}
          metric={op === "count" ? "Quantidade de linhas" : valueCol.label}
          mode={dataMode}
          operation={`${aggregationLabels[op]} por ${groupCol.label}`}
        />
      )}
      {!groupCol || !valueCol || insufficient ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          {!groupCol || !valueCol
            ? "Escolha uma coluna de agrupamento e uma numérica para este widget."
            : "Dados insuficientes para este gráfico."}
        </p>
      ) : (
        <div className="p-4">
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-lg shadow-black/5 dark:shadow-black/30">
            <div className="flex items-center gap-2 px-5 pt-5 pb-3">
              <span
                className="size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: seriesColor }}
                aria-hidden="true"
              />
              <span className="truncate text-xs text-muted-foreground">{valueCol.label}</span>
            </div>
            <div className="h-[200px] px-2">
              <ResponsiveContainer>
                <AreaChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <defs>
                    <linearGradient id={`area-card-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={seriesColor} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={seriesColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="name"
                    tick={(props) => <AxisTick {...props} />}
                    interval="preserveStartEnd"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis hide tickFormatter={(v: number) => compactAxisValue(v, valueCol.kind)} />
                  <ChartTooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                      padding: "8px 12px",
                      boxShadow:
                        "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
                    }}
                    labelStyle={{
                      color: "var(--popover-foreground)",
                      fontWeight: 600,
                      marginBottom: 2,
                    }}
                    itemStyle={{ color: "var(--popover-foreground)", padding: 0 }}
                    formatter={(v: number) => fmt(v, valueCol.kind) ?? String(v)}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke={seriesColor}
                    strokeWidth={2}
                    fill={`url(#area-card-${w.id})`}
                    onClick={(point) => {
                      const name = (point as unknown as { name?: string })?.name;
                      if (groupCol && name !== undefined)
                        handleGroupClick(groupCol.key, String(name));
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {metricRows.length > 0 && (
              <div className="flex flex-col divide-y divide-border px-5 pt-2 pb-1">
                {metricRows.map((row) => (
                  <div key={row.id} className="flex w-full items-center gap-2 py-3">
                    <span
                      className="w-1/2 truncate text-xs text-muted-foreground"
                      title={row.label}
                    >
                      {row.label}
                    </span>
                    <div className="flex w-1/2 items-center justify-end gap-2">
                      <span className="text-lg font-semibold text-foreground">{row.value}</span>
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full",
                          row.up
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-destructive/15 text-destructive",
                        )}
                        aria-hidden="true"
                      >
                        {row.up ? (
                          <TrendingUp className="size-3.5" />
                        ) : (
                          <TrendingDown className="size-3.5" />
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
