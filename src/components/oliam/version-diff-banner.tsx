import { GitMerge } from "lucide-react";
import type { VersionDiff } from "@/lib/import-workbench";
import { cn } from "@/lib/utils";

export function VersionDiffBanner(p: { diff: VersionDiff | null }) {
  if (!p.diff) return null;
  const diff = p.diff;
  return (
    <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        <GitMerge className="size-4 text-primary" /> Comparação com a versão anterior
      </div>
      {diff.reason && (
        <p
          className={cn(
            "mt-3 rounded-xl border px-3 py-2 text-xs",
            diff.status === "incompatible"
              ? "border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-300"
              : "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300",
          )}
        >
          {diff.reason}
        </p>
      )}
      {diff.status !== "incompatible" && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <span className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            +{diff.added} linhas adicionadas
          </span>
          <span className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            −{diff.removed} linhas removidas
          </span>
          <span className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            {diff.changed} linhas alteradas
          </span>
        </div>
      )}
      {(diff.addedColumns.length > 0 ||
        diff.removedColumns.length > 0 ||
        diff.typeChanges.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          {diff.addedColumns.map((column) => (
            <span key={`add-${column}`} className="rounded-full border px-2.5 py-1">
              Nova coluna: {column}
            </span>
          ))}
          {diff.removedColumns.map((column) => (
            <span key={`remove-${column}`} className="rounded-full border px-2.5 py-1">
              Coluna não reconhecida na nova versão: {column}
            </span>
          ))}
          {diff.typeChanges.map((change) => (
            <span key={`type-${change.column}`} className="rounded-full border px-2.5 py-1">
              {change.column}: {change.before} → {change.after}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
