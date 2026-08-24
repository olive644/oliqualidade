import { sourceRowIndexesOf } from "@/lib/chart-source-rows";
import { useState } from "react";
import { ListOrdered } from "lucide-react";
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
import { conditionalColor, fmt } from "@/lib/format";
import {
  aggregationLabels,
  chartSeries,
  NOT_INFORMED,
  pieComparisonFor,
  rankingCoverageFor,
  relevantAggregationOps,
  semanticAggregationOps,
  toggleClickFilter,
  type AggregationOp,
} from "@/lib/data-pipeline";
import type { ColumnSemanticProfile } from "@/lib/spreadsheet-intelligence";
import {
  CalculationButton,
  FieldDropSlot,
  FilterChip,
  isCoarsePointer,
  SeriesComparisonPanel,
  WidgetHead,
  WidgetMetricStrip,
  type WidgetMetric,
  type WidgetDragProps,
} from "./widget-support";
import { WidgetConfigBar } from "./widget-config-context";

export function RankingWidgetBody({
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
  // Contar "linha a linha" devolve 1 para cada registro e transforma cada
  // linha da planilha numa categoria — 600 barras de valor 1, que não
  // informam nada e travam o navegador. Acontecia sem ninguém escolher:
  // o widget nasce com "raw" quando a operação inicial é soma, e se depois
  // a métrica não sobrevive como agregável a operação degrada para
  // contagem (semanticAggregationOps) enquanto o "raw" salvo permanece.
  // Com contagem, agregar não é preferência: é a única leitura possível.
  const dataMode: ChartDataMode = op === "count" ? "aggregate" : (w.dataMode ?? "raw");
  const topN = w.topN ?? 5;
  const grouped =
    groupCol && valueCol ? chartSeries(data, groupCol.key, valueCol.key, op, dataMode) : [];
  const ranked = [...grouped].sort((a, b) => b.total - a.total).slice(0, topN);
  const max = ranked.reduce((m, g) => Math.max(m, Math.abs(g.total)), 0) || 1;
  const coverage = rankingCoverageFor(ranked, grouped);
  // Mesma leitura guiada de barra/pizza, que o ranking não tinha: o hover
  // (desktop) troca o item explicado e, no toque, o primeiro contato apenas
  // seleciona — o filtro sai do botão explícito no painel, para não filtrar
  // sem querer com o dedo.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const displayedIndex = activeIndex ?? selectedIndex;
  // Sem hover nem seleção, o primeiro colocado já vem explicado: o painel
  // nasce preenchido em vez de esperar interação que no toque nem existe.
  const summaryIndex = displayedIndex ?? (ranked.length > 0 ? 0 : null);
  const selectedEntry = summaryIndex !== null ? ranked[summaryIndex] : null;
  const selectedComparison =
    summaryIndex !== null && ranked.length ? pieComparisonFor(ranked, summaryIndex) : null;
  // O ranking já sabia quanto o Top N concentra do total; o número só vivia
  // numa frase pequena. Sobe para a faixa de métricas junto com o líder, que
  // é a leitura que o widget existe para dar.
  const rankingMetrics: WidgetMetric[] =
    valueCol && ranked.length
      ? [
          {
            label: `Líder · ${ranked[0]!.name}`,
            value: fmt(ranked[0]!.total, valueCol.kind) ?? "–",
          },
          {
            label: `Top ${ranked.length} concentra`,
            value:
              coverage.topShare !== null
                ? coverage.topShare.toLocaleString("pt-BR", {
                    style: "percent",
                    maximumFractionDigits: 1,
                  })
                : "–",
          },
          {
            label: "Categorias",
            value: coverage.categoryCount.toLocaleString("pt-BR"),
          },
        ]
      : [];
  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={
          op === "count"
            ? `Top ${topN} · Registros por ${groupCol?.label ?? ""}`
            : `Top ${topN} · ${aggregationLabels[op]} de ${valueCol?.label ?? ""} por ${groupCol?.label ?? ""}`
        }
        icon={<ListOrdered className="size-3.5 shrink-0 text-muted-foreground" />}
        {...dragProps}
      />
      {rankingMetrics.length > 0 && <WidgetMetricStrip metrics={rankingMetrics} />}
      <WidgetConfigBar>
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
          allowRaw
          onRaw={() => onConfigure({ dataMode: "raw" })}
          onOperation={(operation) => onConfigure({ dataMode: "aggregate", op: operation })}
        />
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Itens
          <select
            aria-label="Quantidade de itens no ranking"
            className="oliam-select h-7"
            value={topN}
            onChange={(e) => onConfigure({ topN: Number(e.target.value) })}
          >
            {[3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </WidgetConfigBar>
      {sizeControls}
      {groupCol && valueCol && ranked.length > 0 && coverage.remainingCount > 0 && (
        <p className="border-b border-border bg-secondary-accent/8 px-4 py-2 text-[10px] text-muted-foreground">
          {coverage.topShare !== null
            ? `Top ${ranked.length} concentra ${coverage.topShare.toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 1 })} do total`
            : `Top ${ranked.length} mostrado`}{" "}
          · {coverage.categoryCount.toLocaleString("pt-BR")} categorias no total,{" "}
          {coverage.remainingCount.toLocaleString("pt-BR")} fora deste ranking.
        </p>
      )}
      {!groupCol || !valueCol || ranked.length === 0 ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          {!groupCol || !valueCol
            ? "Escolha uma coluna de agrupamento e uma numérica para este widget."
            : "Dados insuficientes para este ranking."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2 p-4">
          {ranked.map((g, i) => (
            <li key={`${g.name}-${g.sourceRow ?? i}`}>
              <button
                type="button"
                className={cn(
                  "oliam-ranking-row w-full text-left transition-colors",
                  summaryIndex === i && "bg-muted/40",
                )}
                aria-pressed={selectedIndex === i}
                // Em toque o navegador emula mouseenter/leave em volta do
                // clique; deixar o hover mexer aqui apagaria a seleção que o
                // toque acabou de fixar.
                onMouseEnter={() => !isCoarsePointer() && setActiveIndex(i)}
                onMouseLeave={() => !isCoarsePointer() && setActiveIndex(null)}
                onFocus={() => !isCoarsePointer() && setActiveIndex(i)}
                onBlur={() => !isCoarsePointer() && setActiveIndex(null)}
                onClick={() => {
                  if (isCoarsePointer()) {
                    setSelectedIndex(i === selectedIndex ? null : i);
                    return;
                  }
                  setFilters(toggleClickFilter(filters, groupCol.key, String(g.name)));
                }}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    <span className="font-mono text-muted-foreground">{i + 1}.</span>{" "}
                    <span className={cn(g.name === NOT_INFORMED && "italic text-muted-foreground")}>
                      {g.name}
                    </span>
                  </span>
                  <span
                    className="font-mono shrink-0"
                    style={{
                      color:
                        conditionalColor(g.total, valueCol.kind, valueCol.conditionalFormat) ??
                        undefined,
                    }}
                  >
                    {fmt(g.total, valueCol.kind) ?? "–"}
                  </span>
                </div>
                <div className="oliam-ranking-track">
                  <div
                    className="oliam-ranking-fill"
                    style={{
                      width: `${Math.max(4, (Math.abs(g.total) / max) * 100)}%`,
                      background:
                        conditionalColor(g.total, valueCol.kind, valueCol.conditionalFormat) ??
                        undefined,
                      animationDelay: `${150 + Math.min(i, 10) * 45}ms`,
                    }}
                  />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {groupCol && valueCol && selectedEntry && (
        <SeriesComparisonPanel
          selected={selectedEntry}
          comparison={selectedComparison}
          kind={valueCol.kind}
          filterLabel="Filtrar por esta categoria"
          onFilter={() => {
            setFilters(toggleClickFilter(filters, groupCol.key, String(selectedEntry.name)));
            setSelectedIndex(null);
          }}
          {...(sourceRowIndexesOf(selectedEntry).length
            ? {
                onShowSource: () =>
                  onShowSource(
                    sourceRowIndexesOf(selectedEntry),
                    valueCol.key,
                    String(selectedEntry.name),
                  ),
              }
            : {})}
        />
      )}
    </article>
  );
}
