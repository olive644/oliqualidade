import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Ambiente mínimo para renderizar componente React em jsdom.
 *
 * O jsdom não faz layout: todo elemento mede zero. Isso é fatal para os
 * widgets deste projeto, porque a decisão de mostrar ou esconder conteúdo
 * (rótulo em cima da barra, quantas letras do nome da categoria cabem) vem de
 * `useMeasuredWidth`, que lê a largura real com `ResizeObserver` — API que o
 * jsdom nem sequer implementa. Sem o substituto abaixo, o componente ficaria
 * eternamente na largura 0 e o teste só conseguiria observar o estado
 * anterior à medida.
 *
 * O substituto entrega a mesma medida para todo elemento observado, definida
 * por `setMeasuredSize`. Na prática isso alimenta ao mesmo tempo o
 * `useMeasuredWidth` do widget e o `ResponsiveContainer` do recharts, que é
 * justamente a relação que se quer exercitar: a largura do widget decide o
 * conteúdo, e a mesma largura desenha o gráfico.
 */
let measuredWidth = 900;
let measuredHeight = 320;
let prefersReducedMotion = false;

export function setMeasuredSize(width: number, height = 320) {
  measuredWidth = width;
  measuredHeight = height;
}

export function setPrefersReducedMotion(value: boolean) {
  prefersReducedMotion = value;
}

type ObserverCallback = (entries: { contentRect: DOMRectReadOnly; target: Element }[]) => void;

class ImmediateResizeObserver {
  private readonly callback: ObserverCallback;

  constructor(callback: ObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    const contentRect = {
      width: measuredWidth,
      height: measuredHeight,
      top: 0,
      left: 0,
      right: measuredWidth,
      bottom: measuredHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRectReadOnly;
    // Síncrono de propósito. O observador real dispara em um quadro futuro,
    // mas um teste que precisasse esperar quadro nenhum acabaria medindo a
    // paciência do `waitFor` em vez do comportamento do componente.
    this.callback([{ contentRect, target }]);
  }

  unobserve() {}

  disconnect() {}
}

globalThis.ResizeObserver = ImmediateResizeObserver as unknown as typeof globalThis.ResizeObserver;

// O jsdom não implementa matchMedia, usado por consultas de preferência do
// usuário (movimento reduzido, tema). Sem isto, qualquer componente que
// pergunte pela preferência quebra na renderização.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" && prefersReducedMotion,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  setMeasuredSize(900, 320);
  setPrefersReducedMotion(false);
});
