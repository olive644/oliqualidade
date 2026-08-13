import { describe, expect, it } from "vitest";

import {
  aggregate,
  applyMissingRules,
  barChartPresentation,
  chartSeries,
  detectQualitySignals,
  groupAndAggregate,
  leftJoin,
  limitChartSeriesForRendering,
  NOT_INFORMED,
  pieRoundnessFor,
  relevantAggregationOps,
  sortAllBarCategories,
  timeSeriesChartPresentation,
  toggleClickFilter,
} from "@/lib/data-pipeline";

describe("chartSeries", () => {
  const rows: Row[] = [
    { categoria: "A", valor: 10 },
    { categoria: "A", valor: 20 },
    { categoria: "B", valor: 5 },
  ];

  it("preserva cada linha e a ordem do Excel no modo original", () => {
    expect(chartSeries(rows, "categoria", "valor", "sum", "raw")).toEqual([
      { name: "A", total: 10, sourceRow: 1 },
      { name: "A", total: 20, sourceRow: 2 },
      { name: "B", total: 5, sourceRow: 3 },
    ]);
  });

  it("combina categorias somente quando o modo agrupado é escolhido", () => {
    expect(chartSeries(rows, "categoria", "valor", "sum", "aggregate")).toEqual([
      { name: "A", total: 30 },
      { name: "B", total: 5 },
    ]);
  });
});

describe("limite seguro para SVGs de gráficos", () => {
  it("não altera séries que já cabem na renderização", () => {
    const items = [{ total: 1 }, { total: 2 }];
    expect(limitChartSeriesForRendering(items, 5)).toEqual({ items, omitted: 0, total: 2 });
  });

  it("distribui a prévia por toda a série e preserva as extremidades", () => {
    const items = Array.from({ length: 10_000 }, (_, index) => index);
    const result = limitChartSeriesForRendering(items, 100);
    expect(result.items).toHaveLength(100);
    expect(result.items[0]).toBe(0);
    expect(result.items.at(-1)).toBe(9_999);
    expect(result.omitted).toBe(9_900);
    expect(result.total).toBe(10_000);
  });
});

describe("sortAllBarCategories", () => {
  it("mantém todas as categorias e apenas ordena pelas maiores barras", () => {
    const categories = Array.from({ length: 24 }, (_, index) => ({
      name: `Categoria ${index + 1}`,
      total: index + 1,
    }));
    const sorted = sortAllBarCategories(categories);
    expect(sorted).toHaveLength(24);
    expect(sorted[0]?.total).toBe(24);
    expect(sorted.at(-1)?.total).toBe(1);
  });
});

describe("barChartPresentation", () => {
  it("mantém barras lado a lado sem rolagem quando há poucas categorias", () => {
    expect(barChartPresentation(8)).toEqual({ scrollable: false, contentWidth: undefined });
  });

  it("habilita rolagem horizontal em bases extensas, mantendo todas as barras juntas", () => {
    expect(barChartPresentation(300)).toEqual({ scrollable: true, contentWidth: 31200 });
  });
});

describe("timeSeriesChartPresentation", () => {
  it("mantém séries curtas na largura do cartão", () => {
    expect(timeSeriesChartPresentation(8)).toEqual({
      scrollable: false,
      contentWidth: undefined,
    });
  });

  it("dá espaço por ponto e habilita navegação em linha e área extensas", () => {
    expect(timeSeriesChartPresentation(24)).toEqual({
      scrollable: true,
      contentWidth: 1728,
    });
  });

  it("usa passo compacto na métrica com tendência", () => {
    expect(timeSeriesChartPresentation(24, true)).toEqual({
      scrollable: true,
      contentWidth: 1056,
    });
  });
});

describe("relevantAggregationOps para categorias", () => {
  it("oferece somente contagem quando a coluna de valor não é numérica", () => {
    expect(
      relevantAggregationOps(
        [
          { Status: "Enviado", Código: "A1" },
          { Status: "Enviado", Código: "A2" },
          { Status: "Pendente", Código: "A3" },
        ],
        "Status",
        "Código",
      ),
    ).toEqual(["count"]);
  });
});
import type { Column, FilterRule, Row } from "@/lib/types";

const numberCol = (key: string, missingRule?: Column["missingRule"]): Column => ({
  key,
  label: key,
  kind: "number",
  visible: true,
  description: "",
  ...(missingRule ? { missingRule } : {}),
});

const textCol = (key: string, missingRule?: Column["missingRule"]): Column => ({
  key,
  label: key,
  kind: "text",
  visible: true,
  description: "",
  ...(missingRule ? { missingRule } : {}),
});

describe("applyMissingRules", () => {
  it("mantém nulos quando a regra é a padrão (ignore)", () => {
    const rows: Row[] = [{ v: null }, { v: 5 }];
    const { rows: result } = applyMissingRules(rows, [numberCol("v")]);
    expect(result[0]?.["v"]).toBeNull();
  });

  it("preenche com zero quando a regra é zero", () => {
    const rows: Row[] = [{ v: null }, { v: 5 }];
    const { rows: result } = applyMissingRules(rows, [numberCol("v", "zero")]);
    expect(result[0]?.["v"]).toBe(0);
    expect(result[1]?.["v"]).toBe(5);
  });

  it("interpola linearmente entre o valor anterior e o seguinte", () => {
    const rows: Row[] = [{ v: 10 }, { v: null }, { v: 30 }];
    const { rows: result, interpolated } = applyMissingRules(rows, [numberCol("v", "interpolate")]);
    expect(result[1]?.["v"]).toBe(20);
    expect(interpolated.has("1-v")).toBe(true);
  });

  it("repete o valor mais próximo quando não há um dos dois lados para interpolar", () => {
    const rows: Row[] = [{ v: null }, { v: 10 }, { v: null }];
    const { rows: result } = applyMissingRules(rows, [numberCol("v", "interpolate")]);
    expect(result[0]?.["v"]).toBe(10);
    expect(result[2]?.["v"]).toBe(10);
  });

  it("remove a linha inteira quando a regra é hide-row, mesmo em coluna de texto", () => {
    const rows: Row[] = [{ nome: "Suzy" }, { nome: null }, { nome: "" }];
    const { rows: result } = applyMissingRules(rows, [textCol("nome", "hide-row")]);
    expect(result).toHaveLength(1);
    expect(result[0]?.["nome"]).toBe("Suzy");
  });

  it("ignora zero/interpolate em colunas não numéricas", () => {
    const rows: Row[] = [{ nome: null }];
    const { rows: result } = applyMissingRules(rows, [textCol("nome", "zero")]);
    expect(result[0]?.["nome"]).toBeNull();
  });
});

describe("detectQualitySignals", () => {
  it("sinaliza linhas duplicadas", () => {
    const rows: Row[] = [{ v: 1 }, { v: 1 }];
    const signals = detectQualitySignals(rows, [numberCol("v")]);
    expect(signals.some((s) => s.kind === "duplicate-rows")).toBe(true);
  });

  it("sinaliza outlier numérico fora de 3 desvios padrão", () => {
    const rows: Row[] = [
      ...Array.from({ length: 10 }, () => ({ v: 1 })),
      { v: 1000 }, // bem fora do padrão em relação ao restante, quase todo em 1
    ];
    const signals = detectQualitySignals(rows, [numberCol("v")]);
    expect(signals.some((s) => s.kind === "outlier" && s.columnKey === "v")).toBe(true);
  });

  it("sinaliza inconsistência de texto (mesmo valor com grafias diferentes)", () => {
    const rows: Row[] = [{ cidade: "Recife" }, { cidade: "recife" }, { cidade: " Recife " }];
    const signals = detectQualitySignals(rows, [textCol("cidade")]);
    expect(signals.some((s) => s.kind === "text-inconsistency" && s.columnKey === "cidade")).toBe(
      true,
    );
  });

  it("não sinaliza nada para dados limpos e consistentes", () => {
    const rows: Row[] = [
      { v: 1, cidade: "Recife" },
      { v: 2, cidade: "Jaboatão" },
    ];
    const signals = detectQualitySignals(rows, [numberCol("v"), textCol("cidade")]);
    expect(signals).toHaveLength(0);
  });
});

describe("aggregate", () => {
  it("soma, calcula média, mínimo e máximo corretamente", () => {
    const values = [1, 2, 3, 4];
    expect(aggregate(values, "sum")).toBe(10);
    expect(aggregate(values, "avg")).toBe(2.5);
    expect(aggregate(values, "min")).toBe(1);
    expect(aggregate(values, "max")).toBe(4);
    expect(aggregate(values, "count")).toBe(4);
  });

  it("retorna 0 para lista vazia, exceto count que também é 0", () => {
    expect(aggregate([], "sum")).toBe(0);
    expect(aggregate([], "avg")).toBe(0);
    expect(aggregate([], "count")).toBe(0);
  });
});

describe("groupAndAggregate", () => {
  it("agrupa por categoria e soma os valores", () => {
    const rows: Row[] = [
      { categoria: "Bolo", valor: 50 },
      { categoria: "Bolo", valor: 30 },
      { categoria: "Doce", valor: 10 },
    ];
    const result = groupAndAggregate(rows, "categoria", "valor", "sum");
    expect(result).toEqual(
      expect.arrayContaining([
        { name: "Bolo", total: 80 },
        { name: "Doce", total: 10 },
      ]),
    );
  });

  it("usa 'Não informado' para valores de agrupamento ausentes", () => {
    const rows: Row[] = [{ categoria: null, valor: 10 }];
    const result = groupAndAggregate(rows, "categoria", "valor", "sum");
    expect(result[0]?.name).toBe(NOT_INFORMED);
  });

  it("descarta grupos sem nenhum valor numérico válido (não mostra barra zerada)", () => {
    const rows: Row[] = [
      { categoria: "Empresa A", valor: 10 },
      { categoria: "Empresa B", valor: null }, // sem dado, não é zero
      { categoria: "Empresa B", valor: "" },
      { categoria: null, valor: null },
    ];
    const result = groupAndAggregate(rows, "categoria", "valor", "sum");
    expect(result).toEqual([{ name: "Empresa A", total: 10 }]);
  });

  it("na operação 'count', conta linhas do grupo mesmo sem valor numérico preenchido", () => {
    const rows: Row[] = [
      { categoria: "Empresa A", valor: 10 },
      { categoria: "Empresa B", valor: null },
      { categoria: "Empresa B", valor: null },
    ];
    const result = groupAndAggregate(rows, "categoria", "valor", "count");
    expect(result).toEqual(
      expect.arrayContaining([
        { name: "Empresa A", total: 1 },
        { name: "Empresa B", total: 2 },
      ]),
    );
  });
});

describe("relevantAggregationOps", () => {
  it("oferece somente operações estáveis quando algum grupo tem mais de 1 valor numérico", () => {
    const rows: Row[] = [
      { vendedor: "Ana", valor: 100 },
      { vendedor: "Ana", valor: 200 },
      { vendedor: "Bia", valor: 50 },
    ];
    expect(relevantAggregationOps(rows, "vendedor", "valor")).toEqual([
      "sum",
      "avg",
      "count",
      "min",
      "max",
    ]);
  });

  it("reproduz o caso relatado: aba 'Resumo' com 1 linha por vendedor, só 'Soma' faz sentido", () => {
    // Uma linha já pré-agregada por vendedor (ex: "Gabriel: 18 vendas") não
    // tem o que somar/multiplicar/dividir de verdade — todas essas
    // operações dariam o mesmo número (o próprio valor), então só "Soma"
    // (mostrando o valor) deve aparecer.
    const rows: Row[] = [
      { vendedor: "Gabriel", vendas: 18 },
      { vendedor: "Bruno", vendas: 26 },
      { vendedor: "Amanda", vendas: 15 },
    ];
    expect(relevantAggregationOps(rows, "vendedor", "vendas")).toEqual(["sum"]);
  });

  it("mostra 'Soma' e 'Contagem' quando os grupos têm várias linhas mas no máximo 1 valor preenchido", () => {
    const rows: Row[] = [
      { vendedor: "Gabriel", comissao: 50 },
      { vendedor: "Gabriel", comissao: null },
      { vendedor: "Bruno", comissao: null },
    ];
    expect(relevantAggregationOps(rows, "vendedor", "comissao")).toEqual(["sum", "count"]);
  });

  it("não quebra com uma base vazia", () => {
    expect(relevantAggregationOps([], "vendedor", "vendas")).toEqual(["sum"]);
  });
});

describe("leftJoin", () => {
  it("copia campos da segunda planilha quando há correspondência (sem diferenciar maiúsculas)", () => {
    const base: Row[] = [{ cliente: "Suzy" }, { cliente: "ana" }];
    const other: Row[] = [{ nome: "SUZY", telefone: "8199999" }];
    const { rows, addedKeys } = leftJoin(base, "cliente", other, "nome", ["cliente"]);
    expect(addedKeys).toEqual(["telefone"]);
    expect(rows[0]?.["telefone"]).toBe("8199999");
    expect(rows[1]?.["telefone"]).toBeNull();
  });

  it("renomeia colunas da segunda planilha que colidem com colunas já existentes", () => {
    const base: Row[] = [{ cliente: "Suzy", telefone: "0000" }];
    const other: Row[] = [{ nome: "Suzy", telefone: "8199999" }];
    const { addedKeys, rows } = leftJoin(base, "cliente", other, "nome", ["cliente", "telefone"]);
    expect(addedKeys).toEqual(["telefone_2"]);
    expect(rows[0]?.["telefone"]).toBe("0000");
    expect(rows[0]?.["telefone_2"]).toBe("8199999");
  });

  it("não perde nem duplica linhas da base quando não há correspondência", () => {
    const base: Row[] = [{ cliente: "Suzy" }, { cliente: "Lucas" }];
    const other: Row[] = [{ nome: "Outro Nome", telefone: "111" }];
    const { rows } = leftJoin(base, "cliente", other, "nome", ["cliente"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.["telefone"]).toBeNull();
    expect(rows[1]?.["telefone"]).toBeNull();
  });
});

describe("toggleClickFilter", () => {
  it("adiciona um filtro novo quando não havia filtro nessa coluna", () => {
    const result = toggleClickFilter([], "regiao", "Sul");
    expect(result).toEqual([{ key: "regiao", value: "Sul", min: "", max: "" }]);
  });

  it("remove o filtro ao clicar de novo no mesmo valor (alterna)", () => {
    const filters: FilterRule[] = [{ key: "regiao", value: "Sul", min: "", max: "" }];
    const result = toggleClickFilter(filters, "regiao", "Sul");
    expect(result).toEqual([]);
  });

  it("troca o valor do filtro da mesma coluna ao clicar em outro valor", () => {
    const filters: FilterRule[] = [{ key: "regiao", value: "Sul", min: "", max: "" }];
    const result = toggleClickFilter(filters, "regiao", "Norte");
    expect(result).toEqual([{ key: "regiao", value: "Norte", min: "", max: "" }]);
  });

  it("mantém filtros de outras colunas intactos (cross-filter combinando widgets)", () => {
    const filters: FilterRule[] = [{ key: "mes", value: "Janeiro", min: "", max: "" }];
    const result = toggleClickFilter(filters, "regiao", "Sul");
    expect(result).toEqual([
      { key: "mes", value: "Janeiro", min: "", max: "" },
      { key: "regiao", value: "Sul", min: "", max: "" },
    ]);
  });
});

describe("pieRoundnessFor", () => {
  it("mantém o arredondamento padrão quando as fatias são grandes o suficiente", () => {
    const series = [{ total: 50 }, { total: 30 }, { total: 20 }];
    expect(pieRoundnessFor(series)).toEqual({ cornerRadius: 6, paddingAngle: 3 });
  });

  it("reduz o arredondamento quando a menor fatia é fina demais (< 3% do total)", () => {
    // Reproduz o caso real relatado: uma coluna de alta cardinalidade (ex.:
    // ID único por linha) onde o "top 5 + Outros" ainda deixa fatias
    // minúsculas — sem reduzir, o cornerRadius fixo faz essas fatias
    // virarem traços soltos flutuando fora do anel em vez de fatias.
    const series = [
      { total: 5 },
      { total: 5 },
      { total: 5 },
      { total: 5 },
      { total: 5 },
      { total: 446 },
    ];
    expect(pieRoundnessFor(series)).toEqual({ cornerRadius: 0, paddingAngle: 1 });
  });

  it("não quebra com série vazia ou total zero", () => {
    expect(pieRoundnessFor([])).toEqual({ cornerRadius: 6, paddingAngle: 3 });
    expect(pieRoundnessFor([{ total: 0 }, { total: 0 }])).toEqual({
      cornerRadius: 6,
      paddingAngle: 3,
    });
  });
});
