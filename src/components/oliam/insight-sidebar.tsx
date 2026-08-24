import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleHelp, Plus, Search, X } from "lucide-react";
import type { AutoDashboardPlan } from "@/lib/auto-dashboard";
import type { AnalysisTrustSummary } from "@/lib/analysis-trust";
import type { AnalyticalQuestion, QuestionCoverage } from "@/lib/analytical-narrative";
import { aggregate, aggregationLabels, type AggregationOp } from "@/lib/data-pipeline";
import { conditionalColor, conditionalStyle, fmt, parseNumericValue } from "@/lib/format";
import type { Column, FilterRule, Row } from "@/lib/types";
import { cn } from "@/lib/utils";
import { InvestigationPanel } from "./investigation-panel";

/**
 * O botão "Investigar" abria sempre com a métrica global (a `primary` do
 * painel), ignorando de qual pergunta o clique veio — clicar em "Duas
 * variáveis têm relação?" ou em "Como mudou no tempo?" investigava a métrica
 * errada. Resolve pelo `metricKey` da própria pergunta (mesmo padrão já
 * usado em `questionEvidence`), caindo na métrica global só quando a
 * pergunta não aponta pra nenhuma. Extraída do componente pra ser testável
 * sem montar toda a barra lateral.
 */
export function investigationMetricFor(
  question: Pick<AnalyticalQuestion, "metricKey">,
  nums: Column[],
  primary: Column | undefined,
): Column | undefined {
  return nums.find((column) => column.key === question.metricKey) ?? primary;
}

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
  onOpenQuestionWidget: (widgetId: string) => void;
  onCreateQuestionWidget: (question: AnalyticalQuestion) => void;
}) {
  const { cat, primary, dateCol, open, onOpenChange } = p;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [investigating, setInvestigating] = useState<AnalyticalQuestion | null>(null);

  const openInvestigationNextStep = (type: "pareto" | "bar") => {
    const id = type === "pareto" ? "root-causes" : "who-is-bigger";
    const nextQuestion = p.questionCoverage?.questions.find((question) => question.id === id);
    if (!nextQuestion) return;
    setInvestigating(null);
    if (nextQuestion.coveredByWidgetId) {
      onOpenChange(false);
      p.onOpenQuestionWidget(nextQuestion.coveredByWidgetId);
    } else if (nextQuestion.answerable) {
      onOpenChange(false);
      p.onCreateQuestionWidget(nextQuestion);
    }
  };

  const questionAnswer = (question: AnalyticalQuestion): string => {
    if (!question.answerable)
      return question.reason ?? "Os dados necessários não estão disponíveis.";
    if (!question.coveredByWidgetId)
      return "A planilha permite responder, mas ainda falta uma visualização.";
    if (question.id === "current-value" && p.primary) {
      const operation = p.metricOperations.get(p.primary.key) ?? "sum";
      const total = aggregate(
        p.data
          .map((row) => parseNumericValue(row[p.primary!.key]))
          .filter((value): value is number => value !== null),
        operation,
      );
      return `${aggregationLabels[operation]} de ${p.primary.label}: ${fmt(total, p.primary.kind)}.`;
    }
    if (["who-is-bigger", "share-of-total", "root-causes"].includes(question.id)) {
      const leader = p.sidebarRanking[0];
      return leader && p.cat && p.primary
        ? `${leader.name || "Não informado"} lidera com ${fmt(leader.total, p.primary.kind)}.`
        : "A comparação está disponível no painel.";
    }
    if (question.id === "trend-over-time") {
      return (
        p.executiveSummary.find((sentence) => sentence.includes("ao longo de")) ??
        "A evolução temporal está disponível no painel."
      );
    }
    if (question.id === "anomalies") {
      return p.analysisTrust.pendingExceptionCount
        ? `${p.analysisTrust.pendingExceptionCount} pendência${p.analysisTrust.pendingExceptionCount === 1 ? "" : "s"} merece${p.analysisTrust.pendingExceptionCount === 1 ? "" : "m"} revisão.`
        : "Nenhuma pendência crítica foi identificada na visão atual.";
    }
    return "A resposta está representada por uma visualização do painel.";
  };

  const questionEvidence = (question: AnalyticalQuestion): string => {
    const metric = p.nums.find((column) => column.key === question.metricKey)?.label;
    const group = [p.cat, p.dateCol].find((column) => column?.key === question.groupKey)?.label;
    const fields = [metric, group].filter(Boolean).join(" por ");
    return `${fields || "Estrutura da planilha"}, usando ${p.data.length} registros na visão atual${p.filters.length ? ` e ${p.filters.length} filtro${p.filters.length === 1 ? "" : "s"}` : ""}.`;
  };

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 1023px)");
    if (!open || !mobileQuery.matches) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    // Girar o aparelho ou redimensionar a janela com o drawer ainda aberto
    // passava pra layout desktop (lg:hidden esconde o próprio drawer) sem
    // nunca desfazer o bloqueio de scroll do body, porque o efeito só
    // reavaliava a largura na montagem — a página ficava travada até o
    // usuário fechar e reabrir a visão geral.
    const handleViewportChange = () => {
      document.body.style.overflow = mobileQuery.matches ? "hidden" : previousOverflow;
    };
    window.addEventListener("keydown", handleKeyDown);
    mobileQuery.addEventListener("change", handleViewportChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      mobileQuery.removeEventListener("change", handleViewportChange);
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
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Roteiro de análise
            </p>
            <span className="font-mono text-[10px] text-muted-foreground">
              {p.questionCoverage.covered.length}/{p.questionCoverage.answerable.length} respondidas
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Siga as perguntas abaixo para conferir o que o painel responde e o que ainda falta.
          </p>
          <ol className="mt-3 space-y-2">
            {p.questionCoverage.questions.map((question, index) => {
              const covered = Boolean(question.coveredByWidgetId);
              return (
                <li key={question.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold leading-snug">{question.label}</p>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px]",
                            covered
                              ? "bg-primary/10 text-primary"
                              : question.answerable
                                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {covered ? (
                            <CheckCircle2 className="size-3" />
                          ) : (
                            <CircleHelp className="size-3" />
                          )}
                          {covered
                            ? "Respondida"
                            : question.answerable
                              ? "Sem gráfico"
                              : "Dados insuficientes"}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/85">
                        {questionAnswer(question)}
                      </p>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                        Evidência: {questionEvidence(question)}
                      </p>
                      {question.coveredByWidgetId ? (
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
                            onClick={() => {
                              onOpenChange(false);
                              p.onOpenQuestionWidget(question.coveredByWidgetId!);
                            }}
                          >
                            Ver gráfico
                          </button>
                          {investigationMetricFor(question, p.nums, p.primary) && p.cat && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
                              onClick={() => setInvestigating(question)}
                            >
                              <Search className="size-3" />
                              Investigar
                            </button>
                          )}
                        </div>
                      ) : question.answerable ? (
                        <button
                          type="button"
                          className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
                          onClick={() => {
                            onOpenChange(false);
                            p.onCreateQuestionWidget(question);
                          }}
                        >
                          <Plus className="size-3" />
                          Criar gráfico
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {investigating &&
        (() => {
          const metric = investigationMetricFor(investigating, p.nums, p.primary);
          if (!metric || !p.cat) return null;
          return (
            <InvestigationPanel
              rows={p.data}
              metric={metric}
              dimension={p.cat}
              date={p.dateCol}
              operation={p.metricOperations.get(metric.key) ?? "sum"}
              question={investigating.label}
              onClose={() => setInvestigating(null)}
              onNextStep={openInvestigationNextStep}
            />
          );
        })()}
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
          Resumo executivo, roteiro de análise, indicadores e filtros do painel.
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
