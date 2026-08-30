import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  AlignVerticalDistributeCenter,
  ArrowLeft,
  ArrowRight,
  BarChart2,
  BarChart3,
  Calculator,
  CalendarRange,
  ChartBarDecreasing as ParetoIcon,
  Check,
  Columns3,
  ClipboardPaste,
  Copy,
  Files,
  GitMerge,
  GripVertical,
  Image as ImageIcon,
  LayoutGrid,
  ListOrdered,
  MapPin,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PieChart as PieIcon,
  Radar as RadarIcon,
  ScatterChart as ScatterIcon,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWidgetConfig } from "./widget-config-state";
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
  type ChartAxisKind,
  type ChartDataMode,
  type FilterRule,
  type Kind,
  type WidgetSize,
  type WidgetSpan,
  type WidgetType,
} from "@/lib/types";
import {
  columnDragType,
  columnDropAccepted,
  draggedColumnKind,
  sizeClass,
  spanClass,
} from "@/lib/widgets";
import type { ScheduleCellState } from "@/lib/schedule-normalizer";
import { conditionalColor, fmt } from "@/lib/format";
import { barTooltipReading } from "@/lib/chart-reading";
import { finiteChartCoordinate, sourceRowFromChartPayload } from "@/lib/recharts-compat";
import type { TooltipPayloadEntry } from "recharts";
import {
  aggregationLabels,
  compactDateAxisLabel,
  NOT_INFORMED,
  type AggregationOp,
  type PieComparison,
  type TrendSummary,
} from "@/lib/data-pipeline";
import type { SpreadsheetException } from "@/lib/spreadsheet-intelligence";
import { useWidgetEvidence } from "./widget-evidence-state";

/**
 * Em toque (sem hover confiável), tocar direto numa fatia/barra pra filtrar
 * é fácil demais de disparar sem querer — o usuário só queria olhar o
 * valor. Usado pra trocar, só em dispositivos de toque, o clique-filtra-na-
 * hora (preservado no desktop) por clique-inspeciona-primeiro, com um
 * botão explícito "Filtrar por X" no painel de detalhe que já existe.
 * Calculado por chamada (não é estado reativo): a única coisa que importa é
 * o tipo de ponteiro no momento do clique, igual ao padrão já usado em
 * `closeSidebarOnMobile` (dashboard-nav-sidebar.tsx).
 */
export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

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

/** Props de arrastar/copiar/colar/mover/remover compartilhadas por WidgetHead
 * e EmptyWidget — construídas uma vez em WidgetCard (`dragProps`) e passadas
 * intactas para todo componente de corpo de widget extraído. */
export type WidgetDragProps = {
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
};

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
}: WidgetDragProps & {
  title: string;
  icon?: React.ReactNode;
}) {
  const interactive = !!(onRemove || onCopy || onPaste || onMoveBack || onMoveForward);
  const { open: configOpen, toggle: toggleConfig, expanded, toggleExpanded } = useWidgetConfig();
  return (
    <>
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
            data-edit-only
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground",
              draggable && "cursor-grab",
            )}
            aria-hidden="true"
          />
          {icon && <span className="shrink-0 text-primary [&_svg]:size-4">{icon}</span>}
          <h2 className="truncate font-display text-[13px] font-semibold tracking-tight">
            {title}
          </h2>
        </div>
        {interactive && (
          <div
            className="flex shrink-0 items-center gap-0.5 pointer-coarse:gap-1"
            data-export-controls
            data-edit-only
          >
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-7 pointer-coarse:size-12",
                configOpen && "bg-muted text-foreground",
              )}
              aria-label={`${configOpen ? "Ocultar" : "Mostrar"} configuração de ${title}`}
              aria-expanded={configOpen}
              title={configOpen ? "Ocultar configuração" : "Configurar widget"}
              onClick={toggleConfig}
            >
              <SlidersHorizontal className="size-3.5" />
            </Button>
            {expanded !== null && (
              // Ícone com rótulo: "ampliar" é a ação nova e a que mais se
              // procura ao explorar um gráfico apertado na grade. Sozinho entre
              // ícones mudos ela desaparecia; a palavra ao lado é o que a torna
              // encontrável. Em telas estreitas volta a ser só o ícone, onde
              // não há largura para o texto.
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 pointer-coarse:h-12 pointer-coarse:px-3"
                aria-label={expanded ? `Reduzir ${title}` : `Ampliar ${title}`}
                title={expanded ? "Reduzir" : "Ampliar para ver em detalhe"}
                onClick={toggleExpanded}
              >
                {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                <span className="hidden text-[11px] sm:inline">
                  {expanded ? "Reduzir" : "Ampliar"}
                </span>
              </Button>
            )}
            {/* Copiar, colar, reordenar e remover são ações de arrumação do
              painel, não de leitura. Enfileiradas como ícones soltos, viravam
              cinco alvos cinza idênticos que empurravam configurar e ampliar
              para o meio da fila e escondiam as duas ações que a pessoa
              realmente procura enquanto explora os dados. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 pointer-coarse:size-12"
                  aria-label={`Mais ações para ${title}`}
                  title="Mais ações"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={() => onCopy?.()}>
                  <Copy className="size-3.5" />
                  Copiar widget
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canPaste} onSelect={() => onPaste?.()}>
                  <ClipboardPaste className="size-3.5" />
                  {canPaste ? "Colar widget após este" : "Copie um widget primeiro"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!!disableBack} onSelect={() => onMoveBack?.()}>
                  <ArrowLeft className="size-3.5" />
                  Mover para trás
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!!disableForward} onSelect={() => onMoveForward?.()}>
                  <ArrowRight className="size-3.5" />
                  Mover para frente
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => onRemove?.()}
                >
                  <Trash2 className="size-3.5" />
                  Remover widget
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Evidências e configuração técnica de um widget, no pé dele.
 *
 * A ordem de leitura padronizada de todo widget é resultado, visualização,
 * explicação, evidências e configuração técnica. Esta faixa cobre os dois
 * últimos degraus, e por isso ela desceu: antes, os sete campos técnicos
 * (fonte, cálculo, registros, filtros, unidade, confiança, fórmula) ficavam
 * logo abaixo do título, empurrando para baixo justamente o número que o
 * widget existe para mostrar. Quem abre um painel quer ler o resultado
 * primeiro e conferir a procedência depois — não o contrário.
 *
 * O que fica sempre visível é o mínimo para confiar no número: quantos
 * registros sustentam a conta e quantos filtros estão ativos. O resto abre no
 * clique, porque é configuração, não leitura.
 */
export function WidgetEvidencePanel() {
  const evidence = useWidgetEvidence();
  const [open, setOpen] = useState(false);
  if (!evidence) return null;
  const campo = (rotulo: string, valor: React.ReactNode) => (
    <span className="min-w-0 break-words">
      <strong className="text-foreground">{rotulo}:</strong> {valor}
    </span>
  );
  return (
    <div
      className="border-t border-border/70 bg-card px-4 py-2 text-[10px] leading-relaxed text-muted-foreground"
      aria-label="Origem e cálculo desta visualização"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {campo(
          "Registros válidos",
          `${evidence.validRecords.toLocaleString("pt-BR")} de ${evidence.visibleRecords.toLocaleString("pt-BR")}`,
        )}
        {campo("Filtros ativos", evidence.activeFilters.toLocaleString("pt-BR"))}
        <button
          type="button"
          data-export-controls
          className="ml-auto rounded px-1.5 py-0.5 underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Ocultar cálculo" : "Ver cálculo"}
        </button>
      </div>
      <div
        className={cn(
          "oliam-widget-technical mt-1 flex-wrap gap-x-3 gap-y-1 border-t border-border/50 pt-1",
          open ? "flex" : "hidden",
        )}
      >
        {campo("Fonte", evidence.source)}
        {campo("Cálculo", evidence.operation)}
        {campo("Unidade", evidence.unit)}
        {campo(
          "Confiança",
          evidence.confidence === null ? "não calculada" : `${evidence.confidence}%`,
        )}
        {campo("Fórmula", evidence.formula)}
      </div>
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
  radar: "Compara as maiores categorias em um gráfico de eixos radiais.",
  histogram: "Mostra como os valores de uma coluna numérica estão distribuídos, em faixas.",
  "box-plot":
    "Compara a distribuição (mínimo, quartis, mediana, máximo e valores fora da curva) entre categorias.",
  scatter:
    "Cruza duas colunas numéricas para ver se existe relação entre elas, com reta e correlação.",
  pareto:
    "Ordena as categorias da maior para a menor e acumula a participação, para achar as poucas que concentram a maior parte do total.",
  rating: "Transforma uma média numérica em uma nota visual.",
  map: "Distribui os resultados por cidade, estado ou país.",
  insights:
    "Narra em texto os achados de uma métrica por categoria: quem lidera, quanto concentra e possíveis inconsistências.",
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
  image: "Mostra uma imagem embutida na planilha original (foto, logo, diagrama).",
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
  if (type === "radar") return <RadarIcon className={className} />;
  if (type === "histogram") return <BarChart2 className={className} />;
  if (type === "box-plot") return <AlignVerticalDistributeCenter className={className} />;
  if (type === "scatter") return <ScatterIcon className={className} />;
  if (type === "pareto") return <ParetoIcon className={className} />;
  if (type === "rating") return <Star className={className} />;
  if (type === "map") return <MapPin className={className} />;
  if (type === "insights") return <Sparkles className={className} />;
  if (type === "schedule-heatmap") return <CalendarRange className={className} />;
  if (type === "attendance-overview") return <Check className={className} />;
  if (type === "validation-overview") return <ShieldAlert className={className} />;
  if (type === "control-chart") return <Activity className={className} />;
  if (type === "plan-vs-actual") return <BarChart3 className={className} />;
  if (type === "exception-panel") return <AlertTriangle className={className} />;
  if (type === "version-compare") return <GitMerge className={className} />;
  if (type === "pivot-table" || type === "matrix-heatmap")
    return <Columns3 className={className} />;
  if (type === "image") return <ImageIcon className={className} />;
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
/**
 * O que impede o balão de tooltip de ultrapassar a borda do card.
 *
 * O balão nasce do tamanho do texto, numa linha só, e um texto como
 * "100% do total · 1 categoria agrupada : R$ 240,00" fica mais largo que a área
 * do gráfico. O Recharts só consegue encaixar o balão dentro da área quando ele
 * cabe nela, então limitar a largura é o que faz o encaixe voltar a funcionar;
 * sem isso o texto era cortado na borda e a informação ficava inalcançável.
 *
 * São só as três propriedades de contenção, e não o estilo inteiro: os balões
 * do projeto têm três aparências diferentes (raio, fonte, sombra), e unificá-las
 * aqui mudaria o desenho de quatro deles sem que ninguém tenha pedido.
 */
export const chartTooltipContainment = {
  maxWidth: "14rem",
  whiteSpace: "normal",
  wordBreak: "break-word",
} as const;

/**
 * "1 categoria agrupada", e não "1 categorias agrupadas".
 *
 * A fatia "Outros" da pizza junta o que sobrou depois das cinco maiores, e com
 * sete categorias na planilha ela junta exatamente uma. O texto aparecia em três
 * lugares — tooltip, legenda e tabela alternativa para leitor de tela — sempre no
 * plural, e o caso de uma só é comum o bastante para ter chegado às imagens de
 * referência da regressão visual, onde estava gravado como resultado esperado.
 *
 * Existe num lugar só porque três cópias do mesmo texto são três lugares onde
 * ele pode divergir sem ninguém notar.
 */
export function groupedCategoriesLabel(count: number): string {
  return `${count.toLocaleString("pt-BR")} ${count === 1 ? "categoria agrupada" : "categorias agrupadas"}`;
}

export function truncateLabel(value: string, max = 10): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Tooltip do gráfico de barras.
 *
 * A cápsula de alta/baixa só aparece quando o eixo é cronológico (axis =
 * "time"), porque ela compara o ponto com o item anterior da série. Em um
 * eixo de categorias esse vizinho não é "antes": as barras chegam ordenadas
 * da maior para a menor, então o item anterior é apenas a categoria de valor
 * mais alto, e um "queda de 18%" ali era lido como piora quando significava
 * "18% menor que o primeiro colocado". Para categorias, a comparação honesta
 * é com a maior barra do gráfico, escrita por extenso.
 *
 * O tooltip também mostra quantos registros sustentam a barra no modo
 * agrupado — sem esse número, uma barra de dois registros e uma de
 * novecentos parecem igualmente confiáveis.
 */
export function BarTooltip({
  active,
  payload,
  label,
  series,
  kind,
  mode,
  axis,
}: {
  active: boolean | undefined;
  payload: readonly TooltipPayloadEntry[] | undefined;
  label: string | undefined;
  series: { name: string; total: number; count?: number; sourceRow?: number }[];
  kind: Kind;
  mode: ChartDataMode;
  /** "time" quando o eixo X é cronológico; "category" para agrupamentos. */
  axis: ChartAxisKind;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  if (typeof value !== "number") return null;
  const sourceRow = sourceRowFromChartPayload(payload[0]?.payload);
  const idx = sourceRow
    ? series.findIndex((item) => item.sourceRow === sourceRow)
    : series.findIndex((item) => item.name === label);
  const reading = barTooltipReading({ index: idx, series, mode, axis });
  const pct = reading.changeFromPrevious;
  const up = (pct ?? 0) >= 0;
  const { shareOfLargest, count } = reading;
  return (
    <div
      style={{
        background: "var(--popover)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 400,
        padding: "8px 12px",
        boxShadow: "0 8px 24px -6px color-mix(in oklab, var(--foreground) 18%, transparent)",
      }}
    >
      <div style={{ color: "var(--popover-foreground)", fontWeight: 500, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>
          {fmt(value, kind) ?? value}
        </span>
        {mode === "raw" && sourceRow && (
          <span style={{ color: "var(--muted-foreground)", fontSize: 10 }}>
            linha {sourceRow} do Excel
          </span>
        )}
        {pct !== null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 11,
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 999,
              color: up ? "var(--chart-2)" : "var(--destructive)",
              background: `color-mix(in oklab, ${up ? "var(--chart-2)" : "var(--destructive)"} 18%, transparent)`,
            }}
          >
            {up ? "↑" : "↓"} {Math.abs(pct).toFixed(0)}% vs. anterior
          </span>
        )}
      </div>
      {(count !== null || shareOfLargest !== null) && (
        <div
          style={{
            marginTop: 4,
            display: "flex",
            gap: 8,
            color: "var(--muted-foreground)",
            fontSize: 10,
          }}
        >
          {count !== null && (
            <span>
              {count.toLocaleString("pt-BR")} {count === 1 ? "registro" : "registros"}
            </span>
          )}
          {shareOfLargest !== null && <span>{shareOfLargest.toFixed(0)}% da maior categoria</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Legenda de leitura sob o gráfico: diz o que está em cada eixo e, quando o
 * gráfico desenha a linha de média, qual é o valor dela.
 *
 * Sem isso o eixo vertical mostra "1,2 mil" e cabe ao leitor adivinhar se
 * aquilo é reais, peças ou horas — o título do widget carrega essa
 * informação, mas ela se perde quando o gráfico é exportado ou impresso e
 * circula sozinho.
 *
 * O texto fica em HTML abaixo do gráfico, e não em um <Label> dentro do
 * SVG, por dois motivos concretos: os gráficos com muitas categorias rolam
 * na horizontal, e um título de eixo desenhado no SVG ficaria centralizado
 * no conteúdo rolável, fora da vista até que se role até ele; e a altura
 * útil desses widgets (224px a 256px) não sobra para mais uma faixa de
 * texto dentro da área de plotagem sem achatar as barras.
 */
/**
 * Legenda das séries de um gráfico de linha/área.
 *
 * Cada item desenha o traço real da série, e não um quadrado colorido: o
 * tracejado distingue as séries sem depender de enxergar a diferença de cor,
 * que era a única pista disponível antes.
 *
 * Fica em HTML, e não como `<Legend>` dentro do SVG, pelo mesmo motivo da
 * legenda de eixos: a área de plotagem rola na horizontal, e qualquer coisa
 * desenhada no SVG acompanha a rolagem em vez de ficar fixa à vista.
 */
export function ChartSeriesLegend({
  items,
  className,
}: {
  items: { name: string; color: string; dashed?: boolean }[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-1 pt-4 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.name} className="flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden="true" className="shrink-0">
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke={item.color}
              strokeWidth={2}
              strokeLinecap="round"
              {...(item.dashed ? { strokeDasharray: "4 3" } : {})}
            />
          </svg>
          {item.name}
        </li>
      ))}
    </ul>
  );
}

export function ChartAxisLegend({
  x,
  y,
  average,
  order,
  kind,
}: {
  x: string;
  y: string;
  average?: number | null;
  /** Ordem das categorias, escrita só quando não é a ordenação por valor. */
  order?: string | null;
  kind: Kind;
}) {
  const averageLabel = typeof average === "number" ? fmt(average, kind) : null;
  return (
    <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
      <span className="font-medium text-foreground">Horizontal:</span> {x} ·{" "}
      <span className="font-medium text-foreground">Vertical:</span> {y}
      {averageLabel ? ` · Linha tracejada: média de ${averageLabel}` : ""}
      {order ? ` · Ordem: ${order}` : ""}
    </p>
  );
}

export function AxisTick({
  x,
  y,
  payload,
  max,
  index,
  visibleTicksCount,
}: {
  x?: string | number | undefined;
  y?: string | number | undefined;
  payload?: { value?: string | number };
  /** Quantos caracteres cabem sem colidir com o rótulo vizinho. */
  max?: number;
  index?: number | undefined;
  visibleTicksCount?: number | undefined;
}) {
  const normalizedX = finiteChartCoordinate(x);
  const normalizedY = finiteChartCoordinate(y);
  if (normalizedX === null || normalizedY === null) return null;
  const value = String(payload?.value ?? "");
  const missing = value === NOT_INFORMED;
  // Data que não cabe vira `jan/25` em vez de `2025-01-`. Truncar uma data
  // ocupa quase o mesmo espaço e apaga justamente o que distingue um ponto do
  // seguinte. O valor inteiro continua no `<title>`, que é o que o leitor de
  // tela anuncia e o que aparece ao passar o mouse.
  const compact = max !== undefined && value.length > max ? compactDateAxisLabel(value) : null;
  const shown = compact && compact.length <= (max ?? compact.length) ? compact : null;
  const isFirst = index === 0;
  const isLast =
    visibleTicksCount !== undefined && visibleTicksCount > 1 && index === visibleTicksCount - 1;
  return (
    <text
      x={normalizedX}
      y={normalizedY + 12}
      textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
      fontSize={11}
      fontStyle={missing ? "italic" : "normal"}
      fill={missing ? "var(--muted-foreground)" : "var(--foreground)"}
    >
      <title>{value}</title>
      {shown ?? truncateLabel(value, max)}
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

/**
 * Frase permanente de leitura do gráfico: o que foi calculado, a partir de
 * quantas linhas, e quantas ficaram de fora por falta do dado de
 * agrupamento. Antes só aparecia com a configuração do widget aberta — o
 * usuário perdia essa explicação assim que fechava o painel de edição, e o
 * gráfico voltava a ser só um desenho sem contexto.
 */
export function ChartReadingGuide({
  group,
  metric,
  mode,
  op,
  rowCount,
  missingGroupCount,
}: {
  group: string;
  metric: string;
  mode: ChartDataMode;
  op: AggregationOp;
  rowCount: number;
  missingGroupCount: number;
}) {
  const rowsClause = `${rowCount.toLocaleString("pt-BR")} ${
    rowCount === 1 ? "registro visível" : "registros visíveis"
  }`;
  const reading =
    op === "count"
      ? `Quantidade de registros por "${group}"`
      : mode === "raw"
        ? `"${metric}" linha a linha por "${group}"`
        : `${aggregationLabels[op]} de "${metric}" por "${group}"`;
  return (
    <p className="border-b border-border/70 bg-card px-4 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
      {reading}, considerando {rowsClause}.
      {missingGroupCount > 0 && (
        <>
          {" "}
          {missingGroupCount.toLocaleString("pt-BR")}{" "}
          {missingGroupCount === 1
            ? `linha sem "${group}" não entrou neste gráfico`
            : `linhas sem "${group}" não entraram neste gráfico`}
          .
        </>
      )}
    </p>
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
              className="relative size-8 shrink-0 pointer-coarse:size-12"
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
  /**
   * `grouped` distingue a fatia sintética "Outros" das demais. As duas têm
   * `count`, e ele significa coisas diferentes: numa categoria comum é a
   * contagem de linhas, e só na sintética é a quantidade de categorias
   * reunidas. Sem essa distinção a legenda escrevia "29 categorias agrupadas"
   * embaixo de uma categoria só.
   */
  items: { name: string; total: number; count?: number; grouped?: boolean; color: string }[];
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
              {entry.grouped && entry.count ? (
                <span className="col-span-2 pl-[18px] text-[9px] text-muted-foreground">
                  {groupedCategoriesLabel(entry.count)}
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
  onShowSource,
}: {
  selected: { name: string; total: number };
  comparison: PieComparison | null;
  kind: Kind;
  onFilter?: (() => void) | undefined;
  filterLabel: string;
  onShowSource?: (() => void) | undefined;
}) {
  const shareLabel =
    comparison?.share !== null && comparison?.share !== undefined
      ? comparison.share.toLocaleString("pt-BR", {
          style: "percent",
          maximumFractionDigits: 1,
        })
      : null;
  const relativeLabel =
    comparison?.relativeDifference !== null && comparison?.relativeDifference !== undefined
      ? Math.abs(comparison.relativeDifference).toLocaleString("pt-BR", {
          style: "percent",
          maximumFractionDigits: 1,
        })
      : null;
  const relativeSummary =
    comparison?.relativeDifference === null || comparison?.relativeDifference === undefined
      ? null
      : comparison.relativeDifference > 0
        ? `${relativeLabel} acima`
        : comparison.relativeDifference < 0
          ? `${relativeLabel} abaixo`
          : "no mesmo nível";
  const explanation = shareLabel
    ? comparison?.reference
      ? relativeSummary
        ? `${selected.name} representa ${shareLabel} do total e está ${relativeSummary} de ${comparison.reference.name}.`
        : `${selected.name} representa ${shareLabel} do total. A diferença para ${comparison.reference.name} é absoluta; o percentual não pode ser calculado porque a referência é zero.`
      : `${selected.name} representa ${shareLabel} do total e não há outra categoria visível para comparação.`
    : `Não é possível calcular a participação de ${selected.name} no total.`;

  return (
    // flex-wrap (não grid-cols fixo por breakpoint de viewport): a largura
    // real disponível aqui é a do card do widget (pode ser 1/3 da tela),
    // não a da janela — um grid com colunas mínimas fixas ativado por
    // `sm:` (media query de viewport) cortava texto em vez de quebrar
    // linha, porque a viewport podia estar "sm" mesmo com o widget
    // estreito. flex-wrap reflui de acordo com o espaço que o próprio
    // card tem, seja qual for a largura da tela.
    <div className="oliam-panel-enter oliam-series-comparison-row flex flex-wrap items-center gap-3 border-t border-border bg-muted/10 px-4 py-3">
      <div className="min-w-32 flex-[2] basis-40">
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
        <p className="mt-1 text-[10px] font-medium leading-relaxed text-foreground/80">
          {explanation}
        </p>
      </div>
      <div className="min-w-28 flex-1 basis-28">
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
      <div className="min-w-28 flex-1 basis-28">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Participação</p>
        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
          {shareLabel ? `${shareLabel} do total` : "—"}
        </p>
      </div>
      <div className="min-w-28 flex-1 basis-28">
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
                relativeSummary ? ` · ${relativeSummary}` : ""
              }`
            : "Sem referência"}
        </p>
      </div>
      {onShowSource && (
        <Button size="sm" variant="outline" onClick={onShowSource}>
          Ver linhas de origem
        </Button>
      )}
      {onFilter && (
        <Button size="sm" variant="outline" onClick={onFilter}>
          {filterLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * Painel de detalhe para widgets cujos campos não cabem na forma fixa de
 * `SeriesComparisonPanel` (seleção/comparação com "o total") — box plot
 * (cinco números), dispersão (X/Y de um ponto), Pareto (posição/acumulado).
 * Mesma casca visual (classes, proporções, tipografia) que `SeriesComparisonPanel`
 * já usa, só com uma lista de campos livre em vez de um formato fixo — os
 * três continuam parecendo a mesma família de painel em vez de três
 * variações levemente diferentes.
 */
export function WidgetDetailStrip({
  title,
  subtitle,
  fields,
  actions,
}: {
  title: string;
  subtitle?: string;
  fields: { label: string; value: string }[];
  actions?: React.ReactNode;
}) {
  return (
    // `oliam-widget-detail` é um gancho sem estilo, para que a faixa de detalhe
    // possa ser encontrada por identidade. Sem ele, um teste que procure o item
    // selecionado esbarra primeiro no painel de métricas, que usa a mesma
    // marcação de painel e também tem título.
    <div className="oliam-widget-detail oliam-panel-enter flex flex-wrap items-center gap-3 border-t border-border bg-muted/10 px-4 py-3">
      <div className="min-w-32 flex-[2] basis-40">
        <p className="truncate text-sm font-semibold" title={title}>
          {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {fields.map((field) => (
        <div key={field.label} className="min-w-24 flex-1 basis-24">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{field.label}</p>
          <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{field.value}</p>
        </div>
      ))}
      {actions}
    </div>
  );
}

export type WidgetMetric = {
  label: string;
  value: string;
  /** Variação já formatada (ex.: "+12,5%"); só para métricas com tendência. */
  change?: string;
  /** Direção da variação. Ausente quando a métrica não tem tendência. */
  up?: boolean;
};

/**
 * Faixa de números-chave no topo de um widget: o valor que resume a série e,
 * quando ela é temporal, a variação do período com a seta correspondente.
 *
 * Existe porque um gráfico responde "como está distribuído" mas não responde
 * "quanto deu" sem o leitor somar de cabeça. A leitura fica na mesma altura
 * em todos os widgets, então dá para comparar dois cartões lado a lado sem
 * procurar onde cada um escondeu o total.
 *
 * Sem tendência (`change`), a métrica aparece sozinha — categorias não têm
 * "antes e depois", e inventar uma variação ali seria comparar coisas que
 * não estão em sequência.
 */
export function WidgetMetricStrip({ metrics }: { metrics: WidgetMetric[] }) {
  if (!metrics.length) return null;
  return (
    <div
      className="oliam-panel-enter flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-border px-4 py-2"
      data-widget-metrics
    >
      {metrics.map((metric, index) => (
        <div key={metric.label} className="min-w-0 max-w-full">
          <p
            className="truncate text-[10px] uppercase leading-tight tracking-wide text-muted-foreground"
            title={metric.label}
          >
            {metric.label}
          </p>
          <p className="flex items-center gap-1.5 leading-tight">
            <span
              className={cn(
                "font-mono font-semibold tabular-nums",
                index === 0 ? "text-base" : "text-sm text-muted-foreground",
              )}
            >
              {metric.value}
            </span>
            {metric.change && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                  metric.up
                    ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                    : "bg-destructive/12 text-destructive",
                )}
              >
                {metric.up ? (
                  <TrendingUp className="size-3" aria-hidden="true" />
                ) : (
                  <TrendingDown className="size-3" aria-hidden="true" />
                )}
                {metric.change}
              </span>
            )}
          </p>
        </div>
      ))}
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
    // Mesmo motivo do SeriesComparisonPanel logo acima: flex-wrap reflui
    // pela largura real do card do widget, não pela viewport.
    <div className="oliam-panel-enter oliam-trend-summary-row flex flex-wrap items-center gap-3 border-t border-border bg-muted/10 px-4 py-3">
      <div className="min-w-32 flex-[1.6] basis-40">
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
      <div className="min-w-24 flex-1 basis-24">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Média · {summary.pointCount} períodos
        </p>
        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
          {fmt(summary.average, kind)}
        </p>
      </div>
      <div className="min-w-24 flex-1 basis-24">
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
      <div className="min-w-24 flex-1 basis-24">
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
 * Ponto (dot) de gráfico de linha/área clicável, para cross-filter
 * consistente com barra/pizza/ranking/mapa: clicar em um ponto filtra pelo
 * valor do eixo X daquele ponto (ex: um mês específico), mantendo os
 * filtros de outras colunas (ver toggleClickFilter).
 */
export type ChartDotProps = {
  cx?: number | undefined;
  cy?: number | undefined;
  payload?: { name?: string; total?: number } | undefined;
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
  const pointName = payload?.name;
  const clickable = groupCol !== undefined && pointName !== undefined && pointName !== "";
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
      onClick={() => {
        if (!clickable) return;
        onSelect(groupCol.key, String(pointName));
      }}
    />
  );
}

export function EmptyWidget({
  title,
  span,
  size,
  type,
  animationDelay,
  message,
  ...dragProps
}: {
  title: string;
  span: WidgetSpan;
  size: WidgetSize;
  type: WidgetType;
  animationDelay: number;
  message: string;
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
  return (
    <article
      className={cn("oliam-widget group bg-card", spanClass(span), sizeClass(size, type))}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <WidgetHead title={title} {...dragProps} />
      <p className="p-6 text-center text-xs text-muted-foreground">{message}</p>
    </article>
  );
}

/** Indicador "filtrado por X" exibido no cabeçalho de controles do widget
 * quando a coluna de agrupamento dele tem um filtro simples ativo,
 * sincronizado com a barra de filtros do topo (mesmo estado, sheet.filters).
 * Usado por barra/pizza/linha/área, ranking, insights e mapa. */
export function FilterChip({
  groupKey,
  filters,
  setFilters,
}: {
  groupKey: string | undefined;
  filters: FilterRule[];
  setFilters: (filters: FilterRule[]) => void;
}) {
  const active = groupKey ? filters.find((f) => f.key === groupKey && !f.min && !f.max) : undefined;
  if (!active || !groupKey) return null;
  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded-full border border-primary/40 bg-tint px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary"
      onClick={() => setFilters(filters.filter((f) => f.key !== groupKey))}
      aria-label={`Remover filtro: filtrado por ${active.value}`}
    >
      Filtrado por: {active.value}
      <X className="size-3" />
    </button>
  );
}
