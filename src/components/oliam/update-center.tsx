import { useEffect, useState } from "react";
import { Bell, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  APP_VERSION_LABEL,
  CURRENT_UPDATE_ID,
  UPDATE_READ_STORAGE_KEY,
  hasUnreadProductUpdate,
  type ProductUpdate,
} from "@/lib/product-updates";
import { cn } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function UpdateCenter({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [updates, setUpdates] = useState<ProductUpdate[]>([]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    setUnread(hasUnreadProductUpdate(localStorage.getItem(UPDATE_READ_STORAGE_KEY)));
  }, []);

  // O texto das entregas passa de 25 KiB e cresce a cada versão, mas só é lido
  // por quem abre este diálogo. Buscar sob demanda tira esse peso do primeiro
  // carregamento de todo mundo, e o sino continua sabendo a versão e o estado
  // de leitura sem precisar da lista.
  useEffect(() => {
    if (!open || updates.length) return;
    let ativo = true;
    void import("@/lib/product-updates-entries").then((modulo) => {
      if (ativo) setUpdates(modulo.PRODUCT_UPDATES);
    });
    return () => {
      ativo = false;
    };
  }, [open, updates.length]);

  const setOpenAndPersistRead = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen || typeof localStorage === "undefined") return;
    localStorage.setItem(UPDATE_READ_STORAGE_KEY, CURRENT_UPDATE_ID);
    setUnread(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpenAndPersistRead}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={unread ? "Novidades disponíveis" : "Ver atualizações"}
        onClick={() => setOpenAndPersistRead(true)}
        disabled={disabled}
      >
        <Bell />
        <span
          className={cn(
            "absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-background transition-opacity",
            unread ? "opacity-100" : "opacity-0",
          )}
          aria-hidden="true"
          data-testid="update-unread-indicator"
        />
      </Button>
      <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6 pr-12">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-primary">
            <Sparkles className="size-4" />
            <span className="font-mono text-[11px] uppercase tracking-wide">Novidades</span>
            <span className="rounded-full border border-primary/25 bg-primary/5 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide">
              {APP_VERSION_LABEL}
            </span>
          </div>
          <DialogTitle>Atualizações do OliQualidade</DialogTitle>
          <DialogDescription>
            Mudanças recentes para deixar sua análise mais clara e rastreável.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto px-6 pb-6">
          {updates.map((update, index) => (
            <article
              key={update.id}
              className={cn("py-5", index < updates.length - 1 && "border-b border-border")}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {index === 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary">
                    Mais recente
                  </span>
                )}
                <span className="font-mono text-[11px] font-semibold text-primary">
                  v{update.version}
                </span>
                <time
                  className="font-mono text-[11px] text-muted-foreground"
                  dateTime={update.date}
                >
                  {dateFormatter.format(new Date(`${update.date}T00:00:00Z`))}
                </time>
              </div>
              <h3 className="font-display text-base font-semibold">{update.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{update.summary}</p>
              <ul className="mt-3 space-y-2">
                {update.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-2 text-sm leading-relaxed">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
