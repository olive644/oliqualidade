/**
 * "Contexto da análise" — o primeiro dos oito blocos da estrutura de painel
 * descrita pelo usuário (arquivo, aba, período, linhas, filtros, confiança),
 * sempre visível na tela. Já existia uma versão disso (`oliam-export-header`
 * em `routes/index.tsx`), mas com `display: none` fora do modo de
 * exportação — só aparecia no PDF/PNG gerado, nunca durante o uso normal do
 * painel. Este componente é a versão que fica na tela o tempo todo.
 */
export function AnalysisContextBanner({
  fileName,
  sheetName,
  rowCount,
  totalRowCount,
  periodLabel,
  filterCount,
  planConfidence,
}: {
  fileName: string;
  sheetName: string;
  rowCount: number;
  totalRowCount: number;
  periodLabel: string | null;
  filterCount: number;
  planConfidence: number | undefined;
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
      {planConfidence !== undefined && (
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
          {planConfidence}% de confiança no painel sugerido
        </span>
      )}
    </div>
  );
}
