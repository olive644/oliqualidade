import { useState } from "react";
import { ScatterChart as ScatterIcon } from "lucide-react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { numericKinds, type Column, type Row, type Widget } from "@/lib/types";
import { sizeClass, spanClass } from "@/lib/widgets";
import { conditionalColor, fmt } from "@/lib/format";
import { linearTrend, pearsonCorrelation, scatterPoints } from "@/lib/data-pipeline";
import { scatterChartValidity } from "@/lib/chart-validity";
import {
  compactAxisValue,
  FieldDropSlot,
  WidgetDetailStrip,
  WidgetHead,
  WidgetMetricStrip,
  type WidgetDragProps,
  type WidgetMetric,
  WidgetEvidencePanel,
} from "./widget-support";
import { WidgetConfigBar } from "./widget-config-context";

/**
 * Leitura em palavras da força e do sentido de uma correlação — o valor de r
 * sozinho ("r = 0,42") não diz muito pra quem não trabalha com estatística
 * todo dia; a classificação (fraca/moderada/forte) segue a régua usual
 * (Cohen) e é o que aparece na frase permanente do widget.
 */
function correlationReading(r: number): { strength: string; direction: string } {
  const abs = Math.abs(r);
  const strength =
    abs < 0.1
      ? "praticamente nenhuma"
      : abs < 0.3
        ? "fraca"
        : abs < 0.5
          ? "moderada"
          : abs < 0.7
            ? "forte"
            : "muito forte";
  const direction = r > 0 ? "positiva" : r < 0 ? "negativa" : "";
  return { strength, direction };
}

export function ScatterWidgetBody({
  widget: w,
  data,
  columns,
  onConfigure,
  onShowSource,
  dragProps,
  sizeControls,
  animationDelay,
}: {
  widget: Widget;
  data: Row[];
  columns: Column[];
  onConfigure: (patch: Partial<Widget>) => void;
  onShowSource: (rowIndexes: number[], columnKey: string, title: string) => void;
  dragProps: WidgetDragProps;
  sizeControls: React.ReactNode;
  animationDelay: number;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Dispersão nunca agrega (soma/média), então uma coluna "não agregável"
  // (Meta, Conformidade — um alvo ou uma taxa) é tão válida no eixo X/Y
  // quanto qualquer outra numérica; usa todas as colunas numéricas da aba,
  // não o `numericCols` (que os demais widgets recebem já filtrado por
  // agregabilidade — o filtro certo pra somar, errado pra cruzar pares).
  const allNumericCols = columns.filter((c) => numericKinds.includes(c.kind));
  const xCol = columns.find((c) => c.key === w.valueKey) ?? allNumericCols[0];
  const yCol =
    columns.find((c) => c.key === w.valueKey2) ?? allNumericCols.find((c) => c.key !== xCol?.key);

  const points = xCol && yCol ? scatterPoints(data, xCol.key, yCol.key) : [];
  const chartValidity = xCol && yCol ? scatterChartValidity(points) : null;
  const trend = linearTrend(points);
  const correlation = pearsonCorrelation(points);
  const trendLine =
    trend && points.length
      ? [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x))].map((x) => ({
          x,
          y: trend.slope * x + trend.intercept,
        }))
      : null;

  const missingCount = xCol && yCol ? data.length - points.length : 0;
  const selectedPoint = selectedIndex !== null ? points[selectedIndex] : null;
  const reading = correlation !== null ? correlationReading(correlation) : null;

  const metrics: WidgetMetric[] =
    xCol && yCol
      ? [
          { label: "Pares válidos", value: points.length.toLocaleString("pt-BR") },
          {
            label: "Correlação (r)",
            value: correlation !== null ? correlation.toFixed(2) : "indefinida",
          },
        ]
      : [];

  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={`${xCol?.label ?? ""} × ${yCol?.label ?? ""}`}
        icon={<ScatterIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        {...dragProps}
      />
      {metrics.length > 0 && <WidgetMetricStrip metrics={metrics} />}
      <WidgetConfigBar>
        <FieldDropSlot
          accepts={numericKinds}
          onDropColumn={(key) => onConfigure({ valueKey: key })}
        >
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            X
            <select
              aria-label="Coluna numérica do eixo X"
              className="oliam-select"
              value={xCol?.key ?? ""}
              onChange={(e) => onConfigure({ valueKey: e.target.value })}
            >
              {!xCol && <option value="">Selecione…</option>}
              {allNumericCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </FieldDropSlot>
        <FieldDropSlot
          accepts={numericKinds}
          onDropColumn={(key) => onConfigure({ valueKey2: key })}
        >
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Y
            <select
              aria-label="Coluna numérica do eixo Y"
              className="oliam-select"
              value={yCol?.key ?? ""}
              onChange={(e) => onConfigure({ valueKey2: e.target.value })}
            >
              {!yCol && <option value="">Selecione…</option>}
              {allNumericCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </FieldDropSlot>
      </WidgetConfigBar>
      {sizeControls}
      {xCol && yCol && (
        <p className="border-b border-border/70 bg-card px-4 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          {!chartValidity?.valid ? (
            chartValidity?.reason
          ) : reading ? (
            <>
              Correlação {reading.strength}
              {reading.direction && ` e ${reading.direction}`} entre &quot;{xCol.label}&quot; e
              &quot;{yCol.label}&quot; (r = {correlation!.toFixed(2)}), considerando{" "}
              {points.length.toLocaleString("pt-BR")} pares de valores válidos.
            </>
          ) : (
            <>
              Não foi possível calcular a correlação entre &quot;{xCol.label}&quot; e &quot;
              {yCol.label}&quot;:{" "}
              {points.length < 2 ? "faltam pares de valores" : "um dos eixos não varia"}.
            </>
          )}
          {missingCount > 0 && (
            <>
              {" "}
              {missingCount.toLocaleString("pt-BR")}{" "}
              {missingCount === 1
                ? "linha sem um dos dois valores não entrou"
                : "linhas sem um dos dois valores não entraram"}
              .
            </>
          )}
        </p>
      )}
      {!xCol || !yCol || !chartValidity?.valid ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          {!xCol || !yCol
            ? "Escolha duas colunas numéricas para este widget."
            : (chartValidity?.reason ?? "Dados insuficientes para montar a dispersão.")}
        </p>
      ) : (
        <>
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart margin={{ top: 20, right: 12, left: 4, bottom: 8 }}>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={xCol.label}
                  domain={["dataMin", "dataMax"]}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  tickFormatter={(value: number) => compactAxisValue(value, xCol.kind)}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name={yCol.label}
                  domain={["dataMin", "dataMax"]}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(value: number) => compactAxisValue(value, yCol.kind)}
                />
                <ChartTooltip
                  cursor={{ strokeDasharray: "3 3", stroke: "var(--border)" }}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => [
                    fmt(value, name === xCol.label ? xCol.kind : yCol.kind),
                    name,
                  ]}
                />
                {trendLine && (
                  <Line
                    data={trendLine}
                    dataKey="y"
                    stroke="var(--secondary-accent)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                    legendType="none"
                  />
                )}
                <Scatter
                  data={points}
                  onClick={(_, index) =>
                    setSelectedIndex((current) => (current === index ? null : index))
                  }
                  cursor="pointer"
                  isAnimationActive={false}
                  shape={(props: {
                    cx?: number;
                    cy?: number;
                    payload?: { y?: number };
                    index?: number;
                  }) => {
                    if (props.cx === undefined || props.cy === undefined) return <g />;
                    // Mesmo critério de barra/pizza/ranking/box plot: a cor
                    // condicional da coluna do eixo Y (o "resultado" que se
                    // está avaliando), quando o usuário configurou uma regra
                    // para ela.
                    const color =
                      conditionalColor(
                        props.payload?.y ?? null,
                        yCol.kind,
                        yCol.conditionalFormat,
                      ) ?? "var(--primary)";
                    const isSelected = selectedIndex === props.index;
                    return (
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={isSelected ? 5 : 4}
                        fill={color}
                        fillOpacity={0.75}
                        stroke={isSelected ? "var(--foreground)" : "none"}
                        strokeWidth={isSelected ? 1.5 : 0}
                      />
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {selectedPoint && (
            <WidgetDetailStrip
              title={`${fmt(selectedPoint.x, xCol.kind)} / ${fmt(selectedPoint.y, yCol.kind)}`}
              subtitle="Ponto selecionado"
              fields={[
                { label: xCol.label, value: String(fmt(selectedPoint.x, xCol.kind)) },
                { label: yCol.label, value: String(fmt(selectedPoint.y, yCol.kind)) },
              ]}
              actions={
                selectedPoint.sourceRowIndex !== null ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onShowSource(
                        [selectedPoint.sourceRowIndex!],
                        xCol.key,
                        `${fmt(selectedPoint.x, xCol.kind)} / ${fmt(selectedPoint.y, yCol.kind)}`,
                      )
                    }
                  >
                    Ver linhas de origem
                  </Button>
                ) : undefined
              }
            />
          )}
        </>
      )}
      <WidgetEvidencePanel />
    </article>
  );
}
