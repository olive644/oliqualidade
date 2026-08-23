import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { buildInvestigation } from "@/lib/investigation";
import { aggregationLabels, type AggregationOp } from "@/lib/data-pipeline";
import { fmt } from "@/lib/format";
import type { Column, Row } from "@/lib/types";

export function InvestigationPanel(p: {
  rows: Row[];
  metric: Column;
  dimension: Column;
  date: Column | undefined;
  operation: AggregationOp;
  question: string;
  onClose: () => void;
  onNextStep: (type: "pareto" | "bar") => void;
}) {
  const [showRows, setShowRows] = useState(false);
  const result = useMemo(
    () =>
      buildInvestigation({
        rows: p.rows,
        metric: p.metric,
        dimension: p.dimension,
        date: p.date,
        operation: p.operation,
      }),
    [p.rows, p.metric, p.dimension, p.date, p.operation],
  );
  const topRowIndexes = result.causes.flatMap((cause) => cause.rowIndexes).slice(0, 20);

  return (
    <section
      className="border-b border-border bg-primary/[0.03] p-4"
      aria-label="Investigação guiada"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wide text-primary">
            Investigação guiada
          </p>
          <p className="mt-1 text-xs font-semibold leading-snug">{p.question}</p>
        </div>
        <button
          type="button"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Fechar investigação"
          onClick={p.onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 space-y-2.5">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="font-mono text-[9px] uppercase text-muted-foreground">O que aconteceu</p>
          <p className="mt-1 text-xs leading-relaxed">
            {result.mode === "period-change" ? (
              <>
                {aggregationLabels[p.operation]} de {p.metric.label}:{" "}
                {fmt(result.currentValue, p.metric.kind)} no período mais recente, uma diferença de{" "}
                <strong>
                  {(result.difference ?? 0) >= 0 ? "+" : ""}
                  {fmt(result.difference, p.metric.kind)}
                </strong>{" "}
                em relação ao período anterior.
              </>
            ) : (
              <>
                A visão atual soma {fmt(result.currentValue, p.metric.kind)} em {p.metric.label}.
                Não há dois períodos válidos para calcular uma mudança temporal.
              </>
            )}
          </p>
        </div>

        {result.mode === "period-change" && (
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="font-mono text-[9px] uppercase text-muted-foreground">Quando</p>
            <p className="mt-1 text-xs">
              Comparação de <strong>{result.previousPeriod}</strong> com{" "}
              <strong>{result.currentPeriod}</strong>.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-3">
          <p className="font-mono text-[9px] uppercase text-muted-foreground">
            Categorias que mais movimentaram o resultado
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            A participação usa o movimento absoluto. A direção indica apenas aumento ou redução, sem
            classificar o resultado como bom ou ruim.
          </p>
          <ol className="mt-2 space-y-2">
            {result.causes.slice(0, 3).map((cause, index) => (
              <li key={cause.name} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-[10px] text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{cause.name}</span>
                <span className="font-mono">
                  {cause.difference >= 0 ? "+" : ""}
                  {fmt(cause.difference, p.metric.kind)}
                </span>
                <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">
                  {(cause.shareOfMovement * 100).toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })}
                  %
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-xl border border-border bg-card p-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold"
            aria-expanded={showRows}
            onClick={() => setShowRows((current) => !current)}
          >
            <span className="inline-flex items-center gap-1.5">
              <Search className="size-3.5 text-primary" />
              Ver {result.recordCount.toLocaleString("pt-BR")} registros usados
            </span>
            {showRows ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          {showRows && (
            <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-border">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Linha</th>
                    {p.date && <th className="px-2 py-1.5 text-left">{p.date.label}</th>}
                    <th className="px-2 py-1.5 text-left">{p.dimension.label}</th>
                    <th className="px-2 py-1.5 text-right">{p.metric.label}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {topRowIndexes.map((rowIndex) => {
                    const row = p.rows[rowIndex];
                    return (
                      <tr key={rowIndex}>
                        <td className="px-2 py-1.5 text-muted-foreground">{rowIndex + 1}</td>
                        {p.date && (
                          <td className="px-2 py-1.5">{String(row?.[p.date.key] ?? "")}</td>
                        )}
                        <td className="max-w-24 truncate px-2 py-1.5">
                          {String(row?.[p.dimension.key] ?? "Não informado")}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {fmt(row?.[p.metric.key] ?? null, p.metric.kind)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {result.recordCount > topRowIndexes.length && (
                <p className="border-t border-border px-2 py-1.5 text-muted-foreground">
                  Exibindo os primeiros {topRowIndexes.length} registros da investigação.
                </p>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="flex w-full items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-left text-xs font-semibold text-primary hover:bg-primary/15"
          onClick={() => p.onNextStep(result.nextStep)}
        >
          <span>
            Próximo passo:{" "}
            {result.nextStep === "pareto" ? "ver concentração das causas" : "comparar categorias"}
          </span>
          <ArrowRight className="size-4" />
        </button>
      </div>
    </section>
  );
}
