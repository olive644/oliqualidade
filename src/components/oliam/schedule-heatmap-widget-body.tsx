import { Fragment, useMemo } from "react";
import { CalendarRange, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ChartDataMode,
  type Column,
  type FilterRule,
  type Row,
  type Widget,
} from "@/lib/types";
import {
  groupableKinds,
  schedulePeriodColumns,
  scheduleItemColumn,
  scheduleSectionColumn,
  scheduleStatusColumn,
  scheduleDetailColumns,
  sizeClass,
  spanClass,
} from "@/lib/widgets";
import {
  scheduleCellState,
  scheduleCriterionForRow,
  scheduleFillMeaning,
  summarizeScheduleRows,
  type ScheduleCellState,
  type ScheduleFillMeaning,
} from "@/lib/schedule-normalizer";
import { sourceRowIndexOf } from "@/lib/data-review";
import type { SourceCellFill } from "@/lib/cell-fill-provenance";
import { fmt, parseNumericValue } from "@/lib/format";
import {
  aggregate,
  aggregationLabels,
  toggleClickFilter,
  type AggregationOp,
} from "@/lib/data-pipeline";
import {
  CalculationButton,
  scheduleCellClass,
  WidgetHead,
  type WidgetDragProps,
} from "./widget-support";

export function ScheduleHeatmapWidgetBody({
  widget: w,
  data,
  columns,
  sourceCellFills,
  filters,
  setFilters,
  onConfigure,
  dragProps,
  sizeControls,
  animationDelay,
}: {
  widget: Widget;
  data: Row[];
  columns: Column[];
  sourceCellFills: SourceCellFill[];
  filters: FilterRule[];
  setFilters: (filters: FilterRule[]) => void;
  onConfigure: (patch: Partial<Widget>) => void;
  dragProps: WidgetDragProps;
  sizeControls: React.ReactNode;
  animationDelay: number;
}) {
  const detectedPeriods = schedulePeriodColumns(columns);
  const configuredPeriods = (w.periodKeys ?? [])
    .map((key) => columns.find((column) => column.key === key))
    .filter((column): column is Column => Boolean(column));
  const periodCols = configuredPeriods.length ? configuredPeriods : detectedPeriods;
  const periodKeys = new Set(periodCols.map((column) => column.key));
  const scheduleData =
    w.blockKey && w.blockValue !== undefined
      ? data.filter((row) => String(row[w.blockKey!] ?? "") === w.blockValue)
      : data;
  const labelOptions = columns.filter(
    (column) => !periodKeys.has(column.key) && groupableKinds.includes(column.kind),
  );
  const groupCol =
    columns.find((column) => column.key === w.groupKey && !periodKeys.has(column.key)) ??
    scheduleItemColumn(
      columns,
      periodCols.map((column) => column.key),
      scheduleData,
    );
  const statusCol =
    columns.find((column) => column.key === w.statusKey && !periodKeys.has(column.key)) ??
    scheduleStatusColumn(
      columns,
      periodCols.map((column) => column.key),
    );
  const configuredSection = columns.find(
    (column) =>
      column.key === w.sectionKey &&
      !periodKeys.has(column.key) &&
      column.key !== groupCol?.key &&
      column.key !== statusCol?.key,
  );
  const sectionCol =
    w.sectionKey === ""
      ? undefined
      : (configuredSection ??
        scheduleSectionColumn(
          columns,
          periodCols.map((column) => column.key),
          groupCol?.key,
          statusCol?.key,
        ));
  const allDetailCols = columns.filter(
    (column) =>
      !periodKeys.has(column.key) &&
      column.key !== groupCol?.key &&
      column.key !== statusCol?.key &&
      column.key !== sectionCol?.key &&
      scheduleData.some((row) => row[column.key] !== null && row[column.key] !== ""),
  );
  const defaultDetailCols = scheduleDetailColumns(
    columns,
    periodCols.map((column) => column.key),
    scheduleData,
    groupCol?.key,
    statusCol?.key,
  ).filter((column) => column.key !== sectionCol?.key);
  const detailCols = (
    w.detailKeys === undefined
      ? defaultDetailCols
      : w.detailKeys
          .map((key) => allDetailCols.find((column) => column.key === key))
          .filter((column): column is Column => Boolean(column))
  ).slice(0, 8);
  const detailKeys = new Set(detailCols.map((column) => column.key));
  const isBlankScheduleValue = (value: unknown) =>
    value === null ||
    value === undefined ||
    value === "" ||
    (typeof value === "string" && /^[-–—]$/.test(value.trim()));
  const sourceScheduleFillByCell = useMemo(() => {
    const byCell = new Map<string, ScheduleFillMeaning>();
    for (const fill of sourceCellFills) {
      const meaning = scheduleFillMeaning(fill.color);
      if (meaning) byCell.set(`${fill.rowIndex}:${fill.columnKey}`, meaning);
    }
    return byCell;
  }, [sourceCellFills]);
  const fillMeaningFor = (row: Row, columnKey: string) => {
    const sourceRowIndex = sourceRowIndexOf(row);
    if (sourceRowIndex === null) return null;
    return sourceScheduleFillByCell.get(`${sourceRowIndex}:${columnKey}`) ?? null;
  };
  const effectiveScheduleValue = (row: Row, columnKey: string) => {
    const value = row[columnKey];
    if (!isBlankScheduleValue(value)) return value;
    return fillMeaningFor(row, columnKey)?.label ?? value;
  };
  const scheduleRows = scheduleData.filter(
    (row) =>
      groupCol &&
      row[groupCol.key] !== null &&
      row[groupCol.key] !== "" &&
      (periodCols.some(
        (column) =>
          !isBlankScheduleValue(row[column.key]) || Boolean(fillMeaningFor(row, column.key)),
      ) ||
        (statusCol && row[statusCol.key] !== null && row[statusCol.key] !== "") ||
        allDetailCols.some((column) => row[column.key] !== null && row[column.key] !== "")),
  );
  const observationCols = allDetailCols.filter((column) =>
    /observa|nota|coment|justific|informa[cç][aã]o adicional/i.test(
      `${column.key} ${column.label}`,
    ),
  );
  const metricRows = scheduleRows.map((row) => ({
    ...row,
    ...Object.fromEntries(
      periodCols.map((column) => [column.key, effectiveScheduleValue(row, column.key)]),
    ),
  }));
  const scheduleStats = summarizeScheduleRows(
    metricRows,
    columns,
    periodCols.map((column) => column.key),
    statusCol?.key,
    observationCols.map((column) => column.key),
  );
  const scheduleObservations = scheduleRows
    .flatMap((row) =>
      observationCols.flatMap((column) => {
        const value = row[column.key];
        if (isBlankScheduleValue(value)) return [];
        return [
          {
            item: groupCol ? String(row[groupCol.key] ?? "Item") : "Item",
            field: column.label,
            text: String(value),
          },
        ];
      }),
    )
    .filter(
      (entry, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.item === entry.item &&
            candidate.field === entry.field &&
            candidate.text === entry.text,
        ) === index,
    )
    .slice(0, 100);
  const scheduleMode: ChartDataMode = w.dataMode ?? "raw";
  // Blocos podem misturar análises e unidades. Somar ou calcular média entre
  // resultados diferentes cria um número sem significado; a visão resumida
  // conta registros preenchidos por período e a visão original preserva cada linha.
  const scheduleOps: AggregationOp[] = ["count"];
  const scheduleOp: AggregationOp = scheduleOps.includes(w.op ?? "count")
    ? (w.op ?? "count")
    : "count";
  const aggregateScheduleRow: Row = groupCol
    ? {
        [groupCol.key]: `${aggregationLabels[scheduleOp]} de todos os itens`,
        ...Object.fromEntries(
          periodCols.map((column) => {
            const values = scheduleRows.flatMap((row) => {
              const value = effectiveScheduleValue(row, column.key);
              if (scheduleOp === "count") return isBlankScheduleValue(value) ? [] : [1];
              const numeric = parseNumericValue(value);
              return numeric !== null ? [numeric] : [];
            });
            return [column.key, values.length ? aggregate(values, scheduleOp) : null];
          }),
        ),
      }
    : {};
  const visibleRows = (scheduleMode === "aggregate" ? [aggregateScheduleRow] : scheduleRows).slice(
    0,
    400,
  );
  const togglePeriod = (key: string) => {
    const selected = new Set(periodCols.map((column) => column.key));
    if (selected.has(key) && selected.size > 1) selected.delete(key);
    else selected.add(key);
    onConfigure({
      periodKeys: detectedPeriods
        .filter((column) => selected.has(column.key))
        .map((column) => column.key),
    });
  };
  const toggleDetail = (key: string) => {
    const selected = new Set(detailCols.map((column) => column.key));
    if (selected.has(key)) selected.delete(key);
    else if (selected.size < 8) selected.add(key);
    onConfigure({
      detailKeys: allDetailCols
        .filter((column) => selected.has(column.key))
        .map((column) => column.key),
    });
  };

  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(w.span), sizeClass(w.size, w.type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead
        title={w.title || "Cronograma visual"}
        icon={<CalendarRange className="size-3.5 shrink-0 text-muted-foreground" />}
        {...dragProps}
      />
      <div
        className="oliam-widget-config-bar flex flex-wrap items-center gap-3 border-b border-border bg-muted/15 px-4 py-2"
        data-export-controls
      >
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Item
          <select
            aria-label="Coluna dos itens do cronograma"
            className="oliam-select h-7 max-w-44"
            value={groupCol?.key ?? ""}
            onChange={(event) => onConfigure({ groupKey: event.target.value })}
          >
            {labelOptions.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Situação
          <select
            aria-label="Coluna de situação do cronograma"
            className="oliam-select h-7 max-w-44"
            value={statusCol?.key ?? ""}
            onChange={(event) => onConfigure({ statusKey: event.target.value })}
          >
            <option value="">Sem coluna de situação</option>
            {labelOptions
              .filter((column) => column.key !== groupCol?.key)
              .map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Seção
          <select
            aria-label="Coluna que separa os blocos do cronograma"
            className="oliam-select h-7 max-w-52"
            value={sectionCol?.key ?? ""}
            onChange={(event) => onConfigure({ sectionKey: event.target.value })}
          >
            <option value="">Sem separar por seção</option>
            {labelOptions
              .filter((column) => column.key !== groupCol?.key && column.key !== statusCol?.key)
              .map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
          </select>
        </label>
        <CalculationButton
          mode={scheduleMode}
          operation={scheduleOp}
          operations={scheduleOps}
          metric="os resultados dos períodos"
          group="período"
          allowRaw
          onRaw={() => onConfigure({ dataMode: "raw" })}
          onOperation={(operation) => onConfigure({ dataMode: "aggregate", op: operation })}
        />
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          aria-label="Períodos visíveis"
        >
          {detectedPeriods.map((column) => {
            const selected = periodKeys.has(column.key);
            return (
              <button
                key={column.key}
                type="button"
                className={cn(
                  "shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors",
                  selected
                    ? "border-primary/40 bg-primary/12 text-primary"
                    : "border-border bg-card text-muted-foreground",
                )}
                aria-pressed={selected}
                onClick={() => togglePeriod(column.key)}
              >
                {column.label}
              </button>
            );
          })}
        </div>
        {allDetailCols.length > 0 && (
          <div className="flex basis-full items-center gap-2 border-t border-border/60 pt-2">
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Informações extras
            </span>
            <div
              className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
              aria-label="Informações extras visíveis"
            >
              {allDetailCols.map((column) => {
                const selected = detailKeys.has(column.key);
                return (
                  <button
                    key={column.key}
                    type="button"
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors",
                      selected
                        ? "border-secondary-accent/45 bg-secondary-accent/12 text-foreground"
                        : "border-border bg-card text-muted-foreground",
                    )}
                    aria-pressed={selected}
                    onClick={() => toggleDetail(column.key)}
                    title={selected ? `Ocultar ${column.label}` : `Mostrar ${column.label}`}
                  >
                    {column.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {sizeControls}
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-4 py-1.5 text-[10px] text-muted-foreground">
        <span className="shrink-0 rounded-full bg-muted/40 px-2 py-1">
          <strong className="text-foreground">Métrica</strong> · células por período
        </span>
        <span className="shrink-0 px-1">
          {scheduleMode === "raw"
            ? "linha a linha"
            : `${aggregationLabels[scheduleOp]} por período`}
        </span>
        {w.blockValue && (
          <span
            className="max-w-64 shrink-0 truncate rounded-full bg-primary/8 px-2 py-1 text-foreground"
            title={w.blockValue}
          >
            <strong>Bloco</strong> · {w.blockValue}
          </span>
        )}
      </div>
      {!groupCol || !periodCols.length ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          Não encontrei colunas de mês ou data. Escolha uma planilha de cronograma com períodos no
          cabeçalho.
        </p>
      ) : !visibleRows.length ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          Nenhuma marcação encontrada nos períodos selecionados.
        </p>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-muted/10 px-3 py-2">
            {[
              ...(scheduleStats.planned
                ? [
                    {
                      label: "Programados",
                      value: scheduleStats.planned,
                      suffix: "",
                      className: "text-blue-700 dark:text-blue-300",
                    },
                  ]
                : []),
              {
                label: "Resultados",
                value: scheduleStats.results,
                suffix: "",
                className: "text-foreground",
              },
              {
                label: "Cobertura",
                value: scheduleStats.coverage,
                suffix: "%",
                className: "text-primary",
              },
              {
                label: "Realizados / dentro do limite",
                value: scheduleStats.within,
                suffix: "",
                className: "text-emerald-700 dark:text-emerald-300",
              },
              ...(scheduleStats.attention
                ? [
                    {
                      label: "Reprogramados / atenção",
                      value: scheduleStats.attention,
                      suffix: "",
                      className: "text-amber-700 dark:text-amber-300",
                    },
                  ]
                : []),
              {
                label: "Não realizados / fora do limite",
                value: scheduleStats.outside,
                suffix: "",
                className: "text-destructive",
              },
              {
                label: "Sem registro",
                value: scheduleStats.planned
                  ? Math.max(0, scheduleStats.planned - scheduleStats.results)
                  : scheduleStats.empty,
                suffix: "",
                className: "text-muted-foreground",
              },
              ...(scheduleStats.observations
                ? [
                    {
                      label: "Observações",
                      value: scheduleStats.observations,
                      suffix: "",
                      className: "text-foreground",
                    },
                  ]
                : []),
            ].map((stat) => (
              <div
                key={stat.label}
                className="flex min-w-[7.5rem] shrink-0 items-baseline justify-between gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-1.5 shadow-sm"
              >
                <p className="truncate text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
                <p className={cn("shrink-0 font-mono text-sm font-bold", stat.className)}>
                  {stat.value.toLocaleString("pt-BR")}
                  {stat.suffix}
                </p>
              </div>
            ))}
          </div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-max min-w-full border-separate border-spacing-1 p-3 text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 min-w-52 rounded-lg bg-card px-3 py-2 text-left font-semibold shadow-[1px_1px_0_var(--border)]">
                    {groupCol.label}
                  </th>
                  {detailCols.map((column) => (
                    <th
                      key={column.key}
                      className="sticky top-0 z-10 min-w-28 max-w-48 rounded-lg bg-card px-3 py-2 text-left font-semibold shadow-[0_1px_0_var(--border)]"
                    >
                      {column.label}
                    </th>
                  ))}
                  {periodCols.map((column) => (
                    <th
                      key={column.key}
                      className="sticky top-0 z-10 min-w-20 rounded-lg bg-card px-2 py-2 text-center font-semibold shadow-[0_1px_0_var(--border)]"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, rowIndex) => {
                  const item = String(row[groupCol.key]);
                  const status = statusCol ? row[statusCol.key] : null;
                  const section = sectionCol ? String(row[sectionCol.key] ?? "") : "";
                  const previousSection =
                    sectionCol && rowIndex > 0
                      ? String(visibleRows[rowIndex - 1]?.[sectionCol.key] ?? "")
                      : "";
                  const criterion = scheduleCriterionForRow(
                    row,
                    columns,
                    periodCols.map((column) => column.key),
                  );
                  return (
                    <Fragment key={`${section}-${item}-${rowIndex}`}>
                      {section && section !== previousSection && (
                        <tr>
                          <th
                            colSpan={1 + detailCols.length + periodCols.length}
                            className="sticky left-0 rounded-lg border border-primary/20 bg-primary/8 px-3 py-2 text-left font-semibold text-foreground"
                          >
                            <span className="mr-2 text-[10px] uppercase tracking-[0.12em] text-primary">
                              {sectionCol?.label}
                            </span>
                            {section}
                          </th>
                        </tr>
                      )}
                      <tr>
                        <th className="sticky left-0 z-10 max-w-64 rounded-lg bg-card px-3 py-2 text-left font-medium shadow-[1px_0_0_var(--border)]">
                          <button
                            type="button"
                            className="w-full text-left hover:text-primary"
                            onClick={() =>
                              setFilters(toggleClickFilter(filters, groupCol.key, item))
                            }
                            title={`Filtrar por ${item}`}
                          >
                            <span className="block truncate">{item}</span>
                            {status !== null && status !== "" && (
                              <span className="block truncate text-[10px] font-normal text-muted-foreground">
                                {String(status)}
                              </span>
                            )}
                          </button>
                        </th>
                        {detailCols.map((column) => {
                          const value = row[column.key];
                          const empty = isBlankScheduleValue(value);
                          const label = empty
                            ? "—"
                            : (fmt(value ?? null, column.kind) ?? String(value));
                          return (
                            <td
                              key={column.key}
                              className="max-w-48 rounded-lg bg-muted/30 px-3 py-2 text-left text-[11px] text-foreground"
                              title={`${column.label}: ${label}`}
                            >
                              <span
                                className={cn(
                                  "block",
                                  empty ? "text-muted-foreground" : "break-words",
                                )}
                              >
                                {label}
                              </span>
                            </td>
                          );
                        })}
                        {periodCols.map((column) => {
                          const value = row[column.key];
                          const sourceEmpty = isBlankScheduleValue(value);
                          const fillMeaning = sourceEmpty
                            ? fillMeaningFor(row, column.key)
                            : null;
                          const state =
                            fillMeaning?.state ?? scheduleCellState(value, status, criterion);
                          const empty = sourceEmpty && !fillMeaning;
                          const label = empty
                            ? "Sem registro"
                            : String(fillMeaning?.label ?? value);
                          const criterionLabel = criterion ? ` · Limite: ${criterion.label}` : "";
                          return (
                            <td
                              key={column.key}
                              className={cn(
                                "max-w-32 rounded-lg px-2 py-2 text-center font-semibold transition-transform hover:scale-[1.04]",
                                scheduleCellClass[state],
                              )}
                              title={`${item} · ${column.label}: ${label}${criterionLabel}${status ? ` · ${String(status)}` : ""}`}
                            >
                              {empty ? (
                                <span className="block min-h-4" aria-label="Sem registro" />
                              ) : (
                                <span className="block truncate">{label}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {scheduleObservations.length > 0 && (
            <details className="border-t border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-[11px] font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="size-3.5 text-primary" /> Observações do bloco
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {scheduleObservations.length}
                </span>
              </summary>
              <ul className="grid max-h-52 gap-1.5 overflow-auto border-t border-border p-3 sm:grid-cols-2">
                {scheduleObservations.map((entry, index) => (
                  <li
                    key={`${entry.item}-${entry.field}-${index}`}
                    className="rounded-lg bg-muted/25 px-3 py-2 text-[11px] leading-relaxed"
                  >
                    <span className="block truncate font-medium" title={entry.item}>
                      {entry.item}
                    </span>
                    <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">
                      {entry.field}
                    </span>
                    <span className="whitespace-pre-line">{entry.text}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2 text-[10px] text-muted-foreground">
            <span className="font-medium text-foreground">
              {scheduleRows.length.toLocaleString("pt-BR")} item(ns) · {periodCols.length}{" "}
              período(s)
              {detailCols.length ? ` · ${detailCols.length} informação(ões) extra(s)` : ""}
            </span>
            {[
              ["planned", "Planejado"],
              ["done", "Realizado / dentro do limite / conforme"],
              ["warning", "Reprogramado / pendente / atenção"],
              ["failed", "Não realizado / fora do limite / não conforme"],
              ["empty", "Sem registro"],
            ].map(([state, label]) => (
              <span key={state} className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-2.5 rounded-sm",
                    scheduleCellClass[state as ScheduleCellState],
                  )}
                />
                {label}
              </span>
            ))}
            {scheduleRows.length > visibleRows.length && (
              <span>Mostrando 400 de {scheduleRows.length.toLocaleString("pt-BR")} linhas.</span>
            )}
          </div>
        </>
      )}
    </article>
  );
}
