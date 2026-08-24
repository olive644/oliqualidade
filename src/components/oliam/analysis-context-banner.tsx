/**
 * "Contexto da análise" — o primeiro dos oito blocos da estrutura de painel
 * descrita pelo usuário (arquivo, aba, período, linhas, filtros, confiança),
 * sempre visível na tela. Já existia uma versão disso (`oliam-export-header`
 * em `routes/index.tsx`), mas com `display: none` fora do modo de
 * exportação — só aparecia no PDF/PNG gerado, nunca durante o uso normal do
 * painel. Este componente é a versão que fica na tela o tempo todo.
 */
import type { AnalysisTrustSummary } from "@/lib/analysis-trust";

export function AnalysisContextBanner({
  fileName,
  sheetName,
  rowCount,
  totalRowCount,
  periodLabel,
  filterCount,
  affectedWidgetCount,
  trust,
}: {
  fileName: string;
  sheetName: string;
  rowCount: number;
  totalRowCount: number;
  periodLabel: string | null;
  filterCount: number;
  /** Quantos widgets do painel são recalculados quando um filtro muda. */
  affectedWidgetCount: number;
  trust: AnalysisTrustSummary;
}) {
  const filtered = rowCount < totalRowCount;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs">
      <span className="truncate font-semibold text-foreground" title={fileName}>
        {fileName}
      </span>
      <span className="text-muted-foreground">Aba {sheetName}</span>
      <span className={filtered ? "font-medium text-primary" : "text-muted-foreground"}>
        {rowCount.toLocaleString("pt-BR")} de {totalRowCount.toLocaleString("pt-BR")} linhas
        {filtered ? " (filtradas)" : ""}
      </span>
      {periodLabel && <span className="text-muted-foreground">Período: {periodLabel}</span>}
      {filterCount > 0 && (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
          {filterCount} {filterCount === 1 ? "filtro ativo" : "filtros ativos"}
        </span>
      )}
      {filterCount > 0 && affectedWidgetCount > 0 && (
        // O filtro sempre valeu para o painel inteiro, mas isso não estava
        // escrito em lugar nenhum: quem filtrava clicando em um widget não
        // tinha como saber, sem conferir um por um, se os outros também
        // haviam mudado.
        <span className="text-muted-foreground">
          {affectedWidgetCount} de {affectedWidgetCount}{" "}
          {affectedWidgetCount === 1 ? "widget atualizado" : "widgets atualizados"}
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
        {trust.recommendationConfidence !== null && (
          <span title="Adequação das visualizações recomendadas. Não é uma nota de qualidade dos dados.">
            Sugestões: {trust.recommendationConfidence}%
          </span>
        )}
        <span title="Confiança na identificação do papel e da unidade das colunas.">
          Significados: {trust.semanticConfidence}%
        </span>
        <span
          className={trust.pendingExceptionCount > 0 ? "text-amber-600" : undefined}
          title="Inconsistências ainda não revisadas na leitura atual."
        >
          {trust.pendingExceptionCount === 0
            ? "Sem pendências detectadas"
            : `${trust.pendingExceptionCount} ${trust.pendingExceptionCount === 1 ? "pendência" : "pendências"}${
                trust.criticalExceptionCount > 0
                  ? `, ${trust.criticalExceptionCount} ${trust.criticalExceptionCount === 1 ? "crítica" : "críticas"}`
                  : ""
              }`}
        </span>
      </div>
    </div>
  );
}
