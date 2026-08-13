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
  | "rating"
  | "map"
  | "schedule-heatmap"
  | "table";
// largura em colunas de uma grade de 3 colunas
export type WidgetSpan = 1 | 2 | 3;
export type WidgetSize = "sm" | "md" | "lg";

export type Widget = {
  id: string;
  type: WidgetType;
  title?: string; // título customizado; vazio usa um título calculado
  metricKey?: string; // metric/metric-trend/rating: coluna numérica exibida
  groupKey?: string; // bar/pie/line/area/ranking: coluna de agrupamento (linha usa coluna de data); metric-trend: coluna de data opcional para o sparkline
  valueKey?: string; // bar/pie/line/area/ranking: coluna numérica agregada
  op?: ChartAggregationOp; // bar/pie/line/area/ranking: operação de agregação
  span: WidgetSpan;
  size: WidgetSize;
  topN?: number; // ranking: quantos itens exibir (padrão 5)
  scaleMax?: number; // rating: nota máxima da escala (padrão 5)
  periodKeys?: string[]; // schedule-heatmap: colunas exibidas horizontalmente
  statusKey?: string; // schedule-heatmap: coluna que distingue planejado/executado/status
  detailKeys?: string[]; // schedule-heatmap: contexto preservado (limite, análise, responsável etc.)
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
  rating: "Indicador de avaliação",
  map: "Mapa por localização",
  "schedule-heatmap": "Cronograma visual",
  table: "Tabela",
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
  bookmarks?: Bookmark[];
};

export type Dashboard = {
  id: string;
  name: string;
  sheets: SheetData[];
  activeSheetIndex: number;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
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
