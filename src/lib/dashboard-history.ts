import type { Column, Dashboard, FilterRule, Widget } from "@/lib/types";

/**
 * Uma versão guardada do arranjo de um painel.
 *
 * O que entra aqui é a **montagem**: widgets, filtros, ordem e visibilidade
 * das colunas, aba ativa e nome. O que fica de fora são as linhas da planilha,
 * de propósito e por dois motivos. Guardá-las multiplicaria o tamanho de cada
 * versão pelo tamanho da base, e restaurar uma versão antiga ressuscitaria
 * dados velhos que o usuário já substituiu por uma importação nova — o
 * histórico responde "como o painel estava montado", não "quais eram os dados
 * naquele dia". Para dados, o produto já tem a comparação entre versões da
 * planilha importada.
 */
export type DashboardVersion = {
  id: string;
  dashboardId: string;
  createdAt: number;
  /** Descrição curta do que mudou em relação à versão anterior. */
  summary: string;
  /** Marcada pelo usuário no botão de salvar, em vez de capturada sozinha. */
  manual: boolean;
  snapshot: DashboardSnapshot;
};

export type DashboardSnapshot = {
  name: string;
  activeSheetIndex: number;
  sheets: {
    name: string;
    widgets: Widget[];
    filters: FilterRule[];
    columns: Pick<Column, "key" | "label" | "kind" | "visible">[];
  }[];
};

/** Quantas versões um painel guarda antes de descartar a mais antiga. */
export const MAX_VERSIONS_PER_DASHBOARD = 30;

export function snapshotDashboard(dashboard: Dashboard): DashboardSnapshot {
  return {
    name: dashboard.name,
    activeSheetIndex: dashboard.activeSheetIndex,
    sheets: dashboard.sheets.map((sheet) => ({
      name: sheet.name,
      widgets: sheet.widgets ?? [],
      filters: sheet.filters,
      columns: sheet.columns.map(({ key, label, kind, visible }) => ({
        key,
        label,
        kind,
        visible,
      })),
    })),
  };
}

/**
 * Descreve em uma frase o que mudou entre duas montagens.
 *
 * Uma lista de versões com data e hora e nada mais obriga o usuário a
 * restaurar às cegas para descobrir o que tinha ali. A frase não precisa ser
 * exaustiva: precisa ser suficiente para reconhecer a versão procurada.
 */
export function describeChange(
  previous: DashboardSnapshot | undefined,
  current: DashboardSnapshot,
): string {
  if (!previous) return "Primeira versão guardada";
  const partes: string[] = [];

  if (previous.name !== current.name) partes.push(`renomeado para "${current.name}"`);

  const antes = previous.sheets[previous.activeSheetIndex] ?? previous.sheets[0];
  const agora = current.sheets[current.activeSheetIndex] ?? current.sheets[0];
  if (antes && agora) {
    const diferencaWidgets = agora.widgets.length - antes.widgets.length;
    if (diferencaWidgets > 0)
      partes.push(`${diferencaWidgets} widget${diferencaWidgets > 1 ? "s" : ""} a mais`);
    if (diferencaWidgets < 0)
      partes.push(`${-diferencaWidgets} widget${diferencaWidgets < -1 ? "s" : ""} a menos`);
    if (diferencaWidgets === 0 && JSON.stringify(antes.widgets) !== JSON.stringify(agora.widgets))
      partes.push("widgets reconfigurados");

    const diferencaFiltros = agora.filters.length - antes.filters.length;
    if (diferencaFiltros > 0) partes.push(`${diferencaFiltros} filtro a mais`);
    if (diferencaFiltros < 0) partes.push(`${-diferencaFiltros} filtro a menos`);
    if (diferencaFiltros === 0 && JSON.stringify(antes.filters) !== JSON.stringify(agora.filters))
      partes.push("filtros alterados");

    const ocultasAntes = antes.columns.filter((column) => !column.visible).length;
    const ocultasAgora = agora.columns.filter((column) => !column.visible).length;
    if (ocultasAntes !== ocultasAgora) partes.push("colunas visíveis alteradas");
  }

  if (previous.sheets.length !== current.sheets.length) partes.push("abas alteradas");

  if (!partes.length) return "Ajustes no painel";
  // Três itens já identificam a versão; a lista completa viraria parágrafo.
  return partes.slice(0, 3).join(", ");
}

/**
 * Decide se vale guardar uma versão nova.
 *
 * Sem esta checagem, cada tecla digitada no nome de um widget viraria uma
 * versão, e o histórico ficaria inútil justamente por excesso. Uma captura
 * automática só entra quando a montagem realmente mudou.
 */
export function shouldCapture(
  previous: DashboardSnapshot | undefined,
  current: DashboardSnapshot,
): boolean {
  if (!previous) return true;
  return JSON.stringify(previous) !== JSON.stringify(current);
}

/** Mantém as versões mais recentes, preservando sempre as marcadas pelo usuário. */
export function pruneVersions(
  versions: DashboardVersion[],
  max = MAX_VERSIONS_PER_DASHBOARD,
): DashboardVersion[] {
  if (versions.length <= max) return versions;
  const ordenadas = [...versions].sort((a, b) => b.createdAt - a.createdAt);
  const manuais = ordenadas.filter((version) => version.manual);
  const automaticas = ordenadas.filter((version) => !version.manual);
  // Versão marcada pelo usuário sobrevive à limpeza: ele a criou justamente
  // porque queria poder voltar ali depois.
  const mantidas = [...manuais, ...automaticas.slice(0, Math.max(0, max - manuais.length))];
  return mantidas.sort((a, b) => b.createdAt - a.createdAt);
}
