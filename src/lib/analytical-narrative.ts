/**
 * "O painel não deve mostrar um monte de gráfico solto — deve guiar a
 * leitura da planilha, como um analista": este módulo é a parte que decide
 * quais perguntas analíticas a planilha permite responder, quais já têm uma
 * visualização, e resume em frases determinísticas (nunca geradas por IA)
 * o que os dados já calculados dizem — concentração, tendência,
 * inconsistências. Nenhuma frase aqui afirma algo que não dá pra provar com
 * os números; quando falta contexto para uma afirmação mais forte (ex.: "o
 * resultado melhorou"), o texto diz o que falta em vez de arriscar.
 */
import type { AutoDashboardPlan, DashboardColumnClassification } from "@/lib/auto-dashboard";
import { groupAndAggregate, pieComparisonFor, trendSummaryFor } from "@/lib/data-pipeline";
import { fmt, sortChronologically } from "@/lib/format";
import type { Column, Row, Widget, WidgetType } from "@/lib/types";

export type AnalyticalQuestionId =
  | "current-value"
  | "trend-over-time"
  | "who-is-bigger"
  | "share-of-total"
  | "distribution"
  | "anomalies"
  | "correlation"
  | "root-causes";

export type AnalyticalQuestion = {
  id: AnalyticalQuestionId;
  label: string;
  answerable: boolean;
  /** Por que a pergunta não dá pra responder com segurança — só presente quando `answerable` é falso. */
  reason?: string;
  /** Tipos de widget que respondem a essa pergunta, usados só para checar se o painel já tem um. */
  widgetTypes: WidgetType[];
};

/** Nomes de coluna que sugerem uma meta/alvo cadastrado, para a ressalva de "sem meta para comparar". */
const GOAL_NAME = /\bmeta(s)?\b|\balvo\b|\bobjetivo\b|\btarget\b|\bgoal\b/i;

function analyticalQuestions(
  classifications: DashboardColumnClassification[],
): AnalyticalQuestion[] {
  const metricCount = classifications.filter((c) => c.role === "metric").length;
  const hasMetric = metricCount > 0;
  const hasDimension = classifications.some((c) => c.role === "dimension");
  const hasTemporal = classifications.some((c) => c.role === "temporal-dimension");
  const noMetricReason = "nenhuma coluna foi classificada como métrica";
  const noDimensionPairReason = "faltam colunas de categoria e métrica juntas";

  return [
    {
      id: "current-value",
      label: "Qual é o resultado atual?",
      answerable: hasMetric,
      widgetTypes: ["metric", "metric-trend"],
      ...(hasMetric ? {} : { reason: noMetricReason }),
    },
    {
      id: "trend-over-time",
      label: "Como mudou no tempo?",
      answerable: hasMetric && hasTemporal,
      widgetTypes: ["line", "area", "metric-trend"],
      ...(hasMetric && hasTemporal
        ? {}
        : {
            reason: !hasTemporal
              ? "a planilha não tem uma coluna de data confiável"
              : noMetricReason,
          }),
    },
    {
      id: "who-is-bigger",
      label: "Quem é maior ou menor?",
      answerable: hasMetric && hasDimension,
      widgetTypes: ["bar", "ranking"],
      ...(hasMetric && hasDimension ? {} : { reason: noDimensionPairReason }),
    },
    {
      id: "share-of-total",
      label: "Qual é a participação no total?",
      answerable: hasMetric && hasDimension,
      widgetTypes: ["pie"],
      ...(hasMetric && hasDimension ? {} : { reason: noDimensionPairReason }),
    },
    {
      id: "distribution",
      label: "Como os valores estão distribuídos?",
      answerable: hasMetric,
      widgetTypes: ["histogram", "box-plot"],
      ...(hasMetric ? {} : { reason: noMetricReason }),
    },
    {
      id: "anomalies",
      label: "Existem valores fora da curva?",
      answerable: hasMetric && hasDimension,
      widgetTypes: ["box-plot", "control-chart", "exception-panel"],
      ...(hasMetric && hasDimension ? {} : { reason: noDimensionPairReason }),
    },
    {
      id: "correlation",
      label: "Duas variáveis têm relação?",
      answerable: metricCount >= 2,
      widgetTypes: ["scatter"],
      ...(metricCount >= 2 ? {} : { reason: "só há uma coluna classificada como métrica" }),
    },
    {
      id: "root-causes",
      label: "O que mais contribui para o total?",
      answerable: hasMetric && hasDimension,
      widgetTypes: ["pareto"],
      ...(hasMetric && hasDimension ? {} : { reason: noDimensionPairReason }),
    },
  ];
}

export type QuestionCoverage = {
  questions: AnalyticalQuestion[];
  answerable: AnalyticalQuestion[];
  covered: AnalyticalQuestion[];
  uncovered: AnalyticalQuestion[];
  /** Frase pronta pra exibir, do tipo do exemplo: "5 perguntas identificadas, 4 com gráfico. [motivo das que faltam]". */
  summary: string;
};

/**
 * Cruza as perguntas que a estrutura da planilha permite responder com os
 * widgets que já existem no painel (checagem por tipo — presença de um
 * `WidgetType` compatível, não uma correspondência exata de colunas), para
 * dizer quantas perguntas identificadas já viraram gráfico e quais ainda
 * não, com o motivo de cada lacuna.
 */
export function analyzeQuestionCoverage(
  classifications: DashboardColumnClassification[],
  widgets: Widget[],
): QuestionCoverage {
  const questions = analyticalQuestions(classifications);
  const answerable = questions.filter((q) => q.answerable);
  const presentTypes = new Set(widgets.map((w) => w.type));
  const covered = answerable.filter((q) => q.widgetTypes.some((type) => presentTypes.has(type)));
  const uncovered = answerable.filter((q) => !covered.includes(q));
  const unanswerable = questions.filter((q) => !q.answerable);

  const sentences = [
    `Foram identificadas ${answerable.length} ${
      answerable.length === 1 ? "pergunta analítica possível" : "perguntas analíticas possíveis"
    } para esta planilha.`,
    answerable.length > 0
      ? `${covered.length} ${covered.length === 1 ? "já recebeu" : "já receberam"} uma visualização.`
      : "",
    ...uncovered.map(
      (q) => `"${q.label}" ainda não tem gráfico. Você pode adicioná-lo pelo botão "Widget".`,
    ),
    ...unanswerable.map((q) => `Não foi possível responder "${q.label}" porque ${q.reason}.`),
  ].filter(Boolean);

  return { questions, answerable, covered, uncovered, summary: sentences.join(" ") };
}

/**
 * Três a cinco frases determinísticas resumindo o que os dados já calculados
 * dizem — concentração da maior categoria, tendência no tempo,
 * inconsistências pendentes. Cada frase só aparece quando há dado real para
 * sustentá-la (sem dimensão nenhuma, não há frase de concentração; sem
 * coluna temporal, não há frase de tendência); o resultado pode ter menos de
 * três frases numa planilha pobre em contexto, o que é mais honesto que
 * completar com afirmações vazias.
 */
export function buildExecutiveSummary(input: {
  rows: Row[];
  columns: Column[];
  classifications: DashboardColumnClassification[];
  exceptionCount: number;
}): string[] {
  const { rows, columns, classifications, exceptionCount } = input;
  const metrics = classifications.filter((c) => c.role === "metric");
  const dimensions = [...classifications.filter((c) => c.role === "dimension")].sort(
    (a, b) => b.confidence - a.confidence,
  );
  const temporal = classifications.filter((c) => c.role === "temporal-dimension");
  const primaryMetric = metrics[0];
  const primaryDimension = dimensions[0];
  const primaryTemporal = temporal[0];
  const metricKind = columns.find((c) => c.key === primaryMetric?.key)?.kind ?? "number";
  const hasGoalColumn = columns.some((c) => GOAL_NAME.test(`${c.label} ${c.key}`));

  const sentences: string[] = [];

  if (primaryMetric && primaryDimension) {
    const grouped = [
      ...groupAndAggregate(rows, primaryDimension.key, primaryMetric.key, "sum"),
    ].sort((a, b) => b.total - a.total);
    const comparison = grouped.length ? pieComparisonFor(grouped, 0) : null;
    if (comparison && comparison.share !== null) {
      const shareLabel = comparison.share.toLocaleString("pt-BR", {
        style: "percent",
        maximumFractionDigits: 1,
      });
      const referenceClause =
        comparison.reference && comparison.relativeDifference !== null
          ? `, ${Math.abs(comparison.relativeDifference).toLocaleString("pt-BR", {
              style: "percent",
              maximumFractionDigits: 1,
            })} ${comparison.relativeDifference >= 0 ? "acima" : "abaixo"} de "${comparison.reference.name}"`
          : "";
      sentences.push(
        `"${comparison.selected.name}" concentra ${shareLabel} de "${primaryMetric.label}"${referenceClause}, entre ${grouped.length} categorias de "${primaryDimension.label}".`,
      );
      if (!hasGoalColumn) {
        sentences.push(
          `Não existe meta cadastrada para "${primaryMetric.label}", então não é possível afirmar se esse resultado é bom ou ruim.`,
        );
      }
    }
  }

  if (primaryMetric && primaryTemporal) {
    const grouped = sortChronologically(
      groupAndAggregate(rows, primaryTemporal.key, primaryMetric.key, "sum"),
    );
    const trend = trendSummaryFor(grouped);
    if (trend) {
      const changeLabel =
        trend.relativeChange !== null
          ? `${trend.change >= 0 ? "+" : ""}${trend.relativeChange.toLocaleString("pt-BR", {
              style: "percent",
              maximumFractionDigits: 1,
            })}`
          : null;
      sentences.push(
        `"${primaryMetric.label}" foi de ${fmt(trend.first.total, metricKind)} em ${trend.first.name} para ${fmt(trend.last.total, metricKind)} em ${trend.last.name}${
          changeLabel ? ` (${changeLabel})` : ""
        }, ao longo de ${trend.pointCount} períodos.`,
      );
    }
  }

  if (exceptionCount > 0) {
    sentences.push(
      `${exceptionCount} ${
        exceptionCount === 1 ? "inconsistência foi encontrada" : "inconsistências foram encontradas"
      } na planilha e aguarda${exceptionCount === 1 ? "" : "m"} revisão.`,
    );
  }

  return sentences;
}

/** Atalho para montar o resumo a partir de um `AutoDashboardPlan` já calculado, evitando repetir a classificação de colunas. */
export function buildExecutiveSummaryFromPlan(
  plan: Pick<AutoDashboardPlan, "classifications">,
  rows: Row[],
  columns: Column[],
  exceptionCount: number,
): string[] {
  return buildExecutiveSummary({
    rows,
    columns,
    classifications: plan.classifications,
    exceptionCount,
  });
}
