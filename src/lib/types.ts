export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;
export type Kind = "number" | "currency" | "percentage" | "text" | "date" | "category";

export type MissingRule =
  | "ignore" // padrão: ignora nos totais
  | "zero" // trata como zero
  | "interpolate" // estima por interpolação linear
  | "hide-row"; // oculta a linha inteira

export type ConditionalFormatRule = {
  id: string;
  type: "threshold" | "scale";
  // threshold: colore quando o valor cruza um limite
  operator?: "lt" | "lte" | "gt" | "gte";
  value?: number;
  color?: string; // cor de texto ou fundo
  background?: boolean;
  // scale: heatmap min/max
  min?: number;
  max?: number;
  minColor?: string;
  maxColor?: string;
};

export type Column = {
  key: string;
  label: string;
  kind: Kind;
  visible: boolean;
  description: string;
  formula?: string; // presente quando é uma coluna calculada
  missingRule?: MissingRule; // regra de dado ausente (numéricas: ignore/zero/interpolate/hide-row; texto: ignore = "Não informado" / hide-row)
  conditionalFormat?: ConditionalFormatRule[];
};

export type FilterRule = {
  key: string;
  value: string; // usado para texto/categoria (contém)
  min?: string; // usado para número (mín) ou data (início), como string p/ manter o input controlado
  max?: string; // usado para número (máx) ou data (fim)
};

export type ChartAggregationOp = "sum" | "avg" | "count" | "min" | "max" | "multiply" | "divide";
export type ChartDataMode = "raw" | "aggregate";

export type ChartConfig = {
  groupKey: string;
  valueKey: string;
  op: ChartAggregationOp;
};

export type WidgetType =
  | "metric"
  | "metric-trend"
  | "folder-files"
  | "bar"
  | "pie"
  | "line"
  | "area"
  | "ranking"
  | "radar"
  | "rating"
  | "map"
  | "insights"
  | "schedule-heatmap"
  | "attendance-overview"
  | "validation-overview"
  | "control-chart"
  | "plan-vs-actual"
  | "exception-panel"
  | "pivot-table"
  | "matrix-heatmap"
  | "version-compare"
  | "table"
  | "image";
// largura em colunas de uma grade de 3 colunas
export type WidgetSpan = 1 | 2 | 3;
export type WidgetSize = "sm" | "md" | "lg";

export type Widget = {
  id: string;
  type: WidgetType;
  title?: string; // título customizado; vazio usa um título calculado
  metricKey?: string; // metric/metric-trend/rating: coluna numérica exibida
  groupKey?: string; // bar/pie/line/area/ranking/radar: coluna de agrupamento (linha usa coluna de data); metric-trend: coluna de data opcional para o sparkline
  valueKey?: string; // bar/pie/line/area/ranking/radar: coluna numérica agregada
  op?: ChartAggregationOp; // bar/pie/line/area/ranking/radar: operação de agregação
  dataMode?: ChartDataMode; // raw: uma marca por linha do Excel; aggregate: combina categorias
  span: WidgetSpan;
  size: WidgetSize;
  topN?: number; // ranking/radar: quantos itens exibir (padrão 5)
  scaleMax?: number; // rating: nota máxima da escala (padrão 5)
  periodKeys?: string[]; // schedule-heatmap: colunas exibidas horizontalmente
  statusKey?: string; // schedule-heatmap: coluna que distingue planejado/executado/status
  sectionKey?: string; // schedule-heatmap: agrupa linhas por análise/bloco sem repetir o rótulo
  detailKeys?: string[]; // schedule-heatmap: contexto preservado (limite, análise, responsável etc.)
  blockKey?: string; // schedule-heatmap automático: coluna que identifica o bloco de origem
  blockValue?: string; // schedule-heatmap automático: bloco exclusivo exibido neste widget
  columnKey?: string; // pivot/matrix: dimensão exibida nas colunas
  imageIndex?: number; // image: índice em sheet.sourceImages
};

export const widgetTypeLabels: Record<WidgetType, string> = {
  metric: "Métrica",
  "metric-trend": "Métrica com tendência",
  "folder-files": "Planilhas monitoradas",
  bar: "Gráfico de barras",
  pie: "Gráfico de pizza",
  line: "Linha do tempo",
  area: "Gráfico de área",
  ranking: "Ranking (Top N)",
  radar: "Gráfico radar",
  rating: "Indicador de avaliação",
  map: "Mapa por localização",
  insights: "Insights automáticos",
  "schedule-heatmap": "Cronograma visual",
  "attendance-overview": "Presença e assinaturas",
  "validation-overview": "Validação de inspetores",
  "control-chart": "Carta de controle",
  "plan-vs-actual": "Planejado × realizado",
  "exception-panel": "Painel de exceções",
  "pivot-table": "Tabela dinâmica",
  "matrix-heatmap": "Matriz de cruzamento",
  "version-compare": "Comparador de versões",
  table: "Tabela",
  image: "Imagem embutida",
};

export type Bookmark = {
  id: string;
  name: string;
  filters: FilterRule[];
  search: string;
  sort: { key: string; dir: "asc" | "desc" } | null;
  createdAt: number;
};

export type SheetData = {
  name: string;
  rows: Row[];
  columns: Column[];
  filters: FilterRule[];
  previousSnapshot?: { rows: Row[]; capturedAt: number };
  chartConfig?: ChartConfig; // legado: usado só para migrar painéis sem "widgets"
  widgets?: Widget[];
  autoDashboard?: AutoDashboardPlan;
  automaticWidgetPolicyVersion?: number;
  intelligence?: import("@/lib/spreadsheet-intelligence").SpreadsheetIntelligence;
  semanticOverrides?: import("@/lib/spreadsheet-intelligence").SemanticOverrides;
  exceptionDecisions?: import("@/lib/spreadsheet-intelligence").ExceptionDecisions;
  auditTrail?: import("@/lib/data-review").AuditEntry[];
  bookmarks?: Bookmark[];
  /** Observações soltas e comentários de célula preservados da planilha original. */
  sourceNotes?: import("@/lib/import-intelligence").SourceNote[];
  /** Imagens embutidas na planilha original (fotos, logos, diagramas). */
  sourceImages?: import("@/lib/workbook-metadata").WorkbookImageDiagnostic[];
  /** Cor de preenchimento original do Excel por (linha, coluna), só quando a aba é simples o bastante para resolver com segurança. */
  sourceCellFills?: import("@/lib/cell-fill-provenance").SourceCellFill[];
  /** Endereço, valor bruto e fórmula original por (linha, coluna) — calculado uma vez na importação, enquanto a grade original ainda existe, para permitir abrir a célula de origem a partir de um valor agregado no dashboard depois que a grade é descartada. */
  sourceCellProvenance?: import("@/lib/cell-provenance").SourceCellProvenance[];
  /** Rótulo inferido por banda de cor de preenchimento sem mesclagem real, só para exibição — nunca escreve em `rows`. */
  colorGroupLabels?: import("@/lib/cell-fill-provenance").ColorGroupLabel[];
  /** Formas nativas do Excel com texto, persistidas para exibição no painel (não só na revisão). */
  sourceShapes?: import("@/lib/workbook-metadata").WorkbookShapeDiagnostic[];
  /** Gráficos nativos do Excel, persistidos para exibição no painel (não só na revisão). */
  sourceCharts?: import("@/lib/workbook-metadata").WorkbookChartDiagnostic[];
};

export type Dashboard = {
  id: string;
  name: string;
  sheets: SheetData[];
  activeSheetIndex: number;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  sourceFileName?: string;
  folderMonitor?: import("@/lib/folder-monitor").FolderMonitorView;
};

export const kinds: Record<Kind, string> = {
  number: "Número",
  currency: "Moeda",
  percentage: "Percentual",
  text: "Texto",
  date: "Data",
  category: "Categoria",
};

export const numericKinds: Kind[] = ["number", "currency", "percentage"];
import type { AutoDashboardPlan } from "@/lib/auto-dashboard";
