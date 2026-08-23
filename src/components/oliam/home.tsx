import { useState } from "react";
import { Check, CheckSquare2, Copy, Pin, Plus, Square, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { fmt, hue } from "@/lib/format";
import type { Dashboard } from "@/lib/types";
import { Mark } from "./mark";
import { ThemeToggle } from "./theme-toggle";

export function Home(p: {
  dashboards: Dashboard[];
  openDash: (id: string) => void;
  newDash: () => void;
  duplicateDash: (id: string) => void;
  deleteDash: (id: string) => void;
  deleteDashboards: (ids: string[]) => void;
  togglePin: (id: string) => void;
  theme: string;
  toggleTheme: () => void;
}) {
  const sorted = [...p.dashboards].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  );
  const [pendingDelete, setPendingDelete] = useState<Dashboard | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const selectedCount = selectedIds.size;
  const allSelected = selectedCount === sorted.length;
  const leaveSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };
  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const totalRows = p.dashboards.reduce(
    (sum, d) => sum + d.sheets.reduce((s, sh) => s + sh.rows.length, 0),
    0,
  );
  return (
    <div className="oliam-home-shell flex min-h-screen flex-col bg-canvas">
      <header className="oliam-topbar sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Mark />
          <strong className="font-display text-lg tracking-tight">Oli.Qualidade</strong>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle theme={p.theme} toggle={p.toggleTheme} />
          <Button onClick={p.newDash} className="shadow-sm">
            <Plus />
            Novo painel
          </Button>
        </div>
      </header>
      <section className="relative flex-1 overflow-hidden">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 opacity-70"
          style={{
            background:
              "radial-gradient(60% 100% at 15% 0%, color-mix(in oklab, var(--primary) 16%, transparent), transparent), radial-gradient(45% 80% at 85% 10%, color-mix(in oklab, var(--secondary-accent) 14%, transparent), transparent)",
          }}
          aria-hidden="true"
        />
        <div className="oliam-home-main mx-auto w-full max-w-6xl px-6 pb-14 pt-12">
          <div className="mb-9 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-primary shadow-sm">
                <span className="size-1.5 rounded-full bg-primary" />
                Seus painéis
              </p>
              <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                Escolha um painel para continuar
              </h1>
              <p className="mt-2.5 max-w-lg text-sm text-muted-foreground">
                Cada painel guarda seus próprios dados, filtros e gráficos, de forma independente.
              </p>
            </div>
            {sorted.length > 0 && (
              <div className="flex shrink-0 flex-wrap gap-3">
                <Button
                  variant={selectionMode ? "secondary" : "outline"}
                  onClick={() => (selectionMode ? leaveSelectionMode() : setSelectionMode(true))}
                >
                  {selectionMode ? <X /> : <CheckSquare2 />}
                  {selectionMode ? "Cancelar seleção" : "Selecionar painéis"}
                </Button>
                <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
                  <p className="font-display text-xl font-semibold">{p.dashboards.length}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Painéis
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
                  <p className="font-display text-xl font-semibold">{fmt(totalRows, "number")}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Linhas ao todo
                  </p>
                </div>
              </div>
            )}
          </div>
          {sorted.length === 0 ? (
            <button className="oliam-dropzone w-full" onClick={p.newDash}>
              <Plus className="size-6 text-primary" />
              <strong>Criar seu primeiro painel</strong>
              <span className="text-sm text-muted-foreground">Envie uma planilha para começar</span>
            </button>
          ) : (
            <div>
              {selectionMode && (
                <div
                  className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between"
                  role="toolbar"
                  aria-label="Ações da seleção de painéis"
                >
                  <p className="text-sm font-medium" aria-live="polite">
                    {selectedCount === 0
                      ? "Selecione os painéis que deseja apagar"
                      : `${selectedCount} painel${selectedCount === 1 ? "" : "is"} selecionado${selectedCount === 1 ? "" : "s"}`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSelectedIds(allSelected ? new Set() : new Set(sorted.map((d) => d.id)))
                      }
                    >
                      {allSelected ? <Square /> : <CheckSquare2 />}
                      {allSelected ? "Limpar seleção" : "Selecionar todos"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={selectedCount === 0}
                      onClick={() => setPendingBulkDelete(true)}
                    >
                      <Trash2 />
                      Apagar selecionados
                    </Button>
                  </div>
                </div>
              )}
              <div className="oliam-dashboard-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sorted.map((d, i) => (
                  <article
                    key={d.id}
                    className={cn(
                      "oliam-widget oliam-dashboard-card group relative bg-card",
                      selectionMode && "cursor-pointer",
                      selectedIds.has(d.id) &&
                        "ring-2 ring-primary ring-offset-2 ring-offset-canvas",
                    )}
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <span
                      className="absolute inset-x-0 top-0 h-1"
                      style={{ background: hue(d.id) }}
                      aria-hidden="true"
                    />
                    <button
                      className="block w-full p-5 pt-6 text-left"
                      onClick={() => (selectionMode ? toggleSelected(d.id) : p.openDash(d.id))}
                      aria-pressed={selectionMode ? selectedIds.has(d.id) : undefined}
                    >
                      {selectionMode && (
                        <span
                          className={cn(
                            "absolute left-3 top-3 z-10 flex size-7 items-center justify-center rounded-lg border bg-card",
                            selectedIds.has(d.id) &&
                              "border-primary bg-primary text-primary-foreground",
                          )}
                          aria-hidden="true"
                        >
                          {selectedIds.has(d.id) ? (
                            <Check className="size-4" />
                          ) : (
                            <Square className="size-4" />
                          )}
                        </span>
                      )}
                      <span className="mb-4 flex items-center gap-2.5">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-xl font-display text-sm font-semibold text-white"
                          style={{ background: hue(d.id) }}
                          aria-hidden="true"
                        >
                          {d.name.trim().charAt(0).toUpperCase() || "P"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            {d.pinned && (
                              <Pin className="size-3 shrink-0 fill-primary text-primary" />
                            )}
                            <span className="truncate font-display text-base font-semibold">
                              {d.name}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            Atualizado em {new Date(d.updatedAt).toLocaleDateString("pt-BR")}
                          </span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2 border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
                        <span className="rounded-md bg-muted px-1.5 py-0.5">
                          {d.sheets.reduce((s, sh) => s + sh.rows.length, 0)} linhas
                        </span>
                        <span className="rounded-md bg-muted px-1.5 py-0.5">
                          {d.sheets.reduce((s, sh) => s + sh.columns.length, 0)} colunas
                        </span>
                        {d.sheets.length > 1 && (
                          <span className="rounded-md bg-muted px-1.5 py-0.5">
                            {d.sheets.length} abas
                          </span>
                        )}
                      </span>
                    </button>
                    <div
                      className={cn(
                        "oliam-home-card-actions absolute right-2 top-3.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100",
                        selectionMode && "pointer-events-none hidden",
                      )}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 bg-card/80 backdrop-blur-sm"
                        aria-label={d.pinned ? "Desafixar painel" : "Fixar painel"}
                        onClick={() => p.togglePin(d.id)}
                      >
                        <Pin className={cn("size-3.5", d.pinned && "fill-primary text-primary")} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 bg-card/80 backdrop-blur-sm"
                        aria-label="Duplicar painel"
                        onClick={() => p.duplicateDash(d.id)}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 bg-card/80 backdrop-blur-sm"
                        aria-label="Excluir painel"
                        onClick={() => setPendingDelete(d)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação não pode ser desfeita. Os dados, filtros e gráficos desse painel serão
              apagados permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) p.deleteDash(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Excluir painel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={pendingBulkDelete} onOpenChange={setPendingBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Apagar {selectedCount} painel{selectedCount === 1 ? "" : "is"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Os painéis selecionados e todos os seus dados, filtros e gráficos serão apagados
              permanentemente. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                p.deleteDashboards([...selectedIds]);
                setPendingBulkDelete(false);
                leaveSelectionMode();
              }}
            >
              Apagar {selectedCount} painel{selectedCount === 1 ? "" : "is"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
