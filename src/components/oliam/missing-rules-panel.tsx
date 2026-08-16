import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { numericKinds, type Column } from "@/lib/types";

export function MissingRulesPanel(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Column[];
  setColumns: (columns: Column[]) => void;
}) {
  if (!p.open) return null;
  return (
    <div className="absolute inset-x-4 top-28 z-40 w-auto max-w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-panel sm:inset-x-auto sm:right-4 sm:w-96">
      <div className="flex items-center justify-between border-b p-3">
        <strong className="text-sm">Regras de dados ausentes</strong>
        <Button variant="ghost" size="icon" onClick={() => p.onOpenChange(false)}>
          <X />
        </Button>
      </div>
      <div className="max-h-96 overflow-auto p-2">
        {p.columns
          .filter((c) => !c.formula)
          .map((c) => {
            const isNumeric = numericKinds.includes(c.kind);
            return (
              <div key={c.key} className="flex items-center justify-between gap-3 p-2 text-sm">
                <span className="truncate">{c.label}</span>
                <select
                  className="oliam-select w-44 shrink-0"
                  value={c.missingRule ?? "ignore"}
                  onChange={(e) => {
                    const value = e.target.value as NonNullable<Column["missingRule"]>;
                    p.setColumns(
                      p.columns.map((x) => (x.key === c.key ? { ...x, missingRule: value } : x)),
                    );
                  }}
                >
                  {isNumeric ? (
                    <>
                      <option value="ignore">Ignorar nos totais</option>
                      <option value="zero">Tratar como zero</option>
                      <option value="interpolate">Interpolação linear</option>
                      <option value="hide-row">Ocultar linha</option>
                    </>
                  ) : (
                    <>
                      <option value="ignore">Exibir "Não informado"</option>
                      <option value="hide-row">Ocultar linha</option>
                    </>
                  )}
                </select>
              </div>
            );
          })}
        <p className="p-2 text-xs text-muted-foreground">
          Valores estimados por interpolação aparecem com um contorno fino na tabela.
        </p>
      </div>
    </div>
  );
}
