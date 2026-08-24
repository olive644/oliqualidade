import { AlertTriangle, ListOrdered, Sparkles, TrendingUp } from "lucide-react";
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
  countMissingGroupRows,
  detectQualitySignals,
  pieComparisonFor,
  rankingCoverageFor,
  relevantAggregationOps,
  semanticAggregationOps,
  type AggregationOp,
} from "@/lib/data-pipeline";
import type { ColumnSemanticProfile } from "@/lib/spreadsheet-intelligence";
import {
  CalculationButton,
  ChartReadingGuide,
  FieldDropSlot,
  FilterChip,
  WidgetHead,
  type WidgetDragProps,
  WidgetEvidencePanel,
} from "./widget-support";
import { WidgetConfigBar } from "./widget-config-context";

export function InsightsWidgetBody({
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
  const grouped =
    groupCol && valueCol ? chartSeries(data, groupCol.key, valueCol.key, op, dataMode) : [];
  const sorted = [...grouped].sort((a, b) => b.total - a.total);
  const topComparison = sorted.length ? pieComparisonFor(sorted, 0) : null;
  const topCoverage = sorted.length ? rankingCoverageFor(sorted.slice(0, 3), sorted) : null;
  // Sinais de qualidade restritos às duas colunas em uso — a base inteira
  // já tem seu próprio painel global (ver routes/index.tsx); repetir tudo
  // aqui seria ruído, não achado novo específico do que este widget mostra.
  const qualitySignals =
    groupCol && valueCol ? detectQualitySignals(data, [groupCol, valueCol]) : [];
  const hasInsights = topComparison || topCoverage || qualitySignals.length > 0;
  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={`Insights · ${op === "count" ? "Registros" : (valueCol?.label ?? "")} por ${groupCol?.label ?? ""}`}
        icon={<Sparkles className="size-3.5 shrink-0 text-muted-foreground" />}
        {...dragProps}
      />
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
      </WidgetConfigBar>
      {sizeControls}
      {groupCol && valueCol && (
        <ChartReadingGuide
          group={groupCol.label}
          metric={valueCol.label}
          mode={dataMode}
          op={op}
          rowCount={data.length}
          missingGroupCount={countMissingGroupRows(data, groupCol.key)}
        />
      )}
      {!groupCol || !valueCol || sorted.length === 0 ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          {!groupCol || !valueCol
            ? "Escolha uma coluna de agrupamento e uma numérica para este widget."
            : "Dados insuficientes para gerar insights."}
        </p>
      ) : !hasInsights ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          Nenhum achado relevante para esta combinação de colunas.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 p-4 text-xs">
          {topComparison && (
            <li className="flex items-start gap-2">
              <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-secondary-accent" />
              <p>
                <strong>{topComparison.selected.name}</strong> lidera com{" "}
                {fmt(topComparison.selected.total, valueCol.kind)}
                {topComparison.share !== null &&
                  ` (${topComparison.share.toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 1 })} do total)`}
                {topComparison.reference &&
                  topComparison.relativeDifference !== null &&
                  `. Está ${Math.abs(topComparison.relativeDifference).toLocaleString("pt-BR", {
                    style: "percent",
                    maximumFractionDigits: 0,
                  })} à frente de ${topComparison.reference.name}, a segunda colocada.`}
              </p>
            </li>
          )}
          {topCoverage && topCoverage.topShare !== null && topCoverage.remainingCount > 0 && (
            <li className="flex items-start gap-2">
              <ListOrdered className="mt-0.5 size-3.5 shrink-0 text-secondary-accent" />
              <p>
                As {topCoverage.shownCount} maiores categorias concentram{" "}
                {topCoverage.topShare.toLocaleString("pt-BR", {
                  style: "percent",
                  maximumFractionDigits: 1,
                })}{" "}
                do total; restam {topCoverage.remainingCount} categoria
                {topCoverage.remainingCount > 1 ? "s" : ""} menores.
              </p>
            </li>
          )}
          {qualitySignals.map((signal, i) => (
            <li key={`${signal.kind}-${signal.columnKey}-${i}`} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>{signal.message}</p>
            </li>
          ))}
        </ul>
      )}
      <WidgetEvidencePanel />
    </article>
  );
}
