import type {
  ChartConfig,
  Column,
  Kind,
  Row,
  Widget,
  WidgetSize,
  WidgetSpan,
  WidgetType,
} from "@/lib/types";
import { numericKinds } from "@/lib/types";

export function newWidgetId(): string {
  return `widget_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Cria uma cópia independente de um widget, preservando toda a configuração
 * visual e de dados. O identificador sempre muda para que React, arrastar e
 * remover continuem tratando original e cópia como cartões distintos.
 */
export function duplicateWidget(widget: Widget): Widget {
  return { ...widget, id: newWidgetId() };
}

// Tipos de coluna aceitos como agrupamento (eixo X de linha/area, categoria
// de barra/pizza/ranking/mapa). Reaproveitado tanto no filtro de colunas
// candidatas quanto no arrastar-e-soltar de coluna para slot de gráfico
// (ver columnDragType/columnDropTypes).
export const groupableKinds: Kind[] = ["category", "text", "date"];

const COLUMN_DRAG_PREFIX = "application/x-oliqualidade-col-";

/**
 * Nome do tipo MIME sintético usado no dataTransfer ao arrastar uma coluna
 * (painel "Colunas visíveis") para um slot de campo de gráfico (agrupar
 * por / coluna numérica). O tipo da coluna fica embutido no próprio nome do
 * tipo MIME porque, por restrição do HTML5 Drag and Drop, o valor real
 * (dataTransfer.getData) só fica disponível no evento de drop, mas o slot
 * de destino precisa saber durante o dragover se aceita aquela coluna, para
 * decidir se mostra o destaque visual e se chama preventDefault (sem isso o
 * drop nunca dispara). Como os valores de Kind já são só ascii minúsculo,
 * não há risco de perda de informação por normalização de case do
 * navegador nesse tipo MIME.
 */
export function columnDragType(kind: Kind): string {
  return `${COLUMN_DRAG_PREFIX}${kind}`;
}

/**
 * Verifica se algum dos tipos presentes no dataTransfer (dragover ou drop)
 * corresponde a uma coluna de um dos tipos aceitos pelo slot.
 */
export function columnDropAccepted(types: readonly string[], accepts: readonly Kind[]): boolean {
  return accepts.some((k) => types.includes(columnDragType(k)));
}

/**
 * Extrai o tipo da coluna sendo arrastada a partir de dataTransfer.types,
 * mesmo durante o dragover (quando dataTransfer.getData ainda não está
 * disponível por restrição do navegador). Usado para diferenciar "isto não
 * é uma coluna sendo arrastada" (ex.: reordenar um widget, que também usa
 * drag and drop mas não define nenhum tipo com este prefixo) de "é uma
 * coluna, mas de um tipo que este campo não aceita", para só avisar o
 * usuário no segundo caso.
 */
export function draggedColumnKind(types: readonly string[]): Kind | null {
  for (const t of types) {
    if (t.startsWith(COLUMN_DRAG_PREFIX)) return t.slice(COLUMN_DRAG_PREFIX.length) as Kind;
  }
  return null;
}

// Abaixo desse percentual de preenchimento, uma coluna e tratada como
// "quase vazia" e evitada como agrupamento padrao, mesmo que seja a
// primeira coluna categorica/de texto encontrada na planilha (caso comum
// de colunas extras ou mal importadas, ver pickBestGroupColumn).
const MIN_FILL_RATIO = 0.2;

// Nomes comuns de coluna sequencial em planilhas financeiras (tabela Price,
// SAC etc.), usados para achar um eixo X razoavel em linha/area quando nao
// ha coluna de data preenchida.
const SEQUENTIAL_KEY_HINT =
  /parcela|periodo|per[i]odo|sequencia|sequ[e]ncia|indice|[i]ndice|ordem|n[o]\.?(\s|$)|numero|n[u]mero|\bmes\b|m[e]s|month|installment/i;

// Nomes comuns de coluna geografica em planilhas (cidade, estado, regiao
// etc.), usados para o widget de mapa preferir uma coluna que faz sentido
// geocodificar em vez de cair na primeira coluna categorica qualquer (ex.:
// "Vendedor"), que a Nominatim nunca vai conseguir localizar - o mapa ficava
// vazio silenciosamente, sem nenhum indicio pro usuario de que a coluna
// escolhida automaticamente era o problema. O nome/chave da coluna é
// normalizado (sem acento) antes de testar, pra "Município"/"municipio"
// darem no mesmo resultado sem precisar listar as duas formas no regex.
const LOCATION_KEY_HINT =
  /cidade|municipio|estado|\buf\b|regiao|pais|local(idade)?|endereco|bairro|cep|city|state|country|location|address/i;

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function pickLocationColumn(columns: Column[], rows: Row[]): Column | undefined {
  const candidates = columns.filter(
    (c) =>
      groupableKinds.includes(c.kind) &&
      LOCATION_KEY_HINT.test(stripAccents(`${c.label} ${c.key}`)),
  );
  return pickBestGroupColumn(candidates, rows);
}

function fillRatio(col: Column, rows: Row[]): number {
  if (!rows.length) return 1; // sem linhas para avaliar (ex.: testes unitarios): nao penaliza
  let filled = 0;
  for (const r of rows) {
    const v = r[col.key];
    if (v !== null && v !== "") filled++;
  }
  return filled / rows.length;
}

/**
 * Escolhe a melhor coluna entre candidatas para uso como agrupamento
 * padrao, preferindo a mais preenchida. Colunas quase vazias (abaixo de
 * MIN_FILL_RATIO) so sao escolhidas se nao houver alternativa melhor, para
 * o painel nao cair inteiro em "Nao informado" por causa de uma coluna
 * residual ou mal importada da planilha.
 */
export function pickBestGroupColumn(candidates: Column[], rows: Row[]): Column | undefined {
  if (!candidates.length) return undefined;
  const scored = candidates.map((c) => ({ c, fill: fillRatio(c, rows) }));
  const usable = scored.filter((s) => s.fill >= MIN_FILL_RATIO);
  const pool = usable.length ? usable : scored;
  return pool.reduce((best, cur) => (cur.fill > best.fill ? cur : best)).c;
}

/**
 * Para linha/area sem coluna de data preenchida, procura uma coluna
 * numerica que pareca um indice sequencial (parcela, mes, periodo etc.)
 * para servir de eixo X, em vez de cair numa coluna categorica sem
 * nenhum sentido de evolucao no tempo.
 */
function pickSequentialIndexColumn(columns: Column[], rows: Row[]): Column | undefined {
  const candidates = columns.filter(
    (c) => numericKinds.includes(c.kind) && SEQUENTIAL_KEY_HINT.test(`${c.label} ${c.key}`),
  );
  return pickBestGroupColumn(candidates, rows);
}

export function defaultSpan(type: WidgetType): WidgetSpan {
  if (
    type === "metric" ||
    type === "metric-trend" ||
    type === "folder-files" ||
    type === "pie" ||
    type === "rating"
  )
    return 1;
  if (type === "bar" || type === "ranking" || type === "map") return 2;
  return 3; // line, area, table
}

export function defaultSize(type: WidgetType): WidgetSize {
  if (type === "metric" || type === "metric-trend" || type === "folder-files" || type === "rating")
    return "sm";
  if (type === "map") return "lg";
  return "md";
}

const PERIOD_COLUMN_PATTERN =
  /(?:^|\b)(?:jan(?:eiro)?|fev(?:ereiro)?|mar(?:[cç]o)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)(?:\b|$)|^\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?$/i;

/** Colunas que representam períodos em planilhas largas de cronograma. */
export function schedulePeriodColumns(columns: Column[]): Column[] {
  return columns.filter((column) => PERIOD_COLUMN_PATTERN.test(`${column.label}`.trim()));
}

export function scheduleStatusColumn(columns: Column[], periodKeys: string[]): Column | undefined {
  const periods = new Set(periodKeys);
  return columns.find(
    (column) =>
      !periods.has(column.key) &&
      /^(?:status|situa[cç][aã]o|etapa|planejamento|execu[cç][aã]o|tipo|resultado)$/i.test(
        column.label.trim(),
      ),
  );
}

export function scheduleSectionColumn(
  columns: Column[],
  periodKeys: string[],
  groupKey?: string,
  statusKey?: string,
): Column | undefined {
  const periods = new Set(periodKeys);
  const candidates = columns.filter(
    (column) =>
      !periods.has(column.key) &&
      column.key !== groupKey &&
      column.key !== statusKey &&
      groupableKinds.includes(column.kind),
  );
  return candidates.find((column) =>
    /^(?:bloco|se[cç][aã]o|grupo|categoria)$/i.test(column.label.trim()),
  );
}

export function scheduleLimitColumn(columns: Column[], periodKeys: string[]): Column | undefined {
  const periods = new Set(periodKeys);
  return columns.find(
    (column) =>
      !periods.has(column.key) &&
      /(?:^|\b)(?:m[aá]x(?:imo)?|m[ií]n(?:imo)?|limite|crit[eé]rio|meta)(?:\b|\.)/i.test(
        `${column.label} ${column.key}`,
      ),
  );
}

const SCHEDULE_DETAIL_HINT =
  /(?:m[aá]x(?:imo)?|m[ií]n(?:imo)?|limite|meta|crit[eé]rio|frequ[eê]ncia|periodicidade|an[aá]lise|ensaio|m[eé]todo|respons[aá]vel|prestador|registro|laudo|unidade|resultado|observa[cç][aã]o|produto|material|gramatura|amostra)/i;

/**
 * Campos que dão contexto ao cronograma e não podem desaparecer só por não
 * serem o item principal ou um período. Mantém inclusive colunas numéricas
 * como "Máx.", pois uma linha apenas com limite ainda é informação válida.
 */
export function scheduleDetailColumns(
  columns: Column[],
  periodKeys: string[],
  rows: Row[],
  groupKey?: string,
  statusKey?: string,
): Column[] {
  const periods = new Set(periodKeys);
  const candidates = columns.filter((column) => {
    if (periods.has(column.key) || column.key === groupKey || column.key === statusKey)
      return false;
    return rows.some((row) => row[column.key] !== null && row[column.key] !== "");
  });
  const ranked = candidates
    .map((column, index) => ({
      column,
      index,
      priority: SCHEDULE_DETAIL_HINT.test(`${column.label} ${column.key}`) ? 1 : 0,
      fill: fillRatio(column, rows),
    }))
    .sort((a, b) => b.priority - a.priority || b.fill - a.fill || a.index - b.index)
    .slice(0, 6)
    .map(({ column }) => column);
  const selected = new Set(ranked.map((column) => column.key));
  return columns.filter((column) => selected.has(column.key));
}

export function scheduleItemColumn(
  columns: Column[],
  periodKeys: string[],
  rows: Row[],
): Column | undefined {
  const periods = new Set(periodKeys);
  const candidates = columns.filter(
    (column) => !periods.has(column.key) && groupableKinds.includes(column.kind),
  );
  const explicit = candidates.find((column) =>
    /(?:item|ponto|material|produto|objeto|m[aá]quina|local|[aá]rea)/i.test(column.label),
  );
  return explicit ?? pickBestGroupColumn(candidates, rows) ?? candidates[0];
}

/**
 * Cria um widget novo com valores padrão sensatos a partir das colunas
 * disponíveis no painel. Usado tanto ao adicionar um widget pela primeira
 * vez quanto pela migração de painéis antigos (ver buildDefaultWidgets).
 */
export function createWidget(
  type: WidgetType,
  columns: Column[],
  seed?: { groupKey?: string; valueKey?: string; op?: Widget["op"] },
  rows: Row[] = [],
): Widget {
  const nums = columns.filter((c) => numericKinds.includes(c.kind));
  const catCandidates = columns.filter((c) => c.kind === "category" || c.kind === "text");
  const cat = pickBestGroupColumn(catCandidates, rows);
  const dateCol = columns.find((c) => c.kind === "date");
  const dateColFilled = dateCol && fillRatio(dateCol, rows) >= MIN_FILL_RATIO ? dateCol : undefined;
  const groupable = columns.filter((c) => groupableKinds.includes(c.kind));
  const groupableBest = pickBestGroupColumn(groupable, rows);
  const widget: Widget = {
    id: newWidgetId(),
    type,
    span: defaultSpan(type),
    size: defaultSize(type),
  };
  if (type === "metric" || type === "metric-trend" || type === "rating") {
    const metricKey = seed?.valueKey ?? nums[0]?.key;
    if (metricKey) widget.metricKey = metricKey;
    if (type === "metric-trend") {
      const trendGroupKey = seed?.groupKey ?? dateCol?.key;
      if (trendGroupKey) widget.groupKey = trendGroupKey;
    }
    if (type === "rating") widget.scaleMax = 5;
  } else if (type === "schedule-heatmap") {
    const periods = schedulePeriodColumns(columns);
    widget.periodKeys = periods.map((column) => column.key);
    const group = scheduleItemColumn(columns, widget.periodKeys, rows);
    const status = scheduleStatusColumn(columns, widget.periodKeys);
    const section = scheduleSectionColumn(columns, widget.periodKeys, group?.key, status?.key);
    if (group) widget.groupKey = group.key;
    if (status && status.key !== group?.key) widget.statusKey = status.key;
    if (section) widget.sectionKey = section.key;
    widget.detailKeys = scheduleDetailColumns(
      columns,
      widget.periodKeys,
      rows,
      group?.key,
      status?.key,
    )
      .filter((column) => column.key !== section?.key)
      .map((column) => column.key);
  } else if (
    type === "bar" ||
    type === "pie" ||
    type === "line" ||
    type === "area" ||
    type === "ranking" ||
    type === "map"
  ) {
    const groupKey =
      seed?.groupKey ??
      (type === "line" || type === "area"
        ? (dateColFilled?.key ?? pickSequentialIndexColumn(columns, rows)?.key)
        : type === "map"
          ? pickLocationColumn(columns, rows)?.key
          : undefined) ??
      cat?.key ??
      groupableBest?.key;
    const valueKey = seed?.valueKey ?? nums[0]?.key;
    if (groupKey) widget.groupKey = groupKey;
    if (valueKey) widget.valueKey = valueKey;
    widget.op = seed?.op ?? "sum";
    if (type === "ranking") widget.topN = 5;
  }
  return widget;
}

/**
 * Gera a grade padrão de widgets para painéis criados antes do modelo de
 * widgets configuráveis existir. Reproduz o layout fixo antigo (3 cartões de
 * métrica + barra + pizza + linha + tabela) para que nada mude visualmente
 * na primeira vez que um painel salvo é reaberto.
 */
export function buildDefaultWidgets(
  columns: Column[],
  chartConfig?: ChartConfig,
  rows: Row[] = [],
): Widget[] {
  const nums = columns.filter((c) => numericKinds.includes(c.kind));
  const catCandidates = columns.filter((c) => c.kind === "category" || c.kind === "text");
  const cat = pickBestGroupColumn(catCandidates, rows);
  const dateCol = columns.find((c) => c.kind === "date");
  const dateColFilled = dateCol && fillRatio(dateCol, rows) >= MIN_FILL_RATIO ? dateCol : undefined;
  const groupable = columns.filter((c) => groupableKinds.includes(c.kind));
  const groupableBest = pickBestGroupColumn(groupable, rows);
  const primary = nums[0];
  const widgets: Widget[] = [];

  for (const c of nums.slice(0, 3)) {
    widgets.push({ id: newWidgetId(), type: "metric", metricKey: c.key, span: 1, size: "sm" });
  }

  const barGroupKey = chartConfig?.groupKey ?? cat?.key ?? groupableBest?.key;
  const barValueKey = chartConfig?.valueKey ?? primary?.key;
  if (barGroupKey && barValueKey) {
    widgets.push({
      id: newWidgetId(),
      type: "bar",
      groupKey: barGroupKey,
      valueKey: barValueKey,
      op: chartConfig?.op ?? "sum",
      span: 2,
      size: "md",
    });
  }

  if (cat && primary) {
    widgets.push({
      id: newWidgetId(),
      type: "pie",
      groupKey: cat.key,
      valueKey: primary.key,
      op: "sum",
      span: 1,
      size: "md",
    });
  }

  const lineGroupKey = dateColFilled?.key ?? pickSequentialIndexColumn(columns, rows)?.key;
  if (lineGroupKey && primary) {
    widgets.push({
      id: newWidgetId(),
      type: "line",
      groupKey: lineGroupKey,
      valueKey: primary.key,
      op: "sum",
      span: 3,
      size: "md",
    });
  }

  widgets.push({ id: newWidgetId(), type: "table", span: 3, size: "md" });

  return widgets;
}

// Classes literais (não construídas dinamicamente) para o scanner do Tailwind encontrar.
export function spanClass(span: WidgetSpan): string {
  if (span === 1) return "lg:col-span-1";
  if (span === 2) return "lg:col-span-2";
  return "lg:col-span-3";
}

export function sizeClass(size: WidgetSize, type: WidgetType): string {
  if (type === "table") return "";
  if (size === "sm") return "min-h-36";
  if (size === "md") return "min-h-80";
  return "min-h-[28rem]";
}
