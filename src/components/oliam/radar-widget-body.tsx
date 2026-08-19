import { useState } from "react";
import { Radar as RadarIcon } from "lucide-react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
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
import { fmt } from "@/lib/format";
import {
  aggregationLabels,
  chartSeries,
  NOT_INFORMED,
  pieComparisonFor,
  relevantAggregationOps,
  semanticAggregationOps,
  toggleClickFilter,
  type AggregationOp,
} from "@/lib/data-pipeline";
import type { ColumnSemanticProfile } from "@/lib/spreadsheet-intelligence";
import {
  CalculationButton,
  ChartReadingGuide,
  FieldDropSlot,
  FilterChip,
  SeriesComparisonPanel,
  truncateLabel,
  WidgetHead,
  type WidgetDragProps,
} from "./widget-support";

export function RadarWidgetBody({
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
  // Mesmo padrão do pizza (chart-widget-body.tsx): hover troca o
  // destaque, sem estado de "seleção" própria — clicar já filtra
  // diretamente.
  const [activeAxisIndex, setActiveAxisIndex] = useState<number | null>(null);
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
  // Radar sempre agrega por categoria: cada eixo precisa ser único, ao
  // contrário de ranking/barra (onde "linha a linha" faz sentido e cada
  // linha vira uma marca própria). Nunca oferece nem herda modo raw — se
  // oferecesse, categorias repetidas virariam eixos duplicados
  // sobrepostos, quebrando a leitura do polígono.
  const dataMode: ChartDataMode = "aggregate";
  const topN = w.topN ?? 5;
  const grouped =
    groupCol && valueCol ? chartSeries(data, groupCol.key, valueCol.key, op, dataMode) : [];
  const axes = [...grouped]
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, topN)
    .map((g) => ({ ...g, label: truncateLabel(String(g.name), 14) }));
  // Uma opção de "Eixos" só aparece se mudar o resultado de verdade —
  // ex.: com só 3 categorias na planilha, "5" e "8" desenhariam o mesmo
  // triângulo de "3", então ficam de fora (evita a sensação de seletor
  // quebrado quando na verdade não há mais categoria pra mostrar).
  const axisOptions = [3, 5, 8].filter((n, i, all) => {
    const effective = Math.min(n, grouped.length);
    const previous = i > 0 ? Math.min(all[i - 1]!, grouped.length) : -1;
    return effective !== previous;
  });
  // A leitura detalhada fica visível desde o início usando a maior
  // categoria; hover apenas troca o foco — mesmo padrão do pizza.
  const largestAxisIndex = axes.reduce(
    (largest, entry, index, entries) =>
      largest < 0 || entry.total > (entries[largest]?.total ?? Number.NEGATIVE_INFINITY)
        ? index
        : largest,
    -1,
  );
  const summaryAxisIndex = activeAxisIndex ?? (largestAxisIndex >= 0 ? largestAxisIndex : null);
  const selectedAxis = summaryAxisIndex !== null ? axes[summaryAxisIndex] : null;
  const selectedAxisComparison =
    summaryAxisIndex !== null ? pieComparisonFor(axes, summaryAxisIndex) : null;

  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={
          op === "count"
            ? `Radar · Registros por ${groupCol?.label ?? ""}`
            : `Radar · ${aggregationLabels[op]} de ${valueCol?.label ?? ""} por ${groupCol?.label ?? ""}`
        }
        icon={<RadarIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        {...dragProps}
      />
      <div
        className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
        data-export-controls
      >
        <FilterChip groupKey={groupCol?.key} filters={filters} setFilters={setFilters} />
        <FieldDropSlot
          accepts={groupableKinds}
          onDropColumn={(key) => onConfigure({ groupKey: key })}
        >
          <select
            aria-label="Agrupar por"
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
          accepts={op === "count" ? (Object.keys(kinds) as Kind[]) : numericKinds}
          onDropColumn={(key) => onConfigure({ valueKey: key })}
        >
          <select
            aria-label={op === "count" ? "Coluna usada para contar" : "Coluna numérica"}
            className="oliam-select"
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
        </FieldDropSlot>
        <CalculationButton
          mode={dataMode}
          operation={op}
          operations={relevantOps}
          metric={op === "count" ? "os registros" : (valueCol?.label ?? "a métrica")}
          group={groupCol?.label}
          onOperation={(operation) => onConfigure({ dataMode: "aggregate", op: operation })}
        />
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Eixos
          <select
            aria-label="Quantidade de eixos no radar"
            className="oliam-select h-7"
            value={topN}
            onChange={(e) => onConfigure({ topN: Number(e.target.value) })}
          >
            {axisOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
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
      {!groupCol || !valueCol || axes.length < 3 ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          {!groupCol || !valueCol
            ? "Escolha uma coluna de agrupamento e uma numérica para este widget."
            : "São necessárias ao menos 3 categorias para desenhar o radar."}
        </p>
      ) : (
        <div className="h-64 min-w-0 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={axes} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
              <PolarGrid stroke="var(--border)" strokeOpacity={0.6} />
              <PolarAngleAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              />
              <PolarRadiusAxis tick={false} axisLine={false} />
              <ChartTooltip
                cursor={false}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const entry = payload[0]?.payload as { name: string; total: number } | undefined;
                  if (!entry) return null;
                  return (
                    <div
                      style={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        fontSize: 12,
                        padding: "8px 12px",
                        boxShadow:
                          "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
                      }}
                    >
                      <div
                        style={{
                          color: "var(--popover-foreground)",
                          fontWeight: 600,
                          marginBottom: 2,
                        }}
                      >
                        {entry.name === NOT_INFORMED ? "Não informado" : entry.name}
                      </div>
                      <span style={{ color: "var(--popover-foreground)" }}>
                        {fmt(entry.total, valueCol.kind) ?? entry.total}
                      </span>
                    </div>
                  );
                }}
              />
              <Radar
                dataKey="total"
                stroke="var(--primary)"
                fill="var(--primary)"
                fillOpacity={0.35}
                strokeWidth={2}
                isAnimationActive
                cursor="pointer"
                // Cada ponta é seu próprio alvo de hover/clique (igual ao
                // <Cell> da barra/pizza) — dá um leve zoom na ponta sob o
                // mouse e clique filtra direto, sem depender do
                // rastreamento por eixo do RadarChart (que não distingue
                // "sobre a ponta" de "sobre a área preenchida").
                dot={(dotProps: { cx?: number; cy?: number; index?: number }) => {
                  const { cx, cy, index } = dotProps;
                  if (typeof cx !== "number" || typeof cy !== "number" || index === undefined) {
                    return <g />;
                  }
                  const isActive = activeAxisIndex === index;
                  return (
                    <circle
                      key={`axis-dot-${index}`}
                      cx={cx}
                      cy={cy}
                      r={isActive ? 7 : 4}
                      fill="var(--primary)"
                      stroke="var(--card)"
                      strokeWidth={2}
                      style={{
                        transition: "r 150ms cubic-bezier(0.16, 1, 0.3, 1)",
                        cursor: "pointer",
                      }}
                      onMouseEnter={() => setActiveAxisIndex(index)}
                      onMouseLeave={() => setActiveAxisIndex(null)}
                      onClick={() => {
                        const entry = axes[index];
                        if (entry && groupCol) handleGroupClick(groupCol.key, String(entry.name));
                      }}
                    />
                  );
                }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
      {selectedAxis && (
        <SeriesComparisonPanel
          selected={selectedAxis}
          comparison={selectedAxisComparison}
          kind={valueCol?.kind ?? "number"}
          filterLabel="Filtrar por esta categoria"
          onFilter={() => groupCol && handleGroupClick(groupCol.key, String(selectedAxis.name))}
        />
      )}
    </article>
  );
}
