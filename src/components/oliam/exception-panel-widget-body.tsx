import { Fragment, useState } from "react";
import { AlertTriangle, Check, Download, History, WandSparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Column, type Widget } from "@/lib/types";
import { sizeClass, spanClass } from "@/lib/widgets";
import { parseEditedValue, suggestCorrection, type AuditEntry } from "@/lib/data-review";
import type { ExceptionDecision, SpreadsheetException } from "@/lib/spreadsheet-intelligence";
import { Button } from "@/components/ui/button";
import {
  exceptionGuidance,
  WidgetHead,
  type WidgetDragProps,
  WidgetEvidencePanel,
} from "./widget-support";

export function ExceptionPanelWidgetBody({
  widget: w,
  columns,
  exceptions,
  exceptionDecisions,
  auditTrail,
  onExceptionDecision,
  onCorrectException,
  onTraceException,
  dragProps,
  sizeControls,
  animationDelay,
}: {
  widget: Widget;
  columns: Column[];
  exceptions: SpreadsheetException[];
  exceptionDecisions: Record<string, ExceptionDecision>;
  auditTrail: AuditEntry[];
  onExceptionDecision: (exceptionId: string, status: ExceptionDecision["status"] | null) => void;
  onCorrectException: (exception: SpreadsheetException, value: string, reason: string) => void;
  onTraceException: (exception: SpreadsheetException) => void;
  dragProps: WidgetDragProps;
  sizeControls: React.ReactNode;
  animationDelay: number;
}) {
  const [exceptionView, setExceptionView] = useState<"pending" | "handled" | "audit">("pending");
  const [editingException, setEditingException] = useState<string | null>(null);
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");

  const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
  const activeExceptions = exceptions.filter((item) => !exceptionDecisions[item.id]);
  const handledExceptions = exceptions.filter((item) => exceptionDecisions[item.id]);
  const visible = [...(exceptionView === "handled" ? handledExceptions : activeExceptions)]
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
    .slice(0, 100);
  const totals = {
    critical: activeExceptions.filter((item) => item.severity === "critical").length,
    warning: activeExceptions.filter((item) => item.severity === "warning").length,
    info: activeExceptions.filter((item) => item.severity === "info").length,
  };
  const exportExceptions = () => {
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [
      ["prioridade", "tipo", "titulo", "origem", "detalhe"],
      ...activeExceptions.map((item) => [
        item.severity,
        item.kind,
        item.title,
        item.address ?? (item.rowIndex ? `linha ${item.rowIndex}` : (item.columnKey ?? "")),
        item.detail,
      ]),
    ]
      .map((row) => row.map(escape).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "excecoes-da-planilha.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={w.title || "Exceções para revisar"}
        icon={<AlertTriangle className="size-3.5 text-amber-600" />}
        {...dragProps}
      />
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/15 px-4 py-2"
        data-export-controls
      >
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5 text-[11px]">
          <button
            type="button"
            className={cn(
              "rounded-md px-2.5 py-1",
              exceptionView === "pending" && "bg-card font-medium shadow-sm",
            )}
            onClick={() => setExceptionView("pending")}
          >
            Pendentes · {activeExceptions.length}
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-2.5 py-1",
              exceptionView === "handled" && "bg-card font-medium shadow-sm",
            )}
            onClick={() => setExceptionView("handled")}
          >
            Tratadas · {handledExceptions.length}
          </button>
          <button
            type="button"
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1",
              exceptionView === "audit" && "bg-card font-medium shadow-sm",
            )}
            onClick={() => setExceptionView("audit")}
          >
            <History className="size-3" /> Histórico · {auditTrail.length}
          </button>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!activeExceptions.length || exceptionView === "audit"}
          onClick={exportExceptions}
        >
          <Download className="size-3.5" /> Exportar pendências
        </Button>
      </div>
      {sizeControls}
      {exceptionView === "audit" ? (
        <div className="max-h-[32rem] overflow-auto">
          {!auditTrail.length ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <History className="size-5" />O histórico será preenchido quando uma exceção for
              corrigida, resolvida ou ignorada.
            </div>
          ) : (
            <table className="w-full min-w-[46rem] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border">
                  <th className="px-4 py-2">Quando</th>
                  <th className="px-4 py-2">Ação</th>
                  <th className="px-4 py-2">Origem</th>
                  <th className="px-4 py-2">Alteração</th>
                  <th className="px-4 py-2">Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {[...auditTrail]
                  .reverse()
                  .slice(0, 250)
                  .map((entry) => (
                    <tr key={entry.id} className="border-b border-border/60 align-top">
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                        {new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(entry.timestamp)}
                      </td>
                      <td className="px-4 py-2 font-medium">
                        {entry.action === "cell-correction"
                          ? "Célula corrigida"
                          : entry.action === "exception-ignored"
                            ? "Ignorada"
                            : entry.action === "exception-reopened"
                              ? "Reaberta"
                              : "Resolvida"}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px]">
                        {entry.address ??
                          (entry.rowIndex ? `linha ${entry.rowIndex}` : (entry.columnKey ?? "—"))}
                      </td>
                      <td className="max-w-64 px-4 py-2">
                        <span className="text-destructive line-through">
                          {String(entry.before ?? "")}
                        </span>
                        {entry.action === "cell-correction" && (
                          <>
                            <span className="mx-1 text-muted-foreground">→</span>
                            <span className="text-emerald-700 dark:text-emerald-300">
                              {String(entry.after ?? "")}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="max-w-80 px-4 py-2 text-muted-foreground">{entry.reason}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <>
          <div className="border-b border-border bg-blue-500/8 px-4 py-3 text-xs leading-relaxed">
            <strong>Como usar:</strong>{" "}
            <span className="text-muted-foreground">
              cada item explica o que foi detectado, o efeito possível nos resultados e a ação
              recomendada. “Resolver” confirma que você revisou; “Ignorar” mantém o dado sem
              alteração; “Corrigir” registra um novo valor e preserva o original no histórico.
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 border-b border-border bg-muted/10 p-3">
            {[
              ["Críticas", totals.critical, "text-destructive"],
              ["Atenção", totals.warning, "text-amber-700 dark:text-amber-300"],
              ["Informativas", totals.info, "text-muted-foreground"],
            ].map(([label, value, className]) => (
              <div key={String(label)} className="rounded-xl border border-border bg-card p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </p>
                <p className={cn("mt-1 font-mono text-2xl font-bold", className)}>{value}</p>
              </div>
            ))}
          </div>
          {!visible.length ? (
            <div className="flex min-h-32 items-center justify-center gap-2 p-6 text-sm text-emerald-700 dark:text-emerald-300">
              <Check className="size-4" />
              {exceptionView === "handled"
                ? "Nenhuma exceção foi tratada ainda."
                : "Nenhuma exceção pendente encontrada."}
            </div>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full min-w-[68rem] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2">Prioridade</th>
                    <th className="px-4 py-2">O que aconteceu</th>
                    <th className="px-4 py-2">Origem</th>
                    <th className="px-4 py-2">Por que importa</th>
                    <th className="px-4 py-2">O que fazer</th>
                    <th className="px-4 py-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <Fragment key={item.id}>
                      <tr className="border-b border-border/60 align-top">
                        <td className="px-4 py-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                              item.severity === "critical"
                                ? "bg-destructive/12 text-destructive"
                                : item.severity === "warning"
                                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                  : "bg-muted text-muted-foreground",
                            )}
                          >
                            {item.severity === "critical"
                              ? "Crítica"
                              : item.severity === "warning"
                                ? "Atenção"
                                : "Info"}
                          </span>
                        </td>
                        <td className="max-w-64 px-4 py-2">
                          <button
                            type="button"
                            className="text-left font-medium hover:text-primary hover:underline"
                            onClick={() => onTraceException(item)}
                          >
                            {item.title}
                          </button>
                          <p className="mt-1 leading-relaxed text-muted-foreground">
                            {item.detail}
                          </p>
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">
                          <button
                            type="button"
                            className="hover:text-primary hover:underline"
                            onClick={() => onTraceException(item)}
                          >
                            {item.address ??
                              (item.rowIndex ? `linha ${item.rowIndex}` : (item.columnKey ?? "—"))}
                          </button>
                        </td>
                        <td className="max-w-64 px-4 py-2 leading-relaxed text-muted-foreground">
                          {exceptionGuidance(item).impact}
                        </td>
                        <td className="max-w-64 px-4 py-2 leading-relaxed text-muted-foreground">
                          {exceptionGuidance(item).action}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-1">
                            {exceptionView === "handled" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onExceptionDecision(item.id, null)}
                              >
                                Reabrir
                              </Button>
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => onTraceException(item)}
                                >
                                  Ver origem
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onExceptionDecision(item.id, "ignored")}
                                >
                                  Ignorar
                                </Button>
                                {item.columnKey && item.rowIndex && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      const suggestion = suggestCorrection(
                                        item,
                                        columns.find((column) => column.key === item.columnKey),
                                      );
                                      setEditingException(item.id);
                                      setCorrectionValue(
                                        suggestion?.value ?? String(item.value ?? ""),
                                      );
                                      setCorrectionReason(suggestion?.reason ?? "");
                                    }}
                                  >
                                    <WandSparkles className="size-3.5" /> Corrigir
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  onClick={() => onExceptionDecision(item.id, "resolved")}
                                >
                                  Resolver
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {editingException === item.id && exceptionView === "pending" && (
                        <tr className="border-b border-primary/30 bg-tint/40">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="grid gap-3 md:grid-cols-[minmax(10rem,0.7fr)_minmax(16rem,1.3fr)_auto] md:items-end">
                              <label className="grid gap-1 text-[11px] font-medium">
                                Novo valor
                                <input
                                  autoFocus
                                  className="oliam-input h-9"
                                  value={correctionValue}
                                  onChange={(event) => setCorrectionValue(event.target.value)}
                                />
                              </label>
                              <label className="grid gap-1 text-[11px] font-medium">
                                Justificativa da correção
                                <input
                                  className="oliam-input h-9"
                                  value={correctionReason}
                                  onChange={(event) => setCorrectionReason(event.target.value)}
                                  placeholder="Explique por que o valor foi alterado"
                                />
                              </label>
                              <div className="flex gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingException(null)}
                                >
                                  Cancelar
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={!correctionReason.trim()}
                                  onClick={() => {
                                    onCorrectException(item, correctionValue, correctionReason);
                                    setEditingException(null);
                                  }}
                                >
                                  Aplicar correção
                                </Button>
                              </div>
                            </div>
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              Prévia:{" "}
                              <span className="font-mono text-destructive line-through">
                                {String(item.value ?? "")}
                              </span>{" "}
                              →{" "}
                              <span className="font-mono text-emerald-700 dark:text-emerald-300">
                                {String(
                                  parseEditedValue(
                                    correctionValue,
                                    columns.find((column) => column.key === item.columnKey),
                                  ) ?? "vazio",
                                )}
                              </span>
                              . O valor original ficará preservado no histórico.
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <WidgetEvidencePanel />
    </article>
  );
}
