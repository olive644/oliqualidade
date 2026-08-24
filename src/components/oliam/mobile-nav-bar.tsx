import { BarChart3, Filter, PanelRight, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type NavAction = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  active?: boolean;
  /** Ação de montagem: some no modo leitura, como o resto da edição. */
  editOnly?: boolean;
};

/**
 * Barra de navegação inferior do celular.
 *
 * No telefone, as ações principais do painel estavam espalhadas entre a barra
 * superior (menu de painéis, visão geral) e uma barra de ferramentas que rola
 * na horizontal, onde filtrar e acrescentar widget ficavam fora da tela até
 * alguém arrastar. Nenhuma delas caía perto do polegar.
 *
 * A barra fica fixa no rodapé, respeita a área segura do aparelho e só existe
 * na largura de celular — no computador as mesmas ações já estão visíveis o
 * tempo todo, e repetir a barra ali seria ruído.
 */
export function MobileNavBar({
  onOpenPanels,
  onSearch,
  onFilter,
  onAddWidget,
  onToggleInsight,
  insightOpen,
}: {
  onOpenPanels: () => void;
  onSearch: () => void;
  onFilter: () => void;
  onAddWidget: () => void;
  onToggleInsight: () => void;
  insightOpen: boolean;
}) {
  const actions: NavAction[] = [
    { key: "panels", label: "Painéis", icon: <BarChart3 />, onSelect: onOpenPanels },
    { key: "search", label: "Buscar", icon: <Search />, onSelect: onSearch },
    { key: "filter", label: "Filtrar", icon: <Filter />, onSelect: onFilter },
    { key: "widget", label: "Widget", icon: <Plus />, onSelect: onAddWidget, editOnly: true },
    {
      key: "insight",
      label: "Visão geral",
      icon: <PanelRight />,
      onSelect: onToggleInsight,
      active: insightOpen,
    },
  ];
  return (
    <nav className="oliam-mobile-nav" aria-label="Ações do painel">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={action.onSelect}
          aria-pressed={action.active}
          className={cn("oliam-mobile-nav-item", action.active && "text-primary")}
          {...(action.editOnly ? { "data-edit-only": true } : {})}
        >
          <span aria-hidden="true" className="[&_svg]:size-5">
            {action.icon}
          </span>
          {action.label}
        </button>
      ))}
    </nav>
  );
}
