import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SheetOption } from "@/lib/import";

/**
 * Seletor de aba, usado quando um workbook XLSX tem mais de uma aba com
 * dado. Reaproveitado tanto na importação principal (novo painel) quanto no
 * fluxo de "combinar planilha" dentro de um painel existente — ambos só
 * diferem no que fazem com a aba escolhida (`onConfirm`).
 */
export function SheetPickerDialog({
  fileName,
  sheets,
  selected,
  onSelectedChange,
  onConfirm,
  onCancel,
}: {
  fileName: string;
  sheets: SheetOption[];
  selected: number;
  onSelectedChange: (i: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Escolher aba para importar</DialogTitle>
          <DialogDescription>
            {fileName} tem {sheets.length} abas com dado. Escolha qual você quer importar — o resto
            fica de fora por enquanto.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              className={cn(
                "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors",
                i === selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
              )}
              onClick={() => onSelectedChange(i)}
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-muted-foreground">{s.rows.length} linhas</span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={onConfirm}>Importar aba selecionada</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
