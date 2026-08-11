import { describe, expect, it } from "vitest";
import { bookmarkView, createBookmark } from "@/lib/bookmarks";
import type { Column, FilterRule } from "@/lib/types";

const columns: Column[] = [
  {
    key: "regiao",
    label: "Região",
    kind: "category",
    visible: true,
    description: "",
  },
  {
    key: "receita",
    label: "Receita",
    kind: "currency",
    visible: true,
    description: "",
  },
  { key: "data", label: "Data", kind: "date", visible: true, description: "" },
];

describe("marcadores", () => {
  it("captura busca, ordem e todos os tipos de filtro sem compartilhar referências", () => {
    const filters: FilterRule[] = [
      { key: "regiao", value: "Nordeste" },
      { key: "receita", value: "", min: "100", max: "900" },
      { key: "data", value: "", min: "01/08/2026", max: "31/08/2026" },
    ];
    const bookmark = createBookmark(
      " Agosto ",
      filters,
      "suape",
      { key: "receita", dir: "desc" },
      10,
    );

    expect(bookmark).toMatchObject({
      name: "Agosto",
      filters,
      search: "suape",
      sort: { key: "receita", dir: "desc" },
      createdAt: 10,
    });
    expect(bookmark.filters).not.toBe(filters);
    expect(bookmark.filters[0]).not.toBe(filters[0]);
  });

  it("mantém a visão válida e ignora referências a colunas removidas", () => {
    const bookmark = createBookmark(
      "Visão",
      [
        { key: "regiao", value: "Sul" },
        { key: "removida", value: "antiga" },
      ],
      "ativo",
      { key: "removida", dir: "asc" },
      20,
    );

    expect(bookmarkView(bookmark, columns)).toEqual({
      filters: [{ key: "regiao", value: "Sul" }],
      search: "ativo",
      sort: null,
    });
  });
});
