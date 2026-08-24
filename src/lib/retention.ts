/**
 * Política de retenção dos dados que o aplicativo guarda no navegador.
 *
 * Antes, cada cache decidia sozinho quanto tempo viver, e dois deles decidiam
 * "para sempre": o cache de geocodificação crescia a cada nome de cidade já
 * consultado, e nada apagava coordenadas de um painel excluído meses atrás. O
 * histórico de importações tinha teto de quantidade, mas nenhuma noção de
 * idade.
 *
 * Reunir as regras aqui é o que permite responder de um lugar só quanto tempo
 * cada coisa fica — e é o que a central de privacidade precisa para não
 * prometer uma coisa enquanto o código faz outra.
 */
export type RetentionRule = {
  /** Quantos dias uma entrada sobrevive sem ser usada. */
  maxAgeDays: number;
  /** Teto de entradas, aplicado depois da idade. */
  maxEntries: number;
};

export const RETENTION: Record<"geocode" | "importMetrics" | "dashboardHistory", RetentionRule> = {
  // Coordenada de cidade não muda; o prazo existe para o cache não guardar
  // para sempre lugares de uma planilha que o usuário nem tem mais.
  geocode: { maxAgeDays: 180, maxEntries: 2000 },
  // Serve para diagnóstico de desempenho recente. Medição de meio ano atrás
  // não ajuda a entender a importação de hoje.
  importMetrics: { maxAgeDays: 90, maxEntries: 200 },
  // O teto por painel já existia; a idade entra para painéis pouco tocados.
  dashboardHistory: { maxAgeDays: 365, maxEntries: 30 },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Piso de sanidade para uma data: 1º de janeiro de 2000.
 *
 * Registro com data ausente, zerada ou de 1970 é dado corrompido, não dado
 * antigo. Tratá-lo como "sem data conhecida" o mantém sob o teto de
 * quantidade, em vez de apagá-lo em silêncio por um defeito de gravação.
 */
const MIN_PLAUSIBLE_TIMESTAMP = Date.UTC(2000, 0, 1);

/**
 * Aplica idade e teto a uma lista datada, do mais recente para o mais antigo.
 *
 * A ordem importa: cortar por idade antes do teto evita o caso em que uma
 * rajada de entradas novas empurra para fora entradas antigas que ainda
 * estariam no prazo, e o inverso descartaria como "velho" o que o teto já
 * teria removido de qualquer forma.
 */
export function applyRetention<T>(
  entries: T[],
  rule: RetentionRule,
  timestampOf: (entry: T) => number,
  now = Date.now(),
): T[] {
  const limite = now - rule.maxAgeDays * DAY_MS;
  const noPrazo = entries.filter((entry) => {
    const at = timestampOf(entry);
    // Entrada sem data confiável fica: descartar por falta de informação
    // apagaria dado que pode ser recente, e o teto ainda a alcança.
    if (!Number.isFinite(at) || at < MIN_PLAUSIBLE_TIMESTAMP) return true;
    return at >= limite;
  });
  if (noPrazo.length <= rule.maxEntries) return noPrazo;
  // Seleciona as mais recentes, mas devolve na ordem em que chegaram: quem
  // consome as métricas de importação espera ordem cronológica, e reordenar
  // aqui seria um efeito colateral que ninguém pediu à retenção.
  const maisRecentes = new Set(
    [...noPrazo].sort((a, b) => timestampOf(b) - timestampOf(a)).slice(0, rule.maxEntries),
  );
  return noPrazo.filter((entry) => maisRecentes.has(entry));
}

export function retentionSummary(rule: RetentionRule): string {
  return `Até ${rule.maxEntries.toLocaleString("pt-BR")} registros, por no máximo ${rule.maxAgeDays} dias.`;
}
