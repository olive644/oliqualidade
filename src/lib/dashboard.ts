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
  if (widget.type === "table" || widget.type === "folder-files") return true;
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

function repairInvalidWidgets(sheet: SheetData): SheetData {
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
  newSheets: Pick<SheetData, "name" | "rows" | "columns" | "widgets" | "autoDashboard">[],
): SheetData[] {
  return newSheets.map((s) => {
    const old = oldSheets.find((x) => x.name === s.name);
    return {
      name: s.name,
      rows: s.rows,
      columns: s.columns,
      filters: [],
      ...(old ? { previousSnapshot: { rows: old.rows, capturedAt: Date.now() } } : {}),
      ...(old?.chartConfig ? { chartConfig: old.chartConfig } : {}),
      ...(old?.widgets ? { widgets: old.widgets } : {}),
      ...(!old && s.widgets ? { widgets: s.widgets } : {}),
      ...(old?.autoDashboard
        ? { autoDashboard: old.autoDashboard }
        : s.autoDashboard
          ? { autoDashboard: s.autoDashboard }
          : {}),
      ...(old?.bookmarks ? { bookmarks: old.bookmarks } : {}),
    };
  });
}
