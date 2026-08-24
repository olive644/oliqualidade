import { useState } from "react";
import { AlignVerticalDistributeCenter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { numericKinds, type Column, type FilterRule, type Row, type Widget } from "@/lib/types";
import { groupableKinds, sizeClass, spanClass } from "@/lib/widgets";
import { conditionalColor, fmt } from "@/lib/format";
import { boxPlotStats, countMissingGroupRows, toggleClickFilter } from "@/lib/data-pipeline";
import { boxPlotChartValidity, groupedNumericValues } from "@/lib/chart-validity";
import {
  FieldDropSlot,
  FilterChip,
  WidgetDetailStrip,
  WidgetHead,
  WidgetMetricStrip,
  type WidgetDragProps,
  type WidgetMetric,
  WidgetEvidencePanel,
} from "./widget-support";
import { WidgetConfigBar } from "./widget-config-context";
import { useChartHorizontalScroll } from "./use-chart-horizontal-scroll";

const CHART_HEIGHT = 220;
const TOP_PAD = 16;
const BOTTOM_PAD = 28;
const LEFT_PAD = 44;
const SLOT_WIDTH = 100;
const BOX_WIDTH = 44;
/** Acima disso, o SVG passa a ter largura fixa maior que o card e rola na horizontal — mesmo limiar usado pelo gráfico de barras (ver barChartPresentation). */
const SCROLL_THRESHOLD = 8;

export function BoxPlotWidgetBody({
  widget: w,
  data,
  columns,
  numericCols,
  groupableCols,
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
  const groupedValues =
    groupCol && valueCol
      ? groupedNumericValues(data, groupCol.key, valueCol.key)
      : new Map<string, number[]>();
  const chartValidity = groupCol && valueCol ? boxPlotChartValidity(groupedValues) : null;
  const boxes = groupCol && valueCol ? boxPlotStats(data, groupCol.key, valueCol.key) : [];
  const totalCount = boxes.reduce((sum, box) => sum + box.count, 0);
  const missingCount = groupCol ? countMissingGroupRows(data, groupCol.key) : 0;

  const summaryIndex = displayedIndex ?? (boxes.length ? 0 : null);
  const selectedBox = summaryIndex !== null ? boxes[summaryIndex] : null;

  const metrics: WidgetMetric[] =
    groupCol && valueCol
      ? [
          { label: "Categorias", value: String(boxes.length) },
          { label: "Registros considerados", value: totalCount.toLocaleString("pt-BR") },
        ]
      : [];

  const allValues = boxes.flatMap((box) => [box.min, box.max, ...box.outliers]);
  const domainMin = allValues.length ? Math.min(...allValues) : 0;
  const domainMax = allValues.length ? Math.max(...allValues) : 1;
  const plotHeight = CHART_HEIGHT - TOP_PAD - BOTTOM_PAD;
  const yFor = (value: number) =>
    domainMax === domainMin
      ? TOP_PAD + plotHeight / 2
      : TOP_PAD + (1 - (value - domainMin) / (domainMax - domainMin)) * plotHeight;
  const chartWidth = LEFT_PAD + Math.max(1, boxes.length) * SLOT_WIDTH;
  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) =>
    domainMin === domainMax ? domainMin : domainMin + (i * (domainMax - domainMin)) / yTicks,
  );

  const isCategoryFilterActive = (name: string) =>
    filters.some((f) => f.key === groupCol?.key && f.value === name && !f.min && !f.max);

  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={`Distribuição de ${valueCol?.label ?? ""} por ${groupCol?.label ?? ""}`}
        icon={<AlignVerticalDistributeCenter className="size-3.5 shrink-0 text-muted-foreground" />}
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
      </WidgetConfigBar>
      {sizeControls}
      {groupCol && valueCol && (
        <p className="border-b border-border/70 bg-card px-4 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          Distribuição de &quot;{valueCol.label}&quot; por &quot;{groupCol.label}&quot;,
          considerando {totalCount.toLocaleString("pt-BR")} registros numéricos válidos em{" "}
          {boxes.length} {boxes.length === 1 ? "categoria" : "categorias"}.
          {missingCount > 0 && (
            <>
              {" "}
              {missingCount.toLocaleString("pt-BR")}{" "}
              {missingCount === 1
                ? `linha sem "${groupCol.label}" não entrou`
                : `linhas sem "${groupCol.label}" não entraram`}{" "}
              nesta distribuição.
            </>
          )}
        </p>
      )}
      {!groupCol || !valueCol || !chartValidity?.valid ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          {!groupCol || !valueCol
            ? "Escolha uma coluna de categoria e uma numérica para este widget."
            : (chartValidity?.reason ?? "Dados insuficientes para montar o box plot.")}
        </p>
      ) : (
        <>
          <div className="relative">
            <div
              ref={boxes.length > SCROLL_THRESHOLD ? chartScrollRef : undefined}
              className={cn(
                "h-64 overflow-x-auto p-4",
                boxes.length > SCROLL_THRESHOLD && "oliam-chart-drag-scroll",
              )}
              onPointerDown={
                boxes.length > SCROLL_THRESHOLD ? handleChartScrollPointerDown : undefined
              }
            >
              <svg
                viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
                width={Math.max(300, chartWidth)}
                height={CHART_HEIGHT}
                role="img"
                aria-label={`Box plot de ${valueCol.label} por ${groupCol.label}`}
              >
                {tickValues.map((value, i) => (
                  <g key={i}>
                    <line
                      x1={LEFT_PAD}
                      x2={chartWidth}
                      y1={yFor(value)}
                      y2={yFor(value)}
                      stroke="var(--border)"
                      strokeOpacity={0.5}
                    />
                    <text
                      x={LEFT_PAD - 6}
                      y={yFor(value)}
                      textAnchor="end"
                      dominantBaseline="middle"
                      fontSize={9}
                      fill="var(--muted-foreground)"
                    >
                      {fmt(value, valueCol.kind)}
                    </text>
                  </g>
                ))}
                {boxes.map((box, i) => {
                  const slotX = LEFT_PAD + i * SLOT_WIDTH + SLOT_WIDTH / 2;
                  const isDisplayed = displayedIndex === null || displayedIndex === i;
                  // A mediana é o valor mais representativo da caixa — a cor
                  // condicional (quando o usuário configurou uma regra pra
                  // esta coluna) segue o mesmo critério que barra/pizza/ranking
                  // já usam para colorir por valor, em vez de deixar as caixas
                  // sempre na cor neutra do tema.
                  const boxColor =
                    conditionalColor(box.median, valueCol.kind, valueCol.conditionalFormat) ??
                    "var(--primary)";
                  return (
                    <g
                      key={box.name}
                      opacity={isDisplayed ? 1 : 0.4}
                      className="cursor-pointer"
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseLeave={() => setActiveIndex(null)}
                      onClick={() => setSelectedIndex((current) => (current === i ? null : i))}
                    >
                      <line
                        x1={slotX}
                        x2={slotX}
                        y1={yFor(box.max)}
                        y2={yFor(box.min)}
                        stroke="var(--muted-foreground)"
                        strokeWidth={1.5}
                      />
                      <line
                        x1={slotX - BOX_WIDTH / 4}
                        x2={slotX + BOX_WIDTH / 4}
                        y1={yFor(box.max)}
                        y2={yFor(box.max)}
                        stroke="var(--muted-foreground)"
                        strokeWidth={1.5}
                      />
                      <line
                        x1={slotX - BOX_WIDTH / 4}
                        x2={slotX + BOX_WIDTH / 4}
                        y1={yFor(box.min)}
                        y2={yFor(box.min)}
                        stroke="var(--muted-foreground)"
                        strokeWidth={1.5}
                      />
                      <rect
                        x={slotX - BOX_WIDTH / 2}
                        y={yFor(box.q3)}
                        width={BOX_WIDTH}
                        height={Math.max(1, yFor(box.q1) - yFor(box.q3))}
                        fill={boxColor}
                        fillOpacity={0.25}
                        stroke={boxColor}
                        strokeWidth={1.5}
                        rx={2}
                      />
                      <line
                        x1={slotX - BOX_WIDTH / 2}
                        x2={slotX + BOX_WIDTH / 2}
                        y1={yFor(box.median)}
                        y2={yFor(box.median)}
                        stroke={boxColor}
                        strokeWidth={2}
                      />
                      {box.outliers.map((value, oi) => (
                        <circle
                          key={oi}
                          cx={slotX}
                          cy={yFor(value)}
                          r={2.5}
                          fill="var(--destructive)"
                          fillOpacity={0.75}
                        />
                      ))}
                      <text
                        x={slotX}
                        y={CHART_HEIGHT - BOTTOM_PAD + 16}
                        textAnchor="middle"
                        fontSize={9}
                        fill="var(--muted-foreground)"
                      >
                        {box.name.length > 12 ? `${box.name.slice(0, 11)}…` : box.name}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            {boxes.length > SCROLL_THRESHOLD && <ChartScrollButtons label="box plot" />}
          </div>
          {boxes.length > SCROLL_THRESHOLD && (
            <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
              {boxes.length.toLocaleString("pt-BR")} categorias · use as setas, arraste ou role para
              os lados para ver todas
            </p>
          )}
          {selectedBox && (
            <WidgetDetailStrip
              title={selectedBox.name}
              subtitle={`${selectedBox.count.toLocaleString("pt-BR")} ${
                selectedBox.count === 1 ? "registro" : "registros"
              }${selectedBox.outliers.length > 0 ? ` · ${selectedBox.outliers.length} fora da curva` : ""}`}
              fields={[
                {
                  label: "Mín · Q1",
                  value: `${fmt(selectedBox.min, valueCol.kind)} · ${fmt(selectedBox.q1, valueCol.kind)}`,
                },
                { label: "Mediana", value: String(fmt(selectedBox.median, valueCol.kind)) },
                {
                  label: "Q3 · Máx",
                  value: `${fmt(selectedBox.q3, valueCol.kind)} · ${fmt(selectedBox.max, valueCol.kind)}`,
                },
              ]}
              actions={
                <>
                  {selectedBox.sourceRowIndexes?.length ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onShowSource(selectedBox.sourceRowIndexes!, valueCol.key, selectedBox.name)
                      }
                    >
                      Ver linhas de origem
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setFilters(toggleClickFilter(filters, groupCol.key, selectedBox.name))
                    }
                  >
                    {isCategoryFilterActive(selectedBox.name)
                      ? "Remover filtro desta categoria"
                      : "Filtrar por esta categoria"}
                  </Button>
                </>
              }
            />
          )}
        </>
      )}
      <WidgetEvidencePanel />
    </article>
  );
}
