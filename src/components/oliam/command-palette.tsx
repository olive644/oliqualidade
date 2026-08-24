import {
  Activity,
  ClipboardPaste,
  Columns3,
  Download,
  FileImage,
  FileText,
  FolderSync,
  GitMerge,
  HelpCircle,
  History,
  LayoutGrid,
  Maximize2,
  Moon,
  Palette,
  Redo2,
  Sheet as SheetIcon,
  ShieldAlert,
  Sigma,
  Sun,
  Undo2,
  Upload,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { FolderMonitorView } from "@/lib/folder-monitor";
import type { GlobalSearchEntry } from "@/lib/global-search";

export function CommandPalette(p: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  pasteCopiedWidget: () => void;
  hasWidgetClipboard: boolean;
  reimport: () => void;
  folderMonitor: FolderMonitorView | undefined;
  connectFolder: () => void;
  disconnectFolder: () => void;
  exportXlsx: () => void;
  exportCorrectedWorkbook: () => void;
  exportAuditCsv: () => void;
  exportComparisonCsv: () => void;
  exportReviewPdf: () => void | Promise<void>;
  exportPng: () => void | Promise<void>;
  exportPdf: () => void | Promise<void>;
  exportEncryptedBackup: () => void | Promise<void>;
  onRestoreBackup: () => void;
  onOpenFormatPanel: () => void;
  onOpenShortcuts: () => void;
  onOpenImportDiagnostics: () => void;
  onOpenColumnsPanel: () => void;
  startPresentation: () => void;
  openJoin: () => void;
  theme: string;
  toggleTheme: () => void;
  backHome: () => void;
  /** Tudo que existe no painel e pode ser encontrado pelo nome. */
  searchEntries: GlobalSearchEntry[];
  onSelectSearchEntry: (entry: GlobalSearchEntry) => void;
}) {
  const grupos: { kind: GlobalSearchEntry["kind"]; heading: string; icon: React.ReactNode }[] = [
    { kind: "widget", heading: "Widgets", icon: <LayoutGrid /> },
    { kind: "column", heading: "Colunas", icon: <Columns3 /> },
    { kind: "metric", heading: "Métricas", icon: <Sigma /> },
    { kind: "sheet", heading: "Abas", icon: <SheetIcon /> },
    { kind: "dashboard", heading: "Painéis", icon: <LayoutGrid /> },
  ];
  return (
    <CommandDialog open={p.open} onOpenChange={p.onOpenChange}>
      <CommandInput placeholder="Buscar coluna, widget, aba, painel ou ação…" />
      <CommandList>
        <CommandEmpty>Nada encontrado neste painel.</CommandEmpty>
        {grupos.map((grupo) => {
          const itens = p.searchEntries.filter((entry) => entry.kind === grupo.kind);
          if (!itens.length) return null;
          return (
            <CommandGroup key={grupo.kind} heading={grupo.heading}>
              {itens.map((entry) => (
                <CommandItem
                  key={entry.id}
                  // O valor é o que o cmdk compara com o texto digitado. Sem
                  // as palavras-chave aqui, procurar "cidade" não acharia o
                  // gráfico que agrupa por cidade mas se chama outra coisa.
                  value={`${entry.label} ${entry.hint} ${entry.keywords}`}
                  onSelect={() => p.onSelectSearchEntry(entry)}
                >
                  {grupo.icon}
                  <span className="truncate">{entry.label}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {entry.hint}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        <CommandGroup heading="Ações">
          <CommandItem onSelect={p.undo} disabled={!p.canUndo}>
            <Undo2 />
            Desfazer
          </CommandItem>
          <CommandItem onSelect={p.redo} disabled={!p.canRedo}>
            <Redo2 />
            Refazer
          </CommandItem>
          <CommandItem onSelect={() => p.pasteCopiedWidget()} disabled={!p.hasWidgetClipboard}>
            <ClipboardPaste />
            Colar widget copiado
          </CommandItem>
          <CommandItem onSelect={p.reimport}>
            <Upload />
            Importar nova versão
          </CommandItem>
          <CommandItem
            onSelect={
              p.folderMonitor?.status === "error" || !p.folderMonitor
                ? p.connectFolder
                : p.disconnectFolder
            }
          >
            <FolderSync />
            {p.folderMonitor?.status === "error"
              ? "Reconectar pasta monitorada"
              : p.folderMonitor
                ? "Desconectar pasta monitorada"
                : "Monitorar pasta local"}
          </CommandItem>
          <CommandItem onSelect={p.exportXlsx}>
            <Download />
            Exportar XLSX
          </CommandItem>
          <CommandItem onSelect={p.exportCorrectedWorkbook}>
            <SheetIcon />
            Gerar cópia corrigida
          </CommandItem>
          <CommandItem onSelect={p.exportAuditCsv}>
            <History />
            Exportar auditoria CSV
          </CommandItem>
          <CommandItem onSelect={p.exportComparisonCsv}>
            <GitMerge />
            Exportar comparação CSV
          </CommandItem>
          <CommandItem onSelect={() => void p.exportReviewPdf()}>
            <FileText />
            Exportar relatório de revisão PDF
          </CommandItem>
          <CommandItem onSelect={() => void p.exportPng()}>
            <FileImage />
            Exportar PNG
          </CommandItem>
          <CommandItem onSelect={() => void p.exportPdf()}>
            <FileText />
            Exportar PDF do painel
          </CommandItem>
          <CommandItem onSelect={() => void p.exportEncryptedBackup()}>
            <ShieldAlert />
            Criar backup criptografado
          </CommandItem>
          <CommandItem onSelect={p.onRestoreBackup}>
            <Upload />
            Restaurar backup protegido
          </CommandItem>
          <CommandItem onSelect={p.onOpenFormatPanel}>
            <Palette />
            Formatação condicional
          </CommandItem>
          <CommandItem onSelect={p.onOpenShortcuts}>
            <HelpCircle />
            Atalhos de teclado
          </CommandItem>
          <CommandItem onSelect={p.onOpenImportDiagnostics}>
            <Activity />
            Diagnóstico de importação
          </CommandItem>
          <CommandItem onSelect={p.onOpenColumnsPanel}>
            <Columns3 />
            Configurar colunas
          </CommandItem>
          <CommandItem onSelect={p.startPresentation}>
            <Maximize2 />
            Modo apresentação
          </CommandItem>
          <CommandItem onSelect={p.openJoin}>
            <GitMerge />
            Combinar planilha
          </CommandItem>
          <CommandItem onSelect={p.toggleTheme}>
            {p.theme === "dark" ? <Sun /> : <Moon />}Alternar modo escuro
          </CommandItem>
          <CommandItem onSelect={p.backHome}>
            <LayoutGrid />
            Ver todos os painéis
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
