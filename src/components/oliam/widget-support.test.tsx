import { describe, expect, it } from "vitest";
import { BarTooltip, PeriodPointTooltip, PieSliceTooltip } from "./widget-support";
import { renderWidget } from "@/test/render-widget";

/**
 * Testa os balões de tooltip isolados, com `active`/`payload`/`series`
 * controlados — como se o Recharts já tivesse decidido qual ponto está sob o
 * mouse. Simular o rastreamento de mouse de verdade do Recharts sobre uma
 * barra/fatia/ponto específico não é confiável no jsdom (as medidas de
 * layout que ele usa para achar "o ponto mais próximo" não existem ali); a
 * leitura em si (`barTooltipReading`, `periodPointReading`,
 * `pieComparisonFor`) já tem sua própria suíte de testes puros.
 */

describe("BarTooltip", () => {
  const series = [
    { name: "Linha A", total: 97.75, count: 4 },
    { name: "Linha B", total: 96.5, count: 4 },
    { name: "Linha C", total: 92.67, count: 4 },
  ];

  it("mostra posição e participação no total em eixo de categorias", () => {
    const { container } = renderWidget(
      <BarTooltip
        active
        payload={[{ value: 96.5, payload: { name: "Linha B" } }] as never}
        label="Linha B"
        series={series}
        kind="number"
        mode="aggregate"
        axis="category"
      />,
    );
    expect(container.textContent).toContain("Posição 2 de 3");
    expect(container.textContent).toContain("34% do total");
  });

  it("não afirma posição nem participação em eixo cronológico", () => {
    // Mesma razão de shareOfLargest: numa série de tempo a ordem não é por
    // valor, e "posição 2 de 3" descreveria o índice no tempo, não o tamanho.
    const { container } = renderWidget(
      <BarTooltip
        active
        payload={[{ value: 96.5, payload: { name: "Linha B" } }] as never}
        label="Linha B"
        series={series}
        kind="number"
        mode="aggregate"
        axis="time"
      />,
    );
    expect(container.textContent).not.toContain("Posição");
    expect(container.textContent).not.toContain("do total");
  });
});

describe("PeriodPointTooltip", () => {
  const periodo = [
    { name: "jan/26", total: 100 },
    { name: "fev/26", total: 150 },
    { name: "mar/26", total: 90 },
    { name: "abr/26", total: 300 },
    { name: "mai/26", total: 200 },
  ];

  it("mostra variação contra o ponto anterior e contra a média do período", () => {
    const { container } = renderWidget(
      <PeriodPointTooltip
        active
        payload={[{ value: 150 }] as never}
        label="fev/26"
        series={periodo}
        kind="number"
        mode="aggregate"
      />,
    );
    expect(container.textContent).toContain("↑ 50% vs. anterior");
    // Média de [100,150,90,300,200] é 168; 150 fica (150-168)/168 ≈ 10,7% abaixo.
    expect(container.textContent).toContain("11% abaixo da média do período");
  });

  it("marca o maior valor do período", () => {
    const { container } = renderWidget(
      <PeriodPointTooltip
        active
        payload={[{ value: 300 }] as never}
        label="abr/26"
        series={periodo}
        kind="number"
        mode="aggregate"
      />,
    );
    expect(container.textContent).toContain("Maior valor do período");
  });

  it("marca o menor valor do período", () => {
    const { container } = renderWidget(
      <PeriodPointTooltip
        active
        payload={[{ value: 90 }] as never}
        label="mar/26"
        series={periodo}
        kind="number"
        mode="aggregate"
      />,
    );
    expect(container.textContent).toContain("Menor valor do período");
  });

  it("não renderiza nada quando o tooltip não está ativo", () => {
    const { container } = renderWidget(
      <PeriodPointTooltip
        active={false}
        payload={[{ value: 90 }] as never}
        label="mar/26"
        series={periodo}
        kind="number"
        mode="aggregate"
      />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("PieSliceTooltip", () => {
  const pieSeries = [
    { name: "Linha A", total: 97.75 },
    { name: "Linha B", total: 96.5 },
    { name: "Linha C", total: 92.67 },
  ];

  it("mostra participação no total, posição e comparação com a maior outra fatia", () => {
    const { container } = renderWidget(
      <PieSliceTooltip
        active
        payload={[{ payload: { name: "Linha B", total: 96.5 } }] as never}
        series={pieSeries}
        kind="number"
      />,
    );
    expect(container.textContent).toContain("do total");
    expect(container.textContent).toContain("Posição 2 de 3");
    expect(container.textContent).toContain("abaixo de Linha A");
  });

  it('anuncia quantas categorias a fatia "Outros" reúne', () => {
    const comOutros = [...pieSeries, { name: "Outros", total: 20, grouped: true, count: 3 }];
    const { container } = renderWidget(
      <PieSliceTooltip
        active
        payload={[{ payload: { name: "Outros", total: 20 } }] as never}
        series={comOutros}
        kind="number"
      />,
    );
    expect(container.textContent).toContain("3 categorias agrupadas");
  });
});
