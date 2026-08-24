import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { numericKinds, type Column, type Row, type Widget } from "@/lib/types";
import { sizeClass, spanClass } from "@/lib/widgets";
import { conditionalColor, conditionalStyle, parseNumericValue } from "@/lib/format";
import {
  EmptyWidget,
  FieldDropSlot,
  WidgetHead,
  type WidgetDragProps,
  WidgetEvidencePanel,
} from "./widget-support";
import { WidgetConfigBar } from "./widget-config-context";

export function RatingWidgetBody({
  widget: w,
  data,
  columns,
  numericCols,
  onConfigure,
  dragProps,
  animationDelay,
}: {
  widget: Widget;
  data: Row[];
  columns: Column[];
  numericCols: Column[];
  onConfigure: (patch: Partial<Widget>) => void;
  dragProps: WidgetDragProps;
  animationDelay: number;
}) {
  const col =
    columns.find((c) => c.key === w.metricKey && numericKinds.includes(c.kind)) ?? numericCols[0];
  const scaleMax = w.scaleMax ?? 5;
  if (!col) {
    return (
      <EmptyWidget
        {...dragProps}
        title="Avaliação"
        span={w.span}
        size={w.size}
        type={w.type}
        animationDelay={animationDelay}
        message="Nenhuma coluna numérica disponível."
      />
    );
  }
  const values = data
    .map((r) => parseNumericValue(r[col.key]))
    .filter((v): v is number => v !== null);
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const filled = Math.round(avg);
  const ratingStyle = conditionalStyle(avg, col.kind, col.conditionalFormat);
  const ratingColor = conditionalColor(avg, col.kind, col.conditionalFormat) ?? "var(--primary)";
  // Uma média sozinha esconde o quão espalhadas as avaliações estão: 3,0
  // pode ser tudo em torno de 3 ou metade em 1 e metade em 5. min/max e a
  // fração abaixo da média dão essa leitura sem precisar de outro widget.
  const ratingMin = values.length ? Math.min(...values) : null;
  const ratingMax = values.length ? Math.max(...values) : null;
  const belowAverage = values.filter((v) => v < avg).length;
  const belowAverageShare = values.length ? belowAverage / values.length : null;
  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms`, ...(ratingStyle ?? {}) }}
    >
      <WidgetHead
        title={col.label}
        icon={<Star className="size-3.5 shrink-0 text-muted-foreground" />}
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
              aria-label="Coluna da avaliação"
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
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Escala até
          <select
            aria-label="Nota máxima da escala"
            className="oliam-select h-7"
            value={scaleMax}
            onChange={(e) => onConfigure({ scaleMax: Number(e.target.value) })}
          >
            {[5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </WidgetConfigBar>
      <div className="flex flex-col items-start gap-2 p-5">
        <p className="font-mono text-3xl" style={{ color: ratingStyle?.color }}>
          {values.length ? avg.toFixed(1) : "–"}
          <span className="ml-1 text-sm text-muted-foreground">/ {scaleMax}</span>
        </p>
        {scaleMax === 5 ? (
          <div className="flex gap-1" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={cn("size-4", i < filled ? "fill-current" : "text-muted-foreground")}
                style={i < filled ? { color: ratingColor } : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="oliam-ranking-track w-full max-w-40">
            <div
              className="oliam-ranking-fill"
              style={{
                width: `${values.length ? Math.min(100, (avg / scaleMax) * 100) : 0}%`,
                background: ratingColor,
                animationDelay: "150ms",
              }}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {values.length
            ? `${values.length.toLocaleString("pt-BR")} avaliações consideradas`
            : "Nenhum valor numérico disponível."}
        </p>
        {values.length > 1 && ratingMin !== null && ratingMax !== null && (
          <p className="text-[10px] text-muted-foreground">
            Variação de {ratingMin.toLocaleString("pt-BR")} a {ratingMax.toLocaleString("pt-BR")}
            {belowAverageShare !== null &&
              ` · ${belowAverageShare.toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 0 })} das avaliações abaixo da média`}
          </p>
        )}
      </div>
      <WidgetEvidencePanel />
    </article>
  );
}
