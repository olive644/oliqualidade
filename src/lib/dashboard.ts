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
import { analyzeSpreadsheet } from "@/lib/spreadsheet-intelligence";
import { detectOperationalWidgetTypes } from "@/lib/operational-widgets";

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
  if (
    widget.type === "attendance-overview" ||
    widget.type === "validation-overview" ||
    widget.type === "control-chart" ||
    widget.type === "plan-vs-actual"
  ) {
    return detectOperationalWidgetTypes(columns).includes(widget.type);
  }
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
  // Histograma e dispersão não agrupam por categoria, e por isso não têm
  // `groupKey`: o histograma mostra a distribuição de uma coluna numérica, e a
  // dispersão cruza duas. `createWidget` documenta e implementa isso.
  //
  // Sem estes dois ramos eles caem na regra geral abaixo, que exige `groupKey`,
  // e são julgados incompatíveis com a própria planilha que os originou. O
  // efeito era silencioso e caro: ao recarregar o painel, `repairInvalidWidgets`
  // descartava o widget configurado e o repunha a partir das recomendações, com
  // outro título, outra coluna e sem a contagem de faixas escolhida, além de
  // acrescentar a grade inteira de widgets recomendados.
  if (widget.type === "histogram") {
    return numericKinds.includes(byKey(widget.valueKey)?.kind ?? "text");
  }
  if (widget.type === "scatter") {
    return (
      numericKinds.includes(byKey(widget.valueKey)?.kind ?? "text") &&
      numericKinds.includes(byKey(widget.valueKey2)?.kind ?? "text")
    );
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

const AUTOMATIC_OPERATIONAL_TYPES = new Set<Widget["type"]>([
  "schedule-heatmap",
  "attendance-overview",
  "control-chart",
  "plan-vs-actual",
]);
const AUTOMATIC_WIDGET_POLICY_VERSION = 2;

function refreshAutomaticWidgets(sheet: SheetData): SheetData {
  const previousPolicy = sheet.automaticWidgetPolicyVersion ?? 0;
  const originalWidgets = sheet.widgets ?? [];
  const cleanedWidgets = originalWidgets.filter(
    (widget) =>
      previousPolicy >= AUTOMATIC_WIDGET_POLICY_VERSION ||
      (widget.type !== "exception-panel" && widget.type !== "validation-overview"),
  );
  const removedLegacyAutomaticWidget = cleanedWidgets.length !== originalWidgets.length;
  const existing = removedLegacyAutomaticWidget ? cleanedWidgets : originalWidgets;
  const plan = generateAutoDashboardPlan({ columns: sheet.columns, rows: sheet.rows });
  const freshAutomatic = buildRecommendedWidgets(plan, sheet.columns, sheet.rows).filter((widget) =>
    AUTOMATIC_OPERATIONAL_TYPES.has(widget.type),
  );
  const currentAutomatic = existing.filter((widget) =>
    AUTOMATIC_OPERATIONAL_TYPES.has(widget.type),
  );
  const signature = (widget: Widget) =>
    [
      widget.type,
      widget.groupKey,
      widget.blockKey,
      widget.blockValue,
      ...(widget.periodKeys ?? []),
    ].join("|");
  const currentSignature = currentAutomatic.map(signature).sort();
  const freshSignature = freshAutomatic.map(signature).sort();
  if (
    currentSignature.length === freshSignature.length &&
    currentSignature.every((value, index) => value === freshSignature[index])
  )
    return {
      ...sheet,
      autoDashboard: plan,
      ...(sheet.widgets !== undefined || removedLegacyAutomaticWidget ? { widgets: existing } : {}),
      automaticWidgetPolicyVersion: AUTOMATIC_WIDGET_POLICY_VERSION,
    };
  return {
    ...sheet,
    autoDashboard: plan,
    automaticWidgetPolicyVersion: AUTOMATIC_WIDGET_POLICY_VERSION,
    widgets: [
      ...freshAutomatic.map(
        (widget) =>
          currentAutomatic.find((current) => signature(current) === signature(widget)) ?? widget,
      ),
      ...existing.filter((widget) => !AUTOMATIC_OPERATIONAL_TYPES.has(widget.type)),
    ],
  };
}

function migrateDeprecatedTimelineWidget(sheet: SheetData): SheetData {
  const widgets = sheet.widgets ?? [];
  if (!widgets.some((widget) => widget.type === "line")) return sheet;
  return {
    ...sheet,
    widgets: widgets.map((widget) =>
      widget.type === "line" ? { ...widget, type: "area" as const } : widget,
    ),
  };
}

/**
 * Tipos que desenham uma marca por linha quando o modo é "linha a linha".
 * Tabela e cartões de número não entram: eles não multiplicam elementos com
 * o tamanho da planilha.
 */
const ROW_PER_MARK_TYPES = new Set<Widget["type"]>([
  "bar",
  "pie",
  "line",
  "area",
  "ranking",
  "radar",
  "insights",
  "map",
]);

/**
 * Converte para agregado os widgets salvos em "linha a linha" cuja coluna de
 * agrupamento se repete.
 *
 * Painéis criados antes da correção guardaram `dataMode: "raw"` como padrão.
 * Numa planilha de 600 vendas em 6 canais isso desenha 600 marcas empilhadas
 * sobre 6 rótulos — ilegível, e pesado o bastante para travar o navegador. O
 * widget novo já nasce certo, mas o painel salvo continuaria assim para
 * sempre, porque nada reprocessa a escolha depois de gravada.
 *
 * Conservadora de propósito: só toca em widgets cuja coluna de agrupamento
 * de fato se repete nas linhas atuais. Sem repetição, "linha a linha" e
 * agregado desenham a mesma coisa, e a preferência salva é preservada — o
 * mesmo critério que decide o padrão de um widget novo.
 */
function migrateRowPerMarkWidgets(sheet: SheetData): SheetData {
  const widgets = sheet.widgets ?? [];
  if (!widgets.length || !sheet.rows.length) return sheet;
  const repeats = new Map<string, boolean>();
  const groupRepeats = (groupKey: string) => {
    const cached = repeats.get(groupKey);
    if (cached !== undefined) return cached;
    const seen = new Set<unknown>();
    for (const row of sheet.rows) {
      const value = row[groupKey];
      if (value !== null && value !== undefined && value !== "") seen.add(value);
    }
    const result = sheet.rows.length > seen.size;
    repeats.set(groupKey, result);
    return result;
  };
  let changed = false;
  const migrated = widgets.map((widget) => {
    if (widget.dataMode !== "raw" || !ROW_PER_MARK_TYPES.has(widget.type)) return widget;
    if (!widget.groupKey || !groupRepeats(widget.groupKey)) return widget;
    changed = true;
    return { ...widget, dataMode: "aggregate" as const };
  });
  return changed ? { ...sheet, widgets: migrated } : sheet;
}

function repairInvalidWidgets(sheet: SheetData): SheetData {
  sheet = migrateDeprecatedTimelineWidget(sheet);
  sheet = migrateRowPerMarkWidgets(sheet);
  sheet = refreshAutomaticWidgets(sheet);
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
    "name" | "rows" | "columns" | "widgets" | "autoDashboard" | "intelligence" | "sourceNotes"
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
      ...(s.sourceNotes?.length ? { sourceNotes: s.sourceNotes } : {}),
      ...(old?.semanticOverrides ? { semanticOverrides: old.semanticOverrides } : {}),
      ...(old?.exceptionDecisions ? { exceptionDecisions: old.exceptionDecisions } : {}),
      ...(old?.auditTrail ? { auditTrail: old.auditTrail } : {}),
      ...(old?.bookmarks ? { bookmarks: old.bookmarks } : {}),
      ...(old?.automaticWidgetPolicyVersion
        ? { automaticWidgetPolicyVersion: old.automaticWidgetPolicyVersion }
        : {}),
    };
    if (old?.semanticOverrides) {
      merged.intelligence = analyzeSpreadsheet(
        merged.rows,
        merged.columns,
        undefined,
        old.semanticOverrides,
      );
    }
    if (merged.exceptionDecisions && merged.intelligence) {
      const currentExceptionIds = new Set(merged.intelligence.exceptions.map((item) => item.id));
      merged.exceptionDecisions = Object.fromEntries(
        Object.entries(merged.exceptionDecisions).filter(([id]) => currentExceptionIds.has(id)),
      );
    }
    if (old && !merged.widgets?.some((widget) => widget.type === "version-compare")) {
      merged.widgets = [
        createWidget("version-compare", merged.columns, undefined, merged.rows),
        ...(merged.widgets ?? []),
      ];
    }
    return refreshAutomaticWidgets(merged);
  });
}
