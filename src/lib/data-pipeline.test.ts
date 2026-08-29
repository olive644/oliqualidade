import { describe, expect, it } from "vitest";

import {
  aggregate,
  applyMissingRules,
  axisLabelPresentation,
  compactDateAxisLabel,
  barChartPresentation,
  barValueLabelsFit,
  buildAreaComparisonSeries,
  chartSeries,
  collapsePieSeries,
  boxPlotStats,
  detectQualitySignals,
  filterDashboardRows,
  groupAndAggregate,
  histogramBins,
  histogramBinsWithData,
  linearTrend,
  paretoSeries,
  pearsonCorrelation,
  scatterPoints,
  leftJoin,
  limitChartSeriesForRendering,
  matchesRange,
  pieComparisonFor,
  pieRoundnessFor,
  rankingCoverageFor,
  relevantAggregationOps,
  resolveSemanticAggregationOp,
  semanticAggregationOps,
  seriesAverage,
  sortAllBarCategories,
  sortBarCategories,
  timeSeriesChartPresentation,
  toggleClickFilter,
  trendSummaryFor,
} from "@/lib/data-pipeline";
import { markSourceRows } from "@/lib/data-review";

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

  it("carrega o índice de origem estável de cada ponto, quando as linhas vêm do pipeline real", () => {
    const traceable = markSourceRows(rows);
    const series = chartSeries(traceable, "categoria", "valor", "sum", "raw");
    expect(series.map((point) => point.sourceRowIndex)).toEqual([0, 1, 2]);
    // sourceRow (posição no array atual) e sourceRowIndex (índice estável)
    // coincidem aqui porque nada foi filtrado/reordenado; a diferença entre
    // os dois só aparece quando há filtro, busca ou ordenação ativos.
    expect(series.map((point) => point.sourceRow)).toEqual([1, 2, 3]);
  });

  it("não inclui sourceRowIndex fora do pipeline real (linhas sem markSourceRows)", () => {
    const series = chartSeries(rows, "categoria", "valor", "sum", "raw");
    expect(series.every((point) => !("sourceRowIndex" in point))).toBe(true);
  });

  it("combina categorias somente quando o modo agrupado é escolhido", () => {
    expect(chartSeries(rows, "categoria", "valor", "sum", "aggregate")).toEqual([
      { name: "A", total: 30, count: 2 },
      { name: "B", total: 5, count: 1 },
    ]);
  });

  it("não cria pontos para categorias vazias no modo original", () => {
    const rowsWithMissingGroups: Row[] = [
      { categoria: "A", valor: 10 },
      { categoria: null, valor: 20 },
      { categoria: "", valor: 30 },
      { categoria: "   ", valor: 40 },
    ];

    expect(chartSeries(rowsWithMissingGroups, "categoria", "valor", "sum", "raw")).toEqual([
      { name: "A", total: 10, sourceRow: 1 },
    ]);
  });

  it("inclui valores em notação brasileira (vírgula decimal), em vez de descartá-los silenciosamente", () => {
    // Bug real reportado com uma planilha de laboratório: colunas numéricas
    // com valores como "0,69" (texto, vírgula decimal) eram excluídas da
    // série porque Number("0,69") é NaN — o gráfico simplesmente não
    // mostrava esses pontos, sem nenhum aviso.
    const rowsWithText: Row[] = [
      { categoria: "A", valor: "0,69" },
      { categoria: "A", valor: "1.234,5" },
      { categoria: "B", valor: "N/A" },
    ];
    expect(chartSeries(rowsWithText, "categoria", "valor", "sum", "raw")).toEqual([
      { name: "A", total: 0.69, sourceRow: 1 },
      { name: "A", total: 1234.5, sourceRow: 2 },
    ]);
  });
});

describe("buildAreaComparisonSeries", () => {
  const series = [
    { name: "Jan", total: 10 },
    { name: "Fev", total: 15 },
    { name: "Mar", total: 8 },
  ];

  it("separa variações acima e abaixo do período anterior", () => {
    const compared = buildAreaComparisonSeries(series, "previous");
    expect(compared.map((point) => point.difference)).toEqual([0, 5, -7]);
    expect(compared.map((point) => point.aboveReference)).toEqual([0, 5, 0]);
    expect(compared.map((point) => point.belowReference)).toEqual([0, 0, -7]);
  });

  it("preserva a leitura quando os próprios resultados são negativos", () => {
    const compared = buildAreaComparisonSeries(
      [
        { name: "Jan", total: -10 },
        { name: "Fev", total: -4 },
        { name: "Mar", total: -12 },
      ],
      "previous",
    );
    expect(compared.map((point) => point.difference)).toEqual([0, 6, -8]);
  });

  it("usa a meta por período e recua para o período anterior quando ela falta", () => {
    const compared = buildAreaComparisonSeries(
      series,
      "goal",
      new Map([
        ["Jan", 12],
        ["Fev", 14],
      ]),
    );
    expect(compared.map((point) => point.reference)).toEqual([12, 14, 15]);
    expect(compared.map((point) => point.difference)).toEqual([-2, 1, -7]);
  });

  it("calcula a média móvel apenas com períodos anteriores", () => {
    const compared = buildAreaComparisonSeries(series, "moving-average");
    expect(compared.map((point) => point.reference)).toEqual([10, 10, 12.5]);
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

describe("sortBarCategories", () => {
  const serie = (names: string[]) => names.map((name, index) => ({ name, total: index + 1 }));

  it("mantém a ordem natural de meses no modo automático, em vez de ordenar por tamanho", () => {
    const result = sortBarCategories(serie(["Março", "Janeiro", "Fevereiro"]));
    expect(result.series.map((entry) => entry.name)).toEqual(["Janeiro", "Fevereiro", "Março"]);
    expect(result.applied).toBe("natural");
    expect(result.ordinal).toBe(true);
  });

  it("ordena por valor no modo automático quando as categorias não formam sequência", () => {
    const result = sortBarCategories([
      { name: "Linha A", total: 10 },
      { name: "Linha B", total: 40 },
      { name: "Linha C", total: 25 },
    ]);
    expect(result.series.map((entry) => entry.name)).toEqual(["Linha B", "Linha C", "Linha A"]);
    expect(result.applied).toBe("value");
    expect(result.ordinal).toBe(false);
  });

  it("respeita a escolha explícita de ordenar por valor mesmo em categorias ordinais", () => {
    const result = sortBarCategories(
      [
        { name: "Janeiro", total: 5 },
        { name: "Fevereiro", total: 50 },
        { name: "Março", total: 20 },
      ],
      "value",
    );
    expect(result.series.map((entry) => entry.name)).toEqual(["Fevereiro", "Março", "Janeiro"]);
    expect(result.applied).toBe("value");
    // A sequência continua existindo; só não foi usada nesta ordenação.
    expect(result.ordinal).toBe(true);
  });

  it("ordena alfabeticamente respeitando acentos do português", () => {
    const result = sortBarCategories(serie(["Ácido", "Base", "Álcool"]), "alphabetical");
    expect(result.series.map((entry) => entry.name)).toEqual(["Ácido", "Álcool", "Base"]);
  });

  it("preserva a ordem da planilha quando pedem ordem natural sem sequência reconhecida", () => {
    const result = sortBarCategories(serie(["Linha C", "Linha A", "Linha B"]), "natural");
    expect(result.series.map((entry) => entry.name)).toEqual(["Linha C", "Linha A", "Linha B"]);
    expect(result.ordinal).toBe(false);
  });

  it("não altera o array recebido", () => {
    const original = serie(["Março", "Janeiro", "Fevereiro"]);
    sortBarCategories(original);
    expect(original.map((entry) => entry.name)).toEqual(["Março", "Janeiro", "Fevereiro"]);
  });
});

describe("seriesAverage", () => {
  it("devolve a média entre as categorias", () => {
    expect(seriesAverage([{ total: 10 }, { total: 20 }, { total: 60 }])).toBe(30);
  });

  it("considera valores negativos, sem tratá-los como distância", () => {
    expect(seriesAverage([{ total: -30 }, { total: 30 }, { total: 30 }])).toBe(10);
  });

  it("não desenha média com menos de três categorias", () => {
    // Com uma barra a média é a própria barra; com duas ela cai exatamente
    // entre as duas. Nos dois casos a linha não separa ninguém em "acima" e
    // "abaixo", só polui o gráfico.
    expect(seriesAverage([{ total: 10 }])).toBeNull();
    expect(seriesAverage([{ total: 10 }, { total: 20 }])).toBeNull();
    expect(seriesAverage([])).toBeNull();
  });
});

describe("barValueLabelsFit", () => {
  it("usa a largura medida quando ela existe, no lugar da estimativa por span", () => {
    // Mesmo widget de um terço: pela estimativa (150px) oito rótulos de oito
    // caracteres não caberiam, mas o navegador informou 600px de plotagem.
    expect(
      barValueLabelsFit({
        count: 8,
        scrollable: false,
        longestLabelChars: 8,
        span: 1,
        plotWidth: 600,
      }),
    ).toBe(true);
  });

  it("esconde o rótulo quando a medida real é menor que a estimativa", () => {
    expect(
      barValueLabelsFit({
        count: 4,
        scrollable: false,
        longestLabelChars: 8,
        span: 3,
        plotWidth: 120,
      }),
    ).toBe(false);
  });

  it("mostra os valores quando poucas barras dividem um cartão largo", () => {
    expect(barValueLabelsFit({ count: 4, scrollable: false, longestLabelChars: 6, span: 3 })).toBe(
      true,
    );
  });

  it("esconde os valores quando as barras dividem um cartão estreito", () => {
    // Oito barras num cartão de um terço deixam cerca de 30px por barra:
    // "1.234,56" não cabe e os números viram uma faixa sobreposta.
    expect(barValueLabelsFit({ count: 8, scrollable: false, longestLabelChars: 8, span: 1 })).toBe(
      false,
    );
  });

  it("mantém os valores quando o gráfico rola, porque cada barra tem fatia fixa", () => {
    expect(barValueLabelsFit({ count: 300, scrollable: true, longestLabelChars: 8, span: 1 })).toBe(
      true,
    );
  });

  it("esconde os valores mesmo com rolagem quando o rótulo é largo demais para a fatia", () => {
    expect(
      barValueLabelsFit({ count: 300, scrollable: true, longestLabelChars: 20, span: 3 }),
    ).toBe(false);
  });

  it("não tenta desenhar rótulo em gráfico sem categoria", () => {
    expect(barValueLabelsFit({ count: 0, scrollable: false, longestLabelChars: 3, span: 3 })).toBe(
      false,
    );
  });
});

describe("axisLabelPresentation", () => {
  it("corta e pula rótulos pela largura medida, não pela estimativa do span", () => {
    const medido = axisLabelPresentation({
      count: 6,
      scrollable: false,
      span: 1,
      slotPx: 88,
      plotWidth: 600,
    });
    expect(medido).toEqual({ maxChars: 10, interval: 0 });
  });

  it("pula rótulos quando nem o corte mínimo cabe entre as barras", () => {
    // Caso real: seis categorias de um orçamento pessoal em um cartão de um
    // terço deixam cerca de 24px por barra, e mesmo "Hip…" ocupa 28px. Ler
    // três nomes inteiros é melhor que ler seis pedaços sobrepostos.
    //
    // São seis caracteres, e não sete, porque o orçamento passou a reservar
    // uma folga entre um rótulo e o vizinho. Sem ela o cálculo dizia que o
    // rótulo cabia ocupando a fatia inteira, encostado no seguinte, e nas
    // pontas do eixo — que usam âncora `start` e `end` para não vazar do SVG —
    // isso virava sobreposição de verdade.
    expect(axisLabelPresentation({ count: 6, scrollable: false, span: 1, slotPx: 88 })).toEqual({
      maxChars: 6,
      interval: 1,
    });
  });

  it("reserva folga entre um rótulo e o vizinho, e não só a largura dele", () => {
    // Com fatia de 65px e 6,5px por caractere, dez caracteres ocupam a fatia
    // inteira. O orçamento antigo dizia que cabiam dez; o novo desconta a
    // folga e diz oito, que é o que de fato cabe sem encostar.
    expect(
      axisLabelPresentation({ count: 10, scrollable: false, span: 3, slotPx: 65, plotWidth: 650 }),
    ).toEqual({ maxChars: 8, interval: 0 });
  });

  it("mostra todos os rótulos inteiros quando há espaço de sobra", () => {
    expect(axisLabelPresentation({ count: 4, scrollable: false, span: 3, slotPx: 88 })).toEqual({
      maxChars: 10,
      interval: 0,
    });
  });

  it("usa a fatia fixa quando o gráfico rola, não a largura do cartão", () => {
    expect(axisLabelPresentation({ count: 300, scrollable: true, span: 1, slotPx: 88 })).toEqual({
      maxChars: 10,
      interval: 0,
    });
  });

  it("nunca corta abaixo de quatro caracteres, que já não identificam nada", () => {
    const denso = axisLabelPresentation({ count: 40, scrollable: false, span: 1, slotPx: 88 });
    expect(denso.maxChars).toBeGreaterThanOrEqual(4);
    expect(denso.interval).toBeGreaterThan(0);
  });
});

describe("barChartPresentation", () => {
  it("mantém barras lado a lado sem rolagem quando há poucas categorias", () => {
    expect(barChartPresentation(8)).toEqual({ scrollable: false, contentWidth: undefined });
  });

  it("habilita rolagem horizontal em bases extensas, mantendo todas as barras juntas", () => {
    expect(barChartPresentation(300)).toEqual({ scrollable: true, contentWidth: 26400 });
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

  it("interpola entre valores em notação brasileira (vírgula decimal) sem virar NaN", () => {
    const rows: Row[] = [{ v: "0,10" }, { v: null }, { v: "0,30" }];
    const { rows: result } = applyMissingRules(rows, [numberCol("v", "interpolate")]);
    expect(result[1]?.["v"]).toBeCloseTo(0.2, 10);
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
        { name: "Bolo", total: 80, count: 2 },
        { name: "Doce", total: 10, count: 1 },
      ]),
    );
  });

  it("conta os valores que entraram na conta, não as linhas do grupo", () => {
    // A barra de "Empresa B" é sustentada por um único valor, mesmo tendo
    // duas linhas: a linha sem métrica não entra na soma nem na média, e
    // contá-la faria a barra parecer mais apoiada do que é.
    const rows: Row[] = [
      { categoria: "Empresa A", valor: 10 },
      { categoria: "Empresa A", valor: 20 },
      { categoria: "Empresa B", valor: 30 },
      { categoria: "Empresa B", valor: null },
    ];
    const result = groupAndAggregate(rows, "categoria", "valor", "sum");
    expect(result.find((g) => g.name === "Empresa A")?.count).toBe(2);
    expect(result.find((g) => g.name === "Empresa B")?.count).toBe(1);
  });

  it("ignora valores de agrupamento ausentes em vez de criar 'Não informado'", () => {
    const rows: Row[] = [
      { categoria: null, valor: 10 },
      { categoria: "", valor: 20 },
      { categoria: "   ", valor: 30 },
    ];
    const result = groupAndAggregate(rows, "categoria", "valor", "sum");
    expect(result).toEqual([]);
  });

  it("descarta grupos sem nenhum valor numérico válido (não mostra barra zerada)", () => {
    const rows: Row[] = [
      { categoria: "Empresa A", valor: 10 },
      { categoria: "Empresa B", valor: null }, // sem dado, não é zero
      { categoria: "Empresa B", valor: "" },
      { categoria: null, valor: null },
    ];
    const result = groupAndAggregate(rows, "categoria", "valor", "sum");
    expect(result).toEqual([{ name: "Empresa A", total: 10, count: 1 }]);
  });

  it("soma valores em notação brasileira (vírgula decimal) armazenados como texto", () => {
    const rows: Row[] = [
      { categoria: "Turbidez", valor: "0,69" },
      { categoria: "Turbidez", valor: "0,46" },
    ];
    const result = groupAndAggregate(rows, "categoria", "valor", "sum");
    expect(result[0]?.total).toBeCloseTo(1.15, 10);
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
        { name: "Empresa A", total: 1, count: 1 },
        { name: "Empresa B", total: 2, count: 2 },
      ]),
    );
  });

  it("carrega o índice de origem estável de cada linha que entrou no bucket, quando disponível", () => {
    const rows = markSourceRows([
      { categoria: "Bolo", valor: 50 },
      { categoria: "Bolo", valor: "texto" }, // conta pra rowCount, não pro valor
      { categoria: "Doce", valor: 10 },
    ]);
    const bySoma = groupAndAggregate(rows, "categoria", "valor", "sum");
    expect(bySoma.find((g) => g.name === "Bolo")?.sourceRowIndexes).toEqual([0]);
    expect(bySoma.find((g) => g.name === "Doce")?.sourceRowIndexes).toEqual([2]);

    const porContagem = groupAndAggregate(rows, "categoria", "valor", "count");
    expect(porContagem.find((g) => g.name === "Bolo")?.sourceRowIndexes).toEqual([0, 1]);
  });

  it("não inclui sourceRowIndexes quando as linhas não vêm do pipeline real (markSourceRows)", () => {
    const rows: Row[] = [{ categoria: "Bolo", valor: 50 }];
    const result = groupAndAggregate(rows, "categoria", "valor", "sum");
    expect(result[0]).toEqual({ name: "Bolo", total: 50, count: 1 });
    expect(result[0]).not.toHaveProperty("sourceRowIndexes");
  });
});

describe("histogramBins", () => {
  it("divide valores em faixas de largura igual, cobrindo min e max", () => {
    const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({ valor: i })); // 0..19
    const bins = histogramBins(rows, "valor", 4);
    expect(bins).toHaveLength(4);
    expect(bins[0]!.rangeStart).toBe(0);
    expect(bins.at(-1)!.rangeEnd).toBe(19);
    expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(20);
    // Faixas contíguas: o fim de uma é o início da próxima.
    for (let i = 1; i < bins.length; i++) {
      expect(bins[i]!.rangeStart).toBe(bins[i - 1]!.rangeEnd);
    }
  });

  it("ignora valores ausentes ou não numéricos", () => {
    const rows: Row[] = [
      { valor: 10 },
      { valor: null },
      { valor: "" },
      { valor: "texto" },
      { valor: 20 },
    ];
    const bins = histogramBins(rows, "valor", 2);
    expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(2);
  });

  it("volta vazio quando não sobra nenhum valor numérico válido", () => {
    const rows: Row[] = [{ valor: null }, { valor: "" }];
    expect(histogramBins(rows, "valor")).toEqual([]);
  });

  it("produz uma única faixa quando todos os valores são iguais", () => {
    const rows: Row[] = [{ valor: 5 }, { valor: 5 }, { valor: 5 }];
    const bins = histogramBins(rows, "valor");
    expect(bins).toHaveLength(1);
    expect(bins[0]).toMatchObject({ rangeStart: 5, rangeEnd: 5, count: 3 });
  });

  it("usa a regra de Sturges quando binCount não é informado, com teto e piso", () => {
    const oneRow: Row[] = [{ valor: 1 }, { valor: 2 }];
    expect(histogramBins(oneRow, "valor").length).toBeGreaterThanOrEqual(1);

    const manyRows: Row[] = Array.from({ length: 10_000 }, (_, i) => ({ valor: i }));
    const bins = histogramBins(manyRows, "valor");
    expect(bins.length).toBeLessThanOrEqual(20);
    expect(bins.length).toBeGreaterThanOrEqual(5);
  });

  it("não intercala faixas zeradas quando a coluna automática tem poucos valores discretos", () => {
    const frequencies = [30, 25, 27, 31, 37];
    const rows: Row[] = frequencies.flatMap((frequency, index) =>
      Array.from({ length: frequency }, () => ({ valor: index + 1 })),
    );

    const bins = histogramBins(rows, "valor");

    expect(bins.map((bin) => bin.label)).toEqual(["1", "2", "3", "4", "5"]);
    expect(bins.map((bin) => bin.count)).toEqual(frequencies);
    expect(bins.every((bin) => bin.count > 0 && bin.rangeStart === bin.rangeEnd)).toBe(true);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(150);
  });

  it("corrige uma quantidade persistida maior que os valores distintos", () => {
    const rows: Row[] = Array.from({ length: 150 }, (_, index) => ({ valor: (index % 5) + 1 }));
    const bins = histogramBins(rows, "valor", 20);

    expect(bins.map((bin) => bin.label)).toEqual(["1", "2", "3", "4", "5"]);
    expect(bins).toHaveLength(5);
    expect(bins.every((bin) => bin.count === 30)).toBe(true);
  });

  it("respeita uma quantidade manual menor que os valores distintos", () => {
    const rows: Row[] = Array.from({ length: 80 }, (_, index) => ({ valor: (index % 8) + 1 }));
    expect(histogramBins(rows, "valor", 5)).toHaveLength(5);
  });

  it("omite faixas vazias somente da apresentação do histograma", () => {
    const bins = histogramBins(
      [{ valor: 0 }, { valor: 1 }, { valor: 2 }, { valor: 8 }, { valor: 9 }, { valor: 10 }],
      "valor",
      5,
    );

    expect(bins.some((bin) => bin.count === 0)).toBe(true);
    expect(histogramBinsWithData(bins).every((bin) => bin.count > 0)).toBe(true);
  });

  it("carrega o índice de origem estável de cada linha por faixa, quando disponível", () => {
    const rows = markSourceRows([{ valor: 1 }, { valor: 2 }, { valor: 9 }, { valor: 10 }]);
    const bins = histogramBins(rows, "valor", 2);
    expect(bins[0]?.sourceRowIndexes).toEqual([0, 1]);
    expect(bins[1]?.sourceRowIndexes).toEqual([2, 3]);
  });
});

describe("boxPlotStats", () => {
  it("calcula quartis pelo método clássico (mediana exclui as duas metades quando n é ímpar)", () => {
    const rows: Row[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((valor) => ({ categoria: "A", valor }));
    const [stats] = boxPlotStats(rows, "categoria", "valor");
    expect(stats).toMatchObject({ min: 1, q1: 2.5, median: 5, q3: 7.5, max: 9, outliers: [] });
  });

  it("calcula quartis com quantidade par de valores", () => {
    const rows: Row[] = [1, 2, 3, 4, 5, 6, 7, 8].map((valor) => ({ categoria: "A", valor }));
    const [stats] = boxPlotStats(rows, "categoria", "valor");
    expect(stats).toMatchObject({ min: 1, q1: 2.5, median: 4.5, q3: 6.5, max: 8 });
  });

  it("identifica valores fora da cerca de Tukey como outliers, sem contar no min/max do whisker", () => {
    const rows: Row[] = [
      { categoria: "A", valor: 1 },
      { categoria: "A", valor: 2 },
      { categoria: "A", valor: 3 },
      { categoria: "A", valor: 4 },
      { categoria: "A", valor: 5 },
      { categoria: "A", valor: 6 },
      { categoria: "A", valor: 7 },
      { categoria: "A", valor: 100 }, // muito acima de Q3 + 1.5×IQR
    ];
    const [stats] = boxPlotStats(rows, "categoria", "valor");
    expect(stats?.outliers).toEqual([100]);
    expect(stats?.max).toBe(7); // whisker máximo é o maior valor que não é outlier
    expect(stats?.count).toBe(8); // outlier continua contando na amostra
  });

  it("calcula uma caixa por categoria, ignorando linhas sem categoria ou sem valor numérico", () => {
    const rows: Row[] = [
      { categoria: "Bolo", valor: 10 },
      { categoria: "Bolo", valor: 20 },
      { categoria: "Doce", valor: 5 },
      { categoria: null, valor: 99 },
      { categoria: "Bolo", valor: null },
    ];
    const stats = boxPlotStats(rows, "categoria", "valor");
    expect(stats).toHaveLength(2);
    expect(stats.find((s) => s.name === "Bolo")?.count).toBe(2);
    expect(stats.find((s) => s.name === "Doce")).toMatchObject({
      min: 5,
      q1: 5,
      median: 5,
      q3: 5,
      max: 5,
      count: 1,
    });
  });

  it("carrega o índice de origem estável de cada linha por categoria, quando disponível", () => {
    const rows = markSourceRows([
      { categoria: "Bolo", valor: 10 },
      { categoria: "Doce", valor: 5 },
      { categoria: "Bolo", valor: 20 },
    ]);
    const stats = boxPlotStats(rows, "categoria", "valor");
    expect(stats.find((s) => s.name === "Bolo")?.sourceRowIndexes).toEqual([0, 2]);
  });
});

describe("paretoSeries", () => {
  it("ordena da maior para a menor contribuição e acumula a participação", () => {
    const rows: Row[] = [
      { causa: "A", ocorrencias: 50 },
      { causa: "B", ocorrencias: 30 },
      { causa: "C", ocorrencias: 15 },
      { causa: "D", ocorrencias: 5 },
    ];
    const series = paretoSeries(rows, "causa", "ocorrencias", "sum");
    expect(series.map((e) => e.name)).toEqual(["A", "B", "C", "D"]);
    expect(series.map((e) => e.total)).toEqual([50, 30, 15, 5]);
    expect(series.map((e) => e.cumulativeShare)).toEqual([0.5, 0.8, 0.95, 1]);
  });

  it("descarta categorias com total zero ou negativo (não fazem sentido como 'causa')", () => {
    const rows: Row[] = [
      { causa: "A", ocorrencias: 10 },
      { causa: "B", ocorrencias: 0 },
      { causa: "C", ocorrencias: -5 },
    ];
    const series = paretoSeries(rows, "causa", "ocorrencias", "sum");
    expect(series.map((e) => e.name)).toEqual(["A"]);
    expect(series[0]?.cumulativeShare).toBe(1);
  });

  it("volta vazio sem nenhuma categoria com contribuição positiva", () => {
    const rows: Row[] = [{ causa: "A", ocorrencias: 0 }];
    expect(paretoSeries(rows, "causa", "ocorrencias", "sum")).toEqual([]);
  });

  it("carrega o índice de origem estável por categoria, quando disponível", () => {
    const rows = markSourceRows([
      { causa: "A", ocorrencias: 50 },
      { causa: "B", ocorrencias: 10 },
      { causa: "A", ocorrencias: 20 },
    ]);
    const series = paretoSeries(rows, "causa", "ocorrencias", "sum");
    expect(series.find((e) => e.name === "A")?.sourceRowIndexes).toEqual([0, 2]);
  });
});

describe("scatterPoints", () => {
  it("emparelha as duas colunas numéricas, descartando linha com qualquer uma vazia", () => {
    const rows: Row[] = [
      { x: 1, y: 2 },
      { x: 2, y: null },
      { x: null, y: 4 },
      { x: 3, y: 6 },
    ];
    const points = scatterPoints(rows, "x", "y");
    expect(points).toEqual([
      { x: 1, y: 2, sourceRowIndex: null },
      { x: 3, y: 6, sourceRowIndex: null },
    ]);
  });

  it("carrega o índice de origem estável, quando disponível", () => {
    const rows = markSourceRows([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
    ]);
    const points = scatterPoints(rows, "x", "y");
    expect(points.map((p) => p.sourceRowIndex)).toEqual([0, 1]);
  });
});

describe("linearTrend e pearsonCorrelation", () => {
  it("acha a reta exata e correlação 1 para pontos perfeitamente alinhados (y = 2x + 1)", () => {
    const points = [1, 2, 3, 4, 5].map((x) => ({ x, y: 2 * x + 1 }));
    expect(linearTrend(points)).toMatchObject({ slope: 2, intercept: 1 });
    expect(pearsonCorrelation(points)).toBeCloseTo(1, 10);
  });

  it("acha correlação -1 para relação inversa perfeita", () => {
    const points = [1, 2, 3, 4].map((x) => ({ x, y: -3 * x + 10 }));
    expect(pearsonCorrelation(points)).toBeCloseTo(-1, 10);
    expect(linearTrend(points)).toMatchObject({ slope: -3, intercept: 10 });
  });

  it("volta null com menos de 2 pontos", () => {
    expect(linearTrend([{ x: 1, y: 1 }])).toBeNull();
    expect(pearsonCorrelation([])).toBeNull();
  });

  it("volta null (não zero) quando X não varia — inclinação/correlação indefinidas, não ausência de relação", () => {
    const points = [
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 5, y: 3 },
    ];
    expect(linearTrend(points)).toBeNull();
    expect(pearsonCorrelation(points)).toBeNull();
  });

  it("volta null quando Y não varia (correlação indefinida, ainda que X varie)", () => {
    const points = [
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
    ];
    expect(pearsonCorrelation(points)).toBeNull();
    // A reta ainda é definida aqui (X varia): uma reta horizontal, slope 0.
    expect(linearTrend(points)).toMatchObject({ slope: 0, intercept: 5 });
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

  it("não deixa categorias vazias influenciarem as operações oferecidas", () => {
    const rows: Row[] = [
      { vendedor: "Ana", vendas: 10 },
      { vendedor: null, vendas: 20 },
      { vendedor: null, vendas: 30 },
    ];
    expect(relevantAggregationOps(rows, "vendedor", "vendas")).toEqual(["sum"]);
  });

  it("não quebra com uma base vazia", () => {
    expect(relevantAggregationOps([], "vendedor", "vendas")).toEqual(["sum"]);
  });
});

describe("semanticAggregationOps", () => {
  const operations = ["sum", "avg", "count", "min", "max"] as const;

  it("remove soma de percentuais, taxas e resultados de laboratório", () => {
    expect(
      semanticAggregationOps(
        [...operations],
        { kind: "percentage", label: "Taxa de aprovação" },
        { role: "result", unitFamily: "percentage", aggregable: true },
      ),
    ).toEqual(["avg", "count", "min", "max"]);
    expect(
      semanticAggregationOps(
        [...operations],
        { kind: "number", label: "Resultado microbiológico" },
        { role: "result", unitFamily: "concentration", aggregable: true },
      ),
    ).toEqual(["avg", "count", "min", "max"]);
  });

  it("mantém soma para quantidades, totais e valores aditivos", () => {
    expect(
      semanticAggregationOps(
        [...operations],
        { kind: "currency", label: "Receita total" },
        { role: "total", unitFamily: "currency", aggregable: true },
      ),
    ).toEqual([...operations]);
  });

  it("oferece somente contagem para coluna não agregável", () => {
    expect(
      semanticAggregationOps(
        [...operations],
        { kind: "number", label: "Código numérico" },
        { role: "identifier", unitFamily: "count", aggregable: false },
      ),
    ).toEqual(["count"]);
  });

  it("resolve a operação solicitada com a mesma proteção semântica usada pelos gráficos", () => {
    expect(
      resolveSemanticAggregationOp(
        [...operations],
        { kind: "percentage", label: "Taxa de aprovação" },
        { role: "result", unitFamily: "percentage", aggregable: true },
        "sum",
      ),
    ).toBe("avg");
    expect(
      resolveSemanticAggregationOp(
        [...operations],
        { kind: "currency", label: "Receita total" },
        { role: "total", unitFamily: "currency", aggregable: true },
        "sum",
      ),
    ).toBe("sum");
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

describe("collapsePieSeries", () => {
  it("mantém a série intacta quando já tem 6 categorias ou menos", () => {
    const series = [
      { name: "Norte", total: 50 },
      { name: "Sul", total: 30 },
      { name: "Leste", total: 20 },
    ];
    expect(collapsePieSeries(series)).toEqual(series);
  });

  it("reduz para top 5 + Outros quando há mais de 6 categorias", () => {
    const series = [
      { name: "A", total: 100 },
      { name: "B", total: 90 },
      { name: "C", total: 80 },
      { name: "D", total: 70 },
      { name: "E", total: 60 },
      { name: "F", total: 10 },
      { name: "G", total: 5 },
    ];
    expect(collapsePieSeries(series)).toEqual([
      { name: "A", total: 100 },
      { name: "B", total: 90 },
      { name: "C", total: 80 },
      { name: "D", total: 70 },
      { name: "E", total: 60 },
      { name: "Outros", total: 15, count: 2 },
    ]);
  });

  it("reproduz o caso real relatado: coluna de alta cardinalidade em modo linha a linha vira no máximo 6 fatias", () => {
    // Antes da correção, o modo "linha a linha" (raw) do gráfico de pizza
    // pulava esse colapso inteiramente e mandava uma fatia por linha da
    // planilha (ex.: até 120) direto pro <Pie> do Recharts, que quebrava
    // visualmente (fatias viravam "espinhos" soltos em vez de um círculo).
    const rawPerRowSeries = Array.from({ length: 120 }, (_, i) => ({
      name: `V${String(i).padStart(5, "0")}`,
      total: i % 10,
      sourceRow: i + 1,
    }));
    const result = collapsePieSeries(rawPerRowSeries);
    expect(result.length).toBeLessThanOrEqual(6);
    expect(result.at(-1)?.name).toBe("Outros");
  });

  it('não cria "Outros" quando o resto soma zero', () => {
    const series = [
      { name: "A", total: 10 },
      { name: "B", total: 8 },
      { name: "C", total: 6 },
      { name: "D", total: 4 },
      { name: "E", total: 2 },
      { name: "F", total: 0 },
      { name: "G", total: 0 },
    ];
    const result = collapsePieSeries(series);
    expect(result).toHaveLength(5);
    expect(result.some((r) => r.name === "Outros")).toBe(false);
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

describe("pieComparisonFor", () => {
  const series = [
    { name: "Norte", total: 1_200 },
    { name: "Sul", total: 900 },
    { name: "Outros", total: 2_000 },
  ];

  it("nomeia a maior outra categoria e calcula participação e diferença", () => {
    expect(pieComparisonFor(series, 0)).toEqual({
      selected: series[0],
      total: 4_100,
      share: 1_200 / 4_100,
      rank: 2,
      categoryCount: 3,
      reference: series[1],
      difference: 300,
      relativeDifference: 1 / 3,
    });
  });

  it("não usa o agrupador Outros como referência de uma categoria individual", () => {
    expect(pieComparisonFor(series, 1)?.reference).toBe(series[0]);
  });

  it("compara Outros com a maior categoria individual e trata base zero", () => {
    expect(pieComparisonFor(series, 2)?.reference).toBe(series[0]);
    expect(
      pieComparisonFor(
        [
          { name: "A", total: 5 },
          { name: "B", total: 0 },
        ],
        0,
      ),
    ).toMatchObject({ difference: 5, relativeDifference: null });
  });

  it("retorna null para uma seleção inexistente", () => {
    expect(pieComparisonFor(series, 8)).toBeNull();
  });
});

describe("trendSummaryFor", () => {
  it("resume início, fim, variação, mínimo, máximo e média de uma série cronológica", () => {
    const series = [
      { name: "Jan", total: 100 },
      { name: "Fev", total: 80 },
      { name: "Mar", total: 150 },
    ];
    expect(trendSummaryFor(series)).toEqual({
      first: series[0],
      last: series[2],
      change: 50,
      relativeChange: 0.5,
      min: series[1],
      max: series[2],
      average: 110,
      pointCount: 3,
    });
  });

  it("trata base zero no primeiro ponto sem dividir por zero", () => {
    const series = [
      { name: "Jan", total: 0 },
      { name: "Fev", total: 40 },
    ];
    expect(trendSummaryFor(series)).toMatchObject({ change: 40, relativeChange: null });
  });

  it("retorna null com menos de dois pontos", () => {
    expect(trendSummaryFor([])).toBeNull();
    expect(trendSummaryFor([{ name: "Jan", total: 10 }])).toBeNull();
  });
});

describe("rankingCoverageFor", () => {
  it("calcula participação e categorias fora do Top N", () => {
    const all = [{ total: 50 }, { total: 30 }, { total: 10 }, { total: 5 }, { total: 5 }];
    const shown = all.slice(0, 2);
    expect(rankingCoverageFor(shown, all)).toEqual({
      topTotal: 80,
      overallTotal: 100,
      topShare: 0.8,
      categoryCount: 5,
      shownCount: 2,
      remainingCount: 3,
    });
  });

  it("não calcula participação quando o total geral não é positivo", () => {
    expect(rankingCoverageFor([{ total: 5 }], [{ total: 5 }, { total: -5 }])).toMatchObject({
      topShare: null,
    });
    expect(rankingCoverageFor([], [])).toMatchObject({ topShare: null, remainingCount: 0 });
  });
});

describe("matchesRange", () => {
  it("aceita valor numérico dentro do intervalo informado", () => {
    expect(matchesRange(15, "10", "20", false)).toBe(true);
    expect(matchesRange(5, "10", "20", false)).toBe(false);
  });

  it("interpreta min/max e o valor em notação brasileira (vírgula decimal)", () => {
    expect(matchesRange("0,5", "0,1", "0,9", false)).toBe(true);
    expect(matchesRange("1,5", "0,1", "0,9", false)).toBe(false);
  });

  it("sem min/max, aceita qualquer valor", () => {
    expect(matchesRange("qualquer coisa", undefined, undefined, false)).toBe(true);
  });

  it("rejeita valor não numérico quando há filtro numérico ativo", () => {
    expect(matchesRange("N/A", "10", "20", false)).toBe(false);
  });
});

describe("filterDashboardRows", () => {
  const columns: Column[] = [
    { key: "cliente", label: "Cliente", kind: "category", visible: true, description: "" },
    {
      key: "observacao",
      label: "Observação",
      kind: "text",
      visible: true,
      description: "",
    },
    { key: "valor", label: "Valor", kind: "number", visible: true, description: "" },
  ];
  const rows: Row[] = [
    { cliente: "Ana", observacao: "Equipe Norte", valor: 10 },
    { cliente: "Anabela", observacao: "Equipe Sul", valor: 20 },
    { cliente: "Bruno", observacao: "Apoio no norte", valor: 30 },
  ];

  it("exige correspondência exata em filtros categóricos", () => {
    expect(
      filterDashboardRows(rows, columns, [{ key: "cliente", value: "ana", min: "", max: "" }]),
    ).toEqual([rows[0]]);
  });

  it("preserva a busca parcial em colunas textuais", () => {
    expect(
      filterDashboardRows(rows, columns, [{ key: "observacao", value: "norte", min: "", max: "" }]),
    ).toEqual([rows[0], rows[2]]);
  });

  it("combina categoria, intervalo e busca no mesmo recorte", () => {
    expect(
      filterDashboardRows(
        rows,
        columns,
        [
          { key: "cliente", value: "Anabela", min: "", max: "" },
          { key: "valor", value: "", min: "15", max: "25" },
        ],
        "sul",
      ),
    ).toEqual([rows[1]]);
  });
});

describe("compactDateAxisLabel", () => {
  it("encurta a data ISO para mês e ano", () => {
    expect(compactDateAxisLabel("2025-01-01")).toBe("jan/25");
    expect(compactDateAxisLabel("2026-12-31")).toBe("dez/26");
    // Sem o dia também vale: uma série mensal costuma vir assim.
    expect(compactDateAxisLabel("2025-07")).toBe("jul/25");
  });

  it("encurta a data brasileira, que é como a interface escreve", () => {
    expect(compactDateAxisLabel("01/03/2025")).toBe("mar/25");
    expect(compactDateAxisLabel("03/2025")).toBe("mar/25");
  });

  it("devolve nulo no que não é data, para o eixo truncar como sempre", () => {
    // O ponto desta garantia é que uma categoria não vire data por acidente.
    // "Compras" e "12,5" não têm forma de data; "2025-13-01" tem a forma mas
    // não tem o mês, e aceitar isso produziria um rótulo inventado.
    expect(compactDateAxisLabel("Compras")).toBeNull();
    expect(compactDateAxisLabel("12,5")).toBeNull();
    expect(compactDateAxisLabel("2025-13-01")).toBeNull();
    expect(compactDateAxisLabel("")).toBeNull();
  });

  it("mantém a leitura curta o bastante para caber onde a inteira não cabia", () => {
    // Seis caracteres contra dez: é essa diferença que tira a sobreposição das
    // pontas do eixo, onde a âncora desloca o rótulo para dentro.
    expect(compactDateAxisLabel("2025-01-01")).toHaveLength(6);
  });
});
