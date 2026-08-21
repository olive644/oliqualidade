import { createContext, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type WidgetConfigState = {
  open: boolean;
  toggle: () => void;
  /** Widget ampliado em tela cheia. `null` quando o widget não pode ampliar. */
  expanded: boolean | null;
  toggleExpanded: () => void;
};

const WidgetConfigContext = createContext<WidgetConfigState | null>(null);

/**
 * Estado de "configuração à mostra" de um widget.
 *
 * Cada widget tinha duas faixas de controles sempre visíveis — os campos de
 * dados (eixo X, métrica, cálculo) e os de tamanho (largura, altura) — que
 * juntas ocupavam duas linhas antes do gráfico começar. Num painel com dez
 * widgets isso é vinte faixas de formulário competindo com o conteúdo, que é
 * a origem da sensação de poluição visual.
 *
 * Agora as faixas nascem recolhidas e aparecem pelo botão no cabeçalho do
 * widget. O estado é por widget: abrir a configuração de um não mexe nos
 * outros.
 */
export function WidgetConfigProvider({
  children,
  expanded = null,
  onToggleExpanded,
}: {
  children: React.ReactNode;
  /** `null` desliga o botão de ampliar (widget sem versão em tela cheia). */
  expanded?: boolean | null;
  onToggleExpanded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const value = useMemo(
    () => ({
      open,
      toggle: () => setOpen((current) => !current),
      expanded,
      toggleExpanded: onToggleExpanded ?? (() => {}),
    }),
    [open, expanded, onToggleExpanded],
  );
  return <WidgetConfigContext.Provider value={value}>{children}</WidgetConfigContext.Provider>;
}

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

/**
 * Faixa de controles de um widget, exibida apenas quando a configuração está
 * aberta. Substitui as `div`s repetidas em cada corpo de widget, que traziam
 * exatamente as mesmas classes.
 */
export function WidgetConfigBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { open } = useWidgetConfig();
  if (!open) return null;
  return (
    <div
      className={cn(
        "oliam-widget-config-bar oliam-config-enter flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2",
        className,
      )}
      data-export-controls
    >
      {children}
    </div>
  );
}
