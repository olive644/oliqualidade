import type { Column, Widget } from "@/lib/types";
import { numericKinds } from "@/lib/types";

export type GlobalSearchEntry = {
  id: string;
  kind: "column" | "metric" | "widget" | "sheet" | "dashboard";
  label: string;
  /** Texto adicional que também casa com a busca (tipo do widget, nome da aba). */
  hint: string;
  /** Palavras que o usuário pode digitar e que não estão no rótulo. */
  keywords: string;
};

/**
 * Reúne o que existe no painel em uma lista pesquisável.
 *
 * A paleta de comandos só listava ações fixas: dava para exportar ou desfazer,
 * mas não para achar uma coluna, um widget ou uma aba pelo nome. Em uma
 * planilha com dezenas de colunas e um painel com dezenas de widgets, o
 * caminho era rolar e procurar com os olhos.
 *
 * Colunas numéricas aparecem duas vezes, de propósito e em grupos diferentes:
 * como coluna, para filtrar por ela, e como métrica, para virar um indicador.
 * São duas intenções distintas com o mesmo nome, e obrigar o usuário a
 * adivinhar qual delas a busca escolheu seria pior que oferecer as duas.
 */
export function buildGlobalSearchEntries({
  columns,
  widgets,
  sheetNames,
  dashboards,
  widgetTypeLabels,
}: {
  columns: Column[];
  widgets: Widget[];
  sheetNames: string[];
  dashboards: { id: string; name: string }[];
  widgetTypeLabels: Record<string, string>;
}): GlobalSearchEntry[] {
  const entries: GlobalSearchEntry[] = [];

  for (const column of columns) {
    entries.push({
      id: `column:${column.key}`,
      kind: "column",
      label: column.label,
      hint: "Filtrar por esta coluna",
      keywords: `coluna filtro ${column.key} ${column.description ?? ""}`,
    });
    if (numericKinds.includes(column.kind)) {
      entries.push({
        id: `metric:${column.key}`,
        kind: "metric",
        label: column.label,
        hint: "Criar indicador com esta métrica",
        keywords: `metrica indicador numero ${column.key}`,
      });
    }
  }

  for (const [index, widget] of widgets.entries()) {
    const typeLabel = widgetTypeLabels[widget.type] ?? widget.type;
    entries.push({
      id: `widget:${widget.id}`,
      kind: "widget",
      // Widget sem título próprio é a regra, não a exceção: o título costuma
      // ser calculado na renderização, que a busca não tem. O tipo mais a
      // posição identificam o widget sem inventar um nome.
      label: widget.title?.trim() ? widget.title : `${typeLabel} ${index + 1}`,
      hint: typeLabel,
      keywords: `widget grafico ${widget.type} ${widget.groupKey ?? ""} ${widget.valueKey ?? ""} ${widget.metricKey ?? ""}`,
    });
  }

  for (const [index, name] of sheetNames.entries()) {
    entries.push({
      id: `sheet:${index}`,
      kind: "sheet",
      label: name,
      hint: "Trocar para esta aba",
      keywords: "aba planilha guia",
    });
  }

  for (const dashboard of dashboards) {
    entries.push({
      id: `dashboard:${dashboard.id}`,
      kind: "dashboard",
      label: dashboard.name,
      hint: "Abrir este painel",
      keywords: "painel relatorio dashboard",
    });
  }

  return entries;
}
