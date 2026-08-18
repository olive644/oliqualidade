import { GitMerge } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Widget } from "@/lib/types";
import { sizeClass, spanClass } from "@/lib/widgets";
import type { VersionDiff } from "@/lib/import-workbench";
import { WidgetHead, type WidgetDragProps } from "./widget-support";

export function VersionCompareWidgetBody({
  widget: w,
  versionDiff,
  dragProps,
  sizeControls,
  animationDelay,
}: {
  widget: Widget;
  versionDiff: VersionDiff | null;
  dragProps: WidgetDragProps;
  sizeControls: React.ReactNode;
  animationDelay: number;
}) {
  const stats = versionDiff
    ? [
        ["Adicionadas", versionDiff.added, "text-emerald-700 dark:text-emerald-300"],
        ["Alteradas", versionDiff.changed, "text-amber-700 dark:text-amber-300"],
        ["Removidas", versionDiff.removed, "text-destructive"],
      ]
    : [];
  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={w.title || "Comparador de versões"}
        icon={<GitMerge className="size-3.5 text-primary" />}
        {...dragProps}
      />
      {sizeControls}
      {!versionDiff ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          Reimporte esta aba para criar uma base de comparação.
        </p>
      ) : (
        <div className="p-4">
          <div className="grid grid-cols-3 gap-2">
            {stats.map(([label, value, className]) => (
              <div key={String(label)} className="rounded-xl border border-border bg-muted/10 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className={cn("mt-1 font-mono text-2xl font-bold", className)}>{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Método:{" "}
            {versionDiff.comparisonMethod === "key"
              ? "chave estável"
              : versionDiff.comparisonMethod === "position"
                ? "posição das linhas"
                : versionDiff.comparisonMethod === "shared-values"
                  ? "valores compartilhados"
                  : "incompatível"}
            .{versionDiff.reason ? ` ${versionDiff.reason}` : ""}
          </p>
          {(versionDiff.addedColumns.length > 0 || versionDiff.removedColumns.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              {versionDiff.addedColumns.map((column) => (
                <span
                  key={`add-${column}`}
                  className="rounded-full bg-emerald-500/12 px-2 py-1 text-emerald-700 dark:text-emerald-300"
                >
                  + {column}
                </span>
              ))}
              {versionDiff.removedColumns.map((column) => (
                <span
                  key={`remove-${column}`}
                  className="rounded-full bg-destructive/12 px-2 py-1 text-destructive"
                >
                  − {column}
                </span>
              ))}
            </div>
          )}
          {versionDiff.cellChanges.length > 0 && (
            <div className="mt-4 overflow-auto rounded-xl border border-border">
              <div className="flex items-center justify-between border-b border-border bg-muted/20 px-3 py-2">
                <p className="text-xs font-semibold">Alterações célula a célula</p>
                <span className="text-[11px] text-muted-foreground">
                  {versionDiff.cellChanges.length} exibidas
                </span>
              </div>
              <table className="w-full min-w-[36rem] text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-3 py-2">Linha / chave</th>
                    <th className="px-3 py-2">Coluna</th>
                    <th className="px-3 py-2">Anterior</th>
                    <th className="px-3 py-2">Atual</th>
                  </tr>
                </thead>
                <tbody>
                  {versionDiff.cellChanges.slice(0, 100).map((change, index) => (
                    <tr
                      key={`${change.row}-${change.column}-${index}`}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td
                        className="max-w-48 truncate px-3 py-2 font-mono text-[11px]"
                        title={change.identity}
                      >
                        {change.identity || `linha ${change.row}`}
                      </td>
                      <td className="px-3 py-2 font-medium">{change.column}</td>
                      <td
                        className="max-w-56 truncate px-3 py-2 text-destructive line-through"
                        title={String(change.before ?? "")}
                      >
                        {String(change.before ?? "vazio")}
                      </td>
                      <td
                        className="max-w-56 truncate px-3 py-2 text-emerald-700 dark:text-emerald-300"
                        title={String(change.after ?? "")}
                      >
                        {String(change.after ?? "vazio")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
