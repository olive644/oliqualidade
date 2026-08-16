import { ChevronLeft, Pin, Plus, Settings2 } from "lucide-react";
import { Mark } from "@/components/oliam/mark";
import { hue } from "@/lib/format";
import type { Dashboard } from "@/lib/types";
import { cn } from "@/lib/utils";

export function DashboardNavSidebar(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboards: Dashboard[];
  activeId: string;
  openDash: (id: string) => void;
  backHome: () => void;
  newDash: () => void;
  rowCount: number;
  onOpenMissingPanel: () => void;
}) {
  const closeSidebarOnMobile = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches) {
      p.onOpenChange(false);
    }
  };
  return (
    <>
      {p.open && (
        <div
          className="oliam-sidebar-backdrop"
          aria-hidden="true"
          onClick={() => p.onOpenChange(false)}
        />
      )}
      <aside className={cn("oliam-sidebar", !p.open && "w-0 -translate-x-full border-0")}>
        <div className="flex h-16 items-center gap-3 border-b border-border px-4">
          <Mark />
          <strong className="font-display text-lg tracking-tight">Oli.Qualidade</strong>
        </div>
        <div className="flex-1 overflow-auto p-3">
          <button
            className="oliam-nav-item text-muted-foreground"
            onClick={() => {
              p.backHome();
              closeSidebarOnMobile();
            }}
          >
            <ChevronLeft className="size-4" />
            Todos os painéis
          </button>
          <p className="px-2 pb-1.5 pt-4 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Painéis
          </p>
          {[...p.dashboards]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((x) => (
              <button
                key={x.id}
                className={cn("oliam-nav-item", x.id === p.activeId && "active")}
                onClick={() => {
                  p.openDash(x.id);
                  closeSidebarOnMobile();
                }}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: x.id === p.activeId ? "currentColor" : hue(x.id) }}
                />
                <span className="truncate">{x.name}</span>
                {x.pinned && (
                  <Pin
                    className={cn(
                      "ml-auto size-3 shrink-0",
                      x.id === p.activeId ? "fill-current" : "fill-primary text-primary",
                    )}
                  />
                )}
              </button>
            ))}
          <button
            className="oliam-nav-item text-muted-foreground"
            onClick={() => {
              p.newDash();
              closeSidebarOnMobile();
            }}
          >
            <Plus className="size-4" />
            Novo painel
          </button>
        </div>
        <div className="border-t border-border p-3">
          <button className="oliam-nav-item" onClick={p.onOpenMissingPanel}>
            <Settings2 className="size-4" />
            Regras de dados ausentes
          </button>
          <p className="mt-2 px-2 font-mono text-[10px] text-muted-foreground">
            {p.rowCount} linhas · local
          </p>
        </div>
      </aside>
    </>
  );
}
