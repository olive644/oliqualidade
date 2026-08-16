import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ClipboardPaste,
  FolderSync,
  Play,
  Sheet as SheetIcon,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Mark } from "./mark";
import { ThemeToggle } from "./theme-toggle";
import { OliLoader } from "./oli-loader";
import { OliWelcomeScene } from "./oli-welcome-scene";

export function Empty(p: {
  onUpload: () => void;
  onDropFile: (file: File) => void;
  onFolder: () => void;
  onDemo: () => void;
  url: string;
  setUrl: (v: string) => void;
  sheet: () => void;
  loading: boolean;
  loadingLabel: string | null;
  cancelImport: () => void;
  editor: boolean;
  setEditor: (v: boolean) => void;
  paste: string;
  setPaste: (v: string) => void;
  pasteData: () => void;
  backHome: () => void;
  showBack: boolean;
  theme: string;
  toggleTheme: () => void;
  importError: string | null;
  privateMode: boolean;
  togglePrivateMode: () => void;
  hydrated: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (p.loading) return;
    dragCounter.current += 1;
    setDragging(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (p.loading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) p.onDropFile(file);
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-canvas">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[28rem] opacity-70"
        style={{
          background:
            "radial-gradient(50% 90% at 20% 0%, color-mix(in oklab, var(--primary) 16%, transparent), transparent), radial-gradient(40% 70% at 90% 15%, color-mix(in oklab, var(--secondary-accent) 14%, transparent), transparent)",
        }}
        aria-hidden="true"
      />
      <header className="oliam-topbar">
        <div className="flex items-center gap-3">
          {p.showBack && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Voltar aos painéis"
              onClick={p.backHome}
              disabled={!p.hydrated}
            >
              <ChevronLeft />
            </Button>
          )}
          <Mark />
          <strong className="font-display text-lg tracking-tight">Oli.Qualidade</strong>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            BI para dados que precisam fechar
          </span>
          <ThemeToggle theme={p.theme} toggle={p.toggleTheme} disabled={!p.hydrated} />
        </div>
      </header>
      <main className="oli-welcome">
        <section className="oli-welcome-hero">
          <div className="oli-welcome-copy">
            <p className="oli-welcome-badge">Novo painel</p>
            <h1 className="sr-only">Oli.Qualidade</h1>
            <OliWelcomeScene busy={p.loading} />
            <p className="oli-welcome-lead">
              Importe uma planilha e transforme as informações em um painel simples de acompanhar.
            </p>
          </div>
        </section>

        <section className="oli-import-shell">
          <div className="oli-import-heading">
            <div>
              <span className="oli-import-kicker">Importar dados</span>
              <h2>Escolha uma planilha</h2>
            </div>
            <div className="oli-file-types" aria-label="Formatos aceitos">
              <span>XLSX</span>
              <span>CSV</span>
              <span>XLS</span>
              <span>ODS</span>
              <span>XLSB</span>
            </div>
          </div>
          <button
            type="button"
            className="oli-welcome-dropzone"
            data-dragging={dragging}
            onClick={p.onUpload}
            disabled={p.loading || !p.hydrated}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {p.loading ? (
              <>
                <OliLoader />
                <span className="oli-dropzone-copy">
                  <strong>{p.loadingLabel ?? "Lendo sua planilha…"}</strong>
                  <small>Preparando seus dados.</small>
                </span>
              </>
            ) : (
              <>
                <span className="oli-upload-orbit">
                  <Upload />
                  <i />
                </span>
                <span className="oli-dropzone-copy">
                  <strong>{dragging ? "Solte o arquivo aqui" : "Arraste sua planilha aqui"}</strong>
                  <small>ou clique para escolher um arquivo no computador</small>
                </span>
                <span className="oli-dropzone-action">Escolher arquivo</span>
              </>
            )}
          </button>
          {p.loading && (
            <div className="mt-3 flex justify-center">
              <Button type="button" variant="outline" size="sm" onClick={p.cancelImport}>
                Cancelar importação
              </Button>
            </div>
          )}
          {p.importError && (
            <p className="oli-import-error">
              <AlertTriangle />
              {p.importError}
            </p>
          )}
          <div className="oli-import-privacy">
            <ShieldAlert />
            <span>
              <strong>Seus dados ficam com você.</strong> O processamento acontece no navegador.
              <button
                type="button"
                className="ml-2 underline underline-offset-2"
                onClick={p.togglePrivateMode}
                disabled={!p.hydrated}
              >
                {p.privateMode ? "Modo privado ligado" : "Ativar modo privado"}
              </button>
            </span>
          </div>

          <div className="oli-import-divider">
            <span>ou importe de outro jeito</span>
          </div>
          <div className="oli-import-options">
            <button
              type="button"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(!sheetOpen)}
              disabled={!p.hydrated}
            >
              <span>
                <SheetIcon />
              </span>
              <div>
                <strong>Google Sheets</strong>
                <small>Conecte uma planilha pública</small>
              </div>
              <ChevronDown className={cn(sheetOpen && "rotate-180")} />
            </button>
            <button
              type="button"
              aria-expanded={p.editor}
              onClick={() => p.setEditor(!p.editor)}
              disabled={!p.hydrated}
            >
              <span>
                <ClipboardPaste />
              </span>
              <div>
                <strong>Colar dados</strong>
                <small>Copie direto do Excel</small>
              </div>
              <ChevronDown className={cn(p.editor && "rotate-180")} />
            </button>
            <button type="button" onClick={p.onFolder} disabled={!p.hydrated}>
              <span>
                <FolderSync />
              </span>
              <div>
                <strong>Pasta monitorada</strong>
                <small>Atualização automática</small>
              </div>
              <ArrowRight />
            </button>
            <button type="button" onClick={p.onDemo} disabled={!p.hydrated}>
              <span>
                <Play />
              </span>
              <div>
                <strong>Ver demonstração</strong>
                <small>Explore dados de exemplo</small>
              </div>
              <ArrowRight />
            </button>
          </div>
          {sheetOpen && (
            <div className="oli-import-expand">
              <label>Link público do Google Sheets</label>
              <div>
                <input
                  className="oliam-input"
                  placeholder="Cole o link da planilha"
                  value={p.url}
                  onChange={(e) => p.setUrl(e.target.value)}
                />
                <Button variant="outline" disabled={!p.url || p.loading} onClick={p.sheet}>
                  {p.loading ? "Lendo…" : "Conectar"}
                </Button>
              </div>
              <p>A planilha precisa estar publicada para leitura na Web.</p>
            </div>
          )}
          {p.editor && (
            <div className="oli-import-expand">
              <label>Dados copiados</label>
              <textarea
                className="oliam-input"
                placeholder="Cole dados separados por tabulação ou vírgula, copiados direto do Excel…"
                value={p.paste}
                onChange={(e) => p.setPaste(e.target.value)}
              />
              <div className="text-right">
                <Button disabled={!p.paste} onClick={p.pasteData}>
                  Revisar dados
                </Button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
