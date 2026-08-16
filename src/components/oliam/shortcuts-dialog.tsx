import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SHORTCUTS = [
  { keys: "⌘K / Ctrl+K", label: "Abrir a paleta de comandos" },
  { keys: "? ou ⌘/ / Ctrl+/", label: "Abrir esta referência de atalhos" },
  { keys: "Clique numa barra ou fatia", label: "Filtrar a base pelo grupo clicado" },
  { keys: "Arrastar ou ↑ / ↓", label: "Reordenar colunas no painel de colunas" },
  {
    keys: "Arrastar o cabeçalho ou ← / →",
    label: "Reordenar widgets no painel",
  },
  { keys: "⌘Z / Ctrl+Z", label: "Desfazer a última alteração no painel" },
  { keys: "⇧⌘Z / Ctrl+Shift+Z", label: "Refazer a alteração desfeita" },
  { keys: "Esc", label: "Sair do modo apresentação" },
  { keys: "Enter", label: "Confirmar edição de nome do painel ou de coluna" },
];

export function ShortcutsDialog(p: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atalhos de teclado</DialogTitle>
          <DialogDescription>Ações rápidas disponíveis dentro de um painel.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="text-muted-foreground">{s.label}</span>
              <kbd className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11px]">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
