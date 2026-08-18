import { useState } from "react";
import { Check, Sheet as SheetIcon, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/format";
import type { Column, Row } from "@/lib/types";
import type { ImportDiagnostics } from "@/lib/import-intelligence";
import type { SourceGrid, ImportAudit } from "@/lib/import";
import { buildSheetHealth, defaultSelection, type ImportSelection } from "@/lib/import-workbench";
import { ConfidenceDot } from "./confidence-dot";

export function ImportWorkbench({
  rows,
  columns,
  diagnostics,
  sourceGrid,
  audit,
  selection,
  setSelection,
  apply,
  undo,
  canUndo,
  saveProfile,
}: {
  rows: Row[];
  columns: Column[];
  diagnostics?: ImportDiagnostics;
  sourceGrid?: SourceGrid;
  audit?: ImportAudit;
  selection: ImportSelection;
  setSelection: (selection: ImportSelection) => void;
  apply: () => void;
  undo: () => void;
  canUndo: boolean;
  saveProfile: () => void;
}) {
  const [tab, setTab] = useState<"preview" | "health">("preview");
  const previewRows = rows.slice(0, 30);
  const previewColumns = columns.slice(0, 12);
  const sourceSelection = selection.source;
  const sourceRows = sourceGrid?.rows.slice(0, 30) ?? [];
  const sourceColumnCount = Math.min(12, sourceGrid?.rows[0]?.length ?? 0);
  const health = diagnostics ? buildSheetHealth(diagnostics) : null;
  const columnDiagnostic = (key: string) => diagnostics?.columns.find((item) => item.key === key);
  const ignored = new Set(selection.ignoredColumns);
  const toggleColumn = (key: string) =>
    setSelection({
      ...selection,
      ignoredColumns: ignored.has(key)
        ? selection.ignoredColumns.filter((item) => item !== key)
        : [...selection.ignoredColumns, key],
    });
  const columnLetter = (column: number) => {
    let value = column;
    let label = "";
    while (value > 0) {
      value--;
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26);
    }
    return label;
  };
  const enableSourceSelection = () => {
    if (!sourceGrid) return;
    const headerRow = Math.min(
      sourceGrid.startRow + sourceGrid.rows.length - 1,
      sourceGrid.startRow + Math.max(0, (diagnostics?.header.row ?? 1) - 1),
    );
    setSelection({
      ...selection,
      startRow: 1,
      endRow: Math.max(1, sourceGrid.rows.length - 1),
      ignoredColumns: [],
      source: {
        headerRow,
        startRow: Math.min(headerRow + 1, sourceGrid.startRow + sourceGrid.rows.length - 1),
        endRow: sourceGrid.startRow + sourceGrid.rows.length - 1,
        startColumn: sourceGrid.startColumn,
        endColumn: sourceGrid.startColumn + Math.max(0, sourceColumnCount - 1),
      },
    });
  };

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2 font-medium text-sm">
            <SheetIcon className="size-4 text-primary" /> Bancada de importação
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Veja o que foi interpretado e corrija a região antes de criar o relatório.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <Button
            size="sm"
            variant={tab === "preview" ? "default" : "ghost"}
            onClick={() => setTab("preview")}
          >
            Prévia visual
          </Button>
          <Button
            size="sm"
            variant={tab === "health" ? "default" : "ghost"}
            onClick={() => setTab("health")}
            disabled={!health}
          >
            Saúde da planilha
          </Button>
        </div>
      </div>
      {tab === "preview" ? (
        <div className="p-4">
          <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span>
              <i className="mr-1 inline-block size-2.5 rounded-sm bg-blue-500" />
              cabeçalho
            </span>
            <span>
              <i className="mr-1 inline-block size-2.5 rounded-sm bg-emerald-500" />
              válido
            </span>
            <span>
              <i className="mr-1 inline-block size-2.5 rounded-sm bg-amber-400" />
              revisar
            </span>
            <span>
              <i className="mr-1 inline-block size-2.5 rounded-sm bg-red-500" />
              possível perda
            </span>
            <span>
              <i className="mr-1 inline-block size-2.5 rounded-sm bg-slate-400" />
              ignorado
            </span>
          </div>
          <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]">
            {sourceGrid && (
              <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={sourceSelection ? "default" : "outline"}
                  onClick={
                    sourceSelection
                      ? () => setSelection(defaultSelection(rows))
                      : enableSourceSelection
                  }
                >
                  {sourceSelection ? "Voltar à leitura automática" : "Selecionar na grade original"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Origem: {sourceGrid.totalRows} linhas × {sourceGrid.totalColumns} colunas
                  {(sourceGrid.truncatedRows || sourceGrid.truncatedColumns) &&
                    " · a prévia foi limitada por segurança"}
                </span>
              </div>
            )}
            {sourceSelection ? (
              <>
                {(
                  [
                    ["Cabeçalho", "headerRow"],
                    ["Primeira linha de dados", "startRow"],
                    ["Última linha de dados", "endRow"],
                    ["Primeira coluna", "startColumn"],
                    ["Última coluna", "endColumn"],
                  ] as const
                ).map(([label, key]) => (
                  <label key={key} className="text-xs text-muted-foreground">
                    {label}
                    <input
                      className="oliam-input mt-1"
                      type="number"
                      value={sourceSelection[key]}
                      onChange={(event) =>
                        setSelection({
                          ...selection,
                          source: {
                            ...sourceSelection,
                            [key]: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </>
            ) : (
              <>
                <label className="text-xs text-muted-foreground">
                  Primeira linha
                  <input
                    className="oliam-input mt-1"
                    type="number"
                    min={1}
                    max={rows.length}
                    value={selection.startRow}
                    onChange={(event) =>
                      setSelection({ ...selection, startRow: Number(event.target.value) || 1 })
                    }
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Última linha
                  <input
                    className="oliam-input mt-1"
                    type="number"
                    min={selection.startRow}
                    max={rows.length}
                    value={selection.endRow}
                    onChange={(event) =>
                      setSelection({
                        ...selection,
                        endRow: Number(event.target.value) || rows.length,
                      })
                    }
                  />
                </label>
              </>
            )}
            <Button className="self-end" variant="outline" onClick={saveProfile}>
              Salvar perfil
            </Button>
            <div className="flex self-end gap-2">
              <Button variant="ghost" onClick={undo} disabled={!canUndo}>
                <Undo2 className="size-4" /> Desfazer
              </Button>
              <Button onClick={apply}>
                <Check className="size-4" /> Aplicar seleção
              </Button>
            </div>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            {sourceSelection
              ? "Ajuste as coordenadas para escolher exatamente o cabeçalho e a tabela original."
              : "Clique no nome de uma coluna para incluí-la ou ignorá-la."}
          </p>
          <div className="max-h-[25rem] w-full overflow-auto rounded-xl border border-border">
            <table className="min-w-max border-collapse text-xs">
              {sourceSelection && sourceGrid ? (
                <>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="border border-blue-300 bg-blue-600 px-2 py-2 text-white">#</th>
                      {Array.from({ length: sourceColumnCount }, (_, index) => {
                        const absoluteColumn = sourceGrid.startColumn + index;
                        const selected =
                          absoluteColumn >= sourceSelection.startColumn &&
                          absoluteColumn <= sourceSelection.endColumn;
                        return (
                          <th
                            key={absoluteColumn}
                            className={cn(
                              "border px-3 py-2 text-white",
                              selected
                                ? "border-blue-300 bg-blue-600"
                                : "border-slate-400 bg-slate-500",
                            )}
                          >
                            {columnLetter(absoluteColumn)}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sourceRows.map((row, index) => {
                      const absoluteRow = sourceGrid.startRow + index;
                      const isHeader = absoluteRow === sourceSelection.headerRow;
                      const selectedRow =
                        absoluteRow >= sourceSelection.startRow &&
                        absoluteRow <= sourceSelection.endRow;
                      return (
                        <tr key={absoluteRow}>
                          <th
                            className={cn(
                              "border px-2 py-1.5 font-mono",
                              isHeader
                                ? "border-blue-300 bg-blue-600 text-white"
                                : selectedRow
                                  ? "border-border bg-muted"
                                  : "border-border bg-slate-200 text-slate-500 dark:bg-slate-800",
                            )}
                          >
                            {absoluteRow}
                          </th>
                          {Array.from({ length: sourceColumnCount }, (_, columnIndex) => {
                            const absoluteColumn = sourceGrid.startColumn + columnIndex;
                            const selectedColumn =
                              absoluteColumn >= sourceSelection.startColumn &&
                              absoluteColumn <= sourceSelection.endColumn;
                            return (
                              <td
                                key={absoluteColumn}
                                className={cn(
                                  "max-w-56 truncate border border-border px-3 py-1.5",
                                  isHeader && selectedColumn
                                    ? "bg-blue-500/20 font-medium"
                                    : selectedRow && selectedColumn
                                      ? "bg-emerald-500/10"
                                      : "bg-slate-100 text-slate-400 dark:bg-slate-900",
                                )}
                                title={String(row[columnIndex] ?? "")}
                              >
                                {String(row[columnIndex] ?? "") || "—"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </>
              ) : (
                <>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="border border-blue-300 bg-blue-600 px-2 py-2 text-white">#</th>
                      {previewColumns.map((column) => {
                        const diagnostic = columnDiagnostic(column.key);
                        return (
                          <th
                            key={column.key}
                            className={cn(
                              "border px-3 py-2 text-left text-white",
                              ignored.has(column.key)
                                ? "border-slate-400 bg-slate-500"
                                : "border-blue-300 bg-blue-600",
                            )}
                          >
                            <button
                              type="button"
                              className="flex w-full items-center gap-1.5 text-left"
                              onClick={() => toggleColumn(column.key)}
                              title={
                                diagnostic
                                  ? `Confiança ${diagnostic.level}${
                                      diagnostic.warnings.length
                                        ? ` — ${diagnostic.warnings.join("; ")}`
                                        : ""
                                    }`
                                  : undefined
                              }
                            >
                              {diagnostic && <ConfidenceDot level={diagnostic.level} />}
                              <span className="truncate">{column.label}</span>
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, rowIndex) => {
                      const outside =
                        rowIndex + 1 < selection.startRow || rowIndex + 1 > selection.endRow;
                      return (
                        <tr key={rowIndex}>
                          <th
                            className={cn(
                              "border border-border px-2 py-1.5 font-mono",
                              outside
                                ? "bg-slate-200 text-slate-500 dark:bg-slate-800"
                                : "bg-muted",
                            )}
                          >
                            {rowIndex + 1}
                          </th>
                          {previewColumns.map((column) => {
                            const value = row[column.key];
                            const diagnostic = columnDiagnostic(column.key);
                            const problem =
                              value == null || value === "" || Boolean(diagnostic?.warnings.length);
                            const danger = (diagnostic?.qualityScore ?? 100) < 50;
                            return (
                              <td
                                key={column.key}
                                className={cn(
                                  "max-w-56 truncate border border-border px-3 py-1.5",
                                  outside || ignored.has(column.key)
                                    ? "bg-slate-100 text-slate-400 dark:bg-slate-900"
                                    : danger
                                      ? "bg-red-500/15"
                                      : problem
                                        ? "bg-amber-400/15"
                                        : "bg-emerald-500/10",
                                )}
                                title={String(value ?? "")}
                              >
                                {fmt(value ?? null, column.kind) ?? "—"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </>
              )}
            </table>
          </div>
          {(rows.length > 30 || columns.length > 12) && (
            <p className="mt-2 text-xs text-muted-foreground">
              Prévia limitada a 30 linhas e 12 colunas para manter a navegação rápida. A seleção é
              aplicada ao arquivo completo.
            </p>
          )}
        </div>
      ) : health ? (
        <div className="p-4">
          {diagnostics && (
            <div className="mb-4 grid gap-3 md:grid-cols-[1.2fr_1fr]">
              <div className="rounded-xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">Leitura estrutural</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      O Oli mostra a interpretação e os pontos que ainda exigem confirmação.
                    </p>
                  </div>
                  <span className="rounded-full border border-primary/25 bg-primary/8 px-2.5 py-1 text-xs font-medium text-primary">
                    {diagnostics.structuralClassification?.type ?? "tabela"} ·{" "}
                    {diagnostics.interpretationScore ?? diagnostics.confidence}%
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-muted/50 p-2">
                    <strong className="block text-base">
                      {diagnostics.readerDivergences?.length ?? 0}
                    </strong>
                    divergências
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <strong className="block text-base">{diagnostics.formulaCells}</strong>
                    fórmulas
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <strong className="block text-base">
                      {diagnostics.qualityAudit?.intentionalBlankCells ?? 0}
                    </strong>
                    vazios legítimos
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-background p-4">
                <div className="text-sm font-medium">Decisão da importação</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {diagnostics.confidence >= 85 && !(diagnostics.readerDivergences?.length ?? 0)
                    ? "Estrutura consistente. Você pode confirmar ou revisar a grade original."
                    : "Há pontos de atenção. Revise as células marcadas antes de confirmar."}
                </p>
                {diagnostics.formulaDiagnostics.length > 0 && (
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {diagnostics.formulaDiagnostics.slice(0, 3).map((formula, index) => (
                      <li key={`${formula.address}-${index}`}>
                        • {formula.address}: {formula.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          {audit && (
            <div className="mb-4 rounded-xl border border-border bg-background p-4">
              <div className="text-sm font-medium">Balanço verificável da importação</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Contagens objetivas do arquivo, sem tratar expansões ou cabeçalhos como perda.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Células preenchidas na origem", audit.sourceNonEmptyCells],
                  ["Células preenchidas na saída", audit.outputNonEmptyCells],
                  ["Fórmulas recuperadas", audit.formulaCellsRecovered],
                  ["Mesclagens expandidas", audit.mergedCellsExpanded],
                  ["Números convertidos", audit.numericCellsConverted],
                  [
                    "Observações preservadas",
                    audit.notesPreserved ?? diagnostics?.sourceNotes.length ?? 0,
                  ],
                  ["Linhas acima do cabeçalho", audit.rowsAboveHeaderIgnored],
                  ["Linhas ocultas respeitadas", audit.hiddenRowsIgnored],
                  ["Linhas vazias ignoradas", audit.blankRowsIgnored],
                  ["Rodapés/colunas ignorados", audit.trailingRowsIgnored + audit.columnsIgnored],
                  ...(audit.regionsKeptTogether
                    ? ([["Regiões mantidas juntas", audit.regionsKeptTogether]] as const)
                    : []),
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg border border-border px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <strong className="font-display text-lg">{value}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Compatibilidade", health.compatibility],
              ["Confiança estrutural", health.structuralConfidence],
              ["Qualidade", health.dataQuality],
              ["Completude", health.completeness],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-xl border border-border bg-background p-3"
              >
                <div className="text-xs text-muted-foreground">{label}</div>
                <strong className="font-display text-2xl">{value}%</strong>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border p-3 text-sm">
              <strong>{health.duplicateRows}</strong>
              <span className="ml-2 text-muted-foreground">duplicações</span>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm">
              <strong>{health.brokenFormulas}</strong>
              <span className="ml-2 text-muted-foreground">fórmulas incompatíveis</span>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm">
              <strong>{health.anomalies}</strong>
              <span className="ml-2 text-muted-foreground">anomalias</span>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-border bg-background p-4">
            <div className="text-sm font-medium">Recomendações para o arquivo original</div>
            {health.recommendations.length ? (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {health.recommendations.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-emerald-600">
                Nenhuma correção estrutural urgente foi encontrada.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
