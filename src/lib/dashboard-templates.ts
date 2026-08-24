import type { WidgetType } from "@/lib/types";

export type DashboardTemplateId = "vendas" | "financeiro" | "qualidade" | "estudos";

export type DashboardTemplate = {
  id: DashboardTemplateId;
  label: string;
  /** O que o modelo põe na frente, escrito para quem vai escolher. */
  description: string;
  /** Vocabulário que sugere esta finalidade nos nomes das colunas. */
  vocabulary: RegExp;
  /** Tipos de widget que este modelo prioriza, do mais para o menos. */
  priority: WidgetType[];
};

/**
 * Modelos de painel por finalidade.
 *
 * O painel automático é bom em reconhecer o que cada coluna é, e cego para o
 * que a planilha serve. Uma base de vendas e uma base de controle de qualidade
 * podem ter a mesma forma — uma data, uma categoria e um número — e pedirem
 * leituras opostas: a de vendas quer ranking e participação no total, a de
 * qualidade quer dispersão, valores fora da curva e comparação com o limite.
 *
 * O modelo não inventa widget nem muda cálculo: ele reordena o que a análise
 * automática já recomendou, colocando na frente o que aquela finalidade lê
 * primeiro. Por isso um modelo aplicado a uma planilha que não combina com ele
 * degrada para o painel automático de sempre, em vez de produzir bobagem.
 */
export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: "vendas",
    label: "Vendas",
    description: "Evolução do faturamento, quem vende mais e participação de cada item no total.",
    vocabulary:
      /(venda|faturamento|receita|pedido|cliente|produto|vendedor|comiss[aã]o|ticket|desconto|revenue|sales?|customer)/i,
    priority: ["area", "line", "ranking", "bar", "pie", "pareto", "metric-trend"],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    description: "Previsto contra realizado, custo por categoria e onde o dinheiro se concentra.",
    vocabulary:
      /(custo|despesa|or[cç]amento|saldo|lucro|margem|previsto|realizado|pagamento|conta|fluxo|caixa|budget|expense|cost)/i,
    priority: ["area", "bar", "pareto", "matrix-heatmap", "metric-trend", "pivot-table"],
  },
  {
    id: "qualidade",
    label: "Qualidade",
    description: "Dispersão dos resultados, valores fora da curva e comparação com o limite.",
    vocabulary:
      /(qualidade|resultado|limite|especifica[cç][aã]o|conformidade|n[aã]o conformidade|lote|amostra|ensaio|an[aá]lise|laudo|defeito|inspe[cç][aã]o|toler[aâ]ncia)/i,
    priority: ["control-chart", "histogram", "box-plot", "exception-panel", "area", "bar"],
  },
  {
    id: "estudos",
    label: "Estudos",
    description: "Distribuição das medidas, relação entre variáveis e comparação entre grupos.",
    vocabulary:
      /(estudo|pesquisa|experimento|medi[cç][aã]o|vari[aá]vel|grupo|controle|tratamento|participante|question[aá]rio|escala|nota)/i,
    priority: ["histogram", "scatter", "box-plot", "bar", "radar", "matrix-heatmap"],
  },
];

export type TemplateMatch = {
  template: DashboardTemplate;
  /** Quantas colunas casaram com o vocabulário da finalidade. */
  matches: number;
};

/**
 * Sugere a finalidade a partir dos nomes das colunas.
 *
 * Devolve `null` quando nenhuma finalidade se destaca: propor um modelo por
 * empate ou por uma única coincidência seria pior que não propor nada, porque
 * o usuário confiaria numa escolha que foi sorteio.
 */
export function detectTemplate(columnLabels: string[]): TemplateMatch | null {
  const scored = DASHBOARD_TEMPLATES.map((template) => ({
    template,
    matches: columnLabels.filter((label) => template.vocabulary.test(label)).length,
  })).sort((a, b) => b.matches - a.matches);

  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.matches < 2) return null;
  if (runnerUp && runnerUp.matches === best.matches) return null;
  return best;
}

/**
 * Reordena as visualizações pela prioridade da finalidade escolhida.
 *
 * Só as visualizações trocam de lugar. Os indicadores do topo e a tabela
 * detalhada ficam onde estão, porque a posição deles não é uma questão de
 * finalidade e sim da estrutura do painel: número primeiro, tabela por
 * último. A primeira versão desta função ordenava a lista inteira e mandou os
 * indicadores para o fim do painel — a finalidade tinha o direito de escolher
 * qual gráfico vem antes, não o de desmontar a página.
 *
 * O que não está na lista do modelo não é descartado: vai para o fim das
 * visualizações, na ordem em que a análise automática já o tinha colocado.
 * Descartar seria esconder uma leitura válida só porque o modelo não a cita.
 */
export function applyTemplateOrder<T extends { widgetType: WidgetType; kind?: string }>(
  recommendations: T[],
  templateId: DashboardTemplateId,
): T[] {
  const template = DASHBOARD_TEMPLATES.find((item) => item.id === templateId);
  if (!template) return recommendations;
  const rank = (type: WidgetType) => {
    const index = template.priority.indexOf(type);
    return index === -1 ? template.priority.length : index;
  };
  const slots = recommendations
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.kind ?? "visualization") === "visualization");
  // Sort estável: dentro da mesma prioridade, a ordem da análise automática
  // (que já ordenou por confiança) é preservada.
  const ordered = slots
    .map(({ item }) => item)
    .sort((a, b) => rank(a.widgetType) - rank(b.widgetType));
  const result = [...recommendations];
  slots.forEach(({ index }, position) => {
    result[index] = ordered[position]!;
  });
  return result;
}
