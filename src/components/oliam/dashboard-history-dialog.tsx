import { History, RotateCcw, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DashboardVersion } from "@/lib/dashboard-history";

/**
 * Histórico de montagem do painel.
 *
 * Não substitui o desfazer: o desfazer serve para voltar um passo enquanto se
 * trabalha, e vive na memória da aba. Este histórico serve para voltar a um
 * arranjo de dias atrás, sobrevive ao fechamento do app e diz o que mudou em
 * cada ponto — sem ele, "voltar ao que estava" dependia de lembrar e refazer
 * na mão.
 */
export function DashboardHistoryDialog({
  open,
  onOpenChange,
  versions,
  onRestore,
  onSaveVersion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versions: DashboardVersion[];
  onRestore: (version: DashboardVersion) => void;
  onSaveVersion: () => void;
}) {
  const formatarData = (timestamp: number) =>
    new Date(timestamp).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" /> Histórico do painel
          </DialogTitle>
          <DialogDescription>
            Como este painel esteve montado. Restaurar traz de volta os widgets, os filtros e as
            colunas visíveis. As linhas da planilha não mudam.
          </DialogDescription>
        </DialogHeader>

        <Button variant="outline" size="sm" className="self-start" onClick={onSaveVersion}>
          <Save className="size-3.5" />
          Guardar como está agora
        </Button>

        {versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma versão guardada ainda. O histórico começa na primeira alteração do painel.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {versions.map((version) => (
              <li key={version.id} className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    {formatarData(version.createdAt)}
                    {version.manual && (
                      <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-normal text-primary">
                        guardada por você
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{version.summary}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => onRestore(version)}>
                  <RotateCcw className="size-3.5" />
                  Restaurar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
