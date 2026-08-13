import { type CSSProperties, useId, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileSpreadsheet,
  FolderOpen,
  RefreshCw,
  Search,
} from "lucide-react";

import type { FolderMonitorView } from "@/lib/folder-monitor";
import { cn } from "@/lib/utils";

type FolderMonitorWidgetProps = {
  monitor: FolderMonitorView | undefined;
};

const FORMAT_LABELS: Record<string, string> = {
  XLSX: "Excel",
  XLSM: "Excel com macro",
  XLSB: "Excel binário",
  XLS: "Excel legado",
  XLTX: "Modelo do Excel",
  XLTM: "Modelo com macro",
  ODS: "OpenDocument",
  FODS: "OpenDocument",
  CSV: "CSV",
  TSV: "TSV",
  XML: "XML",
  HTML: "HTML",
  HTM: "HTML",
  NUMBERS: "Apple Numbers",
};

function extensionOf(fileName: string) {
  return fileName.split(".").pop()?.toUpperCase() ?? "ARQUIVO";
}

function formatSyncTime(timestamp: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

export function FolderMonitorWidget({ monitor }: FolderMonitorWidgetProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const detailsId = useId();
  const files = useMemo(
    () =>
      monitor?.fileNames?.length ? monitor.fileNames : monitor?.fileName ? [monitor.fileName] : [],
    [monitor],
  );
  const filteredFiles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return normalized
      ? files.filter((fileName) => fileName.toLocaleLowerCase("pt-BR").includes(normalized))
      : files;
  }, [files, query]);
  const formatCount = new Set(files.map(extensionOf)).size;
  const status = monitor?.status ?? "empty";
  const statusLabel =
    status === "syncing"
      ? "Atualizando pasta"
      : status === "error"
        ? "Acesso interrompido"
        : status === "watching"
          ? "Monitoramento ativo"
          : "Nenhuma pasta conectada";

  return (
    <div className={cn("oli-folder-widget", open && "is-open")} data-status={status}>
      <button
        type="button"
        className="oli-folder-trigger"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="oli-folder-scene" aria-hidden="true">
          <span className="oli-folder-back">
            <span className="oli-folder-tab" />
          </span>
          <span className="oli-folder-documents">
            {files.slice(0, 5).map((fileName, index) => (
              <span
                className="oli-folder-document"
                style={{ "--document-index": index } as CSSProperties}
                key={fileName}
              >
                <FileSpreadsheet />
                <span>{extensionOf(fileName)}</span>
              </span>
            ))}
            {!files.length && (
              <span className="oli-folder-document oli-folder-document-empty">
                <FolderOpen />
              </span>
            )}
          </span>
          <span className="oli-folder-front">
            <span className="oli-folder-grip" />
            <span className="oli-folder-counter">
              <span className="oli-folder-status-dot" />
              <strong>{files.length}</strong>
            </span>
          </span>
        </span>

        <span className="oli-folder-summary">
          <span className="oli-folder-summary-topline">
            <span className="oli-folder-status-copy">
              {status === "syncing" && <RefreshCw className="animate-spin" />}
              {status === "error" && <AlertTriangle />}
              {status === "watching" && <Check />}
              {statusLabel}
            </span>
            <ChevronDown className="oli-folder-chevron" />
          </span>
          <strong>{monitor?.folderName ?? "Conecte uma pasta local"}</strong>
          <span>
            {files.length
              ? `${files.length} ${files.length === 1 ? "planilha compatível" : "planilhas compatíveis"} · ${formatCount} ${formatCount === 1 ? "formato" : "formatos"}`
              : "Abra para consultar os formatos aceitos"}
          </span>
        </span>
      </button>

      <div className="oli-folder-details-shell" id={detailsId} aria-hidden={!open}>
        <div className="oli-folder-details">
          {monitor ? (
            <>
              <div className="oli-folder-details-head">
                <div>
                  <strong>Planilhas compatíveis</strong>
                  <span>Última leitura às {formatSyncTime(monitor.lastSyncedAt)}</span>
                </div>
                <span className="oli-folder-format-count">{formatCount} formatos</span>
              </div>

              <label className="oli-folder-search">
                <Search aria-hidden="true" />
                <span className="sr-only">Buscar planilha monitorada</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar nesta pasta"
                  tabIndex={open ? 0 : -1}
                />
              </label>

              {monitor.status === "error" && (
                <div className="oli-folder-error" role="status">
                  <AlertTriangle />
                  <span>{monitor.error ?? "Reconecte a pasta para retomar as atualizações."}</span>
                </div>
              )}

              <div className="oli-folder-file-list" role="list">
                {filteredFiles.map((fileName) => {
                  const extension = extensionOf(fileName);
                  const active = fileName === monitor.fileName;
                  return (
                    <div className="oli-folder-file" role="listitem" key={fileName}>
                      <span className="oli-folder-file-icon">
                        <FileSpreadsheet />
                      </span>
                      <span className="oli-folder-file-name">
                        <strong title={fileName}>{fileName}</strong>
                        <span>{FORMAT_LABELS[extension] ?? extension}</span>
                      </span>
                      {active ? (
                        <span className="oli-folder-active-file">Arquivo ativo</span>
                      ) : (
                        <span className="oli-folder-extension">{extension}</span>
                      )}
                    </div>
                  );
                })}
                {!filteredFiles.length && (
                  <div className="oli-folder-no-results">
                    Nenhuma planilha corresponde a “{query.trim()}”.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="oli-folder-empty-state">
              <strong>Formatos reconhecidos</strong>
              <p>
                Excel, OpenDocument, CSV, TSV, XML, HTML e Apple Numbers podem ser encontrados
                automaticamente.
              </p>
              <span>Use “Monitorar pasta” na barra superior para conectar.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
