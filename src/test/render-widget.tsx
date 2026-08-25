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
export function renderWidget(ui: ReactElement): RenderResult {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}
