import type {
  Bookmark,
  ChartConfig,
  Column,
  Dashboard,
  FilterRule,
  Row,
  SheetData,
  Widget,
} from "@/lib/types";
import { buildRecommendedWidgets, generateAutoDashboardPlan } from "@/lib/auto-dashboard";
import { numericKinds } from "@/lib/types";
import { createWidget } from "@/lib/widgets";

type LegacyDashboard = {
  id: string;
  name: string;
  rows?: Row[];
  columns?: Column[];
  filters?: FilterRule[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  previousSnapshot?: SheetData["previousSnapshot"];
  chartConfig?: ChartConfig;
  widgets?: Widget[];
  bookmarks?: Bookmark[];
  sheets?: SheetData[];
  activeSheetIndex?: number;
  folderMonitor?: Dashboard["folderMonitor"];
};

function widgetCompatible(widget: Widget, columns: Column[]): boolean {
  const byKey = (key: string | undefined) => columns.find((column) => column.key === key);
  if (
    widget.type === "table" ||
    widget.type === "folder-files" ||
    widget.type === "exception-panel" ||
    widget.type === "version-compare"
  )
    return true;
  if (widget.type === "pivot-table" || widget.type === "matrix-heatmap") {
    return Boolean(byKey(widget.groupKey) && byKey(widget.columnKey));
  }
  if (widget.type === "schedule-heatmap") {
    const group = byKey(widget.groupKey);
    const periods = (widget.periodKeys ?? []).filter((key) => byKey(key));
    return Boolean(group && periods.length);
  }
  if (widget.type === "metric" || widget.type === "metric-trend" || widget.type === "rating") {
    return numericKinds.includes(byKey(widget.metricKey)?.kind ?? "text");
  }
  const group = byKey(widget.groupKey);
  const value = byKey(widget.valueKey);
  return Boolean(
    group &&
    value &&
    (widget.op === "count" || numericKinds.includes(value.kind)) &&
    (widget.type !== "line" || group.kind === "date"),
  );
}

function refreshAutomaticScheduleWidgets(sheet: SheetData): SheetData {
  const existing = sheet.widgets ?? [];
  if (!existing.some((widget) => widget.type === "schedule-heatmap")) return sheet;
  const plan = generateAutoDashboardPlan({ columns: sheet.columns, rows: sheet.rows });
  const freshSchedules = buildRecommendedWidgets(plan, sheet.columns, sheet.rows).filter(
    (widget) => widget.type === "schedule-heatmap",
  );
  const currentSchedules = existing.filter((widget) => widget.type === "schedule-heatmap");
  const signature = (widget: Widget) =>
    [widget.groupKey, widget.blockKey, widget.blockValue, ...(widget.periodKeys ?? [])].join("|");
  const currentSignature = currentSchedules.map(signature).sort();
  const freshSignature = freshSchedules.map(signature).sort();
  if (
    currentSignature.length === freshSignature.length &&
    currentSignature.every((value, index) => value === freshSignature[index])
  )
    return { ...sheet, autoDashboard: plan };
  return {
    ...sheet,
    autoDashboard: plan,
    widgets: [
      ...freshSchedules,
      ...existing.filter((widget) => widget.type !== "schedule-heatmap"),
    ],
  };
}

function repairInvalidWidgets(sheet: SheetData): SheetData {
  sheet = refreshAutomaticScheduleWidgets(sheet);
  if (!sheet.widgets?.some((widget) => !widgetCompatible(widget, sheet.columns))) return sheet;
  const plan = generateAutoDashboardPlan({ columns: sheet.columns, rows: sheet.rows });
  const recommended = buildRecommendedWidgets(plan, sheet.columns, sheet.rows);
  const preserved = sheet.widgets.filter((widget) => widgetCompatible(widget, sheet.columns));
  const signatures = new Set(
    preserved.map((widget) =>
      [widget.type, widget.metricKey, widget.groupKey, widget.valueKey, widget.op].join("|"),
    ),
  );
  return {
    ...sheet,
    autoDashboard: plan,
    widgets: [
      ...preserved,
      ...recommended.filter(
        (widget) =>
          !signatures.has(
            [widget.type, widget.metricKey, widget.groupKey, widget.valueKey, widget.op].join("|"),
          ),
      ),
    ],
  };
}

/**
 * Migra um painel salvo no formato antigo (rows/columns/filters/widgets/
 * bookmarks direto no Dashboard, uma tabela só por painel) para o formato
 * novo com múltiplas abas (sheets[]), uma por aba da planilha original —
 * cada uma com sua própria base, filtros e widgets, como abas do Excel.
 *
 * Um painel já no formato novo passa praticamente inalterado, só com
 * activeSheetIndex garantido dentro dos limites (defensivo contra um
 * índice salvo que não exista mais, ex: depois de uma aba ser removida).
 */
export function migrateDashboard(raw: unknown): Dashboard {
  const d = raw as LegacyDashboard;
  if (Array.isArray(d.sheets)) {
    const sheets = d.sheets.map(repairInvalidWidgets);
    const activeSheetIndex =
      typeof d.activeSheetIndex === "number" &&
      d.activeSheetIndex >= 0 &&
      d.activeSheetIndex < sheets.length
        ? d.activeSheetIndex
        : 0;
    return {
      id: d.id,
      name: d.name,
      sheets,
      activeSheetIndex,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      pinned: d.pinned,
      ...(d.folderMonitor ? { folderMonitor: d.folderMonitor } : {}),
    };
  }
  const sheet: SheetData = {
    name: "Dados",
    rows: d.rows ?? [],
    columns: d.columns ?? [],
    filters: d.filters ?? [],
    ...(d.previousSnapshot ? { previousSnapshot: d.previousSnapshot } : {}),
    ...(d.chartConfig ? { chartConfig: d.chartConfig } : {}),
    ...(d.widgets ? { widgets: d.widgets } : {}),
    ...(d.bookmarks ? { bookmarks: d.bookmarks } : {}),
  };
  return {
    id: d.id,
    name: d.name,
    sheets: [sheet],
    activeSheetIndex: 0,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    pinned: d.pinned,
    ...(d.folderMonitor ? { folderMonitor: d.folderMonitor } : {}),
  };
}

export function migrateDashboards(list: unknown[]): Dashboard[] {
  return list.map(migrateDashboard);
}

/**
 * Uma atualização da fonte troca os valores, não as escolhas visuais feitas
 * pelo usuário. Reaplica rótulo, tipo, visibilidade, regras de dados ausentes
 * e formatação condicional às colunas que continuam existindo; colunas
 * calculadas também permanecem disponíveis para os widgets.
 */
export function mergeReimportedColumns(oldColumns: Column[], newColumns: Column[]): Column[] {
  const oldByKey = new Map(oldColumns.map((column) => [column.key, column]));
  const merged = newColumns.map((column) => {
    const old = oldByKey.get(column.key);
    if (!old) return column;
    return {
      ...column,
      label: old.label,
      kind: old.kind,
      visible: old.visible,
      description: old.description,
      ...(old.missingRule ? { missingRule: old.missingRule } : {}),
      ...(old.conditionalFormat
        ? { conditionalFormat: old.conditionalFormat.map((rule) => ({ ...rule })) }
        : {}),
    };
  });
  const newKeys = new Set(newColumns.map((column) => column.key));
  return [
    ...merged,
    ...oldColumns
      .filter((column) => column.formula && !newKeys.has(column.key))
      .map((column) =>
        column.conditionalFormat
          ? {
              ...column,
              conditionalFormat: column.conditionalFormat.map((rule) => ({ ...rule })),
            }
          : { ...column },
      ),
  ];
}

/**
 * Reimportação: casa cada aba recém-importada com uma aba existente do
 * mesmo nome, preservando os widgets, marcadores e configuração de
 * gráfico já montados nela, e gravando a versão anterior (previousSnapshot)
 * para o delta real de cada métrica. Uma aba nova sem correspondente
 * antiga nasce do zero, como se fosse a primeira importação dela.
 * Abas antigas sem correspondente na nova importação são descartadas —
 * reimportar substitui os dados, não soma abas antigas com novas.
 */
export function mergeReimportedSheets(
  oldSheets: SheetData[],
  newSheets: Pick<
    SheetData,
    "name" | "rows" | "columns" | "widgets" | "autoDashboard" | "intelligence"
  >[],
): SheetData[] {
  return newSheets.map((s) => {
    const old = oldSheets.find((x) => x.name === s.name);
    const merged: SheetData = {
      name: s.name,
      rows: s.rows,
      columns: old ? mergeReimportedColumns(old.columns, s.columns) : s.columns,
      filters: [],
      ...(old ? { previousSnapshot: { rows: old.rows, capturedAt: Date.now() } } : {}),
      ...(old?.chartConfig ? { chartConfig: old.chartConfig } : {}),
      ...(old?.widgets ? { widgets: old.widgets } : s.widgets ? { widgets: s.widgets } : {}),
      ...(s.autoDashboard
        ? { autoDashboard: s.autoDashboard }
        : old?.autoDashboard
          ? { autoDashboard: old.autoDashboard }
          : {}),
      ...(s.intelligence ? { intelligence: s.intelligence } : {}),
      ...(old?.bookmarks ? { bookmarks: old.bookmarks } : {}),
    };
    if (old && !merged.widgets?.some((widget) => widget.type === "version-compare")) {
      merged.widgets = [
        createWidget("version-compare", merged.columns, undefined, merged.rows),
        ...(merged.widgets ?? []),
      ];
    }
    return refreshAutomaticScheduleWidgets(merged);
  });
}
