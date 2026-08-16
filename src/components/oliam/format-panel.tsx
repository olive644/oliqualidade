import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormatRulesEditor } from "@/components/oliam/format-rules-editor";
import type { Column } from "@/lib/types";

export function FormatPanel(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nums: Column[];
  columns: Column[];
  setColumns: (columns: Column[]) => void;
}) {
  if (!p.open) return null;
  return (
    <div className="absolute inset-x-4 top-28 z-40 w-auto max-w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-panel sm:inset-x-auto sm:right-4 sm:w-96">
      <div className="flex items-center justify-between border-b p-3">
        <strong className="text-sm">Formatação condicional</strong>
        <Button variant="ghost" size="icon" onClick={() => p.onOpenChange(false)}>
          <X />
        </Button>
      </div>
      <div className="max-h-96 overflow-auto p-2">
        {p.nums.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">
            Nenhuma coluna numérica disponível para formatar.
          </p>
        )}
        {p.nums.map((c) => (
          <FormatRulesEditor
            key={c.key}
            column={c}
            onChange={(rules) =>
              p.setColumns(
                p.columns.map((x) => (x.key === c.key ? { ...x, conditionalFormat: rules } : x)),
              )
            }
          />
        ))}
        <p className="p-2 text-xs text-muted-foreground">
          Regras de limite colorem o valor quando ele cruza um número. Regras de escala pintam o
          fundo em degradê entre um mínimo e um máximo, estilo heatmap.
        </p>
      </div>
    </div>
  );
}
