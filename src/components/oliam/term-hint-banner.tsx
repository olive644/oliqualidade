import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { TERM_HINTS_KEY } from "@/lib/storage";
import type { Widget } from "@/lib/types";

export function useTermHint(widgets: Widget[] | undefined) {
  const [showTermHint, setShowTermHint] = useState(false);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const usesGrouping = (widgets ?? []).some((w) =>
      ["bar", "pie", "line", "ranking", "map"].includes(w.type),
    );
    if (usesGrouping && !localStorage.getItem(TERM_HINTS_KEY)) setShowTermHint(true);
  }, [widgets]);
  const dismissTermHint = () => {
    localStorage.setItem(TERM_HINTS_KEY, "1");
    setShowTermHint(false);
  };
  const termHintBanner = showTermHint ? (
    <div className="flex items-start gap-3 border-b border-border bg-tint px-5 py-3">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="flex-1 text-xs text-foreground">
        <strong>Agrupamento</strong> organiza os dados por uma coluna, como categoria ou data.{" "}
        <strong>Agregação</strong> combina os valores dentro de cada grupo: soma, média, contagem,
        mínimo ou máximo.
      </p>
      <button
        className="shrink-0 text-xs font-medium text-primary hover:underline"
        onClick={dismissTermHint}
      >
        Entendi
      </button>
      <button className="shrink-0" aria-label="Dispensar dica" onClick={dismissTermHint}>
        <X className="size-3.5" />
      </button>
    </div>
  ) : null;
  return { termHintBanner };
}
