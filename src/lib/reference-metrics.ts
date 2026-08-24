/**
 * Colunas numéricas que são referência, e não resultado.
 *
 * "Meta", "alvo", "objetivo", "limite" e "target" são números que dizem onde o
 * resultado deveria chegar. Elas parecem métricas — são numéricas, agregáveis,
 * e o vocabulário de métrica as reconhece —, mas colocá-las no lugar do
 * resultado produz leituras vazias: um gráfico de "Meta ao longo do tempo"
 * costuma ser uma linha reta, porque a meta é constante, e comparar a meta com
 * ela mesma não responde nada.
 *
 * O lugar delas é o outro lado da comparação: a linha de referência contra a
 * qual o resultado é lido.
 */
const REFERENCE_METRIC_NAME =
  /\bmeta(s)?\b|\balvo\b|\bobjetivo\b|\blimite\b|\btarget\b|\bgoal\b|\bbenchmark\b/i;

export function isReferenceMetric(...names: (string | undefined | null)[]): boolean {
  // Sublinhado vira espaço antes do teste: em "meta_mensal" ele conta como
  // letra para a fronteira de palavra do regex, e a chave da coluna quase
  // sempre usa sublinhado onde o rótulo usa espaço.
  return names.some((name) =>
    name ? REFERENCE_METRIC_NAME.test(name.replaceAll("_", " ")) : false,
  );
}
