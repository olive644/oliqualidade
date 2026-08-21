import { AreaChart, Area, ResponsiveContainer, Tooltip as ChartTooltip } from "recharts";
import { ArrowDown, ArrowUp, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { numericKinds, type Column, type Row, type Widget } from "@/lib/types";
import { sizeClass, spanClass } from "@/lib/widgets";
import {
  conditionalColor,
  conditionalStyle,
  fmt,
  parseDateValue,
  parseNumericValue,
} from "@/lib/format";
import {
  aggregate,
  groupAndAggregate,
  semanticAggregationOps,
  timeSeriesChartPresentation,
  type AggregationOp,
} from "@/lib/data-pipeline";
import type { ColumnSemanticProfile } from "@/lib/spreadsheet-intelligence";
import {
  CalculationButton,
  calculationCopy,
  EmptyWidget,
  FieldDropSlot,
  WidgetHead,
  type WidgetDragProps,
} from "./widget-support";
import { WidgetConfigBar } from "./widget-config-context";
import { useChartHorizontalScroll } from "./use-chart-horizontal-scroll";
import { AnimatedNumber } from "./animated-number";

export function MetricWidgetBody({
  widget: w,
  data,
  columns,
  numericCols,
  semanticProfiles,
  versionDelta,
  onConfigure,
  dragProps,
  animationDelay,
}: {
  widget: Widget;
  data: Row[];
  columns: Column[];
  numericCols: Column[];
  semanticProfiles: ColumnSemanticProfile[];
  versionDelta: Map<string, number | null> | null;
  onConfigure: (patch: Partial<Widget>) => void;
  dragProps: WidgetDragProps;
  animationDelay: number;
}) {
  const { chartScrollRef, handleChartScrollPointerDown, ChartScrollButtons } =
    useChartHorizontalScroll();
  const col =
    columns.find((c) => c.key === w.metricKey && numericKinds.includes(c.kind)) ?? numericCols[0];
  if (!col) {
    return (
      <EmptyWidget
        {...dragProps}
        title="Métrica"
        span={w.span}
        size={w.size}
        type={w.type}
        animationDelay={animationDelay}
        message="Nenhuma coluna numérica disponível."
      />
    );
  }
  const metricOps = semanticAggregationOps(
    ["sum", "avg", "count", "min", "max"],
    col,
    semanticProfiles.find((profile) => profile.key === col.key),
  );
  const requestedMetricOp: AggregationOp = w.op ?? "sum";
  const metricOp: AggregationOp = metricOps.includes(requestedMetricOp)
    ? requestedMetricOp
    : (metricOps[0] ?? "avg");
  const total = aggregate(
    data.map((r) => parseNumericValue(r[col.key])).filter((v): v is number => v !== null),
    metricOp,
  );
  const style = conditionalStyle(total, col.kind, col.conditionalFormat);
  const formattedChartColor =
    conditionalColor(total, col.kind, col.conditionalFormat) ?? "var(--secondary-accent)";
  const trendDateCol =
    w.type === "metric-trend"
      ? (columns.find((c) => c.key === w.groupKey && c.kind === "date") ??
        columns.find((c) => c.kind === "date"))
      : undefined;
  const sparkline =
    w.type === "metric-trend" && trendDateCol
      ? [...groupAndAggregate(data, trendDateCol.key, col.key, metricOp)].sort(
          (a, b) =>
            (parseDateValue(a.name) ?? Number.MAX_SAFE_INTEGER) -
            (parseDateValue(b.name) ?? Number.MAX_SAFE_INTEGER),
        )
      : [];
  const sparkPresentation = timeSeriesChartPresentation(sparkline.length, true);
  const sparkStart = sparkline[0]?.total;
  const sparkEnd = sparkline.at(-1)?.total;
  const sparkChange =
    sparkStart !== undefined && sparkEnd !== undefined && sparkStart !== 0
      ? (sparkEnd - sparkStart) / Math.abs(sparkStart)
      : null;
  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms`, ...(style ?? {}) }}
    >
      <WidgetHead
        title={col.label}
        icon={
          w.type === "metric-trend" ? (
            <TrendingUp className="size-3.5 shrink-0 text-muted-foreground" />
          ) : undefined
        }
        {...dragProps}
      />
      <WidgetConfigBar>
        <FieldDropSlot
          accepts={numericKinds}
          onDropColumn={(key) => onConfigure({ metricKey: key })}
        >
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Coluna
            <select
              aria-label="Coluna da métrica"
              className="oliam-select h-7"
              value={col.key}
              onChange={(e) => onConfigure({ metricKey: e.target.value })}
            >
              {numericCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </FieldDropSlot>
        <CalculationButton
          operation={metricOp}
          operations={metricOps}
          metric={col.label}
          onOperation={(operation) => onConfigure({ op: operation })}
        />
        {w.type === "metric-trend" && columns.some((c) => c.kind === "date") && (
          <FieldDropSlot accepts={["date"]} onDropColumn={(key) => onConfigure({ groupKey: key })}>
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Sparkline por
              <select
                aria-label="Coluna de data do sparkline"
                className="oliam-select h-7"
                value={trendDateCol?.key ?? ""}
                onChange={(e) => onConfigure({ groupKey: e.target.value })}
              >
                {columns
                  .filter((c) => c.kind === "date")
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </label>
          </FieldDropSlot>
        )}
      </WidgetConfigBar>
      <div className="border-b border-border bg-card px-4 py-2 text-[11px] text-muted-foreground">
        <strong className="text-foreground">Cálculo atual:</strong>{" "}
        {calculationCopy[metricOp].action} para as {data.length.toLocaleString("pt-BR")} linhas
        visíveis. Toque na calculadora para alterar.
      </div>
      <div className="p-5">
        <p
          className="font-display text-4xl font-extrabold tracking-tight"
          style={style ? { color: style.color } : undefined}
        >
          <AnimatedNumber value={total} kind={col.kind} />
        </p>
        {versionDelta && (
          <p
            className={cn(
              "mt-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium",
              (versionDelta.get(col.key) ?? 0) >= 0
                ? "bg-secondary-accent/12 text-secondary-accent"
                : "bg-destructive/12 text-destructive",
            )}
          >
            {versionDelta.get(col.key) === null ? (
              "sem base para comparar"
            ) : (
              <>
                {(versionDelta.get(col.key) as number) >= 0 ? (
                  <ArrowUp className="size-3" />
                ) : (
                  <ArrowDown className="size-3" />
                )}
                {new Intl.NumberFormat("pt-BR", {
                  style: "percent",
                  maximumFractionDigits: 1,
                }).format(Math.abs(versionDelta.get(col.key) as number))}{" "}
                vs. anterior
              </>
            )}
          </p>
        )}
        {w.type === "metric-trend" && (
          <div className="mt-4">
            {sparkline.length >= 2 ? (
              <>
                <div className="relative">
                  <div
                    ref={sparkPresentation.scrollable ? chartScrollRef : undefined}
                    className={cn(
                      "h-16 overflow-x-auto overflow-y-hidden",
                      sparkPresentation.scrollable && "oliam-chart-drag-scroll",
                    )}
                    onPointerDown={
                      sparkPresentation.scrollable ? handleChartScrollPointerDown : undefined
                    }
                  >
                    <div
                      style={{
                        height: "100%",
                        width: sparkPresentation.scrollable
                          ? sparkPresentation.contentWidth
                          : "100%",
                        minWidth: "100%",
                      }}
                    >
                      <ResponsiveContainer>
                        <AreaChart
                          data={sparkline}
                          margin={{ top: 3, right: 3, left: 3, bottom: 3 }}
                        >
                          <defs>
                            <linearGradient id={`spark-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={formattedChartColor} stopOpacity={0.5} />
                              <stop offset="100%" stopColor={formattedChartColor} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <ChartTooltip
                            contentStyle={{
                              background: "var(--popover)",
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              fontSize: 11,
                            }}
                            formatter={(value: number) => [
                              fmt(value, col.kind) ?? String(value),
                              col.label,
                            ]}
                          />
                          <Area
                            type="monotone"
                            dataKey="total"
                            stroke={formattedChartColor}
                            strokeWidth={2}
                            fill={`url(#spark-${w.id})`}
                            dot={false}
                            activeDot={{ r: 3, fill: formattedChartColor }}
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  {sparkPresentation.scrollable && (
                    <ChartScrollButtons label="tendência da métrica" compact />
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                  <span>{sparkline[0]?.name}</span>
                  <span
                    className={cn(
                      "font-semibold",
                      (sparkChange ?? 0) >= 0 ? "text-secondary-accent" : "text-destructive",
                    )}
                  >
                    {sparkChange === null
                      ? `${sparkline.length} períodos`
                      : new Intl.NumberFormat("pt-BR", {
                          style: "percent",
                          maximumFractionDigits: 1,
                        }).format(sparkChange)}
                  </span>
                  <span>{sparkline.at(-1)?.name}</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sem coluna de data suficiente para o sparkline.
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
