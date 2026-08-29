import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartWidgetBody } from "./chart-widget-body";
import { HistogramWidgetBody } from "./histogram-widget-body";
import { MetricWidgetBody } from "./metric-widget-body";
import { ParetoWidgetBody } from "./pareto-widget-body";
import { RadarWidgetBody } from "./radar-widget-body";
import { ScatterWidgetBody } from "./scatter-widget-body";
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
