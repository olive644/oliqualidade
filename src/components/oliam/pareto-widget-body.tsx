import { useState, type CSSProperties } from "react";
import { ChartBarDecreasing as ParetoIcon } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { numericKinds, type Column, type FilterRule, type Row, type Widget } from "@/lib/types";
import { groupableKinds, sizeClass, spanClass } from "@/lib/widgets";
import { conditionalColor, fmt } from "@/lib/format";
import {
  aggregationLabels,
  barChartPresentation,
  paretoSeries,
  relevantAggregationOps,
  semanticAggregationOps,
  toggleClickFilter,
  type AggregationOp,
} from "@/lib/data-pipeline";
import type { ColumnSemanticProfile } from "@/lib/spreadsheet-intelligence";
import {
  groupedCountValues,
  groupedNumericValues,
  paretoChartValidity,
} from "@/lib/chart-validity";
import {
  CalculationButton,
  compactAxisValue,
  FieldDropSlot,
  FilterChip,
  WidgetDetailStrip,
  WidgetHead,
  WidgetMetricStrip,
  type WidgetDragProps,
  type WidgetMetric,
} from "./widget-support";
import { WidgetConfigBar } from "./widget-config-context";
import { useChartHorizontalScroll } from "./use-chart-horizontal-scroll";

const PARETO_THRESHOLD = 0.8;

export function ParetoWidgetBody({
  widget: w,
  data,
  columns,
  numericCols,
  groupableCols,
  semanticProfiles,
  filters,
  setFilters,
  onConfigure,
  onShowSource,
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
  onShowSource: (rowIndexes: number[], columnKey: string, title: string) => void;
  dragProps: WidgetDragProps;
  sizeControls: React.ReactNode;
  animationDelay: number;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const displayedIndex = activeIndex ?? selectedIndex;
  const { chartScrollRef, handleChartScrollPointerDown, ChartScrollButtons } =
    useChartHorizontalScroll();

  const groupCol = columns.find((c) => c.key === w.groupKey);
  const configuredValueCol = columns.find((c) => c.key === w.valueKey);
  const valueCol = configuredValueCol ?? numericCols[0];
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
  const groupedValues =
    groupCol && valueCol
      ? op === "count"
        ? groupedCountValues(data, groupCol.key)
        : groupedNumericValues(data, groupCol.key, valueCol.key)
      : new Map<string, number[]>();
  const chartValidity = groupCol && valueCol ? paretoChartValidity(groupedValues) : null;

  const series =
    groupCol && valueCol
      ? paretoSeries(data, groupCol.key, valueCol.key, op).map((entry) => ({
          ...entry,
          cumulativePercent: entry.cumulativeShare * 100,
        }))
      : [];
  // Primeira posição (1-based) em que o acumulado já bateu 80%: "essas N
  // categorias concentram 80% do total" é a leitura clássica de Pareto.
  const vitalFewCount = series.findIndex((entry) => entry.cumulativeShare >= PARETO_THRESHOLD) + 1;

  const summaryIndex = displayedIndex ?? (series.length ? 0 : null);
  const selectedEntry = summaryIndex !== null ? series[summaryIndex] : null;
  const barPresentation = barChartPresentation(series.length);

  const metrics: WidgetMetric[] =
    groupCol && valueCol && series.length
      ? [
          { label: "Categorias", value: String(series.length) },
          {
            label: "Concentram 80%",
            value:
              vitalFewCount > 0
                ? `${vitalFewCount} de ${series.length}`
                : "nenhuma combinação chega a 80%",
          },
        ]
      : [];

  const isCategoryFilterActive = (name: string) =>
    filters.some((f) => f.key === groupCol?.key && f.value === name && !f.min && !f.max);

  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={`Pareto de ${valueCol?.label ?? ""} por ${groupCol?.label ?? ""}`}
        icon={<ParetoIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        {...dragProps}
      />
      {metrics.length > 0 && <WidgetMetricStrip metrics={metrics} />}
      <WidgetConfigBar>
        <FilterChip groupKey={groupCol?.key} filters={filters} setFilters={setFilters} />
        <FieldDropSlot
          accepts={groupableKinds}
          onDropColumn={(key) => onConfigure({ groupKey: key })}
        >
          <select
            aria-label="Coluna de categoria"
            className="oliam-select"
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
        </FieldDropSlot>
        <FieldDropSlot
          accepts={numericKinds}
          onDropColumn={(key) => onConfigure({ valueKey: key })}
        >
          <select
            aria-label="Coluna numérica"
            className="oliam-select"
            value={valueCol?.key ?? ""}
            onChange={(e) => onConfigure({ valueKey: e.target.value })}
          >
            {!valueCol && <option value="">Selecione…</option>}
            {numericCols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </FieldDropSlot>
        <CalculationButton
          mode="aggregate"
          operation={op}
          operations={relevantOps}
          metric={op === "count" ? "os registros" : (valueCol?.label ?? "a métrica")}
          group={groupCol?.label}
          onOperation={(operation) => onConfigure({ op: operation })}
        />
      </WidgetConfigBar>
      {sizeControls}
      {groupCol && valueCol && (
        <p className="border-b border-border/70 bg-card px-4 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          {!chartValidity?.valid
            ? chartValidity?.reason
            : vitalFewCount > 0
              ? `${vitalFewCount} de ${series.length} categorias de "${groupCol.label}" concentram 80% de "${valueCol.label}".`
              : `Nem somando todas as ${series.length} categorias de "${groupCol.label}" o acumulado chega a 80% de "${valueCol.label}". A contribuição está bem distribuída e não há poucas categorias dominantes.`}
        </p>
      )}
      {!groupCol || !valueCol || !chartValidity?.valid ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          {!groupCol || !valueCol
            ? "Escolha uma coluna de categoria e uma numérica para este widget."
            : (chartValidity?.reason ?? "Dados insuficientes para montar o Pareto.")}
        </p>
      ) : (
        <>
          <div className="relative">
            <div
              ref={barPresentation.scrollable ? chartScrollRef : undefined}
              className={cn(
                "h-64 overflow-x-auto overflow-y-hidden p-4",
                barPresentation.scrollable && "oliam-chart-drag-scroll",
              )}
              onPointerDown={barPresentation.scrollable ? handleChartScrollPointerDown : undefined}
            >
              <div
                style={{
                  height: "100%",
                  width: barPresentation.scrollable ? barPresentation.contentWidth : "100%",
                  minWidth: "100%",
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series} margin={{ top: 20, right: 12, left: 4, bottom: 24 }}>
                    <defs>
                      <linearGradient id={`bar-grad-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={1} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.55} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                      interval={0}
                      angle={series.length > 6 ? -30 : 0}
                      textAnchor={series.length > 6 ? "end" : "middle"}
                      height={series.length > 6 ? 44 : 24}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      tickFormatter={(value: number) => compactAxisValue(value, valueCol.kind)}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                      tickFormatter={(value: number) => `${value}%`}
                    />
                    <ChartTooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      formatter={(value: number, name: string) =>
                        name === "cumulativePercent"
                          ? [`${value.toFixed(1)}%`, "Acumulado"]
                          : [fmt(value, valueCol.kind), aggregationLabels[op]]
                      }
                    />
                    <ReferenceLine
                      yAxisId="right"
                      y={80}
                      stroke="var(--destructive)"
                      strokeDasharray="4 4"
                      label={{
                        value: "80%",
                        position: "insideTopLeft",
                        fontSize: 10,
                        fill: "var(--destructive)",
                      }}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="total"
                      fill={`url(#bar-grad-${w.id})`}
                      radius={4}
                      onClick={(_, i) => setSelectedIndex((current) => (current === i ? null : i))}
                      onMouseEnter={(_, i) => setActiveIndex(i)}
                      onMouseLeave={() => setActiveIndex(null)}
                      cursor="pointer"
                      isAnimationActive={false}
                    >
                      {series.map((entry, i) => (
                        <Cell
                          key={i}
                          className="oliam-chart-bar-cell"
                          // Só compara com a regra de formatação condicional
                          // quando `entry.total` de fato está na unidade de
                          // valueCol (soma/média/mín/máx). Em op "count",
                          // `entry.total` é uma contagem de linhas — outra
                          // grandeza — e não deve ser testada contra a regra.
                          fill={
                            (op !== "count"
                              ? conditionalColor(
                                  entry.total,
                                  valueCol.kind,
                                  valueCol.conditionalFormat,
                                )
                              : null) ?? `url(#bar-grad-${w.id})`
                          }
                          opacity={displayedIndex === null || displayedIndex === i ? 1 : 0.45}
                          stroke={displayedIndex === i ? "var(--primary)" : "none"}
                          strokeWidth={displayedIndex === i ? 1 : 0}
                          style={
                            {
                              "--oliam-bar-delay": `${Math.min(i, 14) * 42}ms`,
                              filter: displayedIndex === i ? "brightness(1.08)" : "none",
                            } as CSSProperties
                          }
                        />
                      ))}
                      <LabelList
                        dataKey="total"
                        position="top"
                        fontSize={10}
                        fill="var(--muted-foreground)"
                        formatter={(v: number) => fmt(v, valueCol.kind) ?? String(v)}
                      />
                    </Bar>
                    <Line
                      yAxisId="right"
                      dataKey="cumulativePercent"
                      stroke="var(--secondary-accent)"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "var(--secondary-accent)" }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            {barPresentation.scrollable && <ChartScrollButtons label="gráfico de Pareto" />}
          </div>
          {barPresentation.scrollable && (
            <p className="border-t border-border/70 bg-card px-4 py-1 text-center text-[10px] text-muted-foreground">
              {series.length} categorias · use as setas, arraste ou role para os lados para ver
              todas
            </p>
          )}
          {selectedEntry && (
            <WidgetDetailStrip
              title={selectedEntry.name}
              subtitle={`Posição ${(summaryIndex ?? 0) + 1} de ${series.length}`}
              fields={[
                {
                  label: aggregationLabels[op],
                  value: String(fmt(selectedEntry.total, valueCol.kind)),
                },
                {
                  label: "Acumulado até aqui",
                  value: `${selectedEntry.cumulativePercent.toFixed(1)}%`,
                },
              ]}
              actions={
                <>
                  {selectedEntry.sourceRowIndexes?.length ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onShowSource(
                          selectedEntry.sourceRowIndexes!,
                          valueCol.key,
                          selectedEntry.name,
                        )
                      }
                    >
                      Ver linhas de origem
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setFilters(toggleClickFilter(filters, groupCol.key, selectedEntry.name))
                    }
                  >
                    {isCategoryFilterActive(selectedEntry.name)
                      ? "Remover filtro desta categoria"
                      : "Filtrar por esta categoria"}
                  </Button>
                </>
              }
            />
          )}
        </>
      )}
    </article>
  );
}
