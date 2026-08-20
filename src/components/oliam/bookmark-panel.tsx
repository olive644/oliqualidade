import { useState } from "react";
import { Bookmark as BookmarkIcon, BookmarkPlus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Bookmark } from "@/lib/types";

/**
 * Botão + painel suspenso de marcadores (estado nomeado de filtros, busca e
 * ordenação). Autocontido: guarda o próprio estado de abrir/fechar e o nome
 * em edição; o chamador só precisa saber aplicar, remover e salvar um
 * marcador — não sabe que existe um painel suspenso.
 */
export function BookmarkPanel({
  bookmarks,
  onApply,
  onRemove,
  onSave,
}: {
  bookmarks: Bookmark[];
  onApply: (bookmark: Bookmark) => void;
  onRemove: (id: string) => void;
  onSave: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
  };

  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        <BookmarkIcon />
        <span className="hidden sm:inline">Marcadores</span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
          <div className="flex items-center justify-between border-b p-3">
            <strong className="text-sm">Marcadores</strong>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
              <X />
            </Button>
          </div>
          <div className="max-h-72 overflow-auto p-2">
            {bookmarks.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">
                Nenhum marcador salvo ainda. Ajuste os filtros e salve o estado atual abaixo.
              </p>
            )}
            {bookmarks.map((b) => (
              <div key={b.id} className="flex items-center gap-1 p-1">
                <button
                  className="flex-1 truncate px-2 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onApply(b);
                    setOpen(false);
                  }}
                >
                  {b.name}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 pointer-coarse:size-12"
                  aria-label={`Excluir marcador ${b.name}`}
                  onClick={() => onRemove(b.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t p-3">
            <input
              className="oliam-input h-9 flex-1"
              placeholder="Nome do marcador…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
            <Button
              size="icon"
              aria-label="Salvar estado atual como marcador"
              disabled={!name.trim()}
              onClick={save}
            >
              <BookmarkPlus />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
