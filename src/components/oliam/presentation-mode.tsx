import { useEffect, useState } from "react";
import { Minimize2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Mark } from "./mark";
import type { Bookmark } from "@/lib/types";

/**
 * Estado e barra superior do modo apresentação: reaproveita a mesma grade de
 * widgets em tela cheia (renderizada pelo chamador, que ainda decide o que
 * vai dentro do overlay — este hook não conhece `gridContent`), com opção de
 * alternar sozinho entre os marcadores salvos a cada N segundos.
 * `applyBookmark` continua responsabilidade do chamador porque mexe em
 * estado que também pertence à tela principal (busca, ordenação, filtros),
 * não só à apresentação.
 */
export function usePresentationMode(
  dashboardName: string,
  bookmarks: Bookmark[],
  applyBookmark: (bookmark: Bookmark) => void,
) {
  const [presentation, setPresentation] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);
  const [intervalSeconds, setIntervalSeconds] = useState(10);

  const startPresentation = () => {
    setPresentIndex(0);
    const first = bookmarks[0];
    if (first) applyBookmark(first);
    setPresentation(true);
  };

  useEffect(() => {
    if (!presentation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresentation(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentation]);

  useEffect(() => {
    if (!presentation || !autoPlay || bookmarks.length === 0) return;
    const id = setInterval(() => {
      setPresentIndex((i) => {
        const next = (i + 1) % bookmarks.length;
        const bm = bookmarks[next];
        if (bm) applyBookmark(bm);
        return next;
      });
    }, intervalSeconds * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentation, autoPlay, intervalSeconds, bookmarks.length]);

  const presentationBar = (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Mark />
        <span className="font-display text-sm font-medium text-foreground">{dashboardName}</span>
        {bookmarks.length > 0 && (
          <span className="font-mono">
            · marcador {presentIndex + 1}/{bookmarks.length}
            {bookmarks[presentIndex] ? `: ${bookmarks[presentIndex].name}` : ""}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {bookmarks.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label={autoPlay ? "Pausar alternância automática" : "Alternar automaticamente"}
              onClick={() => setAutoPlay((v) => !v)}
            >
              {autoPlay ? <Pause /> : <Play />}
            </Button>
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              a cada
              <input
                type="number"
                min={3}
                className="oliam-input h-8 w-14 text-center"
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Math.max(3, Number(e.target.value) || 3))}
              />
              s
            </label>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setAutoPlay(false);
            setPresentation(false);
          }}
        >
          <Minimize2 />
          Sair (Esc)
        </Button>
      </div>
    </div>
  );

  return { presentation, startPresentation, presentationBar };
}
