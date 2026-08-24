import { sourceRowIndexesOf } from "@/lib/chart-source-rows";
import { useState, type CSSProperties } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  Pie,
  PieChart as RPieChart,
  ResponsiveContainer,
  Sector,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, BarChart3, PieChart as PieIcon, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  kinds,
  numericKinds,
  type BarSortMode,
  type ChartAxisKind,
  type ChartDataMode,
  type AreaReferenceMode,
  type Column,
  type FilterRule,
  type Kind,
  type Row,
  type Widget,
} from "@/lib/types";
import { groupableKinds, sizeClass, spanClass } from "@/lib/widgets";
import { conditionalColor, fmt, palette, sortChronologically } from "@/lib/format";
import {
  aggregationLabels,
  buildAreaComparisonSeries,
  axisLabelPresentation,
  BAR_SLOT_PX,
  barChartPresentation,
  barValueLabelsFit,
  chartSeries,
  TIME_SERIES_SLOT_PX,
  collapsePieSeries,
  limitChartSeriesForRendering,
  pieComparisonFor,
  pieRoundnessFor,
  relevantAggregationOps,
  semanticAggregationOps,
  seriesAverage,
  sortBarCategories,
  timeSeriesChartPresentation,
  toggleClickFilter,
  seriesHeadline,
  trendSummaryFor,
  type AggregationOp,
} from "@/lib/data-pipeline";
import type { ColumnSemanticProfile } from "@/lib/spreadsheet-intelligence";
import {
  AxisTick,
  BarTooltip,
  CalculationButton,
  ChartAxisLegend,
  ChartSeriesLegend,
  ChartDot,
  compactAxisValue,
  FieldDropSlot,
  FilterChip,
  isCoarsePointer,
  PieLegend,
  SeriesComparisonPanel,
  TrendSummaryPanel,
  truncateLabel,
  WidgetMetricStrip,
  type WidgetMetric,
  WidgetHead,
  type ChartDotProps,
  type WidgetDragProps,
} from "./widget-support";
import { WidgetConfigBar } from "./widget-config-context";
import { useChartHorizontalScroll } from "./use-chart-horizontal-scroll";

export function ChartWidgetBody({
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
  // Cross-filter padronizado: clicar em um valor filtra por aquela coluna
  // sem descartar filtros de outras colunas (ex: clicar num mapa e numa
  // linha do tempo ao mesmo tempo); clicar de novo no mesmo valor remove o
  // filtro.
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null);
  const [selectedPieIndex, setSelectedPieIndex] = useState<number | null>(null);
  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);
  const { chartScrollRef, handleChartScrollPointerDown, ChartScrollButtons } =
    useChartHorizontalScroll();
  const handleGroupClick = (groupKey: string, value: string) => {
    setFilters(toggleClickFilter(filters, groupKey, value));
  };
  // Linha e área filtravam direto no clique do ponto, sem nenhuma leitura
  // intermediária — no toque isso dispara filtro sem querer, e no desktop o
  // usuário só via o valor no tooltip, que some. Agora o ponto seleciona
  // primeiro (em qualquer entrada, para o desktop também ganhar a leitura
  // explicada) e o filtro sai do botão do painel.
  const [selectedPointName, setSelectedPointName] = useState<string | null>(null);
  const handlePointClick = (groupKey: string, value: string) => {
    if (isCoarsePointer()) {
      setSelectedPointName((current) => (current === value ? null : value));
      return;
    }
    handleGroupClick(groupKey, value);
  };

  const groupCol =
    w.type === "line"
      ? columns.find((c) => c.key === w.groupKey && c.kind === "date")
      : columns.find((c) => c.key === w.groupKey);
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
  const title =
    dataMode === "raw" && op !== "count"
      ? `${valueCol?.label ?? "Valores"} por linha de ${groupCol?.label ?? "categoria"}`
      : op === "count"
        ? w.type === "pie"
          ? `Distribuição de registros por ${groupCol?.label ?? ""}`
          : `Contagem de registros por ${groupCol?.label ?? ""}`
        : w.type === "line"
          ? `Evolução de ${valueCol?.label ?? ""}`
          : w.type === "area"
            ? `Evolução de ${valueCol?.label ?? ""} (área)`
            : w.type === "pie"
              ? "Distribuição"
              : `${aggregationLabels[op]} de ${valueCol?.label ?? ""} por ${groupCol?.label ?? ""}`;
  // Rótulos de eixo: o título do widget diz o que o gráfico mede, mas some
  // quando o gráfico é exportado ou lido isolado, e o eixo vertical sozinho
  // mostra só "1,2 mil", sem unidade nem operação.
  const horizontalAxisLabel = groupCol?.label ?? "Categoria";
  const verticalAxisLabel =
    op === "count"
      ? "Contagem de registros"
      : dataMode === "raw"
        ? `${valueCol?.label ?? "Valores"} (linha a linha)`
        : `${aggregationLabels[op]} de ${valueCol?.label ?? ""}`;
  const icon =
    w.type === "line" ? (
      <TrendingUp className="size-3.5 shrink-0 text-muted-foreground" />
    ) : w.type === "area" ? (
      <Activity className="size-3.5 shrink-0 text-muted-foreground" />
    ) : w.type === "pie" ? (
      <PieIcon className="size-3.5 shrink-0 text-muted-foreground" />
    ) : (
      <BarChart3 className="size-3.5 shrink-0 text-muted-foreground" />
    );
  const groupOptions = w.type === "line" ? columns.filter((c) => c.kind === "date") : groupableCols;
  const grouped =
    groupCol && valueCol
      ? chartSeries(data, groupCol.key, valueCol.key, op, dataMode).map((g) => ({
          name: g.name,
          total: g.total,
          ...(g.count !== undefined ? { count: g.count } : {}),
          ...(g.sourceRow ? { sourceRow: g.sourceRow } : {}),
          ...(g.sourceRowIndex !== undefined ? { sourceRowIndex: g.sourceRowIndex } : {}),
          ...(g.sourceRowIndexes ? { sourceRowIndexes: g.sourceRowIndexes } : {}),
        }))
      : [];
  const completeSeries =
    w.type === "line" || (w.type === "area" && groupCol?.kind === "date")
      ? sortChronologically(grouped)
      : grouped;
  const barOrder =
    w.type === "bar" && dataMode !== "raw"
      ? sortBarCategories(completeSeries, w.barSort ?? "auto")
      : null;
  const orderedSeries = barOrder ? barOrder.series : completeSeries;
  const renderableSeries =
    w.type === "pie"
      ? { items: orderedSeries, omitted: 0, total: orderedSeries.length }
      : limitChartSeriesForRendering(orderedSeries);
  const series = renderableSeries.items;
  // Metas podem ser classificadas como referência semântica, não como métrica
  // agregável. Por isso a detecção precisa considerar todas as colunas
  // numéricas do painel, e não apenas `numericCols`.
  const goalColumns = columns.filter(
    (column) =>
      numericKinds.includes(column.kind) &&
      column.key !== valueCol?.key &&
      /\bmeta(s)?\b|\balvo\b|\bobjetivo\b|\btarget\b|\bgoal\b/i.test(
        `${column.label} ${column.key}`,
      ),
  );
  const areaGoalCol = goalColumns.find((column) => column.key === w.areaGoalKey) ?? goalColumns[0];
  const areaReference: AreaReferenceMode =
    w.type === "area"
      ? w.areaReference === "goal" && !areaGoalCol
        ? "previous"
        : (w.areaReference ?? (areaGoalCol ? "goal" : "previous"))
      : "previous";
  // Usa o mesmo op/dataMode da série principal — comparar uma soma
  // observada com uma meta em média (ou linha a linha com meta agregada)
  // mistura grandezas diferentes e desalinha os nomes de categoria entre as
  // duas séries. "count" não se aplica a uma coluna de meta (não é uma
  // contagem de linhas), então cai em "avg" nesse caso, como antes.
  const goalOp: AggregationOp = op === "count" ? "avg" : op;
  const goalSeries =
    w.type === "area" && groupCol && areaGoalCol
      ? chartSeries(data, groupCol.key, areaGoalCol.key, goalOp, dataMode)
      : [];
  const goalsByName = new Map(goalSeries.map((entry) => [entry.name, entry.total]));
  const areaSeries =
    w.type === "area" ? buildAreaComparisonSeries(series, areaReference, goalsByName) : [];
  const seriesColor = valueCol
    ? (conditionalColor(series.at(-1)?.total ?? null, valueCol.kind, valueCol.conditionalFormat) ??
      "var(--primary)")
    : "var(--primary)";
  const selectedPointIndex = selectedPointName
    ? series.findIndex((entry) => String(entry.name) === selectedPointName)
    : -1;
  const selectedPoint = selectedPointIndex >= 0 ? (series[selectedPointIndex] ?? null) : null;
  const selectedPointComparison =
    selectedPointIndex >= 0 ? pieComparisonFor(series, selectedPointIndex) : null;
  const barSeries = series;
  const barPresentation = barChartPresentation(barSeries.length);
  // O rótulo mais comprido decide por todos: basta um valor largo demais para
  // a faixa de números virar uma linha sobreposta em cima das barras.
  const longestBarLabelChars = valueCol
    ? barSeries.reduce(
        (longest, entry) =>
          Math.max(longest, (fmt(entry.total, valueCol.kind) ?? String(entry.total)).length),
        0,
      )
    : 0;
  const barAxisLabels = axisLabelPresentation({
    count: barSeries.length,
    scrollable: barPresentation.scrollable,
    span: w.span,
    slotPx: BAR_SLOT_PX,
  });
  const barLabelsFit = barValueLabelsFit({
    count: barSeries.length,
    scrollable: barPresentation.scrollable,
    longestLabelChars: longestBarLabelChars,
    span: w.span,
  });
  // "Quem está acima da média" é a primeira pergunta de quem lê um ranking,
  // e sem a linha de referência essa conta ficava por conta do leitor.
  const barAverage = w.type === "bar" ? seriesAverage(barSeries) : null;
  // O eixo do gráfico de barras é categórico mesmo quando a coluna de
  // agrupamento é uma data: no modo agrupado as barras são reordenadas da
  // maior para a menor, e no modo linha a linha elas seguem a ordem da
  // planilha, que não é necessariamente cronológica. Em nenhum dos dois a
  // barra vizinha é "o período anterior".
  const barAxisKind: ChartAxisKind = "category";
  // A legenda do gráfico de área já existia, mas identificava as séries só
  // pela cor de um quadradinho e não incluía a linha de referência, que é
  // justamente a série contra a qual todas as outras são lidas. Agora ela
  // desenha o traço real de cada série e nomeia a referência pelo que ela é
  // ("Período anterior", "Média móvel", "Meta: X"), em vez do genérico
  // "Referência" que aparecia só no tooltip.
  const areaReferenceLabel =
    areaReference === "goal"
      ? `Meta: ${areaGoalCol?.label ?? ""}`
      : areaReference === "moving-average"
        ? "Média móvel"
        : "Período anterior";
  const areaLegendItems = [
    { name: "Resultado observado", color: "var(--primary)" },
    { name: areaReferenceLabel, color: "var(--muted-foreground)", dashed: true },
    { name: "Acima da referência", color: "var(--secondary-accent)" },
    { name: "Abaixo da referência", color: "var(--chart-4)", dashed: true },
  ];
  // A ordem por valor é a esperada num gráfico de barras e não precisa ser
  // dita. As outras precisam: sem isso, um gráfico de meses fora da ordem de
  // tamanho parece desordenado em vez de sequencial.
  const barOrderLabel =
    barOrder && barOrder.applied === "natural"
      ? barOrder.ordinal
        ? "natural das categorias"
        : "a mesma da planilha"
      : barOrder && barOrder.applied === "alphabetical"
        ? "alfabética"
        : null;
  const timeSeriesPresentation = timeSeriesChartPresentation(series.length);
  const timeAxisLabels = axisLabelPresentation({
    count: series.length,
    scrollable: timeSeriesPresentation.scrollable,
    span: w.span,
    slotPx: TIME_SERIES_SLOT_PX,
  });
  const pieSeries = w.type === "pie" ? collapsePieSeries(completeSeries) : series;
  const pieTotal = pieSeries.reduce((s, e) => s + e.total, 0);
  const displayedPieIndex = activePieIndex ?? selectedPieIndex;
  const largestPieIndex = pieSeries.reduce(
    (largest, entry, index, entries) =>
      largest < 0 || entry.total > (entries[largest]?.total ?? Number.NEGATIVE_INFINITY)
        ? index
        : largest,
    -1,
  );
  // A leitura detalhada fica visível desde o início usando a maior fatia;
  // hover/clique apenas troca o foco. O gráfico continua sem escurecer as
  // demais fatias enquanto nenhuma seleção explícita foi feita.
  const summaryPieIndex = displayedPieIndex ?? (largestPieIndex >= 0 ? largestPieIndex : null);
  const selectedPie = summaryPieIndex !== null ? pieSeries[summaryPieIndex] : null;
  const selectedPieComparison =
    summaryPieIndex !== null ? pieComparisonFor(pieSeries, summaryPieIndex) : null;
  // Mesma leitura guiada do pizza, mas sem estado de "seleção" própria: o
  // clique na barra já filtra diretamente (comportamento existente,
  // preservado), então aqui só o hover troca o destaque, com a maior
  // categoria como padrão quando nada está sob o mouse.
  const largestBarIndex = barSeries.reduce(
    (largest, entry, index, entries) =>
      largest < 0 || entry.total > (entries[largest]?.total ?? Number.NEGATIVE_INFINITY)
        ? index
        : largest,
    -1,
  );
  const summaryBarIndex = activeBarIndex ?? (largestBarIndex >= 0 ? largestBarIndex : null);
  const selectedBar = summaryBarIndex !== null ? barSeries[summaryBarIndex] : null;
  const selectedBarComparison =
    summaryBarIndex !== null ? pieComparisonFor(barSeries, summaryBarIndex) : null;
  // Só mostra resumo de tendência quando a série é de fato cronológica —
  // mesma condição usada acima para decidir se `completeSeries` é ordenada
  // por `sortChronologically`. Área agrupada por uma coluna não temporal
  // não tem "início/fim" com sentido de tempo, é uma comparação categórica.
  const trendSummary =
    w.type === "line" || (w.type === "area" && groupCol?.kind === "date")
      ? trendSummaryFor(series)
      : null;
  const pieLegendItems = pieSeries.map((entry, i) => ({
    ...entry,
    color:
      conditionalColor(entry.total, valueCol?.kind ?? "number", valueCol?.conditionalFormat) ??
      palette[i % palette.length] ??
      "var(--primary)",
  }));
  const { cornerRadius: pieCornerRadius, paddingAngle: piePaddingAngle } =
    pieRoundnessFor(pieSeries);
  const insufficient = w.type === "line" ? series.length < 2 : series.length < 1;
  // Linha sempre é cronológica; área só quando agrupada por data (mesma
  // condição que decide se a série é ordenada por tempo, acima). Pizza e
  // barra comparam categorias, então recebem total em vez de variação.
  const temporalSeries = w.type === "line" || (w.type === "area" && groupCol?.kind === "date");
  const headline =
    groupCol && valueCol
      ? seriesHeadline(w.type === "pie" ? pieSeries : series, {
          temporal: temporalSeries,
          operation: op,
        })
      : null;
  const headlineMetrics: WidgetMetric[] = headline
    ? [
        {
          label: headline.label,
          value:
            (temporalSeries
              ? fmt(headline.latest ?? headline.total, valueCol!.kind)
              : fmt(headline.total, valueCol!.kind)) ?? "–",
          ...(headline.relativeChange !== null
            ? {
                change: `${headline.relativeChange >= 0 ? "+" : ""}${headline.relativeChange.toLocaleString(
                  "pt-BR",
                  { style: "percent", maximumFractionDigits: 1 },
                )}`,
                up: headline.relativeChange >= 0,
              }
            : {}),
        },
        temporalSeries
          ? {
              label: "Média do período",
              value: fmt(headline.average, valueCol!.kind) ?? "–",
            }
          : {
              label: w.type === "pie" ? "Fatias" : "Categorias",
              value: headline.categoryCount.toLocaleString("pt-BR"),
            },
      ]
    : [];

  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead title={title} icon={icon} {...dragProps} />
      {!insufficient && <WidgetMetricStrip metrics={headlineMetrics} />}
      <WidgetConfigBar>
        <FilterChip groupKey={groupCol?.key} filters={filters} setFilters={setFilters} />
        <FieldDropSlot
          accepts={w.type === "line" ? (["date"] as Kind[]) : groupableKinds}
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
              {groupOptions.map((c) => (
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
        {barOrder && (
          <label className="flex max-w-64 items-center gap-1 rounded-lg border border-border bg-card pl-2 text-[10px] text-muted-foreground">
            <span>Ordem</span>
            <select
              aria-label="Ordem das categorias"
              className="oliam-select h-7 min-w-0 border-0 bg-transparent px-1.5 shadow-none"
              value={w.barSort ?? "auto"}
              onChange={(event) => onConfigure({ barSort: event.target.value as BarSortMode })}
            >
              <option value="auto">
                {barOrder.ordinal ? "Automática: ordem natural" : "Automática: maior para menor"}
              </option>
              <option value="natural">Ordem natural</option>
              <option value="value">Maior para menor</option>
              <option value="alphabetical">A a Z</option>
            </select>
          </label>
        )}
        {w.type === "area" && (
          <label className="flex max-w-64 items-center gap-1 rounded-lg border border-border bg-card pl-2 text-[10px] text-muted-foreground">
            <span>Comparar com</span>
            <select
              aria-label="Referência do gráfico de área"
              className="oliam-select h-7 min-w-0 border-0 bg-transparent px-1.5 shadow-none"
              value={areaReference}
              onChange={(event) =>
                onConfigure({ areaReference: event.target.value as AreaReferenceMode })
              }
            >
              <option value="previous">Período anterior</option>
              <option value="moving-average">Média móvel</option>
              {areaGoalCol && <option value="goal">Meta: {areaGoalCol.label}</option>}
            </select>
          </label>
        )}
      </WidgetConfigBar>
      {sizeControls}
      {renderableSeries.omitted > 0 && (
        <p className="border-b border-border bg-secondary-accent/8 px-4 py-2 text-[10px] text-muted-foreground">
          Prévia otimizada: {renderableSeries.items.length.toLocaleString("pt-BR")} de{" "}
          {renderableSeries.total.toLocaleString("pt-BR")} pontos, distribuídos por toda a série. Os
          dados completos e sem amostragem permanecem na tabela detalhada.
        </p>
      )}
      {insufficient || !groupCol || !valueCol ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          {!groupCol || !valueCol
            ? "Escolha uma coluna de agrupamento e uma numérica para este widget."
            : "Dados insuficientes para este gráfico."}
        </p>
      ) : w.type === "bar" ? (
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
                  <BarChart
                    data={barSeries}
                    margin={{ top: 20, right: 12, left: 4, bottom: 18 }}
                    barCategoryGap={barSeries.length > 10 ? "34%" : "18%"}
                  >
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
                      type="category"
                      dataKey="name"
                      tick={(props) => <AxisTick {...props} max={barAxisLabels.maxChars} />}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                      interval={barAxisLabels.interval}
                    />
                    <YAxis
                      type="number"
                      domain={[
                        (dataMin: number) => Math.min(0, dataMin),
                        (dataMax: number) => Math.max(0, dataMax),
                      ]}
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      tickFormatter={(value: number) => compactAxisValue(value, valueCol.kind)}
                    />
                    <ChartTooltip
                      // Sem retângulo de fundo: o Recharts ativaria o
                      // tooltip pra toda a faixa X da categoria (inclusive
                      // o espaço vazio acima de uma barra curta), não só
                      // sobre a barra desenhada. O destaque de "isto está
                      // sob o mouse" já existe via opacidade do <Cell>
                      // abaixo (mais preciso, por forma real).
                      cursor={false}
                      content={(props) =>
                        // activeBarIndex só fica setado enquanto o mouse
                        // está de fato sobre a forma SVG de uma barra
                        // (onMouseEnter/onMouseLeave do próprio <Bar>,
                        // acionado por barra real). O rastreamento por
                        // eixo do Recharts (usado só pra decidir
                        // active/payload/label aqui) continua achando que
                        // deveria mostrar em toda a coluna — esta checagem
                        // extra é o que restringe a exibição à barra em
                        // si.
                        activeBarIndex === null ? null : (
                          <BarTooltip
                            active={props.active}
                            payload={
                              props.payload as {
                                value?: number;
                                payload?: { sourceRow?: number };
                              }[]
                            }
                            label={props.label as string}
                            series={barSeries}
                            kind={valueCol.kind}
                            mode={dataMode}
                            axis={barAxisKind}
                          />
                        )
                      }
                    />
                    <Bar
                      dataKey="total"
                      fill={`url(#bar-grad-${w.id})`}
                      radius={6}
                      maxBarSize={72}
                      onClick={(_, i) => {
                        // O payload que o Recharts entrega ao onClick de uma
                        // <Bar> com <Cell> filhas não confiavelmente carrega
                        // `.name` (varia por versão/estrutura interna) — o
                        // índice, sim, sempre corresponde à posição em
                        // barSeries (mesmo array usado para renderizar as
                        // Cell logo abaixo). Buscar o nome ali, em vez de
                        // confiar no payload, é o mesmo padrão já usado com
                        // sucesso no <Pie> (onClick={(_, index) => ...}).
                        const entry = barSeries[i];
                        if (!entry) return;
                        if (isCoarsePointer()) {
                          // Em toque, sem hover confiável, o primeiro toque
                          // só seleciona (mesmo estado que o mouse usa no
                          // hover) pra mostrar o painel de detalhe com o
                          // botão "Filtrar por esta categoria" — filtrar
                          // direto no toque fica fácil demais de disparar
                          // sem querer. Desktop preservado sem mudança.
                          setActiveBarIndex(i);
                          return;
                        }
                        handleGroupClick(groupCol.key, entry.name);
                      }}
                      onMouseEnter={(_, i) => setActiveBarIndex(i)}
                      onMouseLeave={() => setActiveBarIndex(null)}
                      cursor="pointer"
                      // O hover chama setActiveBarIndex, que re-renderiza o
                      // widget e recalcula barSeries com identidade nova a
                      // cada passagem do mouse. Sem isso, o Recharts trata
                      // a nova referência como "dado mudou", reinicia a
                      // animação de entrada da barra e recalcula o eixo Y
                      // no processo — piscando os números do eixo a cada
                      // hover. Mesmo ajuste já usado no sparkline (metric-widget-body.tsx)
                      // para o mesmo tipo de problema.
                      isAnimationActive={false}
                    >
                      {barSeries.map((entry, entryIndex) => (
                        <Cell
                          key={`${entry.name}-${entry.sourceRow ?? entryIndex}`}
                          className="oliam-chart-bar-cell"
                          fill={
                            conditionalColor(
                              entry.total,
                              valueCol.kind,
                              valueCol.conditionalFormat,
                            ) ?? `url(#bar-grad-${w.id})`
                          }
                          opacity={
                            activeBarIndex === null || activeBarIndex === entryIndex ? 1 : 0.45
                          }
                          stroke={activeBarIndex === entryIndex ? "var(--primary)" : "none"}
                          strokeWidth={activeBarIndex === entryIndex ? 1 : 0}
                          style={
                            {
                              "--oliam-bar-delay": `${Math.min(entryIndex, 14) * 42}ms`,
                              filter: activeBarIndex === entryIndex ? "brightness(1.08)" : "none",
                            } as CSSProperties
                          }
                        />
                      ))}
                      {barLabelsFit && (
                        <LabelList
                          dataKey="total"
                          position="top"
                          fontSize={10}
                          fill="var(--muted-foreground)"
                          formatter={(v: number) => fmt(v, valueCol.kind) ?? String(v)}
                        />
                      )}
                    </Bar>
                    <ReferenceLine
                      y={0}
                      stroke="var(--foreground)"
                      strokeOpacity={0.28}
                      strokeWidth={1}
                    />
                    {barAverage !== null && (
                      <ReferenceLine
                        y={barAverage}
                        stroke="var(--muted-foreground)"
                        strokeDasharray="4 4"
                        strokeWidth={1}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {barPresentation.scrollable && <ChartScrollButtons label="gráfico de barras" />}
          </div>
          {barPresentation.scrollable && (
            <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
              {barSeries.length.toLocaleString("pt-BR")} categorias · use as setas, arraste ou role
              para os lados para ver todas
            </p>
          )}
          <ChartAxisLegend
            x={horizontalAxisLabel}
            y={verticalAxisLabel}
            average={barAverage}
            order={barOrderLabel}
            kind={valueCol.kind}
          />
          <p className="sr-only">
            Tabela alternativa ao gráfico de barras:{" "}
            {barSeries.map((g) => `${g.name}, ${g.total}`).join("; ")}.
          </p>
          {selectedBar && (
            <div key={`${w.id}-bar-detail-${selectedBar.name}`} className="oliam-chart-detail-swap">
              <SeriesComparisonPanel
                selected={selectedBar}
                comparison={selectedBarComparison}
                kind={valueCol.kind}
                filterLabel="Filtrar por esta categoria"
                onFilter={() => handleGroupClick(groupCol.key, selectedBar.name)}
                {...(sourceRowIndexesOf(selectedBar).length
                  ? {
                      onShowSource: () =>
                        onShowSource(
                          sourceRowIndexesOf(selectedBar),
                          valueCol.key,
                          selectedBar.name,
                        ),
                    }
                  : {})}
              />
            </div>
          )}
        </>
      ) : w.type === "pie" ? (
        <>
          <div
            className={cn(
              "grid min-w-0 items-center gap-3 p-4",
              w.span > 1 && "md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,0.9fr)]",
            )}
          >
            <div className="oliam-chart-pie-enter h-52 min-w-0 overflow-visible">
              <ResponsiveContainer width="100%" height="100%">
                <RPieChart margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
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
                    formatter={(
                      v: number,
                      _name: string,
                      entry: { payload?: { count?: number } },
                    ) => {
                      const formatted = fmt(v, valueCol.kind) ?? String(v);
                      const share = pieTotal
                        ? (v / pieTotal).toLocaleString("pt-BR", {
                            style: "percent",
                            maximumFractionDigits: 1,
                          })
                        : "participação indisponível";
                      const count = entry?.payload?.count;
                      return [
                        formatted,
                        count
                          ? `${share} do total · ${count.toLocaleString("pt-BR")} categorias agrupadas`
                          : `${share} do total`,
                      ];
                    }}
                  />
                  <Pie
                    data={pieSeries}
                    dataKey="total"
                    nameKey="name"
                    innerRadius="48%"
                    outerRadius="76%"
                    paddingAngle={piePaddingAngle}
                    cornerRadius={pieCornerRadius}
                    minAngle={4}
                    stroke="var(--card)"
                    strokeWidth={3}
                    // Pop sutil pra fora na fatia em destaque (hover ou
                    // clique), reaproveitando o mecanismo nativo do
                    // Recharts em vez de um <Cell> extra ou estado novo —
                    // displayedPieIndex já sabe qual fatia está ativa.
                    {...(displayedPieIndex !== null ? { activeIndex: displayedPieIndex } : {})}
                    activeShape={(rawProps: unknown) => {
                      const p = rawProps as {
                        cx?: number;
                        cy?: number;
                        innerRadius?: number;
                        outerRadius?: number;
                        startAngle?: number;
                        endAngle?: number;
                        midAngle?: number;
                        fill?: string;
                        stroke?: string;
                        strokeWidth?: number;
                        cornerRadius?: number;
                      };
                      const radians = -((p.midAngle ?? 0) * Math.PI) / 180;
                      const offset = 5;
                      const translateX = Math.cos(radians) * offset;
                      const translateY = Math.sin(radians) * offset;
                      return (
                        <g transform={`translate(${translateX} ${translateY})`}>
                          <Sector
                            className="oliam-chart-pie-active-slice"
                            cx={p.cx ?? 0}
                            cy={p.cy ?? 0}
                            innerRadius={p.innerRadius ?? 0}
                            outerRadius={(p.outerRadius ?? 0) + 6}
                            startAngle={p.startAngle ?? 0}
                            endAngle={p.endAngle ?? 0}
                            fill={p.fill ?? "var(--primary)"}
                            stroke={p.stroke ?? "var(--card)"}
                            strokeWidth={p.strokeWidth ?? 3}
                            cornerRadius={p.cornerRadius ?? 0}
                          />
                        </g>
                      );
                    }}
                    onClick={(_, index) => {
                      // Mesmo padrão de clique-para-filtrar já usado em
                      // barra/linha/área/ranking/mapa: clicar filtra na
                      // hora, sem precisar de um botão extra. "Outros" é um
                      // agrupador sintético (não existe como valor real na
                      // planilha), então só seleciona para exibir a
                      // comparação, sem tentar filtrar por ele. Em toque
                      // (sem hover confiável), o toque só seleciona — o
                      // filtro só acontece pelo botão "Filtrar por esta
                      // fatia" no painel de detalhe, pra não disparar um
                      // filtro sem querer. Desktop preservado sem mudança.
                      setSelectedPieIndex(index);
                      const entry = pieSeries[index];
                      if (entry && entry.name !== "Outros" && !isCoarsePointer()) {
                        handleGroupClick(groupCol.key, entry.name);
                      }
                    }}
                    onMouseEnter={(_, i) => setActivePieIndex(i)}
                    onMouseLeave={() => setActivePieIndex(null)}
                    cursor="pointer"
                    animationDuration={680}
                    animationEasing="ease-out"
                  >
                    {pieSeries.map((entry, i) => (
                      <Cell
                        key={`${entry.name}-${"sourceRow" in entry ? (entry.sourceRow ?? i) : i}`}
                        fill={pieLegendItems[i]?.color}
                        opacity={displayedPieIndex === null || displayedPieIndex === i ? 1 : 0.45}
                        stroke={displayedPieIndex === i ? "var(--foreground)" : "var(--card)"}
                        strokeWidth={displayedPieIndex === i ? 2 : 3}
                        style={{
                          transition: "opacity 220ms ease, stroke 220ms ease",
                        }}
                      />
                    ))}
                    <Label
                      position="center"
                      content={({ viewBox }) => {
                        const box = viewBox as { cx?: number; cy?: number } | undefined;
                        if (box?.cx === undefined || box?.cy === undefined) return null;
                        const active =
                          displayedPieIndex !== null ? pieSeries[displayedPieIndex] : null;
                        const label = active ? truncateLabel(active.name, 12) : "Total";
                        const value = fmt(active ? active.total : pieTotal, valueCol.kind) ?? "–";
                        return (
                          <g
                            key={active ? `pie-center-${active.name}` : "pie-center-total"}
                            className="oliam-chart-center-swap"
                            style={{ pointerEvents: "none" }}
                          >
                            <text
                              x={box.cx}
                              y={box.cy}
                              textAnchor="middle"
                              dominantBaseline="central"
                            >
                              <tspan
                                x={box.cx}
                                dy="-0.35em"
                                fontFamily="var(--font-display)"
                                fontSize={17}
                                fontWeight={800}
                                fill="var(--foreground)"
                              >
                                {value}
                              </tspan>
                              <tspan
                                x={box.cx}
                                dy="1.4em"
                                fontSize={10}
                                fill="var(--muted-foreground)"
                              >
                                {label}
                              </tspan>
                              {active && pieTotal > 0 && (
                                <tspan
                                  x={box.cx}
                                  dy="1.35em"
                                  fontSize={9}
                                  fill="var(--muted-foreground)"
                                >
                                  {(active.total / pieTotal).toLocaleString("pt-BR", {
                                    style: "percent",
                                    maximumFractionDigits: 1,
                                  })}{" "}
                                  do total
                                </tspan>
                              )}
                            </text>
                          </g>
                        );
                      }}
                    />
                  </Pie>
                </RPieChart>
              </ResponsiveContainer>
            </div>
            <PieLegend
              items={pieLegendItems}
              kind={valueCol.kind}
              activeIndex={displayedPieIndex}
              onHoverIndex={setActivePieIndex}
              onSelectIndex={(i) => {
                setSelectedPieIndex(i);
                const entry = pieSeries[i];
                if (entry && entry.name !== "Outros" && !isCoarsePointer()) {
                  handleGroupClick(groupCol.key, entry.name);
                }
              }}
            />
          </div>
          {selectedPie && (
            <div key={`${w.id}-pie-detail-${selectedPie.name}`} className="oliam-chart-detail-swap">
              <SeriesComparisonPanel
                selected={selectedPie}
                comparison={selectedPieComparison}
                kind={valueCol.kind}
                filterLabel="Filtrar por esta fatia"
                onFilter={
                  selectedPie.name !== "Outros"
                    ? () => handleGroupClick(groupCol.key, selectedPie.name)
                    : undefined
                }
                {...(sourceRowIndexesOf(selectedPie).length
                  ? {
                      onShowSource: () =>
                        onShowSource(
                          sourceRowIndexesOf(selectedPie),
                          valueCol.key,
                          selectedPie.name,
                        ),
                    }
                  : {})}
              />
            </div>
          )}
          <p className="sr-only">
            Tabela alternativa à pizza:{" "}
            {pieSeries
              .map((g) =>
                "count" in g && g.count
                  ? `${g.name} (${g.count} categorias agrupadas), ${g.total}`
                  : `${g.name}, ${g.total}`,
              )
              .join("; ")}
            .
          </p>
        </>
      ) : w.type === "area" ? (
        <div className="p-3">
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-lg shadow-black/5 dark:shadow-black/30">
            <ChartSeriesLegend items={areaLegendItems} />
            <div className="relative">
              <div
                ref={timeSeriesPresentation.scrollable ? chartScrollRef : undefined}
                className={cn(
                  "h-56 overflow-x-auto overflow-y-hidden p-4",
                  timeSeriesPresentation.scrollable && "oliam-chart-drag-scroll",
                )}
                onPointerDown={
                  timeSeriesPresentation.scrollable ? handleChartScrollPointerDown : undefined
                }
              >
                <div
                  style={{
                    height: "100%",
                    width: timeSeriesPresentation.scrollable
                      ? timeSeriesPresentation.contentWidth
                      : "100%",
                    minWidth: "100%",
                  }}
                >
                  <ResponsiveContainer>
                    <ComposedChart
                      data={areaSeries}
                      margin={{ top: 20, right: 28, left: 16, bottom: 18 }}
                    >
                      <defs>
                        <linearGradient id={`area-above-${w.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--secondary-accent)" stopOpacity={0.5} />
                          <stop
                            offset="100%"
                            stopColor="var(--secondary-accent)"
                            stopOpacity={0.06}
                          />
                        </linearGradient>
                        <linearGradient id={`area-below-${w.id}`} x1="0" y1="1" x2="0" y2="0">
                          <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0.06} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="name"
                        tick={(props) => <AxisTick {...props} max={timeAxisLabels.maxChars} />}
                        interval={timeAxisLabels.interval}
                        padding={{ left: 20, right: 20 }}
                      />
                      <YAxis
                        yAxisId="observed"
                        tick={{ fontSize: 10 }}
                        width={52}
                        tickFormatter={(v: number) => compactAxisValue(v, valueCol.kind)}
                      />
                      <YAxis yAxisId="variation" orientation="right" hide />
                      <ReferenceLine
                        yAxisId="variation"
                        y={0}
                        stroke="var(--border)"
                        strokeDasharray="3 3"
                      />
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
                        formatter={(v: number, name: string) => [
                          fmt(v, valueCol.kind) ?? String(v),
                          name,
                        ]}
                      />
                      <Area
                        type="monotone"
                        yAxisId="variation"
                        dataKey="aboveReference"
                        name="Variação acima da referência"
                        stroke="var(--secondary-accent)"
                        strokeWidth={1.5}
                        fill={`url(#area-above-${w.id})`}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Area
                        type="monotone"
                        yAxisId="variation"
                        dataKey="belowReference"
                        name="Variação abaixo da referência"
                        stroke="var(--chart-4)"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        fill={`url(#area-below-${w.id})`}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        yAxisId="observed"
                        dataKey="reference"
                        name={areaReferenceLabel}
                        stroke="var(--muted-foreground)"
                        strokeWidth={1.5}
                        strokeDasharray="5 4"
                        dot={false}
                        activeDot={false}
                      />
                      <Line
                        type="monotone"
                        yAxisId="observed"
                        dataKey="total"
                        name="Resultado observado"
                        stroke="var(--primary)"
                        strokeWidth={3.5}
                        dot={(dotProps: ChartDotProps) => {
                          const { key, ...rest } = dotProps as ChartDotProps & {
                            key?: string | number;
                          };
                          return (
                            <ChartDot
                              key={key}
                              {...rest}
                              r={3}
                              groupCol={groupCol}
                              valueCol={valueCol}
                              onSelect={handlePointClick}
                            />
                          );
                        }}
                        activeDot={(dotProps: ChartDotProps) => {
                          const { key, ...rest } = dotProps as ChartDotProps & {
                            key?: string | number;
                          };
                          return (
                            <ChartDot
                              key={key}
                              {...rest}
                              r={5}
                              groupCol={groupCol}
                              valueCol={valueCol}
                              onSelect={handlePointClick}
                            />
                          );
                        }}
                      />
                      <Line
                        type="monotone"
                        yAxisId="variation"
                        dataKey="difference"
                        name="Diferença"
                        stroke="transparent"
                        dot={false}
                        activeDot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {timeSeriesPresentation.scrollable && <ChartScrollButtons label="gráfico de área" />}
            </div>
            {timeSeriesPresentation.scrollable && (
              <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
                {series.length.toLocaleString("pt-BR")} períodos · use as setas, arraste ou role
                para os lados
              </p>
            )}
            <ChartAxisLegend x={horizontalAxisLabel} y={verticalAxisLabel} kind={valueCol.kind} />
            <p className="sr-only">
              Tabela alternativa à área: {series.map((g) => `${g.name}, ${g.total}`).join("; ")}.
            </p>
            {trendSummary && <TrendSummaryPanel summary={trendSummary} kind={valueCol.kind} />}
            {selectedPoint && (
              <SeriesComparisonPanel
                selected={selectedPoint}
                comparison={selectedPointComparison}
                kind={valueCol.kind}
                filterLabel="Filtrar por este período"
                onFilter={() => {
                  handleGroupClick(groupCol.key, String(selectedPoint.name));
                  setSelectedPointName(null);
                }}
                {...(sourceRowIndexesOf(selectedPoint).length
                  ? {
                      onShowSource: () =>
                        onShowSource(
                          sourceRowIndexesOf(selectedPoint),
                          valueCol.key,
                          String(selectedPoint.name),
                        ),
                    }
                  : {})}
              />
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="relative">
            <div
              ref={timeSeriesPresentation.scrollable ? chartScrollRef : undefined}
              className={cn(
                "h-56 overflow-x-auto overflow-y-hidden p-4",
                timeSeriesPresentation.scrollable && "oliam-chart-drag-scroll",
              )}
              onPointerDown={
                timeSeriesPresentation.scrollable ? handleChartScrollPointerDown : undefined
              }
            >
              <div
                style={{
                  height: "100%",
                  width: timeSeriesPresentation.scrollable
                    ? timeSeriesPresentation.contentWidth
                    : "100%",
                  minWidth: "100%",
                }}
              >
                <ResponsiveContainer>
                  <LineChart data={series} margin={{ top: 20, right: 12, left: 0, bottom: 14 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="name"
                      tick={(props) => <AxisTick {...props} max={timeAxisLabels.maxChars} />}
                      interval={timeAxisLabels.interval}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      width={52}
                      tickFormatter={(v: number) => compactAxisValue(v, valueCol.kind)}
                    />
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
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke={seriesColor}
                      strokeWidth={2}
                      dot={(dotProps: ChartDotProps) => {
                        const { key, ...rest } = dotProps as ChartDotProps & {
                          key?: string | number;
                        };
                        return (
                          <ChartDot
                            key={key}
                            {...rest}
                            r={3}
                            groupCol={groupCol}
                            valueCol={valueCol}
                            onSelect={handlePointClick}
                          />
                        );
                      }}
                      activeDot={(dotProps: ChartDotProps) => {
                        const { key, ...rest } = dotProps as ChartDotProps & {
                          key?: string | number;
                        };
                        return (
                          <ChartDot
                            key={key}
                            {...rest}
                            r={5}
                            groupCol={groupCol}
                            valueCol={valueCol}
                            onSelect={handlePointClick}
                          />
                        );
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            {timeSeriesPresentation.scrollable && <ChartScrollButtons label="linha do tempo" />}
          </div>
          {timeSeriesPresentation.scrollable && (
            <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
              {series.length.toLocaleString("pt-BR")} períodos · use as setas, arraste ou role para
              os lados
            </p>
          )}
          <ChartAxisLegend x={horizontalAxisLabel} y={verticalAxisLabel} kind={valueCol.kind} />
          <p className="sr-only">
            Tabela alternativa à evolução: {series.map((g) => `${g.name}, ${g.total}`).join("; ")}.
          </p>
          {trendSummary && <TrendSummaryPanel summary={trendSummary} kind={valueCol.kind} />}
          {selectedPoint && (
            <SeriesComparisonPanel
              selected={selectedPoint}
              comparison={selectedPointComparison}
              kind={valueCol.kind}
              filterLabel="Filtrar por este período"
              onFilter={() => {
                handleGroupClick(groupCol.key, String(selectedPoint.name));
                setSelectedPointName(null);
              }}
              {...(sourceRowIndexesOf(selectedPoint).length
                ? {
                    onShowSource: () =>
                      onShowSource(
                        sourceRowIndexesOf(selectedPoint),
                        valueCol.key,
                        String(selectedPoint.name),
                      ),
                  }
                : {})}
            />
          )}
        </>
      )}
    </article>
  );
}
