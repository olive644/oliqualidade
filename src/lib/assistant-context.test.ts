import { describe, expect, it } from "vitest";
import { buildLiveDashboardContext, buildLiveSuggestedPrompts } from "@/lib/assistant-context";
import type { Column, Widget } from "@/lib/types";

const columns: Column[] = [
  { key: "Data", label: "Data", kind: "date", visible: true, description: "" },
  {
    key: "Itens Processados",
    label: "Itens Processados",
    kind: "number",
    visible: true,
    description: "",
  },
  { key: "Equipe", label: "Equipe", kind: "category", visible: true, description: "" },
];

const trendWidget: Widget = {
  id: "trend",
  type: "metric-trend",
  metricKey: "Itens Processados",
  groupKey: "Data",
  op: "max",
  span: 1,
  size: "sm",
};

describe("contexto vivo do assistente", () => {
  it("captura exatamente a tendência exibida no widget", () => {
    const context = buildLiveDashboardContext({
      dashboardName: "Operações BK",
      sheetName: "Agosto",
      columns,
      rows: [
        { Data: "01/08/2026", "Itens Processados": 179, Equipe: "A" },
        { Data: "11/08/2026", "Itens Processados": 106.684, Equipe: "A" },
      ],
      totalRows: 58,
      widgets: [trendWidget],
      filters: [],
      search: "",
      sort: null,
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    const widget = context.widgets[0];
    expect(context.visibleRows).toBe(2);
    expect(context.totalRows).toBe(58);
    expect(widget?.displayedValue).toEqual({ value: 179, formatted: "179" });
    expect(widget?.trend).toMatchObject({
      change: -0.404,
      formattedChange: "-40,4%",
      firstPeriod: { label: "01/08/2026", value: 179 },
      lastPeriod: { label: "11/08/2026", value: 106.684 },
    });
    expect(widget?.trend?.meaning).toContain("último período - primeiro período");
    expect(buildLiveSuggestedPrompts(context)[0]).toBe(
      "Explique a variação de -40,4% em Itens Processados, de 01/08/2026 até 11/08/2026.",
    );
  });

  it("usa somente as linhas filtradas e registra filtros, busca e ordenação atuais", () => {
    const context = buildLiveDashboardContext({
      dashboardName: "Operações",
      sheetName: "Diário",
      columns,
      rows: [{ Data: "11/08/2026", "Itens Processados": 40, Equipe: "Noite" }],
      totalRows: 100,
      widgets: [trendWidget],
      filters: [{ key: "Equipe", value: "Noite" }],
      search: "11/08",
      sort: { key: "Data", dir: "desc" },
    });

    expect(context.visibleRows).toBe(1);
    expect(context.search).toBe("11/08");
    expect(context.filters[0]).toMatchObject({
      columnLabel: "Equipe",
      value: "Noite",
    });
    expect(context.sort).toEqual({
      columnKey: "Data",
      columnLabel: "Data",
      direction: "desc",
    });
    expect(buildLiveSuggestedPrompts(context)).toContain("Resuma 1 registro desta visão filtrada.");
  });

  it("resume séries extensas sem perder a indicação de que há mais itens", () => {
    const bar: Widget = {
      id: "bar",
      type: "bar",
      groupKey: "Equipe",
      valueKey: "Itens Processados",
      op: "sum",
      span: 2,
      size: "md",
    };
    const rows = Array.from({ length: 105 }, (_, index) => ({
      Data: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
      "Itens Processados": index + 1,
      Equipe: `Equipe ${index + 1}`,
    }));
    const context = buildLiveDashboardContext({
      dashboardName: "Operações",
      sheetName: "Diário",
      columns,
      rows,
      totalRows: rows.length,
      widgets: [bar],
      filters: [],
      search: "",
      sort: null,
    });

    expect(context.widgets[0]?.series).toMatchObject({
      totalItems: 105,
      truncated: true,
    });
    expect(context.widgets[0]?.series?.items).toHaveLength(100);
  });
});
