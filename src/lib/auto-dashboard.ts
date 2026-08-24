import type { ColumnDiagnostic, ImportDiagnostics } from "@/lib/import-intelligence";
import type { ChartAggregationOp, Column, Row, Widget, WidgetType } from "@/lib/types";
import {
  boxPlotChartValidity,
  groupedNumericValues,
  histogramChartValidity,
  numericValuesFor,
  pairedNumericValues,
  paretoChartValidity,
  scatterChartValidity,
} from "@/lib/chart-validity";
import { detectOperationalWidgetTypes } from "@/lib/operational-widgets";
import {
  createWidget,
  scheduleItemColumn,
  schedulePeriodColumns,
  scheduleSectionColumn,
} from "@/lib/widgets";

export type DashboardColumnRole =
  "dimension" | "metric" | "temporal-dimension" | "identifier" | "unsupported";

export type DashboardColumnClassification = {
  key: string;
  label: string;
  role: DashboardColumnRole;
  confidence: number;
  reasons: string[];
  warnings: string[];
};

export type DashboardRecommendationKind = "kpi" | "visualization" | "table";

export type DashboardRecommendation = {
  id: string;
  kind: DashboardRecommendationKind;
  title: string;
  confidence: number;
  reasons: string[];
  warnings: string[];
  widgetType: WidgetType;
  metricKey?: string;
  groupKey?: string;
  valueKey?: string;
  /** Segunda coluna numérica — usada só pela dispersão (eixo Y), que cruza duas métricas em vez de agrupar uma. */
  valueKey2?: string;
  op?: ChartAggregationOp;
  topN?: number;
  blockKey?: string;
  blockValue?: string;
  columnKey?: string;
  /** "Gráfico principal" da estrutura de painel: a primeira visualização recomendada, que deve ocupar a largura cheia em vez do span padrão do tipo. */
  primary?: boolean;
};

export type AutoDashboardPlan = {
  classifications: DashboardColumnClassification[];
  recommendations: DashboardRecommendation[];
  confidence: number;
  reasons: string[];
  warnings: string[];
};

export type AutoDashboardInput = {
  columns: Column[];
  rows: Row[];
  diagnostics?: Pick<ImportDiagnostics, "confidence" | "qualityScore" | "columns" | "warnings">;
};

const IDENTIFIER_KIND = new Set<ColumnDiagnostic["kind"]>([
  "id",
  "cpf",
  "cnpj",
  "email",
  "phone",
  "postal-code",
  "url",
]);
const METRIC_KIND = new Set<ColumnDiagnostic["kind"]>([
  "integer",
  "number",
  "currency",
  "percentage",
]);
const TEMPORAL_KIND = new Set<ColumnDiagnostic["kind"]>(["date", "datetime"]);
const IDENTIFIER_NAME =
  /(^|[\s_-])(id|codigo|c[oó]digo|cod|n[º°o]\.?|n[uú]mero|cpf|cnpj|pedido|matr[ií]cula|sku|uuid|protocolo)([\s_.-]|\d|$)/i;
const METRIC_NAME =
  /(valor|faturamento|receita|venda|quantidade|qtd|pre[cç]o|custo|lucro|margem|total|saldo|ticket|meta|value|revenue|sales?|quantity|qty|amount|price|cost|profit|margin|balance|target|goal)/i;
const TEMPORAL_NAME =
  /(^|[\s_-])(data|date|m[eê]s|month|ano|year|semana|week|trimestre|quarter)([\s_-]|$)/i;
// Mesmo vocabulário de LOCATION_KEY_HINT (widgets.ts), usado ali pro widget
// de mapa preferir uma coluna geográfica de verdade — aqui decide se uma
// dimensão vira "mapa" ou "barras" na recomendação automática. Os dois
// deveriam reconhecer as mesmas colunas como geográficas.
const GEO_NAME =
  /(cidade|munic[ií]pio|estado|\buf\b|regi[aã]o|pa[ií]s|local(idade)?|endere[cç]o|bairro|\bcep\b|territ[oó]rio|city|state|country|region|location|address)/i;

/**
 * Quantidade de líderes mostrados num widget de ranking. Mantido igual ao
 * padrão de `w.topN ?? 5` em ranking-widget-body.tsx: abaixo dessa
 * cardinalidade o ranking mostraria as mesmas categorias que a barra, na
 * mesma ordem, então a recomendação automática nem chega a propor ranking.
 */
const RANKING_TOP_N = 5;
const MAX_AUTOMATIC_VISUALIZATIONS = 10;

const VISUALIZATION_PRIORITY: Partial<Record<WidgetType, number>> = {
  area: 100,
  line: 100,
  bar: 95,
  map: 95,
  histogram: 92,
  scatter: 92,
  "box-plot": 90,
  radar: 89,
  pareto: 88,
  "matrix-heatmap": 86,
  ranking: 80,
  pie: 70,
};

function supportsPareto(groups: ReadonlyMap<string, number[]>): boolean {
  return groups.size > RANKING_TOP_N && paretoChartValidity(groups).valid;
}

function limitAutomaticVisualizations(
  recommendations: DashboardRecommendation[],
): DashboardRecommendation[] {
  const visualizations = recommendations
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "visualization");
  if (visualizations.length <= MAX_AUTOMATIC_VISUALIZATIONS) return recommendations;

  const ordered = [...visualizations].sort((a, b) => {
    // `primary` é opcional — a maioria das recomendações não define. `Number(undefined)`
    // é NaN, que quebraria o contrato do comparador; Boolean(...) normaliza pra 0/1 antes.
    const primaryDelta = Number(Boolean(b.item.primary)) - Number(Boolean(a.item.primary));
    if (primaryDelta !== 0) return primaryDelta;
    const priorityDelta =
      (VISUALIZATION_PRIORITY[b.item.widgetType] ?? 50) -
      (VISUALIZATION_PRIORITY[a.item.widgetType] ?? 50);
    if (priorityDelta !== 0) return priorityDelta;
    const confidenceDelta = b.item.confidence - a.item.confidence;
    return confidenceDelta !== 0 ? confidenceDelta : a.index - b.index;
  });
  const selected: typeof ordered = [];
  const selectedIds = new Set<string>();
  const selectedTypes = new Set<WidgetType>();

  // Primeiro preserva perguntas visuais diferentes. Sem essa passagem, duas
  // barras de alta confiança podiam expulsar radar, matriz ou ranking mesmo
  // quando esses formatos respondiam perguntas distintas sobre a planilha.
  for (const candidate of ordered) {
    if (selectedTypes.has(candidate.item.widgetType)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.item.id);
    selectedTypes.add(candidate.item.widgetType);
    if (selected.length === MAX_AUTOMATIC_VISUALIZATIONS) break;
  }
  for (const candidate of ordered) {
    if (selected.length === MAX_AUTOMATIC_VISUALIZATIONS) break;
    if (selectedIds.has(candidate.item.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.item.id);
  }
  const keep = new Set(selected.map(({ item }) => item.id));

  return recommendations.filter((item) => item.kind !== "visualization" || keep.has(item.id));
}

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function slug(...parts: Array<string | undefined>): string {
  return parts
    .filter(Boolean)
    .join("-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function diagnosticFor(input: AutoDashboardInput, key: string): ColumnDiagnostic | undefined {
  return input.diagnostics?.columns.find((column) => column.key === key);
}

function distinctCount(rows: Row[], key: string): number {
  return new Set(
    rows
      .map((row) => row[key])
      .filter((value) => value !== null && value !== undefined && value !== "")
      .map(String),
  ).size;
}

export function classifyDashboardColumn(
  column: Column,
  diagnostic?: ColumnDiagnostic,
): DashboardColumnClassification {
  const name = `${column.key} ${column.label}`;
  const detectedKind = diagnostic?.kind;
  const reasons: string[] = [];
  const warnings = [...(diagnostic?.warnings ?? [])];
  let role: DashboardColumnRole;
  let confidence = (diagnostic?.confidence ?? 0.75) * 100;

  if (diagnostic && diagnostic.filled === 0) {
    // Uma coluna sem nenhum valor preenchido não vira métrica nem dimensão,
    // mesmo que o tipo detectado pareça numérico/categórico — "Total geral:
    // 0" numa tabela dinâmica ou um gráfico agrupado por uma coluna
    // inteiramente vazia é sempre ruído, nunca um achado real. `filled`/
    // `missing` já vêm calculados no diagnóstico de importação; não precisa
    // de nova leitura de dados aqui.
    role = "unsupported";
    reasons.push("A coluna não tem nenhum valor preenchido nas linhas importadas.");
    confidence = Math.min(confidence, 20);
  } else if (
    diagnostic?.sensitive ||
    (detectedKind && IDENTIFIER_KIND.has(detectedKind)) ||
    IDENTIFIER_NAME.test(name)
  ) {
    role = "identifier";
    reasons.push(
      "A coluna tem formato ou nome de identificador e não deve ser agregada como métrica.",
    );
    confidence += diagnostic?.sensitive ? 12 : 5;
  } else if (
    detectedKind
      ? TEMPORAL_KIND.has(detectedKind)
      : column.kind === "date" || TEMPORAL_NAME.test(name)
  ) {
    role = "temporal-dimension";
    reasons.push("A coluna representa tempo e pode ordenar séries cronológicas.");
    confidence += 8;
  } else if (
    detectedKind
      ? METRIC_KIND.has(detectedKind)
      : ["number", "currency", "percentage"].includes(column.kind)
  ) {
    if (IDENTIFIER_NAME.test(name) && !METRIC_NAME.test(name)) {
      role = "identifier";
      reasons.push("Apesar de numérica, a coluna aparenta ser um código sequencial.");
    } else {
      role = "metric";
      reasons.push("A coluna é numérica e adequada para agregações.");
      if (METRIC_NAME.test(name)) {
        reasons.push("O nome da coluna indica uma medida empresarial.");
        confidence += 7;
      }
    }
  } else if (
    ["category", "text"].includes(column.kind) ||
    detectedKind === "category" ||
    detectedKind === "text"
  ) {
    role = "dimension";
    reasons.push("A coluna pode segmentar e agrupar os registros.");
  } else {
    role = "unsupported";
    reasons.push("O tipo da coluna não produz uma visualização determinística segura.");
    confidence = Math.min(confidence, 50);
  }

  if (diagnostic && diagnostic.qualityScore < 70) {
    warnings.push(`Qualidade da coluna abaixo do ideal (${diagnostic.qualityScore}%).`);
    confidence -= (70 - diagnostic.qualityScore) * 0.35;
  }

  return {
    key: column.key,
    label: column.label,
    role,
    confidence: clampScore(confidence),
    reasons,
    warnings: [...new Set(warnings)],
  };
}

function recommendation(
  input: AutoDashboardInput,
  config: Omit<DashboardRecommendation, "confidence" | "reasons" | "warnings"> & {
    columns: string[];
    reasons: string[];
    warnings?: string[];
    baseConfidence: number;
  },
): DashboardRecommendation {
  const diagnostics = config.columns
    .map((key) => diagnosticFor(input, key))
    .filter((item): item is ColumnDiagnostic => Boolean(item));
  const avgQuality = diagnostics.length
    ? diagnostics.reduce((sum, item) => sum + item.qualityScore, 0) / diagnostics.length
    : (input.diagnostics?.qualityScore ?? 80);
  const avgConfidence = diagnostics.length
    ? diagnostics.reduce((sum, item) => sum + item.confidence * 100, 0) / diagnostics.length
    : (input.diagnostics?.confidence ?? 80);
  const missingWarnings = diagnostics
    .filter((item) => item.missing > 0)
    .map((item) => `${item.label}: ${item.missing} valor(es) ausente(s).`);
  const confidence = clampScore(
    config.baseConfidence * 0.45 +
      avgQuality * 0.3 +
      avgConfidence * 0.25 -
      missingWarnings.length * 3,
  );
  const { columns: _columns, baseConfidence: _baseConfidence, ...result } = config;
  return {
    ...result,
    confidence,
    reasons: config.reasons,
    warnings: [...new Set([...(config.warnings ?? []), ...missingWarnings])],
  };
}

export function generateAutoDashboardPlan(input: AutoDashboardInput): AutoDashboardPlan {
  const classifications = input.columns.map((column) =>
    classifyDashboardColumn(column, diagnosticFor(input, column.key)),
  );
  const byRole = (role: DashboardColumnRole) =>
    classifications.filter((item) => item.role === role);
  // Mesmo raciocínio pras duas linhas abaixo: metricas e dimensões entram
  // nos gráficos automáticos (barra/ranking/pizza/KPI) na ordem de melhor
  // confiança/qualidade primeiro, não na ordem em que a coluna aparece na
  // planilha — com várias candidatas, só as primeiras viram widget (
  // `metrics.slice(0, 3)`/`dimensions.slice(0, 2)`, mais abaixo); sem essa
  // ordenação, uma coluna de ótima qualidade em 3º lugar nunca aparecia,
  // enquanto duas colunas ruins mas bem no início sempre ganhavam. Sort é
  // estável, então colunas com confiança igual mantêm a ordem original da
  // planilha entre si. Também mantém `primaryMetric` (= metrics[0]) igual
  // ao que analytical-narrative.ts usa pra decidir cobertura de pergunta —
  // ordens diferentes faziam um widget recém-criado nunca bater com a
  // pergunta que o gerou.
  const metrics = [...byRole("metric")].sort((a, b) => b.confidence - a.confidence);
  const dimensions = [...byRole("dimension")].sort((a, b) => b.confidence - a.confidence);
  const temporal = byRole("temporal-dimension");
  const identifiers = byRole("identifier");
  const recommendations: DashboardRecommendation[] = [];

  const normalizedKeys = new Set(
    input.columns.map((column) =>
      column.key
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    ),
  );
  const specializedStructure = [
    {
      type: "matriz de validação por horário",
      keys: ["hora", "referencia", "aceita", "rejeita"],
    },
    {
      type: "série de ensaios laboratoriais",
      keys: ["amostra", "ensaio", "identificacao", "resultado"],
    },
    {
      type: "controle dimensional com especificações",
      keys: ["categoria", "estatistica", "hora", "amostra", "data"],
    },
  ].find((candidate) => candidate.keys.every((key) => normalizedKeys.has(key)));
  const attendanceRoster =
    normalizedKeys.has("nome") &&
    (normalizedKeys.has("matricula") || normalizedKeys.has("n°") || normalizedKeys.has("nº"));
  const operationalWidgets = detectOperationalWidgetTypes(input.columns);
  if (specializedStructure || attendanceRoster || operationalWidgets.length) {
    const structure = specializedStructure?.type ?? "lista de presença";
    const operationalRecommendations: DashboardRecommendation[] = operationalWidgets
      .filter((type) => type !== "validation-overview")
      .map((type) => {
        const metadata: Record<
          Extract<
            WidgetType,
            "attendance-overview" | "validation-overview" | "control-chart" | "plan-vs-actual"
          >,
          { title: string; reason: string }
        > = {
          "attendance-overview": {
            title: "Presença e assinaturas",
            reason:
              "Resume participantes, assinaturas ausentes, setores e turnos sem somar matrículas.",
          },
          "validation-overview": {
            title: "Validação de inspetores",
            reason: "Separa aprovações, rejeições e pendências por inspetor.",
          },
          "control-chart": {
            title: "Carta de controle",
            reason:
              "Exibe a estabilidade das medições e sinaliza pontos fora dos limites estatísticos.",
          },
          "plan-vs-actual": {
            title: "Planejado × realizado",
            reason: "Compara automaticamente colunas hierárquicas do mesmo período.",
          },
        };
        const item = metadata[type as keyof typeof metadata];
        return {
          id: slug(type),
          kind: "visualization",
          title: item.title,
          widgetType: type,
          confidence: 100,
          reasons: [item.reason],
          warnings: [],
        };
      });
    return {
      classifications,
      recommendations: [
        ...operationalRecommendations,
        {
          id: "table-detail",
          kind: "table",
          title: "Detalhamento dos dados",
          widgetType: "table",
          confidence: 100,
          reasons: [`A tabela preserva a estrutura reconhecida como ${structure}.`],
          warnings: [],
        },
      ],
      confidence: 100,
      reasons: [
        operationalWidgets.includes("plan-vs-actual")
          ? "A aba possui pares de colunas Programado e Realizado para os mesmos períodos."
          : `A aba foi reconhecida como ${structure}.`,
        "O painel evita somas e médias automáticas entre limites, resultados, assinaturas ou unidades incompatíveis.",
      ],
      warnings: [...new Set(input.diagnostics?.warnings ?? [])],
    };
  }

  // Cronogramas largos possuem vários resultados numéricos mensais, mas
  // somá-los como KPIs ou gráficos comuns mistura ensaios e limites com
  // unidades diferentes. Para esse formato, o painel nasce especializado:
  // cronograma fiel, volume por bloco e tabela detalhada.
  const schedulePeriods = schedulePeriodColumns(input.columns);
  if (schedulePeriods.length >= 3) {
    const periodKeys = schedulePeriods.map((column) => column.key);
    const scheduleGroup = scheduleItemColumn(input.columns, periodKeys, input.rows);
    const scheduleSection = scheduleSectionColumn(input.columns, periodKeys, scheduleGroup?.key);
    if (scheduleGroup) {
      const blockValues = scheduleSection
        ? [
            ...new Set(
              input.rows
                .map((row) => row[scheduleSection.key])
                .filter((value) => value !== null && value !== undefined && value !== "")
                .map(String),
            ),
          ]
        : [];
      if (scheduleSection && blockValues.length >= 2) {
        for (const blockValue of blockValues) {
          recommendations.push(
            recommendation(input, {
              id: slug("cronograma", scheduleSection.key, blockValue),
              kind: "visualization",
              title: blockValue,
              widgetType: "schedule-heatmap",
              groupKey: scheduleGroup.key,
              blockKey: scheduleSection.key,
              blockValue,
              columns: [scheduleSection.key, scheduleGroup.key, ...periodKeys],
              baseConfidence: 98,
              reasons: [
                `${schedulePeriods.length} colunas de período foram reconhecidas no cabeçalho.`,
                `O bloco “${blockValue}” permanece isolado dos demais ensaios e limites.`,
              ],
            }),
          );
        }
      } else {
        recommendations.push(
          recommendation(input, {
            id: slug("cronograma", scheduleGroup.key),
            kind: "visualization",
            title: "Cronograma visual",
            widgetType: "schedule-heatmap",
            groupKey: scheduleGroup.key,
            columns: [scheduleGroup.key, ...periodKeys],
            baseConfidence: 97,
            reasons: [
              `${schedulePeriods.length} colunas de período foram reconhecidas no cabeçalho.`,
              "Resultados e limites permanecem separados para não somar análises incompatíveis.",
            ],
          }),
        );
      }
    }
    recommendations.push({
      id: "table-detail",
      kind: "table",
      title: "Detalhamento dos dados",
      widgetType: "table",
      confidence: 100,
      reasons: ["A tabela preserva cada resultado, período, item e limite original."],
      warnings: [],
    });
    const warnings = input.diagnostics?.warnings ?? [];
    const confidence = recommendations.length
      ? clampScore(
          recommendations.reduce((sum, item) => sum + item.confidence, 0) / recommendations.length,
        )
      : 0;
    return {
      classifications,
      recommendations,
      confidence,
      reasons: [
        "A aba foi reconhecida como cronograma e recebeu visualizações próprias para esse formato.",
        "Valores mensais não são somados entre análises com limites ou unidades diferentes.",
      ],
      warnings: [...new Set(warnings)],
    };
  }

  for (const metric of metrics.slice(0, 3)) {
    recommendations.push(
      recommendation(input, {
        id: slug("kpi", metric.key, "total"),
        kind: "kpi",
        title: `${metric.label} total`,
        widgetType: temporal.length ? "metric-trend" : "metric",
        metricKey: metric.key,
        ...(temporal[0] ? { groupKey: temporal[0].key } : {}),
        columns: [metric.key, temporal[0]?.key].filter((key): key is string => Boolean(key)),
        baseConfidence: 92,
        reasons: [
          "A coluna foi classificada como métrica agregável.",
          ...(temporal.length ? ["Há uma dimensão temporal para contextualizar a tendência."] : []),
        ],
      }),
    );
  }

  const primaryMetric = metrics[0];
  const primaryTime = temporal[0];
  if (primaryMetric && primaryTime) {
    recommendations.push(
      recommendation(input, {
        id: slug("series-temporal", primaryTime.key, primaryMetric.key),
        kind: "visualization",
        title: `${primaryMetric.label} por ${primaryTime.label}`,
        widgetType: "area",
        groupKey: primaryTime.key,
        valueKey: primaryMetric.key,
        op: "sum",
        columns: [primaryTime.key, primaryMetric.key],
        baseConfidence: 96,
        reasons: [
          "Uma coluna temporal e uma métrica foram identificadas.",
          "Gráficos de área preservam a ordem e evidenciam evolução no tempo.",
        ],
        // "Como mudou no tempo" é a leitura mais completa que a base permite
        // quando existe — vira o gráfico principal do painel, em largura
        // cheia, em vez de dividir a linha com a primeira comparação por
        // categoria.
        primary: true,
      }),
    );
  }

  // O histograma só entra quando a própria métrica possui amostra numérica
  // e variedade suficientes. Contar linhas da planilha incluía nulos/textos
  // e criava histogramas vazios ou de uma única barra.
  if (primaryMetric) {
    const values = numericValuesFor(input.rows, primaryMetric.key);
    const distinctValues = new Set(values).size;
    if (histogramChartValidity(values).valid) {
      recommendations.push(
        recommendation(input, {
          id: slug("histograma", primaryMetric.key),
          kind: "visualization",
          title: `Distribuição de ${primaryMetric.label}`,
          widgetType: "histogram",
          valueKey: primaryMetric.key,
          columns: [primaryMetric.key],
          baseConfidence: 80,
          reasons: [
            `"${primaryMetric.label}" tem ${values.length} valores numéricos válidos e ${distinctValues} valores distintos, volume suficiente para revelar a distribuição.`,
          ],
        }),
      );
    }
  }

  // A dispersão precisa de pares válidos na mesma linha e variação nos dois
  // eixos; duas colunas numéricas, sozinhas, não garantem correlação legível.
  if (metrics.length >= 2) {
    const [first, second] = [...metrics].sort((a, b) => b.confidence - a.confidence);
    if (first && second) {
      const pairs = pairedNumericValues(input.rows, first.key, second.key);
      if (scatterChartValidity(pairs).valid) {
        recommendations.push(
          recommendation(input, {
            id: slug("dispersao", first.key, second.key),
            kind: "visualization",
            title: `${first.label} × ${second.label}`,
            widgetType: "scatter",
            valueKey: first.key,
            valueKey2: second.key,
            columns: [first.key, second.key],
            baseConfidence: 76,
            reasons: [
              `"${first.label}" e "${second.label}" têm ${pairs.length} pares numéricos válidos e variação nos dois eixos para investigar correlação.`,
            ],
          }),
        );
      }
    }
  }

  if (primaryMetric) {
    dimensions.slice(0, 2).forEach((dimension, index) => {
      const cardinality = distinctCount(input.rows, dimension.key);
      const isGeo = GEO_NAME.test(`${dimension.key} ${dimension.label}`);
      // Pareto e box plot (mais abaixo, ambos só para index === 0) podem
      // avaliar a mesma dimensão quando a cardinalidade cai na faixa comum
      // a ambos (6-8 categorias) — agrupa uma vez só em vez de duas
      // passagens idênticas por input.rows. A faixa do box plot (2-8)
      // sempre cabe dentro do teto do Pareto (40), então o mesmo `<= 40`
      // cobre os dois sem calcular pra cardinalidades que nenhum dos dois
      // usaria.
      const groupedForDimension =
        index === 0 && cardinality <= 40
          ? groupedNumericValues(input.rows, dimension.key, primaryMetric.key)
          : null;
      recommendations.push(
        recommendation(input, {
          id: slug(isGeo ? "mapa" : "barras", dimension.key, primaryMetric.key),
          kind: "visualization",
          title: `${primaryMetric.label} por ${dimension.label}`,
          widgetType: isGeo ? "map" : "bar",
          groupKey: dimension.key,
          valueKey: primaryMetric.key,
          op: "sum",
          columns: [dimension.key, primaryMetric.key],
          baseConfidence: isGeo ? 88 : 91,
          reasons: [
            isGeo
              ? "O nome da dimensão indica uma localização geográfica."
              : "Uma dimensão categórica e uma métrica permitem comparação entre grupos.",
          ],
          warnings:
            cardinality > 30
              ? [`A dimensão possui alta cardinalidade (${cardinality} valores).`]
              : [],
          // Sem coluna temporal, esta é a primeira comparação por categoria
          // — o gráfico principal da estrutura de painel — e só ela, não a
          // segunda dimensão do loop.
          ...(!primaryTime && index === 0 ? { primary: true } : {}),
        }),
      );

      // A barra já mostra todas as categorias ordenadas pelo valor (ver
      // sortAllBarCategories em chart-widget-body). O ranking só responde a
      // uma pergunta diferente ("quem lidera, e quanto o topo concentra do
      // restante") quando existe um "restante" de fato — ou seja, quando a
      // cardinalidade passa do topN. Abaixo disso, ranking e barra mostram os
      // mesmos grupos na mesma ordem, e recomendar os dois é redundante.
      if (cardinality > RANKING_TOP_N) {
        recommendations.push(
          recommendation(input, {
            id: slug("ranking", dimension.key, primaryMetric.key),
            kind: "visualization",
            title: `Ranking de ${dimension.label} por ${primaryMetric.label}`,
            widgetType: "ranking",
            groupKey: dimension.key,
            valueKey: primaryMetric.key,
            op: "sum",
            topN: RANKING_TOP_N,
            columns: [dimension.key, primaryMetric.key],
            baseConfidence: 89,
            reasons: [
              `Destaca os líderes e mostra quanto eles concentram frente às demais ${cardinality} categorias.`,
            ],
          }),
        );

        // Pareto responde uma pergunta diferente do ranking: não "quem
        // lidera" e sim "quantas causas concentram a maior parte do
        // resultado". Só para a primeira dimensão (a que já ganhou
        // ranking/barra), e com um teto de cardinalidade — acima disso o
        // gráfico vira ruído mesmo com a rolagem horizontal.
        if (
          index === 0 &&
          cardinality <= 40 &&
          groupedForDimension &&
          supportsPareto(groupedForDimension)
        ) {
          recommendations.push(
            recommendation(input, {
              id: slug("pareto", dimension.key, primaryMetric.key),
              kind: "visualization",
              title: `Pareto de ${primaryMetric.label} por ${dimension.label}`,
              widgetType: "pareto",
              groupKey: dimension.key,
              valueKey: primaryMetric.key,
              op: "sum",
              columns: [dimension.key, primaryMetric.key],
              baseConfidence: 78,
              reasons: [
                `Mostra quantas das ${cardinality} categorias de "${dimension.label}" concentram 80% de "${primaryMetric.label}". Essa leitura destaca contribuições dominantes e difere do ranking, que mostra quem lidera.`,
              ],
            }),
          );
        }
      }

      // Box plot compara a variabilidade de uma métrica entre poucas
      // categorias (mesma faixa de cardinalidade da pizza), mas só faz
      // sentido quando cada categoria tem repetições suficientes para
      // calcular quartis de verdade — com 1 ou 2 linhas por categoria, o
      // "box" seria só um traço sem informação além do que a barra já mostra.
      if (index === 0 && cardinality >= 2 && cardinality <= 8 && !isGeo && groupedForDimension) {
        const groups = groupedForDimension;
        if (groups.size === cardinality && boxPlotChartValidity(groups).valid) {
          const smallestGroup = Math.min(...[...groups.values()].map((values) => values.length));
          recommendations.push(
            recommendation(input, {
              id: slug("variabilidade", dimension.key, primaryMetric.key),
              kind: "visualization",
              title: `Variabilidade de ${primaryMetric.label} por ${dimension.label}`,
              widgetType: "box-plot",
              groupKey: dimension.key,
              valueKey: primaryMetric.key,
              columns: [dimension.key, primaryMetric.key],
              baseConfidence: 80,
              reasons: [
                `Todas as ${cardinality} categorias de "${dimension.label}" têm ao menos ${smallestGroup} valores numéricos e variação para comparar quartis e pontos fora da curva.`,
              ],
            }),
          );
        }
      }

      if (cardinality >= 2 && cardinality <= 8 && !isGeo) {
        recommendations.push(
          recommendation(input, {
            id: slug("distribuicao", dimension.key, primaryMetric.key),
            kind: "visualization",
            title: `Distribuição de ${primaryMetric.label} por ${dimension.label}`,
            widgetType: "pie",
            groupKey: dimension.key,
            valueKey: primaryMetric.key,
            op: "sum",
            columns: [dimension.key, primaryMetric.key],
            baseConfidence: 82,
            reasons: [
              `A dimensão possui poucas categorias (${cardinality}), mantendo a distribuição legível.`,
            ],
          }),
        );
      }

      if (index === 0 && cardinality >= 3 && cardinality <= 8 && !isGeo) {
        recommendations.push(
          recommendation(input, {
            id: slug("radar", dimension.key, primaryMetric.key),
            kind: "visualization",
            title: `Perfil de ${primaryMetric.label} por ${dimension.label}`,
            widgetType: "radar",
            groupKey: dimension.key,
            valueKey: primaryMetric.key,
            op: "sum",
            topN: cardinality,
            columns: [dimension.key, primaryMetric.key],
            baseConfidence: 84,
            reasons: [
              `As ${cardinality} categorias permitem comparar o perfil relativo de "${primaryMetric.label}" sem sobrecarregar os eixos do radar.`,
            ],
          }),
        );
      }
    });
  }

  // Bases operacionais frequentemente possuem apenas códigos, datas e
  // categorias (sem uma medida financeira/quantitativa segura). Nesse caso,
  // contar registros é uma análise válida e evita tanto um painel vazio quanto
  // a soma enganosa de protocolos como "Nº 1".
  const countKey = identifiers[0]?.key ?? input.columns[0]?.key;
  if (!primaryMetric && countKey) {
    if (primaryTime) {
      recommendations.push(
        recommendation(input, {
          id: slug("contagem-temporal", primaryTime.key, countKey),
          kind: "visualization",
          title: `Registros por ${primaryTime.label}`,
          widgetType: "area",
          groupKey: primaryTime.key,
          valueKey: countKey,
          op: "count",
          columns: [primaryTime.key, countKey],
          baseConfidence: 91,
          reasons: ["Sem métrica numérica segura, a série mostra a contagem de registros."],
        }),
      );
    }
    for (const dimension of dimensions.slice(0, 2)) {
      const cardinality = distinctCount(input.rows, dimension.key);
      recommendations.push(
        recommendation(input, {
          id: slug("contagem", dimension.key, countKey),
          kind: "visualization",
          title: `Registros por ${dimension.label}`,
          widgetType: "bar",
          groupKey: dimension.key,
          valueKey: countKey,
          op: "count",
          columns: [dimension.key, countKey],
          baseConfidence: 90,
          reasons: ["A contagem compara quantos registros pertencem a cada categoria."],
          warnings:
            cardinality > 50
              ? [`A dimensão possui alta cardinalidade (${cardinality} valores).`]
              : [],
        }),
      );
      recommendations.push(
        recommendation(input, {
          id: slug("ranking-contagem", dimension.key, countKey),
          kind: "visualization",
          title: `Ranking de ${dimension.label} por registros`,
          widgetType: "ranking",
          groupKey: dimension.key,
          valueKey: countKey,
          op: "count",
          topN: 5,
          columns: [dimension.key, countKey],
          baseConfidence: 88,
          reasons: ["O ranking destaca as categorias com mais registros."],
        }),
      );
      if (cardinality >= 2 && cardinality <= 8) {
        recommendations.push(
          recommendation(input, {
            id: slug("distribuicao-contagem", dimension.key, countKey),
            kind: "visualization",
            title: `Distribuição de registros por ${dimension.label}`,
            widgetType: "pie",
            groupKey: dimension.key,
            valueKey: countKey,
            op: "count",
            columns: [dimension.key, countKey],
            baseConfidence: 84,
            reasons: ["Poucas categorias permitem comparar a distribuição por contagem."],
          }),
        );
      }
      if (dimension === dimensions[0] && cardinality >= 3 && cardinality <= 8) {
        recommendations.push(
          recommendation(input, {
            id: slug("radar-contagem", dimension.key, countKey),
            kind: "visualization",
            title: `Perfil de registros por ${dimension.label}`,
            widgetType: "radar",
            groupKey: dimension.key,
            valueKey: countKey,
            op: "count",
            topN: cardinality,
            columns: [dimension.key, countKey],
            baseConfidence: 82,
            reasons: [
              `As ${cardinality} categorias permitem comparar visualmente o perfil das contagens.`,
            ],
          }),
        );
      }
    }
  }

  if (dimensions.length >= 2) {
    const rowDimension = dimensions[0]!;
    const columnDimension = dimensions[1]!;
    const value = primaryMetric?.key ?? identifiers[0]?.key ?? input.columns[0]?.key;
    const op: ChartAggregationOp = primaryMetric ? "sum" : "count";
    if (value) {
      recommendations.push(
        recommendation(input, {
          id: slug("tabela-dinamica", rowDimension.key, columnDimension.key),
          kind: "table",
          title: `${rowDimension.label} × ${columnDimension.label}`,
          widgetType: "pivot-table",
          groupKey: rowDimension.key,
          columnKey: columnDimension.key,
          valueKey: value,
          op,
          columns: [rowDimension.key, columnDimension.key, value],
          baseConfidence: 90,
          reasons: ["Duas dimensões permitem cruzar os dados sem perder os totais."],
        }),
        recommendation(input, {
          id: slug("matriz", rowDimension.key, columnDimension.key),
          kind: "visualization",
          title: `Matriz de ${rowDimension.label} × ${columnDimension.label}`,
          widgetType: "matrix-heatmap",
          groupKey: rowDimension.key,
          columnKey: columnDimension.key,
          valueKey: value,
          op,
          columns: [rowDimension.key, columnDimension.key, value],
          baseConfidence: 87,
          reasons: ["A intensidade visual revela concentrações no cruzamento das dimensões."],
        }),
      );
    }
  }

  recommendations.push({
    id: "table-detail",
    kind: "table",
    title: "Detalhamento dos dados",
    widgetType: "table",
    confidence: 100,
    reasons: ["A tabela preserva o acesso aos registros que sustentam as recomendações."],
    warnings: [],
  });

  const planWarnings: string[] = [];
  if (!metrics.length)
    planWarnings.push(
      "Nenhuma métrica numérica segura foi identificada; as visualizações usam contagem de registros.",
    );
  if (input.diagnostics && input.diagnostics.confidence < 70) {
    planWarnings.push(
      `A importação possui confiança baixa (${input.diagnostics.confidence}%). Revise a estrutura antes de publicar o dashboard.`,
    );
  }
  const limitedRecommendations = limitAutomaticVisualizations(recommendations);
  const omittedVisualizationCount =
    recommendations.filter((item) => item.kind === "visualization").length -
    limitedRecommendations.filter((item) => item.kind === "visualization").length;
  if (omittedVisualizationCount > 0) {
    planWarnings.push(
      `${omittedVisualizationCount} visualização(ões) complementar(es) não foi(ram) adicionada(s) automaticamente para manter o painel legível; elas continuam disponíveis no botão "Widget".`,
    );
  }
  const confidence = limitedRecommendations.length
    ? clampScore(
        limitedRecommendations.reduce((sum, item) => sum + item.confidence, 0) /
          limitedRecommendations.length,
      )
    : 0;

  return {
    classifications,
    recommendations: limitedRecommendations,
    confidence,
    reasons: [
      `${metrics.length} métrica(s), ${dimensions.length} dimensão(ões) e ${temporal.length} dimensão(ões) temporal(is) identificada(s).`,
      "As recomendações foram produzidas por regras determinísticas e podem ser explicadas individualmente.",
    ],
    warnings: [...new Set([...planWarnings, ...(input.diagnostics?.warnings ?? [])])],
  };
}

export function recommendationToWidget(
  item: DashboardRecommendation,
  columns: Column[],
  rows: Row[] = [],
): Widget {
  const seed = {
    ...(item.groupKey ? { groupKey: item.groupKey } : {}),
    ...((item.valueKey ?? item.metricKey) ? { valueKey: item.valueKey ?? item.metricKey } : {}),
    ...(item.valueKey2 ? { valueKey2: item.valueKey2 } : {}),
    ...(item.op ? { op: item.op } : {}),
  };
  const widget = createWidget(item.widgetType, columns, seed, rows);
  widget.title = item.title;
  // "Gráfico principal" da estrutura de painel: largura cheia em vez do
  // span padrão do tipo, para se destacar de fato do resto do painel.
  if (item.primary) widget.span = 3;
  if (item.metricKey) widget.metricKey = item.metricKey;
  if (item.topN) widget.topN = item.topN;
  if (item.blockKey && item.blockValue) {
    widget.blockKey = item.blockKey;
    widget.blockValue = item.blockValue;
    widget.sectionKey = "";
  }
  if (item.columnKey) widget.columnKey = item.columnKey;
  return widget;
}

export function buildRecommendedWidgets(
  plan: AutoDashboardPlan,
  columns: Column[],
  rows: Row[] = [],
): Widget[] {
  const widgets = plan.recommendations.map((item) => recommendationToWidget(item, columns, rows));
  let rowStart = 0;
  let occupied = 0;
  const fillRow = (end: number) => {
    let missing = 3 - occupied;
    for (let index = end - 1; index >= rowStart && missing > 0; index -= 1) {
      const widget = widgets[index];
      if (!widget) continue;
      const growth = Math.min(missing, 3 - widget.span);
      widget.span = (widget.span + growth) as Widget["span"];
      missing -= growth;
    }
  };

  // A grade desktop possui três colunas. Quando a sequência automática não
  // fecha exatamente uma linha, amplia o último cartão disponível antes de
  // começar a próxima. Assim nenhuma linha automática termina com um espaço
  // vazio, sem alterar os dados nem a ordem analítica dos widgets.
  widgets.forEach((widget, index) => {
    if (widget.span === 3) {
      if (occupied > 0) fillRow(index);
      rowStart = index + 1;
      occupied = 0;
      return;
    }
    if (occupied + widget.span > 3) {
      fillRow(index);
      rowStart = index;
      occupied = widget.span;
      return;
    }
    occupied += widget.span;
    if (occupied === 3) {
      rowStart = index + 1;
      occupied = 0;
    }
  });
  if (occupied > 0) fillRow(widgets.length);
  return widgets;
}
