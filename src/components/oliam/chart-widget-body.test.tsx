import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartWidgetBody } from "./chart-widget-body";
import { setMeasuredSize } from "@/test/component-setup";
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
