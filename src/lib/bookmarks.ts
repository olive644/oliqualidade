import type { Bookmark, Column, FilterRule } from "@/lib/types";

export type BookmarkSort = Bookmark["sort"];

/** Captura uma visão sem compartilhar objetos mutáveis com a tela atual. */
export function createBookmark(
  name: string,
  filters: FilterRule[],
  search: string,
  sort: BookmarkSort,
  now = Date.now(),
): Bookmark {
  return {
    id: `bm_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    filters: filters.map((filter) => ({ ...filter })),
    search,
    sort: sort ? { ...sort } : null,
    createdAt: now,
  };
}

/**
 * Reabre um marcador contra o esquema atual da planilha. Filtros e ordenação
 * de colunas removidas por uma nova versão são descartados, enquanto texto,
 * datas, intervalos numéricos e busca continuam intactos.
 */
export function bookmarkView(bookmark: Bookmark, columns: Column[]) {
  const keys = new Set(columns.map((column) => column.key));
  return {
    filters: bookmark.filters
      .filter((filter) => keys.has(filter.key))
      .map((filter) => ({ ...filter })),
    search: bookmark.search,
    sort: bookmark.sort && keys.has(bookmark.sort.key) ? { ...bookmark.sort } : null,
  };
}
