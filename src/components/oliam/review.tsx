import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BarChart3,
  Check,
  Columns3,
  ExternalLink,
  FileText,
  Gauge,
  GitMerge,
  GripVertical,
  Image as ImageIcon,
  Info,
  Link as LinkIcon,
  ListChecks,
  Palette,
  PenTool,
  ShieldAlert,
  Sparkles,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/format";
import { kinds, type Column, type Kind, type Row } from "@/lib/types";
import { buildSheetConfidenceMatrix, confidenceLevelFor } from "@/lib/import-intelligence";
import type { ImportDiagnostics, SourceNote } from "@/lib/import-intelligence";
import { auditFidelityPercent, type SourceGrid, type ImportAudit } from "@/lib/import";
import {
  adaptImportProfile,
  applyImportSelection,
  defaultSelection,
  matchingImportProfile,
  saveImportProfile,
  type ImportSelection,
} from "@/lib/import-workbench";
import {
  buildSmartImportInput,
  smartImportFingerprint,
  type SmartImportAnalysis,
  type SmartImportSuggestion,
} from "@/lib/smart-import";
import { analyzeImportWithAi, markSmartImportAutoAnalysis } from "@/lib/smart-import-client";
import { ConfidenceDot } from "./confidence-dot";
import { Mark } from "./mark";
import { OliLoader } from "./oli-loader";
import { ImportWorkbench } from "./import-workbench";

export function Review(p: {
  sheets: {
    name: string;
    rows: Row[];
    columns: Column[];
    diagnostics?: ImportDiagnostics;
    sourceGrid?: SourceGrid;
    audit?: ImportAudit;
    sourceNotes?: SourceNote[];
  }[];
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  setColumns: (c: Column[]) => void;
  setRows: (rows: Row[]) => void;
  name: string;
  back: () => void;
  confirm: () => void;
  importWarning: string | null;
}) {
  const [lowConfidenceConfirmed, setLowConfidenceConfirmed] = useState(false);
  const active = p.sheets[p.activeIndex] ?? p.sheets[0];
  const rows = useMemo(() => active?.rows ?? [], [active]);
  const columns = useMemo(() => active?.columns ?? [], [active?.columns]);
  const [selection, setSelection] = useState<ImportSelection>(() => defaultSelection(rows));
  const [undoRows, setUndoRows] = useState<Row[] | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [smartAnalysis, setSmartAnalysis] = useState<SmartImportAnalysis | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartError, setSmartError] = useState<string | null>(null);
  const [smartCached, setSmartCached] = useState(false);
  const [appliedSmartSuggestions, setAppliedSmartSuggestions] = useState<Set<string>>(new Set());
  const autoAnalyzedSheets = useRef(new Set<string>());
  const smartInput = useMemo(
    () =>
      active?.diagnostics
        ? buildSmartImportInput(p.name, active.name, columns, active.diagnostics)
        : null,
    [active?.diagnostics, active?.name, columns, p.name],
  );
  const runSmartAnalysis = useCallback(
    async (force = false) => {
      if (!smartInput || smartLoading) return;
      setSmartLoading(true);
      setSmartError(null);
      try {
        const result = await analyzeImportWithAi(smartInput, { force });
        setSmartAnalysis(result.analysis);
        setSmartCached(result.cached);
      } catch (error) {
        setSmartError(error instanceof Error ? error.message : "Análise inteligente indisponível.");
      } finally {
        setSmartLoading(false);
      }
    },
    [smartInput, smartLoading],
  );
  useEffect(() => {
    setSmartAnalysis(null);
    setSmartError(null);
    setSmartCached(false);
    setAppliedSmartSuggestions(new Set());
  }, [p.activeIndex]);
  useEffect(() => {
    if (!active?.diagnostics || !smartInput) return;
    const needsAiHelp =
      active.diagnostics.confidence < 80 ||
      active.diagnostics.header.confidence < 0.75 ||
      active.diagnostics.tableRegions.length > 1;
    const sheetKey = `${p.activeIndex}:${active.name}`;
    if (!needsAiHelp || autoAnalyzedSheets.current.has(sheetKey)) return;
    const fingerprint = smartImportFingerprint(smartInput);
    autoAnalyzedSheets.current.add(sheetKey);
    if (markSmartImportAutoAnalysis(fingerprint)) void runSmartAnalysis();
  }, [active?.diagnostics, active?.name, p.activeIndex, runSmartAnalysis, smartInput]);
  useEffect(() => {
    const match = matchingImportProfile(rows, p.name, active?.sourceGrid);
    setSelection(match?.selection ?? defaultSelection(rows));
    if (!match) setProfileNotice(null);
    else if (match.exact) setProfileNotice(`Perfil "${match.profile.name}" reaplicado.`);
    else {
      const renamed = match.changes.renamedColumns
        .map((column) => `"${column.before}" → "${column.after}"`)
        .join(", ");
      setProfileNotice(
        `O modelo do arquivo mudou. O perfil "${match.profile.name}" foi adaptado com ${match.confidence}% de confiança${renamed ? `: ${renamed}` : ""}. Revise antes de confirmar.`,
      );
    }
    setUndoRows(null);
  }, [p.activeIndex, p.name, rows, active?.sourceGrid]);
  const needsConfirmation =
    Boolean(active?.diagnostics) &&
    ((active?.diagnostics?.confidence ?? 100) < 70 ||
      (active?.diagnostics?.header.confidence ?? 1) < 0.7 ||
      (active?.diagnostics?.tableRegions.length ?? 0) > 1);
  const suggestionKey = (suggestion: SmartImportSuggestion) =>
    `${suggestion.type}:${suggestion.columnKey}:${suggestion.proposedLabel ?? suggestion.proposedKind ?? ""}`;
  const applySmartSuggestion = (suggestion: SmartImportSuggestion) => {
    if (suggestion.type === "rename-column" && suggestion.proposedLabel) {
      p.setColumns(
        columns.map((column) =>
          column.key === suggestion.columnKey
            ? { ...column, label: suggestion.proposedLabel! }
            : column,
        ),
      );
    } else if (suggestion.type === "change-kind" && suggestion.proposedKind) {
      p.setColumns(
        columns.map((column) =>
          column.key === suggestion.columnKey
            ? { ...column, kind: suggestion.proposedKind! }
            : column,
        ),
      );
    } else if (suggestion.type === "ignore-column") {
      setSelection((current) => ({
        ...current,
        ignoredColumns: current.ignoredColumns.includes(suggestion.columnKey)
          ? current.ignoredColumns
          : [...current.ignoredColumns, suggestion.columnKey],
      }));
    }
    setAppliedSmartSuggestions((current) => new Set(current).add(suggestionKey(suggestion)));
    toast.success("Sugestão da análise inteligente aplicada.");
  };
  const applySafeSmartSuggestions = () => {
    const safe =
      smartAnalysis?.suggestions.filter(
        (suggestion) => suggestion.confidence >= 90 && suggestion.type !== "ignore-column",
      ) ?? [];
    if (!safe.length) {
      toast.info("Não há sugestões automáticas com confiança mínima de 90%.");
      return;
    }
    p.setColumns(
      columns.map((column) => {
        const rename = safe.find(
          (suggestion) =>
            suggestion.columnKey === column.key && suggestion.type === "rename-column",
        );
        const kind = safe.find(
          (suggestion) => suggestion.columnKey === column.key && suggestion.type === "change-kind",
        );
        return {
          ...column,
          ...(rename?.proposedLabel ? { label: rename.proposedLabel } : {}),
          ...(kind?.proposedKind ? { kind: kind.proposedKind } : {}),
        };
      }),
    );
    setAppliedSmartSuggestions((current) => {
      const next = new Set(current);
      safe.forEach((suggestion) => next.add(suggestionKey(suggestion)));
      return next;
    });
    toast.success(`${safe.length} sugestão(ões) segura(s) aplicada(s).`);
  };
  const sheetConfidenceMatrix = buildSheetConfidenceMatrix(p.sheets);
  return (
    <div className="min-h-screen bg-canvas">
      <header className="oliam-topbar">
        <div className="flex items-center gap-3">
          <Mark />
          <strong className="font-display text-lg tracking-tight">Oli.Qualidade</strong>
          <span className="text-muted-foreground">/ Revisão de estrutura</span>
        </div>
        <Button variant="ghost" onClick={p.back}>
          Cancelar
        </Button>
      </header>
      <div className="mx-auto max-w-5xl px-5 py-10">
        {p.importWarning && (
          <p className="mb-6 flex items-center gap-2 rounded-xl border border-primary/30 bg-tint px-3 py-2.5 text-xs text-foreground">
            <AlertTriangle className="size-3.5 shrink-0 text-primary" />
            {p.importWarning}
          </p>
        )}
        {profileNotice && (
          <p className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5 text-xs text-foreground">
            <Info className="size-3.5 shrink-0 text-emerald-600" />
            {profileNotice}
          </p>
        )}
        <div className="mb-8 flex flex-wrap justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs text-primary shadow-sm">
              <span className="size-1.5 rounded-full bg-primary" />
              ETAPA 1 DE 2 · OBRIGATÓRIA
            </p>
            <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight">
              Confirme como cada coluna deve ser lida
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              IDs e códigos numéricos devem ser definidos como texto para nunca entrarem em totais.
              {p.sheets.length > 1 &&
                " Cada aba ou região independente da planilha original vira uma aba do painel."}
            </p>
          </div>
          <p className="whitespace-nowrap rounded-2xl border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground shadow-sm">
            {p.name}
            <br />
            {rows.length} linhas · {columns.length} colunas
          </p>
        </div>
        <section className="mb-5 overflow-hidden rounded-2xl border border-violet-500/25 bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-violet-500/5 px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-violet-600 dark:text-violet-400" />
                Análise inteligente
                {smartCached && (
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                    resultado reutilizado
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                O Oli analisa somente estrutura, contagens e exemplos não sensíveis. Você decide o
                que aplicar, e nenhum valor ausente é inventado.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!smartInput || smartLoading}
              onClick={() => void runSmartAnalysis(Boolean(smartAnalysis))}
            >
              {smartLoading ? <OliLoader compact /> : <Sparkles className="size-3.5" />}
              {smartAnalysis ? "Analisar novamente" : "Analisar estrutura"}
            </Button>
          </div>
          {smartLoading && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Comparando cabeçalhos, tipos e regiões da planilha…
            </div>
          )}
          {smartError && (
            <div className="flex items-start gap-2 border-t border-border px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{smartError} A leitura normal permanece disponível.</span>
            </div>
          )}
          {smartAnalysis && !smartLoading && (
            <div className="border-t border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{smartAnalysis.purpose}</div>
                  <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                    {smartAnalysis.summary}
                  </p>
                </div>
                <span className="rounded-full border border-violet-500/25 bg-violet-500/5 px-2.5 py-1 text-xs text-violet-700 dark:text-violet-300">
                  {smartAnalysis.confidence}% de confiança
                </span>
              </div>
              {smartAnalysis.suggestions.length ? (
                <div className="mt-4 space-y-2">
                  {smartAnalysis.suggestions.map((suggestion) => {
                    const key = suggestionKey(suggestion);
                    const applied = appliedSmartSuggestions.has(key);
                    const action =
                      suggestion.type === "rename-column"
                        ? `Renomear “${suggestion.columnKey}” para “${suggestion.proposedLabel}”`
                        : suggestion.type === "change-kind"
                          ? `Ler “${suggestion.columnKey}” como ${kinds[suggestion.proposedKind!]}`
                          : `Ignorar a coluna “${suggestion.columnKey}”`;
                    return (
                      <div
                        key={key}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium">{action}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {suggestion.reason} · {suggestion.confidence}%
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={applied ? "ghost" : "outline"}
                          disabled={applied}
                          onClick={() => applySmartSuggestion(suggestion)}
                        >
                          {applied ? (
                            <Check className="size-3.5" />
                          ) : (
                            <Sparkles className="size-3.5" />
                          )}
                          {applied ? "Aplicada" : "Aplicar"}
                        </Button>
                      </div>
                    );
                  })}
                  <div className="pt-1 text-right">
                    <Button size="sm" variant="secondary" onClick={applySafeSmartSuggestions}>
                      Aplicar sugestões seguras (≥90%)
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                  O Oli analisou a estrutura e não encontrou ajustes seguros necessários.
                </p>
              )}
              {smartAnalysis.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                  {smartAnalysis.warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
        {active?.diagnostics && (
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Confiança da importação
              </div>
              <div className="mt-1 flex items-end gap-2">
                <strong className="font-display text-2xl">{active.diagnostics.confidence}%</strong>
                <span className="pb-0.5 text-xs text-muted-foreground">estrutura detectada</span>
              </div>
              {active.diagnostics.recoveryGain > 0 && (
                <div className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  +{active.diagnostics.recoveryGain} pontos após recuperação
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Dados
              </div>
              <div className="mt-1 font-display text-2xl">
                {active.diagnostics.rowCount.toLocaleString("pt-BR")}
              </div>
              <div className="text-xs text-muted-foreground">
                linhas · {active.diagnostics.columnCount} colunas
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Integridade
              </div>
              <div className="mt-1 font-display text-2xl">{active.diagnostics.duplicateRows}</div>
              <div className="text-xs text-muted-foreground">linhas duplicadas detectadas</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Estrutura
              </div>
              <div className="mt-1 font-display text-2xl">
                {active.diagnostics.formulaCells + active.diagnostics.mergedRanges}
              </div>
              <div className="text-xs text-muted-foreground">fórmulas + mesclagens</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Leitura
              </div>
              <div className="mt-1 font-display text-2xl">
                {active.diagnostics.interpretationScore ?? active.diagnostics.confidence}%
              </div>
              <div className="text-xs text-muted-foreground">células úteis interpretadas</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
                Consistência
              </div>
              <div className="mt-1 font-display text-2xl">{active.diagnostics.qualityScore}%</div>
              <div className="text-xs text-muted-foreground">
                valores presentes
                {active.diagnostics.advancedQuality &&
                  ` · robusta ${active.diagnostics.advancedQuality.tableScore}%`}
              </div>
            </div>
          </div>
        )}
        {active?.diagnostics && (
          <div className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Info className="size-4 text-primary" />
                  Leitura estrutural
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cabeçalho provável na linha {active.diagnostics.header.row}, com{" "}
                  {Math.round(active.diagnostics.header.confidence * 100)}% de confiança.
                </p>
              </div>
              {active.diagnostics.suggestedNormalization.length > 0 && (
                <span className="rounded-full border border-primary/25 bg-tint px-2.5 py-1 text-xs text-primary">
                  {active.diagnostics.suggestedNormalization.length} normalização(ões) sugerida(s)
                </span>
              )}
            </div>
            {active.diagnostics.confidenceReasons.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                {active.diagnostics.confidenceReasons.map((reason) => (
                  <span
                    key={reason}
                    className="rounded-full border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300"
                  >
                    {reason}
                  </span>
                ))}
              </div>
            )}
            {(active.diagnostics.structuredTables.length > 0 ||
              active.diagnostics.pivotTables.length > 0 ||
              active.diagnostics.calculatedColumns.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                {active.diagnostics.structuredTables.map((table) => (
                  <span
                    key={`${table.name}-${table.range}`}
                    className="rounded-full border border-primary/25 bg-tint px-2.5 py-1 text-xs text-primary"
                  >
                    Tabela {table.name}
                    {table.range ? ` · ${table.range}` : ""}
                  </span>
                ))}
                {active.diagnostics.pivotTables.map((table) => (
                  <span
                    key={`${table.name}-${table.range}`}
                    className="rounded-full border border-secondary-accent/30 bg-secondary-accent/10 px-2.5 py-1 text-xs text-foreground"
                  >
                    Pivot {table.name}
                    {table.range ? ` · ${table.range}` : ""}
                  </span>
                ))}
                {active.diagnostics.calculatedColumns.length > 0 && (
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                    Colunas calculadas: {active.diagnostics.calculatedColumns.join(", ")}
                  </span>
                )}
              </div>
            )}
            {active.diagnostics.advancedQuality?.columns.length ? (
              <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-3">
                {active.diagnostics.advancedQuality.columns.map((column) => (
                  <div
                    key={column.key}
                    className="rounded-xl border border-border bg-background p-3 text-xs"
                  >
                    <div className="font-medium">
                      {column.key} · score {column.score}%
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      IQR {column.iqr?.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? "—"}
                      {" · "}MAD{" "}
                      {column.mad?.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? "—"}
                    </div>
                    <div className="text-muted-foreground">
                      IQR {column.iqrOutliers} · MAD {column.madOutliers} · Z-score{" "}
                      {column.zScoreOutliers} · temporal {column.temporalAnomalies}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
        {active?.diagnostics?.warnings.length ? (
          <div className="mb-5 rounded-2xl border border-primary/25 bg-tint p-4">
            <div className="flex items-center gap-2 font-medium text-sm">
              <AlertTriangle className="size-4 text-primary" />
              Diagnóstico da planilha
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {active.diagnostics.warnings.map((warning) => (
                <span
                  key={warning}
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {warning}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {active?.diagnostics?.sourceNotes.length ? (
          <details className="mb-5 rounded-2xl border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <FileText className="size-4 text-primary" />
                Observações e comentários preservados
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {active.diagnostics.sourceNotes.length}
              </span>
            </summary>
            <ul className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
              {active.diagnostics.sourceNotes.slice(0, 20).map((note, index) => (
                <li
                  key={`${note.address}-${index}`}
                  className="rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed"
                >
                  <span className="mb-1 block font-mono text-[10px] text-muted-foreground">
                    {note.address} · {note.kind === "comment" ? "Comentário" : "Observação"}
                    {note.author ? ` · ${note.author}` : ""}
                  </span>
                  <span className="whitespace-pre-line">{note.text}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {active?.diagnostics?.hyperlinks.length ? (
          <details className="mb-5 rounded-2xl border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <LinkIcon className="size-4 text-primary" />
                Hyperlinks preservados
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {active.diagnostics.hyperlinks.length}
              </span>
            </summary>
            <ul className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
              {active.diagnostics.hyperlinks.slice(0, 20).map((link, index) => (
                <li
                  key={`${link.address}-${index}`}
                  className="rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed"
                >
                  <span className="mb-1 block font-mono text-[10px] text-muted-foreground">
                    {link.address}
                    {link.tooltip ? ` · ${link.tooltip}` : ""}
                  </span>
                  <span className="break-all">{link.target}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {active?.diagnostics?.definedNames.length ? (
          <details className="mb-5 rounded-2xl border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <Tag className="size-4 text-primary" />
                Nomes definidos
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {active.diagnostics.definedNames.length}
              </span>
            </summary>
            <ul className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
              {active.diagnostics.definedNames.map((definedName, index) => (
                <li
                  key={`${definedName.name}-${index}`}
                  className="rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed"
                >
                  <span className="mb-1 block font-mono text-[10px] text-muted-foreground">
                    {definedName.name}
                    {definedName.scope ? "" : " · workbook inteiro"}
                  </span>
                  <span className="break-all">{definedName.refersTo}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {active?.diagnostics?.externalLinks.length ? (
          <details className="mb-5 rounded-2xl border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <ExternalLink className="size-4 text-primary" />
                Referências a arquivos externos
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {active.diagnostics.externalLinks.length}
              </span>
            </summary>
            <ul className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
              {active.diagnostics.externalLinks.map((link, index) => (
                <li
                  key={`${link.target}-${index}`}
                  className="rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed break-all"
                >
                  {link.target}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {active?.diagnostics?.dataValidations.length ? (
          <details className="mb-5 rounded-2xl border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <ListChecks className="size-4 text-primary" />
                Validações de dados do Excel
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {active.diagnostics.dataValidations.length}
              </span>
            </summary>
            <ul className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
              {active.diagnostics.dataValidations.map((validation, index) => (
                <li
                  key={`${validation.range}-${index}`}
                  className="rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed"
                >
                  <span className="mb-1 block font-mono text-[10px] text-muted-foreground">
                    {validation.range} · {validation.type}
                  </span>
                  {validation.formula1 ? (
                    <span className="break-all">{validation.formula1}</span>
                  ) : null}
                  {validation.prompt ? (
                    <span className="mt-1 block text-muted-foreground">{validation.prompt}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {active?.diagnostics?.images.length ? (
          <details className="mb-5 rounded-2xl border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <ImageIcon className="size-4 text-primary" />
                Imagens embutidas
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {active.diagnostics.images.length}
              </span>
            </summary>
            <ul className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
              {active.diagnostics.images.map((image, index) => (
                <li
                  key={`${image.name}-${index}`}
                  className="rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed"
                >
                  <span className="mb-1 block font-mono text-[10px] text-muted-foreground">
                    {image.anchor ?? "posição não determinada"} · {image.format}
                  </span>
                  <span className="break-all">{image.name}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {active?.diagnostics?.shapes.length ? (
          <details className="mb-5 rounded-2xl border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <PenTool className="size-4 text-primary" />
                Formas do Excel com texto
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {active.diagnostics.shapes.length}
              </span>
            </summary>
            <ul className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
              {active.diagnostics.shapes.map((shape, index) => (
                <li
                  key={`${shape.name}-${index}`}
                  className="rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed"
                >
                  <span className="mb-1 block font-mono text-[10px] text-muted-foreground">
                    {shape.anchor ?? "posição não determinada"} · {shape.name}
                  </span>
                  <span className="whitespace-pre-line break-words">{shape.text}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {active?.diagnostics?.charts.length ? (
          <details className="mb-5 rounded-2xl border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <BarChart3 className="size-4 text-primary" />
                Gráficos nativos do Excel
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {active.diagnostics.charts.length}
              </span>
            </summary>
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Construídos no arquivo original a partir de referências de célula. Não são
              recalculados nem reproduzidos no painel — os dados de origem continuam disponíveis nos
              widgets que você criar aqui.
            </p>
            <ul className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
              {active.diagnostics.charts.map((chart, index) => (
                <li
                  key={`${chart.anchor}-${index}`}
                  className="rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed"
                >
                  <span className="mb-1 block font-mono text-[10px] text-muted-foreground">
                    {chart.anchor ?? "posição não determinada"} · {chart.type}
                  </span>
                  <span className="break-words">{chart.title ?? "sem título"}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {active?.diagnostics?.cellFills.length ? (
          <details className="mb-5 rounded-2xl border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <Palette className="size-4 text-primary" />
                Cor de preenchimento original
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {active.diagnostics.cellFills.length}
              </span>
            </summary>
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Só cor sólida com RGB direto é lida; sombreamento por cor de tema do Excel não é
              resolvido. Ainda não é usada para colorir nenhum widget — inventário por enquanto.
            </p>
            <ul className="grid max-h-64 gap-2 overflow-y-auto border-t border-border p-3 sm:grid-cols-3">
              {active.diagnostics.cellFills.slice(0, 200).map((fill, index) => (
                <li
                  key={`${fill.address}-${index}`}
                  className="flex items-center gap-2 rounded-xl bg-muted/25 px-3 py-2 text-xs leading-relaxed"
                >
                  <span
                    className="size-3.5 shrink-0 rounded-full border border-border"
                    style={{ backgroundColor: fill.color }}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {fill.address}
                  </span>
                  <span className="font-mono text-[10px]">{fill.color}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {active?.audit ? (
          <details className="mb-5 rounded-2xl border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <Gauge className="size-4 text-primary" />
                Relatório de fidelidade da importação
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                <ConfidenceDot level={confidenceLevelFor(auditFidelityPercent(active.audit))} />
                {auditFidelityPercent(active.audit)}%
              </span>
            </summary>
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Percentual de células não vazias da planilha original que chegaram até a tabela
              importada, e o que foi ajustado no caminho.
            </p>
            <dl className="grid gap-x-4 gap-y-2 border-t border-border p-3 text-xs sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                <dt className="text-muted-foreground">Células na origem</dt>
                <dd className="font-mono">{active.audit.sourceNonEmptyCells}</dd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                <dt className="text-muted-foreground">Células na tabela importada</dt>
                <dd className="font-mono">{active.audit.outputNonEmptyCells}</dd>
              </div>
              {active.audit.formulaCellsRecovered > 0 ? (
                <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                  <dt className="text-muted-foreground">Fórmulas recalculadas/recuperadas</dt>
                  <dd className="font-mono">{active.audit.formulaCellsRecovered}</dd>
                </div>
              ) : null}
              {active.audit.mergedCellsExpanded > 0 ? (
                <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                  <dt className="text-muted-foreground">Células mescladas expandidas</dt>
                  <dd className="font-mono">{active.audit.mergedCellsExpanded}</dd>
                </div>
              ) : null}
              {active.audit.numericCellsConverted > 0 ? (
                <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                  <dt className="text-muted-foreground">Valores convertidos para número</dt>
                  <dd className="font-mono">{active.audit.numericCellsConverted}</dd>
                </div>
              ) : null}
              {active.audit.rowsAboveHeaderIgnored > 0 ? (
                <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                  <dt className="text-muted-foreground">Linhas acima do cabeçalho ignoradas</dt>
                  <dd className="font-mono">{active.audit.rowsAboveHeaderIgnored}</dd>
                </div>
              ) : null}
              {active.audit.hiddenRowsIgnored > 0 ? (
                <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                  <dt className="text-muted-foreground">Linhas ocultas ignoradas</dt>
                  <dd className="font-mono">{active.audit.hiddenRowsIgnored}</dd>
                </div>
              ) : null}
              {active.audit.blankRowsIgnored > 0 ? (
                <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                  <dt className="text-muted-foreground">Linhas em branco ignoradas</dt>
                  <dd className="font-mono">{active.audit.blankRowsIgnored}</dd>
                </div>
              ) : null}
              {active.audit.trailingRowsIgnored > 0 ? (
                <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                  <dt className="text-muted-foreground">Linhas finais ignoradas</dt>
                  <dd className="font-mono">{active.audit.trailingRowsIgnored}</dd>
                </div>
              ) : null}
              {active.audit.columnsIgnored > 0 ? (
                <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                  <dt className="text-muted-foreground">Colunas ignoradas</dt>
                  <dd className="font-mono">{active.audit.columnsIgnored}</dd>
                </div>
              ) : null}
              {active.audit.repeatedHeaderRowsIgnored ? (
                <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                  <dt className="text-muted-foreground">Cabeçalhos repetidos ignorados</dt>
                  <dd className="font-mono">{active.audit.repeatedHeaderRowsIgnored}</dd>
                </div>
              ) : null}
              {active.audit.notesPreserved ? (
                <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                  <dt className="text-muted-foreground">Notas preservadas</dt>
                  <dd className="font-mono">{active.audit.notesPreserved}</dd>
                </div>
              ) : null}
              {active.audit.regionsKeptTogether ? (
                <div className="flex items-center justify-between rounded-xl bg-muted/25 px-3 py-2">
                  <dt className="text-muted-foreground">Regiões mantidas juntas por segurança</dt>
                  <dd className="font-mono">{active.audit.regionsKeptTogether}</dd>
                </div>
              ) : null}
            </dl>
          </details>
        ) : null}
        {active?.diagnostics?.tableRegions && active.diagnostics.tableRegions.length > 1 && (
          <div className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Columns3 className="size-4 text-primary" />
              Regiões de dados detectadas
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Encontramos áreas potencialmente independentes nesta aba. Elas não serão combinadas
              automaticamente sem confirmação.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {active.diagnostics.tableRegions.map((region, index) => (
                <div
                  key={`${region.startRow}-${region.startColumn}-${index}`}
                  className="rounded-xl border border-border bg-background p-3 text-xs"
                >
                  <div className="font-medium">Região {index + 1}</div>
                  <div className="mt-1 font-mono text-muted-foreground">
                    L{region.startRow}:L{region.endRow} · C{region.startColumn}:C{region.endColumn}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {region.rows} linhas · {region.columns} colunas ·{" "}
                    {Math.round(region.confidence * 100)}% confiança
                  </div>
                  {active.sourceGrid && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        const rowOffset = active.sourceGrid!.startRow - 1;
                        const columnOffset = active.sourceGrid!.startColumn - 1;
                        const headerRow = Math.max(
                          region.startRow,
                          active.diagnostics?.header.row ?? region.startRow,
                        );
                        setSelection({
                          startRow: 1,
                          endRow: Math.max(1, region.endRow - headerRow),
                          ignoredColumns: [],
                          source: {
                            headerRow: headerRow + rowOffset,
                            startRow: headerRow + rowOffset + 1,
                            endRow: region.endRow + rowOffset,
                            startColumn: region.startColumn + columnOffset,
                            endColumn: region.endColumn + columnOffset,
                          },
                        });
                      }}
                    >
                      Usar esta região
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {active?.diagnostics?.transformations.length ? (
          <div className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitMerge className="size-4 text-primary" />
              Transformações e pontos para revisão
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {active.diagnostics.transformations.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {needsConfirmation && (
          <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={lowConfidenceConfirmed}
              onChange={(event) => setLowConfidenceConfirmed(event.target.checked)}
            />
            <span>
              <strong className="font-medium">Confirmar leitura ambígua</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                Revise o cabeçalho, as regiões detectadas e a prévia abaixo. O relatório só será
                criado depois da sua confirmação para evitar uma interpretação silenciosamente
                incorreta.
              </span>
            </span>
          </label>
        )}
        {active?.diagnostics?.columns.some((c) => c.sensitive) && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <strong className="font-medium">Dados potencialmente sensíveis detectados.</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                O importador marcou {active.diagnostics.columns.filter((c) => c.sensitive).length}{" "}
                coluna(s) como potencialmente pessoal(is). Esses campos não devem ser enviados para
                IA sem necessidade.
              </p>
            </div>
          </div>
        )}
        <ImportWorkbench
          rows={rows}
          columns={columns}
          {...(active?.diagnostics ? { diagnostics: active.diagnostics } : {})}
          {...(active?.sourceGrid ? { sourceGrid: active.sourceGrid } : {})}
          {...(active?.audit ? { audit: active.audit } : {})}
          selection={selection}
          setSelection={setSelection}
          canUndo={Boolean(undoRows)}
          apply={() => {
            const next = applyImportSelection(rows, selection, active?.sourceGrid);
            if (!next.length || !Object.keys(next[0] ?? {}).length) {
              toast.error("A seleção precisa manter ao menos uma linha e uma coluna.");
              return;
            }
            setUndoRows(rows);
            p.setRows(next);
            setSelection(defaultSelection(next));
            toast.success("Seleção aplicada. Você ainda pode desfazer esta reparação.");
          }}
          undo={() => {
            if (!undoRows) return;
            p.setRows(undoRows);
            setSelection(defaultSelection(undoRows));
            setUndoRows(null);
          }}
          saveProfile={() => {
            const profileName = window.prompt(
              "Nome do perfil de importação",
              p.name.replace(/\.[^.]+$/, ""),
            );
            if (!profileName) return;
            const now = Date.now();
            saveImportProfile(
              adaptImportProfile(
                {
                  id: crypto.randomUUID(),
                  name: profileName,
                  signature: "",
                  selection,
                  createdAt: now,
                  updatedAt: now,
                },
                rows,
                p.name,
                active?.sourceGrid,
              ),
            );
            toast.success("Perfil salvo para planilhas com esta mesma estrutura.");
          }}
        />
        {p.sheets.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Abas da planilha">
            {p.sheets.map((s, i) => {
              const sheetConfidence = sheetConfidenceMatrix[i];
              return (
                <button
                  key={s.name + i}
                  role="tab"
                  aria-selected={i === p.activeIndex}
                  onClick={() => p.setActiveIndex(i)}
                  title={
                    sheetConfidence?.confidence == null
                      ? undefined
                      : `Confiança ${sheetConfidence.level}: ${sheetConfidence.confidence}%${
                          sheetConfidence.reasons.length
                            ? ` — ${sheetConfidence.reasons.join("; ")}`
                            : ""
                        }`
                  }
                  className={cn(
                    "rounded-t-lg border border-b-0 px-3.5 py-2 text-sm font-medium transition-colors",
                    i === p.activeIndex
                      ? "border-border bg-card text-foreground"
                      : "border-transparent bg-transparent text-muted-foreground hover:bg-accent",
                  )}
                >
                  {sheetConfidence?.confidence != null &&
                    sheetConfidence.level !== "sem diagnóstico" && (
                      <ConfidenceDot level={sheetConfidence.level} className="mr-1.5" />
                    )}
                  {s.name}
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                    {s.rows.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="grid grid-cols-[32px_1.3fr_1fr_1fr] border-b border-border bg-muted/60 px-3 py-2.5 font-mono text-[11px] tracking-wide text-muted-foreground">
            <span />
            <span>COLUNA</span>
            <span>TIPO E FORMATO</span>
            <span>AMOSTRA</span>
          </div>
          {columns.map((c, i) => (
            <div
              key={c.key}
              className="border-b border-border px-3 py-3 transition-colors last:border-0 hover:bg-accent/40"
            >
              <div className="grid grid-cols-[32px_1.3fr_1fr_1fr] items-center">
                <GripVertical className="size-4 text-muted-foreground" />
                <input
                  className="oliam-plain-input font-medium"
                  value={c.label}
                  onChange={(e) =>
                    p.setColumns(
                      columns.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    )
                  }
                />
                <select
                  className="oliam-select"
                  value={c.kind}
                  onChange={(e) =>
                    p.setColumns(
                      columns.map((x, j) => (j === i ? { ...x, kind: e.target.value as Kind } : x)),
                    )
                  }
                >
                  {Object.entries(kinds).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <span
                  className={cn(
                    "truncate text-sm",
                    ["number", "currency", "percentage"].includes(c.kind) && "font-mono",
                  )}
                >
                  {fmt(rows[0]?.[c.key] ?? null, c.kind) ?? "–"}
                </span>
              </div>
              {active?.diagnostics?.columns.find((d) => d.key === c.key) && (
                <div className="mt-2 flex items-center gap-2 pl-8 text-[11px] text-muted-foreground">
                  <span>
                    Qualidade:{" "}
                    {active?.diagnostics?.columns.find((d) => d.key === c.key)?.qualityScore}%
                  </span>
                  <span>·</span>
                  <span>
                    {active?.diagnostics?.columns.find((d) => d.key === c.key)?.missing ?? 0}{" "}
                    ausentes
                  </span>
                  {active?.diagnostics?.columns.find((d) => d.key === c.key)?.sensitive && (
                    <span className="text-amber-600">· sensível</span>
                  )}
                </div>
              )}
              <div className="mt-2 grid grid-cols-[32px_1fr] items-center">
                <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <input
                  className="oliam-plain-input text-xs text-muted-foreground"
                  placeholder="Descrição opcional, exibida ao passar o mouse no cabeçalho da tabela"
                  value={c.description}
                  onChange={(e) =>
                    p.setColumns(
                      columns.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                    )
                  }
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 text-right">
          <Button
            className="px-6 shadow-sm"
            onClick={p.confirm}
            disabled={needsConfirmation && !lowConfidenceConfirmed}
          >
            Gerar relatório
          </Button>
        </div>
      </div>
    </div>
  );
}
