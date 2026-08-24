import { describe, expect, it } from "vitest";
import { widgetsAffectedByFilters } from "./widgets";
import type { WidgetType } from "@/lib/types";

const painel = (...tipos: WidgetType[]) => tipos.map((type) => ({ type }));

describe("widgetsAffectedByFilters", () => {
  it("conta os widgets que leem as linhas da planilha", () => {
    expect(widgetsAffectedByFilters(painel("metric", "bar", "pie", "table"))).toBe(4);
  });

  it("não conta o que não muda com filtro", () => {
    // Uma imagem embutida no arquivo e a lista de planilhas monitoradas não
    // dependem das linhas, então prometer que elas foram atualizadas seria
    // falso.
    expect(widgetsAffectedByFilters(painel("metric", "image", "folder-files"))).toBe(1);
  });

  it("devolve zero em painel vazio", () => {
    expect(widgetsAffectedByFilters([])).toBe(0);
  });
});
