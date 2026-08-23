import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { AutoDashboardPlan } from "@/lib/auto-dashboard";
import type { AnalysisTrustSummary } from "@/lib/analysis-trust";
import type { QuestionCoverage } from "@/lib/analytical-narrative";
import { aggregate, aggregationLabels, type AggregationOp } from "@/lib/data-pipeline";
import { conditionalColor, conditionalStyle, fmt, parseNumericValue } from "@/lib/format";
import type { Column, FilterRule, Row } from "@/lib/types";
import { cn } from "@/lib/utils";

export function InsightSidebar(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: Row[];
  rowCount: number;
  autoDashboard: AutoDashboardPlan | undefined;
  analysisTrust: AnalysisTrustSummary;
  executiveSummary: string[];
  questionCoverage: QuestionCoverage | undefined;
  nums: Column[];
  metricOperations: ReadonlyMap<string, AggregationOp>;
  versionDelta: Map<string, number | null> | null;
  sidebarRanking: { name: string; total: number }[];
  sidebarRankingMax: number;
  sidebarRankingOperation: AggregationOp;
  cat: Column | undefined;
  primary: Column | undefined;
  dateCol: Column | undefined;
  filters: FilterRule[];
  setFilters: (filters: FilterRule[]) => void;
}) {
  const { cat, primary, dateCol, open, onOpenChange } = p;
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !window.matchMedia("(max-width: 1023px)").matches) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const content = (
    <>
      <div className="border-b border-border p-4">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          Visão geral
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {p.data.length} de {p.rowCount} linhas na visão atual
        </p>
      </div>
      {p.executiveSummary.length > 0 && (
        <div className="border-b border-border p-4">
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Resumo executivo
          </p>
          <ul className="mt-2 space-y-2">
            {p.executiveSummary.map((sentence, i) => (
              <li key={i} className="text-xs leading-relaxed text-foreground/90">
                {sentence}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.questionCoverage && p.questionCoverage.questions.length > 0 && (
        <div className="border-b border-border p-4">
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Perguntas analíticas
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {p.questionCoverage.summary}
          </p>
        </div>
      )}
      {p.autoDashboard && (
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Leitura automática atual
            </p>
            {p.analysisTrust.recommendationConfidence !== null && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {p.analysisTrust.recommendationConfidence}% sugestões
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Avalia a adequação das sugestões e a leitura do significado das colunas. As porcentagens
            não são uma nota de qualidade dos dados.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-muted/60 p-2">
              <p className="text-muted-foreground">Significados</p>
              <p className="mt-0.5 font-mono font-semibold">
                {p.analysisTrust.semanticConfidence}%
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 p-2">
              <p className="text-muted-foreground">Pendências</p>
              <p
                className={cn(
                  "mt-0.5 font-mono font-semibold",
                  p.analysisTrust.pendingExceptionCount > 0 && "text-amber-600",
                )}
              >
                {p.analysisTrust.pendingExceptionCount}
              </p>
              {p.analysisTrust.criticalExceptionCount > 0 && (
                <p className="mt-0.5 text-[10px] text-amber-600">
                  {p.analysisTrust.criticalExceptionCount}{" "}
                  {p.analysisTrust.criticalExceptionCount === 1 ? "crítica" : "críticas"}
                </p>
              )}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {p.autoDashboard.recommendations.slice(0, 5).map((item) => (
              <div key={item.id} className="rounded-xl border border-border bg-card p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium leading-snug">{item.title}</p>
                  <span className="shrink-0 font-mono text-[10px] text-primary">
                    {item.confidence}% adequação
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {item.reasons[0]}
                </p>
                {item.warnings[0] && (
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-600">
                    {item.warnings[0]}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {p.nums.length > 0 && (
        <div className="border-b border-border p-4">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            KPIs
          </p>
          <div className="grid grid-cols-2 gap-2">
            {p.nums.slice(0, 4).map((c) => {
              const operation = p.metricOperations.get(c.key) ?? "sum";
              const total = aggregate(
                p.data
                  .map((r) => parseNumericValue(r[c.key]))
                  .filter((v): v is number => v !== null),
                operation,
              );
              const delta = p.versionDelta?.get(c.key) ?? null;
              const style = conditionalStyle(total, c.kind, c.conditionalFormat);
              return (
                <div
                  key={c.key}
                  className="rounded-xl border border-border bg-card p-2.5 shadow-sm"
                  style={style ?? undefined}
                >
                  <p
                    className="truncate text-[11px] text-muted-foreground"
                    title={`${aggregationLabels[operation]} de ${c.label}`}
                  >
                    {aggregationLabels[operation]} de {c.label}
                  </p>
                  <p className="font-mono text-base font-semibold" style={{ color: style?.color }}>
                    {fmt(total, c.kind)}
                  </p>
                  {delta !== null && (
                    <p
                      className={cn(
                        "font-mono text-[10px]",
                        delta >= 0 ? "text-secondary-accent" : "text-destructive",
                      )}
                    >
                      {delta >= 0 ? "+" : ""}
                      {new Intl.NumberFormat("pt-BR", {
                        style: "percent",
                        maximumFractionDigits: 1,
                      }).format(delta)}{" "}
                      vs. anterior
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {p.sidebarRanking.length > 0 && cat && primary && (
        <div className="border-b border-border p-4">
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Ranking por {cat.label}
          </p>
          <p className="mb-3 mt-1 text-[11px] text-muted-foreground">
            {aggregationLabels[p.sidebarRankingOperation]} de {primary.label}
          </p>
          <div className="space-y-0.5">
            {p.sidebarRanking.map((r, i) => {
              const active = p.filters.some((f) => f.key === cat.key && f.value === r.name);
              return (
                <button
                  key={r.name}
                  className={cn(
                    "oliam-ranking-row block w-full text-left transition-opacity hover:opacity-90",
                    active && "opacity-100",
                  )}
                  onClick={() => {
                    if (active) {
                      p.setFilters(p.filters.filter((f) => f.key !== cat.key));
                    } else {
                      p.setFilters([
                        ...p.filters.filter((f) => f.key !== cat.key),
                        { key: cat.key, value: r.name, min: "", max: "" },
                      ]);
                    }
                  }}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs">{r.name || "Não informado"}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {fmt(r.total, primary.kind)}
                    </span>
                  </div>
                  <div className="oliam-ranking-track">
                    <div
                      className="oliam-ranking-fill"
                      style={{
                        width: `${Math.max(4, (Math.abs(r.total) / p.sidebarRankingMax) * 100)}%`,
                        background:
                          conditionalColor(r.total, primary.kind, primary.conditionalFormat) ??
                          (active ? "var(--primary)" : "var(--secondary-accent)"),
                        animationDelay: `${Math.min(i, 10) * 45}ms`,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {dateCol && (
        <div className="p-4">
          <p className="mb-3 text-[11px] uppercase tracking-wide text-muted-foreground">
            Filtrar por {dateCol.label}
          </p>
          {(() => {
            const existing = p.filters.find((f) => f.key === dateCol.key);
            return (
              <div className="flex flex-col gap-2">
                <input
                  className="oliam-input h-9"
                  type="text"
                  placeholder="De, dd/mm/aaaa"
                  value={existing?.min ?? ""}
                  onChange={(e) => {
                    const min = e.target.value;
                    const rest = p.filters.filter((f) => f.key !== dateCol.key);
                    p.setFilters([
                      ...rest,
                      { key: dateCol.key, value: "", min, max: existing?.max ?? "" },
                    ]);
                  }}
                />
                <input
                  className="oliam-input h-9"
                  type="text"
                  placeholder="Até, dd/mm/aaaa"
                  value={existing?.max ?? ""}
                  onChange={(e) => {
                    const max = e.target.value;
                    const rest = p.filters.filter((f) => f.key !== dateCol.key);
                    p.setFilters([
                      ...rest,
                      { key: dateCol.key, value: "", min: existing?.min ?? "", max },
                    ]);
                  }}
                />
              </div>
            );
          })()}
        </div>
      )}
    </>
  );

  return (
    <>
      <aside className="oliam-insight-sidebar hidden shrink-0 overflow-auto lg:block">
        {content}
      </aside>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-black/50 lg:hidden"
        aria-label="Fechar visão geral"
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 w-[min(92vw,24rem)] overflow-y-auto border-l border-border bg-background shadow-2xl lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="insight-sidebar-mobile-title"
        aria-describedby="insight-sidebar-mobile-description"
      >
        <h2 id="insight-sidebar-mobile-title" className="sr-only">
          Visão geral da análise
        </h2>
        <p id="insight-sidebar-mobile-description" className="sr-only">
          Resumo executivo, perguntas analíticas, indicadores e filtros do painel.
        </p>
        <button
          ref={closeButtonRef}
          type="button"
          className="absolute right-2 top-2 z-10 grid size-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Fechar visão geral"
          onClick={() => onOpenChange(false)}
        >
          <X className="size-5" aria-hidden="true" />
        </button>
        <div className="pt-10">{content}</div>
      </aside>
    </>
  );
}
