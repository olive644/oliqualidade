import type { AutoDashboardPlan } from "@/lib/auto-dashboard";
import { conditionalColor, conditionalStyle, fmt } from "@/lib/format";
import type { Column, FilterRule, Row } from "@/lib/types";
import { cn } from "@/lib/utils";

export function InsightSidebar(p: {
  open: boolean;
  data: Row[];
  rowCount: number;
  autoDashboard: AutoDashboardPlan | undefined;
  nums: Column[];
  versionDelta: Map<string, number | null> | null;
  sidebarRanking: { name: string; total: number }[];
  sidebarRankingMax: number;
  cat: Column | undefined;
  primary: Column | undefined;
  dateCol: Column | undefined;
  filters: FilterRule[];
  setFilters: (filters: FilterRule[]) => void;
}) {
  if (!p.open) return null;
  const { cat, primary, dateCol } = p;
  return (
    <aside className="oliam-insight-sidebar hidden shrink-0 overflow-auto lg:block">
      <div className="border-b border-border p-4">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          Visão geral
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {p.data.length} de {p.rowCount} linhas na visão atual
        </p>
      </div>
      {p.autoDashboard && (
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Dashboard sugerido
            </p>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
              {p.autoDashboard.confidence}% confiança
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Criado automaticamente a partir dos tipos, preenchimento e qualidade das colunas.
          </p>
          <div className="mt-3 space-y-2">
            {p.autoDashboard.recommendations.slice(0, 5).map((item) => (
              <div key={item.id} className="rounded-xl border border-border bg-card p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium leading-snug">{item.title}</p>
                  <span className="shrink-0 font-mono text-[10px] text-primary">
                    {item.confidence}%
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {item.reasons[0]}
                </p>
                {item.warnings[0] && (
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-600">
                    {item.warnings[0]}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {p.nums.length > 0 && (
        <div className="border-b border-border p-4">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            KPIs
          </p>
          <div className="grid grid-cols-2 gap-2">
            {p.nums.slice(0, 4).map((c) => {
              const total = p.data.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
              const delta = p.versionDelta?.get(c.key) ?? null;
              const style = conditionalStyle(total, c.kind, c.conditionalFormat);
              return (
                <div
                  key={c.key}
                  className="rounded-xl border border-border bg-card p-2.5 shadow-sm"
                  style={style ?? undefined}
                >
                  <p className="truncate text-[11px] text-muted-foreground">{c.label}</p>
                  <p className="font-mono text-base font-semibold" style={{ color: style?.color }}>
                    {fmt(total, c.kind)}
                  </p>
                  {delta !== null && (
                    <p
                      className={cn(
                        "font-mono text-[10px]",
                        delta >= 0 ? "text-secondary-accent" : "text-destructive",
                      )}
                    >
                      {delta >= 0 ? "+" : ""}
                      {new Intl.NumberFormat("pt-BR", {
                        style: "percent",
                        maximumFractionDigits: 1,
                      }).format(delta)}{" "}
                      vs. anterior
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {p.sidebarRanking.length > 0 && cat && primary && (
        <div className="border-b border-border p-4">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Ranking por {cat.label}
          </p>
          <div className="space-y-0.5">
            {p.sidebarRanking.map((r, i) => {
              const active = p.filters.some((f) => f.key === cat.key && f.value === r.name);
              return (
                <button
                  key={r.name}
                  className={cn(
                    "oliam-ranking-row block w-full text-left transition-opacity hover:opacity-90",
                    active && "opacity-100",
                  )}
                  onClick={() => {
                    if (active) {
                      p.setFilters(p.filters.filter((f) => f.key !== cat.key));
                    } else {
                      p.setFilters([
                        ...p.filters.filter((f) => f.key !== cat.key),
                        { key: cat.key, value: r.name, min: "", max: "" },
                      ]);
                    }
                  }}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs">{r.name || "Não informado"}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {fmt(r.total, primary.kind)}
                    </span>
                  </div>
                  <div className="oliam-ranking-track">
                    <div
                      className="oliam-ranking-fill"
                      style={{
                        width: `${Math.max(4, (Math.abs(r.total) / p.sidebarRankingMax) * 100)}%`,
                        background:
                          conditionalColor(r.total, primary.kind, primary.conditionalFormat) ??
                          (active ? "var(--primary)" : "var(--secondary-accent)"),
                        animationDelay: `${Math.min(i, 10) * 45}ms`,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {dateCol && (
        <div className="p-4">
          <p className="mb-3 text-[11px] uppercase tracking-wide text-muted-foreground">
            Filtrar por {dateCol.label}
          </p>
          {(() => {
            const existing = p.filters.find((f) => f.key === dateCol.key);
            return (
              <div className="flex flex-col gap-2">
                <input
                  className="oliam-input h-9"
                  type="text"
                  placeholder="De, dd/mm/aaaa"
                  value={existing?.min ?? ""}
                  onChange={(e) => {
                    const min = e.target.value;
                    const rest = p.filters.filter((f) => f.key !== dateCol.key);
                    p.setFilters([
                      ...rest,
                      { key: dateCol.key, value: "", min, max: existing?.max ?? "" },
                    ]);
                  }}
                />
                <input
                  className="oliam-input h-9"
                  type="text"
                  placeholder="Até, dd/mm/aaaa"
                  value={existing?.max ?? ""}
                  onChange={(e) => {
                    const max = e.target.value;
                    const rest = p.filters.filter((f) => f.key !== dateCol.key);
                    p.setFilters([
                      ...rest,
                      { key: dateCol.key, value: "", min: existing?.min ?? "", max },
                    ]);
                  }}
                />
              </div>
            );
          })()}
        </div>
      )}
    </aside>
  );
}
