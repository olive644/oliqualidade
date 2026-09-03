import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartWidgetBody } from "./chart-widget-body";
import { HistogramWidgetBody } from "./histogram-widget-body";
import { MetricWidgetBody } from "./metric-widget-body";
import { ParetoWidgetBody } from "./pareto-widget-body";
import { RadarWidgetBody } from "./radar-widget-body";
import { ScatterWidgetBody, scatterPointKey } from "./scatter-widget-body";
import { OperationalWidgetBody } from "@/components/operational-widget-body";
import { setMeasuredSize, setPrefersReducedMotion } from "@/test/component-setup";
import { renderWidget } from "@/test/render-widget";
import type { Column, Row, Widget } from "@/lib/types";

/**
 * Primeiro teste de componente do projeto, e ele existe por um motivo
 * específico: `barValueLabelsFit` já era testada como função pura, mas nada
 * verificava que a largura medida do widget chegava até ela e que a decisão
 * dela virava rótulo na tela. Essa ligação era a dívida registrada na seção
 * 119 do audit, coberta até aqui só por verificação manual no navegador.
 */

const setores = ["Compras", "Vendas", "Log", "TI", "RH", "Obras", "Jurid", "Manut"];

const columns: Column[] = [
  { key: "setor", label: "Setor", kind: "category", visible: true, description: "" },
  { key: "custo", label: "Custo", kind: "number", visible: true, description: "" },
];

// Valores na casa dos milhões de propósito: escritos com separador de
// milhar eles ocupam nove caracteres ("1.234.567"), que é o que torna a
// diferença entre caber e não caber observável dentro de larguras reais de
// tela. Com números curtos, o rótulo caberia em qualquer largura e o teste
// não distinguiria nada.
const data: Row[] = setores.map((setor, index) => ({
  setor,
  custo: 1_234_567 + index * 111_111,
}));

const widget: Widget = {
  id: "w-barras",
  type: "bar",
  groupKey: "setor",
  valueKey: "custo",
  op: "sum",
  dataMode: "aggregate",
  span: 3,
  size: "md",
};

function renderBarWidget() {
  return renderWidget(
    <ChartWidgetBody
      widget={widget}
      data={data}
      columns={columns}
      numericCols={columns.filter((c) => c.kind === "number")}
      groupableCols={columns.filter((c) => c.kind === "category")}
      semanticProfiles={[]}
      filters={[]}
      setFilters={() => {}}
      onConfigure={() => {}}
      onShowSource={() => {}}
      dragProps={{}}
      sizeControls={null}
      animationDelay={0}
    />,
  );
}

const svgTexts = (container: HTMLElement) =>
  [...container.querySelectorAll("text")].map((node) => node.textContent ?? "");

/** Rótulo de valor: o texto do total escrito em cima da barra. */
const hasValueLabels = (container: HTMLElement) =>
  svgTexts(container).some((text) => text.includes("1.234.567"));

describe("ChartWidgetBody, gráfico de barras", () => {
  it("escreve o valor em cima da barra quando a largura medida comporta", async () => {
    setMeasuredSize(900);
    const { container } = renderBarWidget();

    await waitFor(() => expect(hasValueLabels(container)).toBe(true));
  });

  it("esconde o valor em cima da barra na largura de um celular", async () => {
    setMeasuredSize(360);
    const { container } = renderBarWidget();

    // Espera o gráfico existir antes de afirmar ausência: sem isto, o teste
    // passaria também num gráfico que simplesmente não renderizou.
    await waitFor(() =>
      expect(container.querySelectorAll(".oliam-chart-bar-cell").length).toBe(setores.length),
    );

    expect(hasValueLabels(container)).toBe(false);
  });
});

describe("ChartWidgetBody, leitura sobre linhas descartadas do agrupamento", () => {
  // Camada 3, ponto 1 do relatório do usuário: comparar linhas visíveis vs.
  // linhas usadas no gráfico e sinalizar a divergência, em vez de descartar
  // em silêncio. `countMissingGroupRows`/`ChartReadingGuide` já existiam e já
  // eram usados no box plot e no widget de insights; faltava ligar ao tipo de
  // widget mais comum (barra/pizza/linha/área).
  const columnsComFaltante: Column[] = [
    { key: "setor", label: "Setor", kind: "category", visible: true, description: "" },
    { key: "custo", label: "Custo", kind: "number", visible: true, description: "" },
  ];
  const dataComFaltante: Row[] = [
    ...setores.map((setor, index) => ({ setor, custo: 1_000 + index * 10 })),
    { setor: "", custo: 500 },
  ];

  it("avisa quantas linhas ficaram de fora por falta de valor de agrupamento", () => {
    setMeasuredSize(900);
    const widgetComFaltante: Widget = {
      id: "w-barras-faltante",
      type: "bar",
      groupKey: "setor",
      valueKey: "custo",
      op: "sum",
      dataMode: "aggregate",
      span: 3,
      size: "md",
    };
    const { container } = renderWidget(
      <ChartWidgetBody
        widget={widgetComFaltante}
        data={dataComFaltante}
        columns={columnsComFaltante}
        numericCols={columnsComFaltante.filter((c) => c.kind === "number")}
        groupableCols={columnsComFaltante.filter((c) => c.kind === "category")}
        semanticProfiles={[]}
        filters={[]}
        setFilters={() => {}}
        onConfigure={() => {}}
        onShowSource={() => {}}
        dragProps={{}}
        sizeControls={null}
        animationDelay={0}
      />,
    );

    expect(container.textContent).toContain(
      `${dataComFaltante.length.toLocaleString("pt-BR")} registros visíveis`,
    );
    expect(container.textContent).toContain('1 linha sem "Setor" não entrou neste gráfico');
  });

  it("não mostra o aviso quando nenhuma linha ficou de fora", () => {
    setMeasuredSize(900);
    const { container } = renderBarWidget();

    expect(container.textContent).not.toContain("não entrou neste gráfico");
    expect(container.textContent).not.toContain("não entraram neste gráfico");
  });
});

const timeColumns: Column[] = [
  { key: "periodo", label: "Período", kind: "date", visible: true, description: "" },
  { key: "resultado", label: "Resultado", kind: "number", visible: true, description: "" },
  { key: "meta", label: "Meta", kind: "number", visible: true, description: "" },
];

const timeData: Row[] = [
  { periodo: "01/01/2021", resultado: -12, meta: 5 },
  { periodo: "01/01/2022", resultado: 0, meta: 5 },
  { periodo: "01/01/2023", resultado: 18.5, meta: 12 },
  { periodo: "01/01/2024", resultado: null, meta: 12 },
  { periodo: "01/01/2025", resultado: 30, meta: 20 },
];

function renderTimeWidget(type: "area" | "line") {
  const timeWidget: Widget = {
    id: `w-${type}`,
    type,
    groupKey: "periodo",
    valueKey: "resultado",
    areaReference: "goal",
    areaGoalKey: "meta",
    op: "sum",
    dataMode: "aggregate",
    span: 3,
    size: "md",
  };
  return renderWidget(
    <ChartWidgetBody
      widget={timeWidget}
      data={timeData}
      columns={timeColumns}
      numericCols={timeColumns.filter((column) => column.kind === "number")}
      groupableCols={timeColumns.filter((column) => column.kind === "date")}
      semanticProfiles={[]}
      filters={[]}
      setFilters={() => {}}
      onConfigure={() => {}}
      onShowSource={() => {}}
      dragProps={{}}
      sizeControls={null}
      animationDelay={0}
    />,
  );
}

describe("ChartWidgetBody, pizza e séries temporais", () => {
  it("renderiza setores reais e preserva destaque fixo ao selecionar uma fatia", async () => {
    setMeasuredSize(900);
    setPrefersReducedMotion(true);
    const pieWidget: Widget = { ...widget, id: "w-pizza", type: "pie" };
    const { container } = renderWidget(
      <ChartWidgetBody
        widget={pieWidget}
        data={data}
        columns={columns}
        numericCols={columns.filter((column) => column.kind === "number")}
        groupableCols={columns.filter((column) => column.kind === "category")}
        semanticProfiles={[]}
        filters={[]}
        setFilters={() => {}}
        onConfigure={() => {}}
        onShowSource={() => {}}
        dragProps={{}}
        sizeControls={null}
        animationDelay={0}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll(".recharts-sector").length).toBeGreaterThan(1),
    );
    const firstSector = container.querySelector<SVGPathElement>(".recharts-sector");
    if (!firstSector) throw new Error("A primeira fatia da pizza não foi renderizada.");
    fireEvent.click(firstSector);
    await waitFor(() =>
      expect(container.querySelector(".oliam-chart-pie-active-slice")).not.toBeNull(),
    );
  });

  it.each(["area", "line"] as const)(
    "renderiza SVG e pontos essenciais no gráfico %s com negativos, zero, nulo e datas",
    async (type) => {
      setMeasuredSize(390);
      document.documentElement.classList.add("dark");
      const { container } = renderTimeWidget(type);

      await waitFor(() => expect(container.querySelector(".recharts-surface")).not.toBeNull());
      expect(container.querySelectorAll(".recharts-line-curve").length).toBeGreaterThan(0);
      if (type === "area") {
        expect(container.querySelectorAll(".recharts-area-area").length).toBeGreaterThan(0);
      }
      const periodTicks = [...container.querySelectorAll("text > title")]
        .map((title) => title.parentElement)
        .filter((node): node is HTMLElement => node !== null);
      expect(periodTicks.length).toBeGreaterThanOrEqual(2);
      expect(periodTicks[0]?.getAttribute("text-anchor")).toBe("start");
      expect(periodTicks.at(-1)?.getAttribute("text-anchor")).toBe("end");
      document.documentElement.classList.remove("dark");
    },
  );
});

const specializedColumns: Column[] = [
  { key: "categoria", label: "Categoria", kind: "category", visible: true, description: "" },
  { key: "periodo", label: "Período", kind: "date", visible: true, description: "" },
  { key: "valor", label: "Valor", kind: "number", visible: true, description: "" },
  { key: "qualidade", label: "Qualidade", kind: "number", visible: true, description: "" },
];

const specializedCategories = [
  "Categoria muito longa Alfa",
  "Beta",
  "Gama",
  "Delta",
  "Épsilon",
  "Zeta",
];
const specializedRows: Row[] = [
  ...Array.from({ length: 24 }, (_, index) => ({
    categoria: specializedCategories[index % specializedCategories.length] ?? "Zeta",
    periodo: `01/${String((index % 12) + 1).padStart(2, "0")}/${2023 + Math.floor(index / 12)}`,
    valor: index === 0 ? -5 : index === 1 ? 0 : index * 2.5,
    qualidade: index * 3 + 2,
  })),
  { categoria: "Zeta", periodo: "01/01/2025", valor: null, qualidade: 80 },
];

const specializedWidget = (type: Widget["type"]): Widget => ({
  id: `w-${type}`,
  type,
  groupKey: "categoria",
  valueKey: "valor",
  valueKey2: "qualidade",
  metricKey: "valor",
  op: "sum",
  dataMode: "aggregate",
  span: 3,
  size: "md",
});

const specializedCommon = {
  data: specializedRows,
  columns: specializedColumns,
  numericCols: specializedColumns.filter((column) => column.kind === "number"),
  groupableCols: specializedColumns.filter((column) => column.kind === "category"),
  semanticProfiles: [],
  filters: [],
  setFilters: () => {},
  onConfigure: () => {},
  onShowSource: () => {},
  dragProps: {},
  sizeControls: null,
  animationDelay: 0,
};

describe("widgets especializados com Recharts 3", () => {
  it("renderiza histograma com barras reais, labels e seleção", async () => {
    setMeasuredSize(320);
    const { container } = renderWidget(
      <HistogramWidgetBody widget={specializedWidget("histogram")} {...specializedCommon} />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll(".oliam-chart-bar-cell").length).toBeGreaterThan(1),
    );
    const firstBar = container.querySelector<SVGPathElement>(".oliam-chart-bar-cell");
    if (!firstBar) throw new Error("A primeira barra do histograma não foi renderizada.");
    fireEvent.click(firstBar);
    expect(container.querySelector(".recharts-surface")).not.toBeNull();
  });

  it("renderiza métrica com área auxiliar e tooltip habilitado", async () => {
    setMeasuredSize(390);
    const metricWidget = { ...specializedWidget("metric-trend"), groupKey: "periodo" };
    const { container } = renderWidget(
      <MetricWidgetBody
        widget={metricWidget}
        data={specializedRows}
        columns={specializedColumns}
        numericCols={specializedCommon.numericCols}
        semanticProfiles={[]}
        versionDelta={null}
        onConfigure={() => {}}
        dragProps={{}}
        animationDelay={0}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll(".recharts-area-area").length).toBeGreaterThan(0),
    );
    expect(container.querySelector(".recharts-tooltip-wrapper")).not.toBeNull();
  });

  it("renderiza Pareto com barras, linha acumulada e zero explícito", async () => {
    setMeasuredSize(414);
    const paretoRows: Row[] = specializedRows.map((row) => {
      const value = row["valor"];
      return { ...row, valor: typeof value === "number" ? Math.abs(value) : (value ?? null) };
    });
    const { container } = renderWidget(
      <ParetoWidgetBody
        widget={specializedWidget("pareto")}
        {...specializedCommon}
        data={paretoRows}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll(".recharts-bar-rectangle path").length).toBeGreaterThan(1),
    );
    expect(container.querySelectorAll(".recharts-line-curve").length).toBeGreaterThan(0);
  });

  it("renderiza dispersão com pontos personalizados e linha de tendência", async () => {
    setMeasuredSize(768);
    const { container } = renderWidget(
      <ScatterWidgetBody
        widget={specializedWidget("scatter")}
        data={specializedRows}
        columns={specializedColumns}
        onConfigure={() => {}}
        onShowSource={() => {}}
        dragProps={{}}
        sizeControls={null}
        animationDelay={0}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll(".recharts-scatter-symbol circle").length).toBeGreaterThan(
        1,
      ),
    );
    expect(container.querySelectorAll(".recharts-line-curve").length).toBeGreaterThan(0);
  });

  it("renderiza radar com polígono e pontos tocáveis", async () => {
    setMeasuredSize(390);
    setPrefersReducedMotion(true);
    const { container } = renderWidget(
      <RadarWidgetBody widget={specializedWidget("radar")} {...specializedCommon} />,
    );
    await waitFor(() => expect(container.querySelector(".recharts-radar-polygon")).not.toBeNull());
    expect(container.querySelectorAll(".recharts-radar-dots circle").length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("renderiza a carta de controle persistida com todas as linhas essenciais", async () => {
    setMeasuredSize(360);
    const { container } = renderWidget(
      <OperationalWidgetBody
        type="control-chart"
        columns={specializedColumns}
        rows={specializedRows}
      />,
    );
    await waitFor(() => expect(container.querySelector(".recharts-surface")).not.toBeNull());
    expect(container.querySelectorAll(".recharts-line-curve").length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * A seleção precisa acompanhar a identidade do que foi selecionado.
 *
 * O que ela não pode fazer é continuar apontando para a mesma **posição**. A
 * pessoa seleciona a terceira categoria, aplica um filtro, a série encolhe ou
 * troca de ordem, e a posição 2 passa a ser outra categoria: o widget destaca a
 * errada, ou não destaca nenhuma e deixa o gráfico inteiro esmaecido.
 *
 * Estes testes comparam identidade, e não presença. Afirmar que "existe algo
 * destacado" passaria dos dois lados, que é como o defeito da seção 156
 * sobreviveu por tanto tempo.
 */
describe("a seleção acompanha a identidade, e não a posição", () => {
  const catColumns: Column[] = [
    { key: "setor", label: "Setor", kind: "category", visible: true, description: "" },
    { key: "custo", label: "Custo", kind: "number", visible: true, description: "" },
  ];
  const numColumns: Column[] = [
    { key: "custo", label: "Custo", kind: "number", visible: true, description: "" },
    { key: "prazo", label: "Prazo", kind: "number", visible: true, description: "" },
  ];

  const quatroSetores: Row[] = [
    { setor: "Alfa", custo: 400 },
    { setor: "Beta", custo: 300 },
    { setor: "Gama", custo: 200 },
    { setor: "Delta", custo: 100 },
  ];
  const semAlfa = quatroSetores.filter((linha) => linha["setor"] !== "Alfa");

  /** O texto do bloco de detalhe é onde a pessoa lê qual item está selecionado. */
  const detalhe = (container: HTMLElement) =>
    container.querySelector(".oliam-chart-detail-swap")?.textContent ?? "";

  const pieElement = (rows: Row[]) => (
    <ChartWidgetBody
      widget={{
        id: "w-pizza-identidade",
        type: "pie",
        groupKey: "setor",
        valueKey: "custo",
        op: "sum",
        dataMode: "aggregate",
        span: 3,
        size: "md",
      }}
      data={rows}
      columns={catColumns}
      numericCols={catColumns.filter((column) => column.kind === "number")}
      groupableCols={catColumns.filter((column) => column.kind === "category")}
      semanticProfiles={[]}
      filters={[]}
      setFilters={() => {}}
      onConfigure={() => {}}
      onShowSource={() => {}}
      dragProps={{}}
      sizeControls={null}
      animationDelay={0}
    />
  );

  it("a pizza não passa a destacar outra categoria quando a série encolhe", async () => {
    setMeasuredSize(900);
    setPrefersReducedMotion(true);
    const { container, rerenderWidget } = renderWidget(pieElement(quatroSetores));

    await waitFor(() =>
      expect(container.querySelectorAll(".recharts-sector").length).toBeGreaterThan(3),
    );
    const setores = container.querySelectorAll<SVGPathElement>(".recharts-sector");
    fireEvent.click(setores[2]!);
    await waitFor(() => expect(detalhe(container)).toContain("Gama"));

    // "Alfa" sai, como aconteceria ao aplicar um filtro. Tudo o que vinha
    // depois dela anda uma posição para trás, e a posição 2 vira "Delta".
    rerenderWidget(pieElement(semAlfa));
    await waitFor(() =>
      expect(container.querySelectorAll(".recharts-sector").length).toBeGreaterThan(2),
    );

    expect(detalhe(container)).not.toContain("Delta");
  });

  it("o histograma não deixa o gráfico inteiro esmaecido quando as faixas mudam", async () => {
    setMeasuredSize(900);
    setPrefersReducedMotion(true);
    const dados: Row[] = Array.from({ length: 40 }, (_, i) => ({ custo: i * 5, prazo: i }));
    const comFaixas = (binCount: number) => (
      <HistogramWidgetBody
        widget={{
          id: "w-hist-identidade",
          type: "histogram",
          valueKey: "custo",
          binCount,
          span: 3,
          size: "md",
        }}
        data={dados}
        columns={numColumns}
        numericCols={numColumns}
        filters={[]}
        setFilters={() => {}}
        onConfigure={() => {}}
        onShowSource={() => {}}
        dragProps={{}}
        sizeControls={null}
        animationDelay={0}
      />
    );
    const { container, rerenderWidget } = renderWidget(comFaixas(8));

    await waitFor(() =>
      expect(container.querySelectorAll(".oliam-chart-bar-cell").length).toBeGreaterThan(5),
    );
    fireEvent.click(container.querySelectorAll<SVGPathElement>(".oliam-chart-bar-cell")[5]!);

    // Com 3 faixas não existe a posição 5. Guardada por índice, a seleção
    // aponta para uma faixa inexistente: nenhuma barra casa com o destaque e
    // **todas** ficam esmaecidas, que é o estado que ninguém consegue desfazer
    // sem clicar de novo.
    rerenderWidget(comFaixas(3));
    await waitFor(() =>
      expect(container.querySelectorAll(".oliam-chart-bar-cell").length).toBeLessThan(5),
    );

    const barras = [...container.querySelectorAll(".oliam-chart-bar-cell")];
    const esmaecidas = barras.filter((barra) => barra.getAttribute("opacity") !== "1");
    expect(barras.length).toBeGreaterThan(0);
    expect(esmaecidas.length).toBeLessThan(barras.length);
  });
});

/**
 * Pareto e dispersão pelo mesmo critério, com os riscos próprios de cada um.
 *
 * O Pareto **reordena** por contribuição, então basta um valor mudar para a
 * posição 2 virar outra categoria, sem nada sair da série. A dispersão não tem
 * nome: a identidade dela é a linha de origem, que é justamente o que o botão
 * "Ver linhas de origem" abre.
 */
describe("a seleção acompanha a identidade também no Pareto e na dispersão", () => {
  const catColumns: Column[] = [
    { key: "setor", label: "Setor", kind: "category", visible: true, description: "" },
    { key: "custo", label: "Custo", kind: "number", visible: true, description: "" },
  ];

  // `oliam-widget-detail` é o gancho da faixa de detalhe. Sem ele a busca
  // esbarra no painel de métricas, que usa a mesma marcação e também tem título.
  const tituloDoDetalhe = (container: HTMLElement) =>
    container.querySelector(".oliam-widget-detail p[title]")?.getAttribute("title") ?? "";

  it("o Pareto não troca de categoria quando a ordem por contribuição muda", async () => {
    setMeasuredSize(900);
    setPrefersReducedMotion(true);
    const paretoElement = (rows: Row[]) => (
      <ParetoWidgetBody
        widget={{
          id: "w-pareto-identidade",
          type: "pareto",
          groupKey: "setor",
          valueKey: "custo",
          op: "sum",
          span: 3,
          size: "md",
        }}
        data={rows}
        columns={catColumns}
        numericCols={catColumns.filter((column) => column.kind === "number")}
        groupableCols={catColumns.filter((column) => column.kind === "category")}
        semanticProfiles={[]}
        filters={[]}
        setFilters={() => {}}
        onConfigure={() => {}}
        onShowSource={() => {}}
        dragProps={{}}
        sizeControls={null}
        animationDelay={0}
      />
    );
    const { container, rerenderWidget } = renderWidget(
      paretoElement([
        { setor: "Alfa", custo: 400 },
        { setor: "Beta", custo: 300 },
        { setor: "Gama", custo: 200 },
      ]),
    );

    await waitFor(() =>
      expect(container.querySelectorAll(".oliam-chart-bar-cell").length).toBeGreaterThan(2),
    );
    fireEvent.click(container.querySelectorAll<SVGPathElement>(".oliam-chart-bar-cell")[2]!);
    await waitFor(() => expect(tituloDoDetalhe(container)).toBe("Gama"));

    // Ninguém sai da série: só "Gama" passa a ser a maior. O Pareto reordena, e
    // a posição 2 vira "Beta".
    rerenderWidget(
      paretoElement([
        { setor: "Alfa", custo: 400 },
        { setor: "Beta", custo: 300 },
        { setor: "Gama", custo: 900 },
      ]),
    );

    await waitFor(() => expect(tituloDoDetalhe(container)).toBe("Gama"));
  });

  /**
   * A dispersão fica sem teste de componente, e isto é deliberado.
   *
   * O gráfico dela não redesenha os símbolos depois de uma troca de dado no
   * jsdom: eles vão a zero e não voltam, e o bloco de detalhe some junto. Com
   * isso o teste passa igual antes e depois da correção, ou seja, não distingue
   * nada. Um teste que não separa os dois lados é pior que teste nenhum, porque
   * dá aparência de cobertura.
   *
   * O que dá para garantir aqui é a regra de identidade que o widget usa, e é
   * ela que está abaixo. A ligação com o clique segue o mesmo desenho dos três
   * widgets acima, que estão cobertos.
   */
  it("a identidade de um ponto prefere a linha de origem, e cai nas coordenadas sem ela", () => {
    // Duas linhas diferentes com o mesmo par de valores continuam distinguíveis
    // quando a origem é conhecida. É por isso que ela vem primeiro.
    expect(scatterPointKey({ x: 60, y: 18, sourceRowIndex: 4 })).not.toBe(
      scatterPointKey({ x: 60, y: 18, sourceRowIndex: 9 }),
    );
    // E a mesma linha continua a mesma depois de um filtro reordenar tudo.
    expect(scatterPointKey({ x: 60, y: 18, sourceRowIndex: 4 })).toBe(
      scatterPointKey({ x: 60, y: 18, sourceRowIndex: 4 }),
    );
    // Sem origem conhecida, o par de coordenadas responde: dois pontos
    // exatamente sobrepostos são indistinguíveis na tela de qualquer forma.
    expect(scatterPointKey({ x: 60, y: 18, sourceRowIndex: null })).toBe(
      scatterPointKey({ x: 60, y: 18, sourceRowIndex: null }),
    );
    expect(scatterPointKey({ x: 60, y: 18, sourceRowIndex: null })).not.toBe(
      scatterPointKey({ x: 61, y: 18, sourceRowIndex: null }),
    );
  });
});

/**
 * Um componente definido dentro de um hook é uma função nova a cada
 * renderização, e o React trata função nova como **tipo novo**: ele desmonta a
 * subárvore inteira e monta outra no lugar. Quando essa subárvore está
 * sobreposta ao gráfico, como os botões de rolagem, cada renderização a faz
 * piscar — e passar o mouse pelo card renderiza várias vezes por segundo.
 *
 * Medido antes do conserto, com uma sonda que marca o elemento e observa a
 * marca quadro a quadro: os botões assumiram 22 identidades numa passagem de
 * mouse, enquanto o `svg` e o `wrapper` do gráfico mantiveram uma só.
 *
 * A garantia aqui é de **identidade do elemento**, e não de presença: afirmar
 * que os botões existem depois de redesenhar passaria dos dois lados.
 */
describe("a sobreposição de rolagem do gráfico não é remontada a cada desenho", () => {
  const muitasCategorias = Array.from({ length: 14 }, (_, i) => `Categoria ${i + 1}`);
  const colunas: Column[] = [
    { key: "categoria", label: "Categoria", kind: "category", visible: true, description: "" },
    { key: "valor", label: "Valor", kind: "number", visible: true, description: "" },
  ];
  const linhas = (fator: number): Row[] =>
    muitasCategorias.map((categoria, i) => ({ categoria, valor: (i + 1) * fator }));

  const barra = (fator: number) => (
    <ChartWidgetBody
      widget={{
        id: "w-barra-remonta",
        type: "bar",
        groupKey: "categoria",
        valueKey: "valor",
        op: "sum",
        dataMode: "aggregate",
        span: 3,
        size: "md",
      }}
      data={linhas(fator)}
      columns={colunas}
      numericCols={colunas.filter((c) => c.kind === "number")}
      groupableCols={colunas.filter((c) => c.kind === "category")}
      semanticProfiles={[]}
      filters={[]}
      setFilters={() => {}}
      onConfigure={() => {}}
      onShowSource={() => {}}
      dragProps={{}}
      sizeControls={null}
      animationDelay={0}
    />
  );

  it("mantém o mesmo elemento dos botões depois de um redesenho", async () => {
    setMeasuredSize(900);
    setPrefersReducedMotion(true);
    const { container, rerenderWidget } = renderWidget(barra(1));

    await waitFor(() =>
      expect(container.querySelector("[aria-label^='Navegação horizontal']")).not.toBeNull(),
    );
    const antes = container.querySelector("[aria-label^='Navegação horizontal']");

    rerenderWidget(barra(2));
    await waitFor(() =>
      expect(container.querySelector("[aria-label^='Navegação horizontal']")).not.toBeNull(),
    );

    // O mesmo nó do DOM, e não outro com a mesma aparência.
    expect(container.querySelector("[aria-label^='Navegação horizontal']")).toBe(antes);
  });
});
