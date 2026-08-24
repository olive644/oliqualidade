import { describe, expect, it } from "vitest";
import { buildGlobalSearchEntries } from "./global-search";
import type { Column, Widget } from "@/lib/types";

const coluna = (key: string, label: string, kind: Column["kind"] = "text"): Column => ({
  key,
  label,
  kind,
  visible: true,
  description: "",
});

const widget = (id: string, type: Widget["type"], title?: string): Widget =>
  ({ id, type, span: 1, size: "md", ...(title ? { title } : {}) }) as Widget;

const rotulos = { bar: "Gráfico de barras", metric: "Métrica" };

const entradas = () =>
  buildGlobalSearchEntries({
    columns: [coluna("cidade", "Cidade"), coluna("valor", "Valor", "currency")],
    widgets: [widget("w1", "bar", "Vendas por cidade"), widget("w2", "metric")],
    sheetNames: ["Dados", "Resumo"],
    dashboards: [{ id: "d1", name: "Painel de vendas" }],
    widgetTypeLabels: rotulos,
  });

describe("buildGlobalSearchEntries", () => {
  it("indexa colunas, widgets, abas e painéis", () => {
    const porTipo = new Map<string, number>();
    for (const e of entradas()) porTipo.set(e.kind, (porTipo.get(e.kind) ?? 0) + 1);
    expect(porTipo.get("column")).toBe(2);
    expect(porTipo.get("widget")).toBe(2);
    expect(porTipo.get("sheet")).toBe(2);
    expect(porTipo.get("dashboard")).toBe(1);
  });

  it("oferece coluna numérica como coluna e como métrica", () => {
    // Duas intenções com o mesmo nome: filtrar por ela ou transformá-la em
    // indicador. Escolher uma sozinha obrigaria o usuário a adivinhar.
    const valor = entradas().filter((e) => e.label === "Valor");
    expect(valor.map((e) => e.kind).sort()).toEqual(["column", "metric"]);
  });

  it("não oferece coluna de texto como métrica", () => {
    expect(entradas().some((e) => e.kind === "metric" && e.label === "Cidade")).toBe(false);
  });

  it("usa o título do widget quando existe", () => {
    expect(entradas().some((e) => e.label === "Vendas por cidade")).toBe(true);
  });

  it("identifica pelo tipo e pela posição o widget sem título", () => {
    // O título costuma ser calculado na renderização, que a busca não vê.
    expect(entradas().some((e) => e.label === "Métrica 2")).toBe(true);
  });

  it("guarda as colunas do widget como palavra-chave, para achar pelo dado", () => {
    const comGrupo = buildGlobalSearchEntries({
      columns: [],
      widgets: [{ ...widget("w1", "bar"), groupKey: "cidade", valueKey: "valor" } as Widget],
      sheetNames: [],
      dashboards: [],
      widgetTypeLabels: rotulos,
    });
    expect(comGrupo[0]?.keywords).toContain("cidade");
    expect(comGrupo[0]?.keywords).toContain("valor");
  });
});
