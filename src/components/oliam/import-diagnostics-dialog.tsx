import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  clearImportMetrics,
  summarizeImportMetrics,
  type ImportMetricEntry,
} from "@/lib/import-metrics";
import { loadImportMetrics } from "@/lib/storage";
import type { WorkbookReaderId } from "@/lib/workbook-reading-engine";

const readerLabels: Record<WorkbookReaderId, string> = {
  "sheetjs-verified": "SheetJS (verificado por OOXML)",
  sheetjs: "SheetJS",
  "rust-wasm": "Rust/WASM",
  "ooxml-recovery": "Recuperação OOXML (fallback)",
};

/**
 * Consome o histórico local de `import-metrics.ts` (coletado em toda
 * importação desde a etapa anterior, mas até agora sem nenhum consumidor de
 * UI) para responder à pergunta que motivou a coleta: o leitor experimental
 * Rust/WASM está ajudando ou só custando mais caro? Carrega sob demanda
 * (só quando o diálogo abre), não mantém nada em cache entre aberturas.
 */
export function ImportDiagnosticsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [entries, setEntries] = useState<ImportMetricEntry[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const stored = await loadImportMetrics();
      if (active) setEntries(stored);
    })();
    return () => {
      active = false;
    };
  }, [open]);

  const summary = entries ? summarizeImportMetrics(entries) : null;
  const readerRows = summary
    ? (Object.entries(summary.byReader) as [WorkbookReaderId, number][])
    : [];

  const handleClear = async () => {
    await clearImportMetrics();
    setEntries([]);
    setConfirmClear(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Diagnóstico de importação</DialogTitle>
            <DialogDescription>
              Histórico local de leitores usados, tempo por importação e divergências entre o leitor
              experimental (Rust/WASM) e o leitor padrão. Nada do conteúdo das planilhas fica
              guardado aqui. São armazenadas apenas contagens, durações e bytes.
            </DialogDescription>
          </DialogHeader>
          {entries === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma importação registrada ainda nesta sessão do navegador.
            </p>
          ) : (
            summary && (
              <>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-border px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">Importações registradas</div>
                    <strong className="font-display text-lg">{summary.totalImports}</strong>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">Falhas</div>
                    <strong className="font-display text-lg">{summary.failedImports}</strong>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">
                      Fallback para o leitor padrão
                    </div>
                    <strong className="font-display text-lg">{summary.fallbackCount}</strong>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">
                      Paridade Rust/WASM (shadow)
                    </div>
                    <strong className="font-display text-sm">
                      {summary.wasmShadowMatched} ok · {summary.wasmShadowDiverged} divergiu ·{" "}
                      {summary.wasmShadowFailed} falhou
                    </strong>
                  </div>
                </div>
                {readerRows.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Leitor</th>
                          <th className="px-3 py-2 text-right font-medium">Importações</th>
                          <th className="px-3 py-2 text-right font-medium">Tempo médio</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {readerRows.map(([reader, count]) => (
                          <tr key={reader}>
                            <td className="px-3 py-2">{readerLabels[reader] ?? reader}</td>
                            <td className="px-3 py-2 text-right font-mono">{count}</td>
                            <td className="px-3 py-2 text-right font-mono">
                              {Math.round(summary.avgElapsedMsByReader[reader] ?? 0)} ms
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )
          )}
          <DialogFooter>
            {entries !== null && entries.length > 0 && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmClear(true)}
              >
                Limpar histórico
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar histórico de importação?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação não pode ser desfeita. As métricas registradas localmente serão apagadas
              permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleClear()}
            >
              Limpar histórico
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
