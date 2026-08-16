import { X } from "lucide-react";
import { numericKinds, type Column, type FilterRule } from "@/lib/types";

export function FilterChipsBar(p: {
  filters: FilterRule[];
  columns: Column[];
  setFilters: (filters: FilterRule[]) => void;
}) {
  if (p.filters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2">
      {p.filters.length > 1 && (
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
          onClick={() => p.setFilters([])}
        >
          Limpar {p.filters.length} filtros
        </button>
      )}
      {p.filters.map((f, i) => {
        const col = p.columns.find((c) => c.key === f.key);
        const isRange = col && (numericKinds.includes(col.kind) || col.kind === "date");
        return (
          <div
            className="flex items-center rounded-full border border-border bg-accent text-xs"
            key={i}
          >
            <span className="px-2 text-muted-foreground">{col?.label}</span>
            {isRange ? (
              <>
                <input
                  autoFocus
                  type={col.kind === "date" ? "text" : "number"}
                  className="w-20 bg-transparent py-1 outline-none"
                  placeholder={col.kind === "date" ? "dd/mm/aaaa" : "mín"}
                  value={f.min ?? ""}
                  onChange={(e) =>
                    p.setFilters(
                      p.filters.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)),
                    )
                  }
                />
                <span className="text-muted-foreground">–</span>
                <input
                  type={col.kind === "date" ? "text" : "number"}
                  className="w-20 bg-transparent py-1 outline-none"
                  placeholder={col.kind === "date" ? "dd/mm/aaaa" : "máx"}
                  value={f.max ?? ""}
                  onChange={(e) =>
                    p.setFilters(
                      p.filters.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)),
                    )
                  }
                />
              </>
            ) : (
              <input
                autoFocus
                className="w-24 bg-transparent py-1 outline-none"
                placeholder="valor…"
                value={f.value}
                onChange={(e) =>
                  p.setFilters(
                    p.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                  )
                }
              />
            )}
            <button
              className="rounded-r-full p-1.5 pr-2.5 text-muted-foreground transition-colors hover:text-destructive"
              aria-label="Remover filtro"
              onClick={() => p.setFilters(p.filters.filter((_, j) => j !== i))}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
