import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QualitySignal } from "@/lib/data-pipeline";

export function QualitySignalsPanel(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visibleSignals: QualitySignal[];
  onDismiss: (key: string) => void;
}) {
  if (!p.open) return null;
  return (
    <div className="absolute inset-x-4 top-28 z-40 w-auto max-w-96 overflow-hidden rounded-2xl border border-border bg-card shadow-panel sm:inset-x-auto sm:right-4 sm:w-96">
      <div className="flex items-center justify-between border-b p-3">
        <strong className="text-sm">Qualidade dos dados</strong>
        <Button variant="ghost" size="icon" onClick={() => p.onOpenChange(false)}>
          <X />
        </Button>
      </div>
      {p.visibleSignals.length === 0 ? (
        <p className="p-4 text-[12px] text-muted-foreground">
          Nenhum problema encontrado nos dados atuais.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto p-2">
          {p.visibleSignals.map((s) => (
            <div
              key={`${s.kind}-${s.columnKey}`}
              className="flex items-start gap-2 border-b p-2 text-[12px] last:border-b-0"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <p className="flex-1 leading-relaxed">{s.message}</p>
              <button
                className="shrink-0 p-0.5"
                aria-label="Dispensar aviso"
                onClick={() => p.onDismiss(`${s.kind}-${s.columnKey}`)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
