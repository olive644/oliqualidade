import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Renderiza um widget com os provedores que o cartão real fornece.
 *
 * Hoje é só o `TooltipProvider`: os botões de ação do widget usam o tooltip
 * do Radix, que exige o provedor em algum ancestral e lança erro sem ele. Na
 * aplicação o provedor está na raiz, longe do widget, então um teste que
 * renderiza o widget sozinho precisa recriá-lo.
 *
 * Vale passar por aqui em vez de embrulhar caso a caso: quando outro provedor
 * de raiz virar exigência de renderização, ele entra neste ponto único e os
 * testes existentes continuam valendo.
 */
export function renderWidget(ui: ReactElement): RenderResult & {
  /**
   * Redesenha o widget com props novas, mantendo o mesmo componente montado.
   *
   * Existe porque o `rerender` cru do testing-library exige que quem chama
   * repita a árvore de provedores; esquecer o provedor troca o teste por um
   * erro de renderização, e acertá-lo espalha o detalhe do provedor por todo
   * teste que precise de duas passagens. É por essa segunda passagem que se
   * observa o que sobrevive a uma mudança de dado, como a seleção de um widget
   * depois de um filtro.
   */
  rerenderWidget: (next: ReactElement) => void;
} {
  const resultado = render(<TooltipProvider>{ui}</TooltipProvider>);
  return {
    ...resultado,
    rerenderWidget: (next) => resultado.rerender(<TooltipProvider>{next}</TooltipProvider>),
  };
}
