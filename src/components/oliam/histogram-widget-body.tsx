import { sourceRowIndexesOf } from "@/lib/chart-source-rows";
import { useState, type CSSProperties } from "react";
import { BarChart2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BarShapeProps } from "recharts";
import { cn } from "@/lib/utils";
import { numericKinds, type Column, type FilterRule, type Row, type Widget } from "@/lib/types";
import { sizeClass, spanClass } from "@/lib/widgets";
import { parseNumericValue } from "@/lib/format";
import { numericChartTooltipValue, numericLabelValue } from "@/lib/recharts-compat";
import {
  barChartPresentation,
  histogramBins,
  histogramBinsWithData,
  pieComparisonFor,
} from "@/lib/data-pipeline";
import { histogramChartValidity, numericValuesFor } from "@/lib/chart-validity";
import {
  FieldDropSlot,
  SeriesComparisonPanel,
  WidgetHead,
  WidgetMetricStrip,
  type WidgetDragProps,
  type WidgetMetric,
  WidgetEvidencePanel,
} from "./widget-support";
import { WidgetConfigBar } from "./widget-config-context";
import { useChartHorizontalScroll } from "./use-chart-horizontal-scroll";

const BIN_COUNT_OPTIONS = [5, 8, 10, 15, 20];

export function HistogramWidgetBody({
  widget: w,
  data,
  columns,
  numericCols,
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

  const configuredValueCol = columns.find((c) => c.key === w.valueKey);
  const valueCol =
    configuredValueCol && numericKinds.includes(configuredValueCol.kind)
      ? configuredValueCol
      : numericCols[0];
  const validValues = valueCol ? numericValuesFor(data, valueCol.key) : [];
  const chartValidity = valueCol ? histogramChartValidity(validValues) : null;
  const bins = valueCol ? histogramBins(data, valueCol.key, w.binCount) : [];
  const emptyBinCount = bins.filter((bin) => bin.count === 0).length;
  const series = histogramBinsWithData(bins).map((bin) => ({
    name: bin.label,
    total: bin.count,
    rangeStart: bin.rangeStart,
    rangeEnd: bin.rangeEnd,
    ...(bin.sourceRowIndexes ? { sourceRowIndexes: bin.sourceRowIndexes } : {}),
  }));
  const showsExactValues =
    series.length > 1 && series.every((bin) => bin.rangeStart === bin.rangeEnd);
  const distinctValueCount = new Set(validValues).size;
  const availableBinCountOptions = showsExactValues
    ? BIN_COUNT_OPTIONS.filter((count) => count < distinctValueCount)
    : BIN_COUNT_OPTIONS;
  const distributionUnit = showsExactValues
    ? series.length === 1
      ? "valor distinto"
      : "valores distintos"
    : series.length === 1
      ? "faixa"
      : "faixas";
  const validCount = series.reduce((sum, bin) => sum + bin.total, 0);
  const missingCount = valueCol
    ? data.length - data.filter((row) => parseNumericValue(row[valueCol.key]) !== null).length
    : 0;

  // Igual à barra/pizza/ranking: sem hover nem seleção, a faixa mais
  // numerosa já vem explicada, em vez de o painel de detalhe nascer vazio.
  const summaryIndex =
    displayedIndex ??
    (series.length
      ? series.reduce((best, bin, index) => (bin.total > series[best]!.total ? index : best), 0)
      : null);
  const selectedBin = summaryIndex !== null ? series[summaryIndex] : null;
  const selectedComparison = summaryIndex !== null ? pieComparisonFor(series, summaryIndex) : null;
  const barPresentation = barChartPresentation(series.length);

  const metrics: WidgetMetric[] = valueCol
    ? [
        { label: "Valores considerados", value: validCount.toLocaleString("pt-BR") },
        {
          label: showsExactValues ? "Valores distintos" : "Faixas",
          value: String(series.length),
        },
        ...(missingCount > 0
          ? [{ label: "Sem valor numérico", value: missingCount.toLocaleString("pt-BR") }]
          : []),
        ...(emptyBinCount > 0
          ? [{ label: "Faixas vazias omitidas", value: emptyBinCount.toLocaleString("pt-BR") }]
          : []),
      ]
    : [];

  const isRangeFilterActive = (bin: { rangeStart: number; rangeEnd: number }) =>
    filters.some(
      (f) =>
        f.key === valueCol?.key &&
        f.min === String(bin.rangeStart) &&
        f.max === String(bin.rangeEnd),
    );

  return (
    <article
      data-widget-id={w.id}
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={`Distribuição de ${valueCol?.label ?? ""}`}
        icon={<BarChart2 className="size-3.5 shrink-0 text-muted-foreground" />}
        {...dragProps}
      />
      {metrics.length > 0 && <WidgetMetricStrip metrics={metrics} />}
      <WidgetConfigBar>
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
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {showsExactValues ? "Agrupamento" : "Faixas"}
          <select
            aria-label={showsExactValues ? "Agrupamento do histograma" : "Quantidade de faixas"}
            className="oliam-select h-7"
            value={showsExactValues ? 0 : (w.binCount ?? 0)}
            disabled={showsExactValues && availableBinCountOptions.length === 0}
            onChange={(e) => {
              const next = Number(e.target.value);
              onConfigure({ binCount: next || undefined });
            }}
          >
            <option value={0}>
              {showsExactValues ? `Por valor (${series.length})` : "Automático"}
            </option>
            {availableBinCountOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </WidgetConfigBar>
      {sizeControls}
      {valueCol && (
        <p className="border-b border-border/70 bg-card px-4 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          Distribuição de &quot;{valueCol.label}&quot; em {series.length} {distributionUnit},
          considerando {validCount.toLocaleString("pt-BR")}{" "}
          {validCount === 1 ? "valor numérico válido" : "valores numéricos válidos"}.
          {missingCount > 0 && (
            <>
              {" "}
              {missingCount.toLocaleString("pt-BR")}{" "}
              {missingCount === 1
                ? "registro sem valor numérico não entrou"
                : "registros sem valor numérico não entraram"}{" "}
              nesta distribuição.
            </>
          )}
          {emptyBinCount > 0 && (
            <>
              {" "}
              {emptyBinCount.toLocaleString("pt-BR")}{" "}
              {emptyBinCount === 1 ? "faixa sem" : "faixas sem"} registros{" "}
              {emptyBinCount === 1 ? "foi omitida" : "foram omitidas"} do gráfico.
            </>
          )}
        </p>
      )}
      {!valueCol || !chartValidity?.valid ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          {!valueCol
            ? "Escolha uma coluna numérica para este widget."
            : (chartValidity?.reason ?? "Dados insuficientes para montar o histograma.")}
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
                  <BarChart data={series} margin={{ top: 20, right: 12, left: 4, bottom: 18 }}>
                    <defs>
                      <linearGradient id={`bar-grad-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={1} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.55} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      vertical={false}
                      horizontal
                      stroke="var(--border)"
                      strokeOpacity={0.6}
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                      interval={0}
                      angle={series.length > 6 ? -30 : 0}
                      textAnchor={series.length > 6 ? "end" : "middle"}
                      height={series.length > 6 ? 40 : 24}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <ChartTooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      formatter={(value) => {
                        const count = numericChartTooltipValue(value);
                        return [
                          count === null
                            ? "Contagem indisponível"
                            : `${count.toLocaleString("pt-BR")} registro(s)`,
                          "Contagem",
                        ];
                      }}
                    />
                    <Bar
                      dataKey="total"
                      fill={`url(#bar-grad-${w.id})`}
                      radius={4}
                      onClick={(_, i) => setSelectedIndex((current) => (current === i ? null : i))}
                      onMouseEnter={(_, i) => setActiveIndex(i)}
                      onMouseLeave={() => setActiveIndex(null)}
                      cursor="pointer"
                      isAnimationActive={false}
                      shape={(shapeProps: BarShapeProps) => {
                        const highlighted = displayedIndex === shapeProps.index;
                        return (
                          <Rectangle
                            {...shapeProps}
                            className="oliam-chart-bar-cell"
                            fill={`url(#bar-grad-${w.id})`}
                            opacity={displayedIndex === null || highlighted ? 1 : 0.45}
                            stroke={highlighted ? "var(--primary)" : "none"}
                            strokeWidth={highlighted ? 1 : 0}
                            style={
                              {
                                ...shapeProps.style,
                                "--oliam-bar-delay": `${Math.min(shapeProps.index, 14) * 42}ms`,
                                filter: highlighted ? "brightness(1.08)" : "none",
                              } as CSSProperties
                            }
                          />
                        );
                      }}
                    >
                      <LabelList
                        dataKey="total"
                        position="top"
                        fontSize={10}
                        fill="var(--muted-foreground)"
                        formatter={(value) => {
                          const count = numericLabelValue(value);
                          return count !== null && count > 0 ? count.toLocaleString("pt-BR") : "";
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {barPresentation.scrollable && <ChartScrollButtons label="histograma" />}
          </div>
          {barPresentation.scrollable && (
            <p className="border-t border-border/70 bg-card px-4 py-1 text-center text-[10px] text-muted-foreground">
              {series.length} {showsExactValues ? "valores" : "faixas"}. Use as setas, arraste ou
              role para os lados para ver todos.
            </p>
          )}
          {selectedBin && (
            <SeriesComparisonPanel
              selected={selectedBin}
              comparison={selectedComparison}
              kind="number"
              filterLabel={
                isRangeFilterActive(selectedBin)
                  ? `Remover filtro ${showsExactValues ? "deste valor" : "desta faixa"}`
                  : `Filtrar ${showsExactValues ? "por este valor" : "por esta faixa"}`
              }
              onFilter={() => {
                if (!valueCol) return;
                const rest = filters.filter((f) => f.key !== valueCol.key);
                setFilters(
                  isRangeFilterActive(selectedBin)
                    ? rest
                    : [
                        ...rest,
                        {
                          key: valueCol.key,
                          value: "",
                          min: String(selectedBin.rangeStart),
                          max: String(selectedBin.rangeEnd),
                        },
                      ],
                );
              }}
              {...(valueCol && sourceRowIndexesOf(selectedBin).length
                ? {
                    onShowSource: () =>
                      onShowSource(sourceRowIndexesOf(selectedBin), valueCol.key, selectedBin.name),
                  }
                : {})}
            />
          )}
        </>
      )}
      <WidgetEvidencePanel />
    </article>
  );
}
