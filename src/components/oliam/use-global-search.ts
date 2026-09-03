import { useMemo, useRef } from "react";
import { buildGlobalSearchEntries, type GlobalSearchEntry } from "@/lib/global-search";
import type { Column, FilterRule, Widget, WidgetType } from "@/lib/types";
import { widgetTypeLabels } from "@/lib/types";

/**
 * Índice da paleta de busca global (colunas, widgets, abas, painéis) e o
 * roteamento de uma entrada escolhida para a ação correspondente: coluna vira
 * filtro, métrica vira widget, widget/aba/painel levam até lá. O índice
 * recalcula quando o formato do painel muda, não a cada tecla digitada —
 * quem filtra o texto é a própria paleta.
 */
export function useGlobalSearch(p: {
  columns: Column[];
  widgets: Widget[];
  sheetNames: string[];
  dashboards: { id: string; name: string }[];
  filters: FilterRule[];
  setFilters: (filters: FilterRule[]) => void;
  addWidget: (type: WidgetType, patch?: Partial<Widget>) => void;
  switchSheet: (index: number) => void;
  openDash: (id: string) => void;
  closePalette: () => void;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchEntries = useMemo(
    () =>
      buildGlobalSearchEntries({
        columns: p.columns,
        widgets: p.widgets,
        sheetNames: p.sheetNames,
        dashboards: p.dashboards,
        widgetTypeLabels,
      }),
    [p.columns, p.widgets, p.sheetNames, p.dashboards],
  );

  const handleSearchEntry = (entry: GlobalSearchEntry) => {
    p.closePalette();
    const [, alvo = ""] = entry.id.split(":");
    if (entry.kind === "column") {
      // Só acrescenta o filtro se ainda não houver um para a coluna; repetir
      // criaria duas linhas de filtro concorrentes para o mesmo campo.
      if (!p.filters.some((filter) => filter.key === alvo))
        p.setFilters([...p.filters, { key: alvo, value: "", min: "", max: "" }]);
      return;
    }
    if (entry.kind === "metric") {
      p.addWidget("metric", { metricKey: alvo });
      return;
    }
    if (entry.kind === "widget") {
      // O widget pode estar fora da área visível; rolar até ele é o que
      // transforma "encontrei" em "estou vendo".
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-widget-id="${alvo}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      return;
    }
    if (entry.kind === "sheet") {
      p.switchSheet(Number(alvo));
      return;
    }
    if (entry.kind === "dashboard") p.openDash(alvo);
  };

  return { searchInputRef, searchEntries, handleSearchEntry };
}
