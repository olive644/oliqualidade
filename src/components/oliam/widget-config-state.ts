import { createContext, useContext } from "react";

export type WidgetConfigState = {
  open: boolean;
  toggle: () => void;
  /** Widget ampliado em tela cheia. `null` quando o widget não pode ampliar. */
  expanded: boolean | null;
  toggleExpanded: () => void;
};

export const WidgetConfigContext = createContext<WidgetConfigState | null>(null);

export function useWidgetConfig(): WidgetConfigState {
  // Sem provider (widget renderizado fora do cartão, como em testes), a
  // configuração fica sempre visível: é o comportamento antigo, e nunca
  // esconder um controle é mais seguro do que escondê-lo sem botão para
  // trazê-lo de volta.
  return (
    useContext(WidgetConfigContext) ?? {
      open: true,
      toggle: () => {},
      expanded: null,
      toggleExpanded: () => {},
    }
  );
}
