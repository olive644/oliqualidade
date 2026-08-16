import { Calculator, ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormulaColumnEditor } from "@/components/oliam/formula-column-editor";
import { columnDragType } from "@/lib/widgets";
import { kinds, type Column } from "@/lib/types";
import {
  semanticRoleLabels,
  semanticUnitOptions,
  type ColumnSemanticProfile,
  type SemanticRole,
} from "@/lib/spreadsheet-intelligence";

export function ColumnPanel(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: Column[];
  setColumns: (columns: Column[]) => void;
  semanticProfilesByKey: Map<string, ColumnSemanticProfile>;
  semanticOverrides: Record<string, { role?: SemanticRole; unit?: string | null }> | undefined;
  setSemanticOverride: (
    columnKey: string,
    patch: { role?: SemanticRole; unit?: string | null },
  ) => void;
  resetSemanticOverride: (columnKey: string) => void;
}) {
  if (!p.open) return null;
  return (
    <div className="absolute inset-x-4 top-28 z-40 w-auto overflow-hidden rounded-2xl border border-border bg-card shadow-panel sm:inset-x-auto sm:right-4 sm:w-[42rem]">
      <div className="flex items-center justify-between border-b p-3">
        <div>
          <strong className="text-sm">Colunas e significado</strong>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Confirme o papel e a unidade usados nas análises.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => p.onOpenChange(false)}>
          <X />
        </Button>
      </div>
      <div className="max-h-[32rem] overflow-auto p-2">
        {p.columns.map((c, i) => {
          const profile = p.semanticProfilesByKey.get(c.key);
          const overridden = Boolean(p.semanticOverrides?.[c.key]);
          return (
            <div
              key={c.key}
              draggable
              onDragStart={(e) => {
                // Reordenar dentro desta lista (texto = índice de origem).
                e.dataTransfer.setData("text/plain", String(i));
                // Arrastar para um slot de campo de gráfico fora da lista
                // (tipo MIME sintético que já embute o Kind da coluna,
                // ver columnDragType em src/lib/widgets.ts).
                e.dataTransfer.setData(columnDragType(c.kind), c.key);
                e.dataTransfer.effectAllowed = "all";
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData("text/plain"));
                if (Number.isNaN(from) || from === i) return;
                const next = [...p.columns];
                const moved = next.splice(from, 1)[0];
                if (!moved) return;
                next.splice(i, 0, moved);
                p.setColumns(next);
              }}
              className="border-b border-border/70 p-2 text-sm last:border-b-0 hover:bg-accent/50"
            >
              <div className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={c.visible}
                    onChange={() =>
                      p.setColumns(
                        p.columns.map((x, j) => (j === i ? { ...x, visible: !x.visible } : x)),
                      )
                    }
                  />
                  <GripVertical
                    className="size-4 shrink-0 cursor-grab text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium">
                    {c.label}
                    {c.formula && (
                      <Calculator
                        className="ml-1 inline size-3 text-secondary-accent"
                        aria-label="Coluna calculada"
                      />
                    )}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {kinds[c.kind]}
                  </span>
                </label>
                <div className="flex shrink-0 flex-col">
                  <button
                    className="disabled:opacity-30"
                    aria-label={`Mover ${c.label} para cima`}
                    disabled={i === 0}
                    onClick={() => {
                      if (i === 0) return;
                      const next = [...p.columns];
                      const a = next[i - 1],
                        b = next[i];
                      if (!a || !b) return;
                      next[i - 1] = b;
                      next[i] = a;
                      p.setColumns(next);
                    }}
                  >
                    <ChevronUp className="size-3" />
                  </button>
                  <button
                    className="disabled:opacity-30"
                    aria-label={`Mover ${c.label} para baixo`}
                    disabled={i === p.columns.length - 1}
                    onClick={() => {
                      if (i === p.columns.length - 1) return;
                      const next = [...p.columns];
                      const a = next[i],
                        b = next[i + 1];
                      if (!a || !b) return;
                      next[i] = b;
                      next[i + 1] = a;
                      p.setColumns(next);
                    }}
                  >
                    <ChevronDown className="size-3" />
                  </button>
                </div>
              </div>
              <div className="mt-2 grid gap-2 pl-10 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-center">
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  Papel
                  <select
                    className="oliam-select h-7 min-w-0 flex-1"
                    value={profile?.role ?? "unknown"}
                    onChange={(event) =>
                      p.setSemanticOverride(c.key, {
                        role: event.target.value as SemanticRole,
                      })
                    }
                  >
                    {Object.entries(semanticRoleLabels).map(([role, label]) => (
                      <option key={role} value={role}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  Unidade
                  <select
                    className="oliam-select h-7 min-w-0 flex-1"
                    value={profile?.unit ?? ""}
                    onChange={(event) =>
                      p.setSemanticOverride(c.key, { unit: event.target.value || null })
                    }
                  >
                    <option value="">Sem unidade</option>
                    {semanticUnitOptions.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
                  <span>{profile?.confidence ?? 0}%</span>
                  {overridden ? (
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => p.resetSemanticOverride(c.key)}
                    >
                      Usar automático
                    </button>
                  ) : (
                    <span>Automático</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t p-3">
        <FormulaColumnEditor columns={p.columns} onAddColumn={p.setColumns} />
      </div>
    </div>
  );
}
