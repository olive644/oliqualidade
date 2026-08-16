import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Calculator,
  CalendarRange,
  Check,
  Columns3,
  ClipboardPaste,
  Copy,
  Files,
  GitMerge,
  GripVertical,
  LayoutGrid,
  ListOrdered,
  MapPin,
  PieChart as PieIcon,
  ShieldAlert,
  Star,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  kinds,
  type Column,
  type ChartDataMode,
  type Kind,
  type WidgetSize,
  type WidgetSpan,
  type WidgetType,
} from "@/lib/types";
import { columnDragType, columnDropAccepted, draggedColumnKind } from "@/lib/widgets";
import type { ScheduleCellState } from "@/lib/schedule-normalizer";
import { conditionalColor, fmt } from "@/lib/format";
import {
  NOT_INFORMED,
  type AggregationOp,
  type PieComparison,
  type TrendSummary,
} from "@/lib/data-pipeline";
import {
  loadGeocodeCache,
  saveGeocodeCache,
  type GeocodeCache,
  type GeoPoint,
} from "@/lib/storage";
import type { SpreadsheetException } from "@/lib/spreadsheet-intelligence";
import { geocodeMissing } from "@/lib/geocode";
import { OliLoader } from "./oli-loader";

export function FieldDropSlot({
  accepts,
  onDropColumn,
  children,
}: {
  accepts: readonly Kind[];
  onDropColumn: (key: string) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const warned = useRef(false);
  return (
    <div
      className={cn(
        "rounded-sm outline-offset-2 transition-[outline-color]",
        over ? "outline outline-2 outline-dashed outline-primary" : "outline-none",
      )}
      onDragOver={(e) => {
        if (columnDropAccepted(e.dataTransfer.types, accepts)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!over) setOver(true);
          warned.current = false;
          return;
        }
        // Coluna de um tipo que este campo não aceita (ex.: texto solto
        // sobre o campo "Coluna numérica"): avisa uma única vez por gesto
        // de arraste, já que dragover dispara várias vezes por segundo
        // enquanto o cursor fica parado sobre o slot.
        const draggedKind = draggedColumnKind(e.dataTransfer.types);
        if (draggedKind && !warned.current) {
          warned.current = true;
          toast.error(`Este campo não aceita colunas do tipo ${kinds[draggedKind]}.`, {
            description: `Tipos aceitos aqui: ${accepts.map((k) => kinds[k]).join(", ")}.`,
          });
        }
      }}
      onDragLeave={(e) => {
        // dragenter/dragleave disparam para cada elemento filho (o texto do
        // rótulo, o <select>), então sem essa checagem o contorno pisca ao
        // arrastar sobre o conteúdo interno em vez de ficar estável durante
        // todo o hover sobre o slot.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
        warned.current = false;
      }}
      onDrop={(e) => {
        if (!columnDropAccepted(e.dataTransfer.types, accepts)) return;
        e.preventDefault();
        setOver(false);
        for (const k of accepts) {
          const key = e.dataTransfer.getData(columnDragType(k));
          if (key) {
            onDropColumn(key);
            return;
          }
        }
      }}
    >
      {children}
    </div>
  );
}

export function WidgetHead({
  title,
  icon,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onRemove,
  onCopy,
  onPaste,
  canPaste,
  onMoveBack,
  onMoveForward,
  disableBack,
  disableForward,
}: {
  title: string;
  icon?: React.ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onRemove?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  canPaste?: boolean;
  onMoveBack?: () => void;
  onMoveForward?: () => void;
  disableBack?: boolean;
  disableForward?: boolean;
}) {
  const interactive = !!(onRemove || onCopy || onPaste || onMoveBack || onMoveForward);
  return (
    <div
      className="flex h-12 flex-wrap items-center justify-between gap-1 border-b border-border bg-muted/30 px-3 pointer-coarse:h-auto pointer-coarse:min-h-12 pointer-coarse:py-1.5"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex min-w-0 items-center gap-2 px-1">
        <GripVertical
          data-export-controls
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground",
            draggable && "cursor-grab",
          )}
          aria-hidden="true"
        />
        {icon && <span className="shrink-0 text-primary [&_svg]:size-4">{icon}</span>}
        <h2 className="truncate font-display text-[13px] font-semibold tracking-tight">{title}</h2>
      </div>
      {interactive && (
        <div
          className="flex shrink-0 items-center gap-0.5 pointer-coarse:gap-1"
          data-export-controls
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-7 pointer-coarse:size-9"
            aria-label={`Copiar ${title}`}
            title="Copiar widget"
            onClick={onCopy}
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 pointer-coarse:size-9"
            aria-label={`Colar widget após ${title}`}
            title={canPaste ? "Colar widget após este" : "Copie um widget primeiro"}
            disabled={!canPaste}
            onClick={onPaste}
          >
            <ClipboardPaste className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 pointer-coarse:size-9"
            aria-label={`Mover ${title} para trás`}
            disabled={disableBack}
            onClick={onMoveBack}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 pointer-coarse:size-9"
            aria-label={`Mover ${title} para frente`}
            disabled={disableForward}
            onClick={onMoveForward}
          >
            <ArrowRight className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 pointer-coarse:size-9 hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Remover ${title}`}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export const widgetSizeLabels: Record<WidgetSize, string> = {
  sm: "Baixo",
  md: "Médio",
  lg: "Alto",
};
export const widgetSpanLabels: Record<WidgetSpan, string> = { 1: "1/3", 2: "2/3", 3: "Cheio" };

export const widgetTypeDescriptions: Record<WidgetType, string> = {
  metric: "Resume uma coluna numérica em um único indicador.",
  "metric-trend": "Mostra um indicador e sua evolução ao longo do tempo.",
  "folder-files": "Conta e acompanha as planilhas de uma pasta monitorada.",
  bar: "Compara valores entre categorias usando barras.",
  pie: "Mostra a participação de cada categoria no total.",
  line: "Exibe a evolução dos valores por data.",
  area: "Destaca volume e evolução ao longo de um período.",
  ranking: "Ordena e exibe os maiores resultados.",
  rating: "Transforma uma média numérica em uma nota visual.",
  map: "Distribui os resultados por cidade, estado ou país.",
  "schedule-heatmap": "Cruza itens e períodos, colorindo o andamento do cronograma.",
  "attendance-overview": "Resume participantes, assinaturas ausentes, setores e turnos.",
  "validation-overview": "Separa aprovações, rejeições e pendências por inspetor.",
  "control-chart": "Acompanha medições, média e limites estatísticos do processo.",
  "plan-vs-actual": "Compara automaticamente o programado e o realizado por período.",
  "exception-panel": "Prioriza inconsistências, anomalias e pontos de baixa confiança.",
  "pivot-table": "Cruza duas dimensões com subtotais e total geral.",
  "matrix-heatmap": "Mostra concentração entre duas dimensões pela intensidade da cor.",
  "version-compare": "Resume inclusões, remoções e alterações desde a última importação.",
  table: "Exibe os registros detalhados da base.",
};

export function WidgetPickerIcon({ type }: { type: WidgetType }) {
  const className = "size-5";
  if (type === "metric") return <Calculator className={className} />;
  if (type === "metric-trend" || type === "line") return <TrendingUp className={className} />;
  if (type === "folder-files") return <Files className={className} />;
  if (type === "bar") return <BarChart3 className={className} />;
  if (type === "pie") return <PieIcon className={className} />;
  if (type === "area") return <Activity className={className} />;
  if (type === "ranking") return <ListOrdered className={className} />;
  if (type === "rating") return <Star className={className} />;
  if (type === "map") return <MapPin className={className} />;
  if (type === "schedule-heatmap") return <CalendarRange className={className} />;
  if (type === "attendance-overview") return <Check className={className} />;
  if (type === "validation-overview") return <ShieldAlert className={className} />;
  if (type === "control-chart") return <Activity className={className} />;
  if (type === "plan-vs-actual") return <BarChart3 className={className} />;
  if (type === "exception-panel") return <AlertTriangle className={className} />;
  if (type === "version-compare") return <GitMerge className={className} />;
  if (type === "pivot-table" || type === "matrix-heatmap")
    return <Columns3 className={className} />;
  return <LayoutGrid className={className} />;
}

export const scheduleCellClass: Record<ScheduleCellState, string> = {
  empty: "bg-muted/35 text-muted-foreground",
  planned: "bg-blue-500/18 text-blue-700 dark:text-blue-300",
  done: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/22 text-amber-800 dark:text-amber-300",
  failed: "bg-destructive/20 text-destructive",
  neutral: "bg-primary/12 text-foreground",
};

/**
 * Tick customizado para o eixo X dos gráficos de barra, área e linha.
 * Aplica cor e tipografia consistentes com o tema (inclusive no modo
 * escuro, onde o texto padrão do Recharts não se adapta sozinho) e destaca
 * a categoria "Não informado" em itálico e tom mais claro, para o usuário
 * distinguir dado ausente de um valor real na primeira olhada.
 */
/** Trunca um rótulo comprido com reticências, mantendo o texto completo
 * disponível via <title> (tooltip nativo do navegador ao passar o mouse),
 * em vez de deixar o SVG quebrar ou sobrepor letras entre rótulos vizinhos. */
export function truncateLabel(value: string, max = 10): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Tooltip do gráfico de barras: mostra o valor do período junto com a
 * variação percentual em relação ao item anterior da série (na ordem em
 * que aparece no eixo), com uma cápsula colorida de alta/baixa — mesma
 * ideia do tooltip de "Revenue" de referência que o usuário mandou.
 * "Anterior" aqui é sempre o item anterior na ordem exibida, não
 * necessariamente uma data — pra grupos não cronológicos (ex.: por
 * vendedor) ainda funciona como "comparado à barra à esquerda".
 */
export function BarTooltip({
  active,
  payload,
  label,
  series,
  kind,
  mode,
}: {
  active: boolean | undefined;
  payload: { value?: number; payload?: { sourceRow?: number } }[] | undefined;
  label: string | undefined;
  series: { name: string; total: number; sourceRow?: number }[];
  kind: Kind;
  mode: ChartDataMode;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  if (typeof value !== "number") return null;
  const sourceRow = payload[0]?.payload?.sourceRow;
  const idx = sourceRow
    ? series.findIndex((item) => item.sourceRow === sourceRow)
    : series.findIndex((item) => item.name === label);
  const prevTotal = idx > 0 ? series[idx - 1]?.total : undefined;
  const pct =
    idx > 0 && typeof prevTotal === "number" && prevTotal !== 0
      ? ((value - prevTotal) / Math.abs(prevTotal)) * 100
      : null;
  const up = (pct ?? 0) >= 0;
  return (
    <div
      style={{
        background: "var(--popover)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        fontSize: 12,
        padding: "8px 12px",
        boxShadow: "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
      }}
    >
      <div style={{ color: "var(--popover-foreground)", fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--popover-foreground)" }}>{fmt(value, kind) ?? value}</span>
        {mode === "raw" && payload[0]?.payload?.sourceRow && (
          <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>
            linha {payload[0].payload.sourceRow} do Excel
          </span>
        )}
        {pct !== null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 11,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 999,
              color: up ? "var(--chart-2)" : "var(--destructive)",
              background: `color-mix(in oklab, ${up ? "var(--chart-2)" : "var(--destructive)"} 18%, transparent)`,
            }}
          >
            {up ? "↑" : "↓"} {Math.abs(pct).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

export function AxisTick({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
}) {
  const value = String(payload?.value ?? "");
  const missing = value === NOT_INFORMED;
  return (
    <text
      x={x}
      y={(y ?? 0) + 12}
      textAnchor="middle"
      fontSize={11}
      fontStyle={missing ? "italic" : "normal"}
      fill={missing ? "var(--muted-foreground)" : "var(--foreground)"}
    >
      <title>{value}</title>
      {truncateLabel(value)}
    </text>
  );
}

export function compactAxisValue(value: number, kind: Kind) {
  const options: Intl.NumberFormatOptions = {
    notation: "compact",
    maximumFractionDigits: 1,
  };
  if (kind === "currency") {
    options.style = "currency";
    options.currency = "BRL";
  }
  if (kind === "percentage") {
    options.style = "percent";
    options.maximumFractionDigits = 0;
  }
  return new Intl.NumberFormat("pt-BR", options).format(value);
}

export function exceptionGuidance(exception: SpreadsheetException): {
  impact: string;
  action: string;
} {
  const guidance: Record<SpreadsheetException["kind"], { impact: string; action: string }> = {
    "duplicate-row": {
      impact: "A mesma informação pode aparecer mais de uma vez e inflar totais ou contagens.",
      action: "Compare as linhas indicadas e mantenha apenas os registros realmente distintos.",
    },
    "mixed-type": {
      impact: "A coluna mistura formatos e pode deixar valores fora de cálculos ou filtros.",
      action: "Abra a origem e padronize o valor conforme o restante da coluna.",
    },
    outlier: {
      impact:
        "O valor está muito distante do padrão e pode distorcer médias, escalas e tendências.",
      action:
        "Confirme na planilha se o valor é real; corrija apenas quando houver erro de digitação.",
    },
    formula: {
      impact:
        "A fórmula não pôde ser confirmada e o resultado pode estar desatualizado ou ausente.",
      action:
        "Recalcule a pasta no Excel e importe novamente, ou confira o resultado na célula de origem.",
    },
    "reader-divergence": {
      impact: "Dois métodos de leitura encontraram resultados diferentes para esta célula.",
      action: "Abra a origem, confirme o valor visível no Excel e escolha a correção adequada.",
    },
    "low-confidence": {
      impact:
        "O formato não foi reconhecido com segurança e pode ter sido interpretado incorretamente.",
      action: "Confira o valor e o tipo da coluna antes de usar este dado em decisões.",
    },
    "incompatible-unit": {
      impact: "Valores com unidades diferentes não podem ser comparados ou somados diretamente.",
      action: "Converta os valores para a mesma unidade ou mantenha-os em métricas separadas.",
    },
  };
  return guidance[exception.kind];
}

export function ChartReadingGuide({
  group,
  metric,
  mode,
  operation,
}: {
  group: string;
  metric: string;
  mode: ChartDataMode;
  operation: string;
}) {
  return (
    <div
      className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-border/70 bg-card px-4 py-1.5 text-[10px] text-muted-foreground"
      title={`Eixo X: ${group}. Eixo Y: ${metric}. ${mode === "raw" ? "Cada linha do Excel" : operation}.`}
    >
      <span className="max-w-44 shrink-0 truncate rounded-full bg-muted/40 px-2 py-1">
        <strong className="text-foreground">X</strong> · {group}
      </span>
      <span aria-hidden="true">→</span>
      <span className="max-w-44 shrink-0 truncate rounded-full bg-muted/40 px-2 py-1">
        <strong className="text-foreground">Y</strong> · {metric}
      </span>
      <span className="max-w-56 shrink-0 truncate px-1">
        {mode === "raw" ? "linha a linha" : operation}
      </span>
    </div>
  );
}

export const calculationCopy: Record<AggregationOp, { action: string; detail: string }> = {
  sum: {
    action: "Somar os valores",
    detail: "Junta as linhas da mesma categoria e mostra o total.",
  },
  avg: {
    action: "Calcular a média",
    detail: "Junta as linhas da mesma categoria e mostra o valor médio.",
  },
  count: {
    action: "Contar as linhas",
    detail: "Mostra quantos registros existem em cada categoria.",
  },
  min: {
    action: "Mostrar o menor valor",
    detail: "Escolhe o menor resultado encontrado em cada categoria.",
  },
  max: {
    action: "Mostrar o maior valor",
    detail: "Escolhe o maior resultado encontrado em cada categoria.",
  },
  multiply: {
    action: "Multiplicar os valores",
    detail: "Multiplica os resultados da categoria na ordem em que aparecem.",
  },
  divide: {
    action: "Dividir os valores",
    detail: "Divide o primeiro resultado pelos seguintes, respeitando a ordem.",
  },
};

export function CalculationButton({
  mode,
  operation,
  operations,
  metric,
  group,
  allowRaw = false,
  onRaw,
  onOperation,
}: {
  mode?: ChartDataMode;
  operation: AggregationOp;
  operations: AggregationOp[];
  metric: string;
  group?: string | undefined;
  allowRaw?: boolean;
  onRaw?: () => void;
  onOperation: (operation: AggregationOp) => void;
}) {
  const current = mode === "raw" ? "Cada linha do Excel" : calculationCopy[operation].action;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="relative size-8 shrink-0"
              aria-label={`Escolher cálculo. Atual: ${current}`}
            >
              <Calculator className="size-4" />
              {mode !== "raw" && (
                <span
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
                  aria-hidden="true"
                />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Escolher como calcular</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-1.5">
        <DropdownMenuLabel className="px-2 pb-0.5 text-xs">
          Como calcular {metric}
        </DropdownMenuLabel>
        <p className="px-2 pb-2 text-[11px] leading-relaxed text-muted-foreground">
          {group
            ? `Escolha se o gráfico mantém as linhas originais ou combina valores por ${group}.`
            : "Escolha o resumo numérico que este indicador deve mostrar."}
        </p>
        <DropdownMenuSeparator />
        {allowRaw && (
          <DropdownMenuItem className="items-start py-2" {...(onRaw ? { onSelect: onRaw } : {})}>
            <Check className={cn("mt-0.5 size-4", mode === "raw" ? "opacity-100" : "opacity-0")} />
            <span>
              <span className="block text-xs font-medium">Manter cada linha do Excel</span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                Não soma nem combina valores; preserva a ordem original da planilha.
              </span>
            </span>
          </DropdownMenuItem>
        )}
        {operations.map((candidate) => {
          const copy = calculationCopy[candidate];
          const selected = mode !== "raw" && operation === candidate;
          return (
            <DropdownMenuItem
              key={candidate}
              className="items-start py-2"
              onSelect={() => onOperation(candidate)}
            >
              <Check className={cn("mt-0.5 size-4", selected ? "opacity-100" : "opacity-0")} />
              <span>
                <span className="block text-xs font-medium">
                  {copy.action}
                  {group ? ` por ${group}` : ""}
                </span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                  {copy.detail}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Legenda externa da pizza. Mantê-la fora do SVG impede que o Recharts
 * comprima ou corte o gráfico quando os nomes e valores ocupam mais espaço.
 * Também é aqui que "Não informado" recebe o mesmo destaque do eixo.
 */
export function PieLegend({
  items,
  kind,
  activeIndex,
  onHoverIndex,
  onSelectIndex,
}: {
  items: { name: string; total: number; count?: number; color: string }[];
  kind?: Kind;
  activeIndex?: number | null;
  onHoverIndex?: (i: number | null) => void;
  onSelectIndex?: (i: number) => void;
}) {
  if (!items.length) return null;
  const sum = items.reduce((s, entry) => s + entry.total, 0);
  return (
    <ul
      className="flex max-h-52 min-w-0 flex-col gap-1 overflow-y-auto rounded-xl bg-muted/20 p-2 text-[11px]"
      aria-label="Legenda do gráfico de pizza"
    >
      {items.map((entry, i) => {
        const missing = entry.name === NOT_INFORMED;
        const pct = sum > 0 ? (entry.total / sum) * 100 : 0;
        const dimmed = activeIndex !== null && activeIndex !== undefined && activeIndex !== i;
        return (
          <li
            key={`${entry.name}-${i}`}
            className={cn(
              "rounded-lg transition-all duration-150",
              dimmed ? "opacity-45" : "opacity-100",
              activeIndex === i && "bg-accent",
            )}
            onMouseEnter={() => onHoverIndex?.(i)}
            onMouseLeave={() => onHoverIndex?.(null)}
          >
            <button
              type="button"
              className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-1.5 text-left"
              onClick={() => onSelectIndex?.(i)}
              title={`Filtrar por ${entry.name}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: entry.color }}
                />
                <span
                  className={cn(
                    "truncate",
                    missing && "italic text-muted-foreground",
                    activeIndex === i && "font-semibold text-foreground",
                  )}
                  title={entry.name}
                >
                  {entry.name}
                </span>
              </span>
              <span className="whitespace-nowrap text-right font-mono text-muted-foreground">
                <span className="block">{fmt(entry.total, kind ?? "number") ?? entry.total}</span>
                <span className="block text-[9px]">{pct.toFixed(1)}%</span>
              </span>
              {entry.count ? (
                <span className="col-span-2 pl-[18px] text-[9px] text-muted-foreground">
                  {entry.count.toLocaleString("pt-BR")} categorias agrupadas
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Painel de leitura guiada para uma categoria em destaque (hover ou seleção)
 * dentro de um gráfico categórico: valor, participação no total e diferença
 * para a maior outra categoria visível. Extraído do gráfico de pizza, que foi
 * o primeiro a ganhar essa camada de explicação além do próprio desenho —
 * `comparison` vem de `pieComparisonFor` (`data-pipeline.ts`), que já é
 * genérica sobre `{name, total}[]` e não depende de nada específico de pizza.
 *
 * A classe `oliam-series-comparison-row` também é o gatilho de uma regra CSS
 * de exportação (`styles.css`) que empilha esta grade em uma única coluna só
 * em modo de exportação PDF/PNG — sem ela, o mínimo de largura da primeira
 * coluna pode ser espremido a quase 0px e o texto quebra letra por letra
 * (bug real já corrigido para o pizza, ver `docs/CURRENT_STATE_AUDIT.md`,
 * seção 41). Qualquer novo uso deste componente herda a correção automaticamente.
 */
export function SeriesComparisonPanel({
  selected,
  comparison,
  kind,
  onFilter,
  filterLabel,
}: {
  selected: { name: string; total: number };
  comparison: PieComparison | null;
  kind: Kind;
  onFilter?: (() => void) | undefined;
  filterLabel: string;
}) {
  return (
    <div className="oliam-series-comparison-row grid gap-3 border-t border-border bg-muted/10 px-4 py-3 sm:grid-cols-[minmax(8rem,1.4fr)_repeat(3,minmax(7rem,0.7fr))_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold" title={selected.name}>
          {selected.name}
        </p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
          {comparison
            ? `Posição ${comparison.rank} de ${comparison.categoryCount} categorias visíveis`
            : "Categoria em destaque"}
          {comparison?.reference
            ? ` · comparação com ${comparison.reference.name}, a maior outra categoria.`
            : " · não há outra categoria para comparar."}
        </p>
      </div>
      <div>
        <p
          className="truncate text-[10px] uppercase tracking-wide text-muted-foreground"
          title={`Valor de ${selected.name}`}
        >
          Valor de {selected.name}
        </p>
        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
          {fmt(selected.total, kind)}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Participação</p>
        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
          {comparison?.share !== null && comparison?.share !== undefined
            ? comparison.share.toLocaleString("pt-BR", {
                style: "percent",
                maximumFractionDigits: 1,
              })
            : "—"}
        </p>
      </div>
      <div>
        <p
          className="truncate text-[10px] uppercase tracking-wide text-muted-foreground"
          title={
            comparison?.reference ? `Diferença para ${comparison.reference.name}` : "Comparação"
          }
        >
          {comparison?.reference ? `Diferença para ${comparison.reference.name}` : "Comparação"}
        </p>
        <p
          className={cn(
            "mt-0.5 font-mono text-sm font-semibold tabular-nums",
            comparison?.difference !== null &&
              comparison?.difference !== undefined &&
              comparison.difference < 0
              ? "text-destructive"
              : "text-emerald-700 dark:text-emerald-300",
          )}
        >
          {comparison?.difference !== null && comparison?.difference !== undefined
            ? `${comparison.difference >= 0 ? "+" : ""}${fmt(comparison.difference, kind)}${
                comparison.relativeDifference !== null
                  ? ` · ${comparison.relativeDifference >= 0 ? "+" : ""}${comparison.relativeDifference.toLocaleString(
                      "pt-BR",
                      { style: "percent", maximumFractionDigits: 1 },
                    )}`
                  : ""
              }`
            : "Sem referência"}
        </p>
      </div>
      {onFilter && (
        <Button size="sm" variant="outline" onClick={onFilter}>
          {filterLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * Resumo de tendência para linha/área: variação do primeiro ao último ponto
 * cronológico, além dos pontos de mínimo e máximo já visíveis no gráfico e a
 * média do período. `summary` vem de `trendSummaryFor` (`data-pipeline.ts`).
 * Ao contrário de `SeriesComparisonPanel`, não compara categorias entre si —
 * a ordem dos pontos é temporal, não um ranking.
 */
export function TrendSummaryPanel({ summary, kind }: { summary: TrendSummary; kind: Kind }) {
  const positive = summary.change >= 0;
  return (
    <div className="oliam-trend-summary-row grid gap-3 border-t border-border bg-muted/10 px-4 py-3 sm:grid-cols-[minmax(8rem,1.3fr)_repeat(3,minmax(6rem,0.8fr))] sm:items-center">
      <div className="min-w-0">
        <p
          className="truncate text-[10px] uppercase tracking-wide text-muted-foreground"
          title={`${summary.first.name} até ${summary.last.name}`}
        >
          {summary.first.name} → {summary.last.name}
        </p>
        <p
          className={cn(
            "mt-0.5 font-mono text-sm font-semibold tabular-nums",
            positive ? "text-emerald-700 dark:text-emerald-300" : "text-destructive",
          )}
        >
          {positive ? "+" : ""}
          {fmt(summary.change, kind)}
          {summary.relativeChange !== null
            ? ` · ${positive ? "+" : ""}${summary.relativeChange.toLocaleString("pt-BR", {
                style: "percent",
                maximumFractionDigits: 1,
              })}`
            : ""}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Média · {summary.pointCount} períodos
        </p>
        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
          {fmt(summary.average, kind)}
        </p>
      </div>
      <div className="min-w-0">
        <p
          className="truncate text-[10px] uppercase tracking-wide text-muted-foreground"
          title={`Mínimo em ${summary.min.name}`}
        >
          Mínimo · {summary.min.name}
        </p>
        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
          {fmt(summary.min.total, kind)}
        </p>
      </div>
      <div className="min-w-0">
        <p
          className="truncate text-[10px] uppercase tracking-wide text-muted-foreground"
          title={`Máximo em ${summary.max.name}`}
        >
          Máximo · {summary.max.name}
        </p>
        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
          {fmt(summary.max.total, kind)}
        </p>
      </div>
    </div>
  );
}

/**
 * Um widget do painel: cartão de métrica, gráfico ou tabela. Cada widget
 * calcula seus próprios dados a partir de sua configuração (metricKey ou
 * groupKey/valueKey/op), de forma independente dos demais widgets. A ordem
 * no array de widgets do painel determina a posição na grade; arrastar pelo
 * cabeçalho (ou usar as setas) reordena, e os seletores de largura/altura
 * redimensionam.
 */
/**
 * Corpo do widget de mapa: geocodifica os nomes de local do agrupamento
 * (usando o cache compartilhado em lib/storage.ts e lib/geocode.ts) e
 * desenha um marcador por local resolvido num mapa Leaflet com tiles do
 * OpenStreetMap, com raio proporcional ao valor agregado. O Leaflet só é
 * carregado no navegador (import dinâmico dentro do efeito), nunca durante
 * a renderização no servidor.
 */
// Tiles CARTO (grátis, sem chave de API, atribuição exigida só em texto) nos
// estilos "Positron" (claro) e "Dark Matter" (escuro) — bem mais discretos
// em cinza/azul do que os tiles coloridos padrão do OpenStreetMap, e casam
// com o tema claro/escuro do próprio site em vez de destoar dele. Trocar
// pra um provedor com estilo 100% customizável (Mapbox/MapTiler, cores
// exatas da paleta do site) exigiria criar conta e chave de API — não dá
// pra fazer isso pelo usuário sem as credenciais dele.
const MAP_TILE_URL = {
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const MAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>';

export function MapWidgetBody({
  grouped,
  valueColumn,
  onSelect,
}: {
  grouped: { name: string; total: number }[];
  valueColumn: Column;
  onSelect: (name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const tileLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const [cache, setCache] = useState<GeocodeCache>({});
  const [ready, setReady] = useState(false);
  // Segue o mesmo tema (claro/escuro) do resto do site: o toggle de tema
  // alterna a classe "dark" em <html> (ver useTheme), então observar essa
  // classe aqui evita ter que passar o tema por várias camadas de props só
  // pra chegar nesse widget.
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const namesKey = grouped.map((g) => g.name).join("|");

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(el.classList.contains("dark")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    loadGeocodeCache().then((c) => {
      if (alive) {
        setCache(c);
        setReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const names = namesKey ? namesKey.split("|") : [];
    void (async () => {
      const updates: GeocodeCache = {};
      await geocodeMissing(names, cache, (name, point) => {
        updates[name] = point;
      });
      if (!alive || !Object.keys(updates).length) return;
      setCache((prev) => {
        const next = { ...prev, ...updates };
        void saveGeocodeCache(next);
        return next;
      });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, namesKey]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let alive = true;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const mod = await import("leaflet");
      const L = (mod.default ?? mod) as typeof import("leaflet");
      if (!alive || !containerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current).setView([-14, -51], 3);
      }
      const map = mapRef.current;
      if (!tileLayerRef.current) {
        tileLayerRef.current = L.tileLayer(MAP_TILE_URL[isDark ? "dark" : "light"], {
          attribution: MAP_ATTRIBUTION,
          maxZoom: 20,
        }).addTo(map);
      } else {
        tileLayerRef.current.setUrl(MAP_TILE_URL[isDark ? "dark" : "light"]);
      }
      layerRef.current?.remove();
      const layer = L.layerGroup();
      const resolved = grouped
        .map((g) => ({ ...g, point: cache[g.name] }))
        .filter((g): g is typeof g & { point: GeoPoint } => !!g.point);
      const max = resolved.reduce((m, g) => Math.max(m, Math.abs(g.total)), 0) || 1;
      const sum = resolved.reduce((s, g) => s + g.total, 0);
      // Resolvido aqui (não como string "var(--primary)" fixa) porque o
      // Leaflet grava isso como atributo SVG (stroke/fill) via JS, e nem
      // todo navegador/webview resolve custom property CSS num atributo de
      // presentation attribute setado assim — resolver o valor de verdade
      // é mais confiável. Refeito a cada troca de tema (isDark é dependência
      // deste efeito) pra continuar acompanhando claro/escuro.
      const primaryColor =
        getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() ||
        "#0ea5e9";
      const colorProbe = document.createElement("span");
      colorProbe.hidden = true;
      document.body.appendChild(colorProbe);
      resolved.forEach((g) => {
        const radius = 7 + (Math.abs(g.total) / max) * 20;
        const pct = sum > 0 ? (g.total / sum) * 100 : 0;
        const formattedColor = conditionalColor(
          g.total,
          valueColumn.kind,
          valueColumn.conditionalFormat,
        );
        colorProbe.style.color = formattedColor ?? primaryColor;
        const markerColor = getComputedStyle(colorProbe).color || primaryColor;
        const marker = L.circleMarker([g.point.lat, g.point.lng], {
          radius,
          color: markerColor,
          fillColor: markerColor,
          fillOpacity: 0.45,
          weight: 2,
        });
        const popup = document.createElement("div");
        popup.className = "text-xs";
        const strong = document.createElement("strong");
        strong.textContent = g.name;
        popup.appendChild(strong);
        popup.appendChild(document.createElement("br"));
        popup.appendChild(
          document.createTextNode(`${fmt(g.total, valueColumn.kind) ?? "–"} (${pct.toFixed(1)}%)`),
        );
        marker.bindPopup(popup);
        marker.on("click", () => onSelect(g.name));
        marker.addTo(layer);
      });
      colorProbe.remove();
      layer.addTo(map);
      layerRef.current = layer;
      resizeTimer = setTimeout(() => {
        if (alive && mapRef.current === map) map.invalidateSize();
      }, 50);
      if (resolved.length) {
        const bounds = L.latLngBounds(resolved.map((g) => [g.point.lat, g.point.lng]));
        map.fitBounds(bounds.pad(0.3), { maxZoom: 6 });
      }
    })();
    return () => {
      alive = false;
      clearTimeout(resizeTimer);
    };
  }, [grouped, cache, onSelect, valueColumn, isDark]);

  const resolvedCount = grouped.filter((g) => cache[g.name]).length;
  const notFoundCount = grouped.filter((g) => g.name in cache && cache[g.name] === null).length;
  const pending = grouped.length - resolvedCount - notFoundCount;
  // Quando nenhum nome vira marcador, o mapa fica só com os tiles de fundo
  // e nenhum ponto — sem esse aviso maior, a única pista era um texto
  // pequeno no rodapé, fácil de não notar (parece "o mapa não funciona",
  // quando na prática é a coluna escolhida que não tem nome de local de
  // verdade, ex: nome de vendedor em vez de cidade).
  const allUnresolved = !pending && grouped.length > 0 && resolvedCount === 0;

  return (
    <>
      <div className="relative">
        <div ref={containerRef} className="h-64 w-full" />
        {pending > 0 && (
          <div className="oliam-map-loading" role="status">
            <OliLoader compact />
            <span>Localizando {pending}…</span>
          </div>
        )}
      </div>
      {allUnresolved && (
        <p className="border-t bg-destructive/10 px-4 py-2 text-[11px] text-destructive">
          Nenhum dos {grouped.length} valores dessa coluna foi reconhecido como local (cidade,
          estado ou país) pelo OpenStreetMap. Troque a coluna de agrupamento acima por uma que tenha
          nome de local de verdade.
        </p>
      )}
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        Localização aproximada a partir do nome do local, via OpenStreetMap Nominatim. O tamanho de
        cada ponto indica o valor agregado.
        {pending > 0 && ` Localizando ${pending} de ${grouped.length}…`}
        {notFoundCount > 0 &&
          !allUnresolved &&
          ` ${notFoundCount} local(is) não encontrado(s) e sem marcador no mapa.`}
      </p>
      <p className="sr-only">
        Tabela alternativa ao mapa: {grouped.map((g) => `${g.name}, ${g.total}`).join("; ")}.
      </p>
    </>
  );
}

/**
 * Ponto (dot) de gráfico de linha/área clicável, para cross-filter
 * consistente com barra/pizza/ranking/mapa: clicar em um ponto filtra pelo
 * valor do eixo X daquele ponto (ex: um mês específico), mantendo os
 * filtros de outras colunas (ver toggleClickFilter).
 */
export type ChartDotProps = {
  cx?: number;
  cy?: number;
  payload?: { name?: string; total?: number };
};
export function ChartDot({
  cx,
  cy,
  r,
  payload,
  groupCol,
  valueCol,
  onSelect,
}: ChartDotProps & {
  r: number;
  groupCol: Column | undefined;
  valueCol: Column | undefined;
  onSelect: (groupKey: string, value: string) => void;
}) {
  if (cx === undefined || cy === undefined) return null;
  const clickable = !!(groupCol && payload?.name);
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={
        conditionalColor(
          payload?.total ?? null,
          valueCol?.kind ?? "text",
          valueCol?.conditionalFormat,
        ) ?? "var(--primary)"
      }
      style={clickable ? { cursor: "pointer" } : undefined}
      onClick={() => clickable && onSelect(groupCol!.key, String(payload!.name))}
    />
  );
}
