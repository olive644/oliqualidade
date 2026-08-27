/**
 * Limites, prazos e vocabulário de falha do streaming do assistente.
 *
 * Tudo o que o proxy do Gemini e a conversa precisam combinar mora aqui, num
 * lugar só: se um número muda, ele muda para os dois lados ao mesmo tempo.
 * Espalhar essas constantes pelos arquivos já custou caro antes, quando o
 * único prazo existente (20s) protegia apenas até os cabeçalhos e ninguém
 * percebia que a geração em si não tinha teto nenhum.
 */

const KIB = 1024;

/**
 * Teto de um único evento SSE vindo do Gemini.
 *
 * 512 KiB, e não os 256 KiB que pareceriam suficientes olhando só para os
 * deltas: um `step.delta` de texto carrega poucas centenas de bytes, mas o
 * evento terminal `interaction.completed` devolve o objeto da interação, que
 * pode ecoar a entrada. A entrada aqui é o contexto sanitizado do painel, e
 * medindo o pior caso plausível que o produto aceita (250 colunas, o teto de
 * `MAX_AI_COLUMNS`) ele chega a 151 KiB; somando o histórico (12 mensagens de
 * até 4.000 caracteres) e a pergunta, a entrada beira 200 KiB. Com 256 KiB o
 * limite cortaria conversa legítima em painel grande. 512 KiB deixa mais que
 * o dobro de folga sobre a maior entrada possível e continua sendo um teto.
 */
export const GEMINI_MAX_EVENT_BYTES = 512 * KIB;

/**
 * Teto de bytes lidos do Gemini numa geração inteira.
 *
 * Protege contra o stream que nunca termina: sem isto, um provedor que
 * continuasse emitindo eventos manteria a função viva consumindo cota até o
 * limite da plataforma. 8 MiB é ordens de grandeza acima de qualquer resposta
 * de chat real e ainda assim é um número finito.
 */
export const GEMINI_MAX_STREAM_BYTES = 8 * KIB * KIB;

/**
 * Teto do texto de resposta repassado ao navegador.
 *
 * Vale nos dois lados: o servidor para de encaminhar e a conversa para de
 * acumular. 256 KiB de texto são cerca de quarenta mil palavras, muito além
 * de qualquer resposta útil sobre um painel, então quem chega aqui está com
 * defeito, não com uma pergunta difícil.
 */
export const CHAT_MAX_ANSWER_BYTES = 256 * KIB;

/**
 * Teto de um evento SSE no lado do navegador.
 *
 * Menor que o do servidor de propósito: os eventos que o navegador lê são os
 * que este projeto mesmo gera, um `delta` por trecho, e nenhum deles se
 * aproxima disso. O evento grande aqui só apareceria se algo entre o servidor
 * e a aba estivesse remontando o fluxo.
 */
export const CHAT_MAX_EVENT_BYTES = 64 * KIB;

/**
 * Teto de bytes que o navegador aceita ler de uma resposta.
 *
 * Bem acima do teto de texto porque cada delta chega embrulhado no seu próprio
 * evento SSE: alguns milhares de trechos curtos gastam em moldura muito mais
 * do que gastam em conteúdo. O que este número protege é a memória da aba,
 * não o tamanho da resposta, que já tem teto próprio.
 */
export const CHAT_MAX_STREAM_BYTES = 8 * KIB * KIB;

/** Prazo até o Gemini devolver os cabeçalhos da resposta. */
export const GEMINI_START_TIMEOUT_MS = 20_000;

/**
 * Prazo sem nenhum byte novo do Gemini, contado só enquanto uma leitura está
 * pendente. Contar de outra forma puniria o navegador lento: com backpressure,
 * ficar sem ler é decisão de quem consome, não silêncio de quem produz.
 */
export const GEMINI_IDLE_TIMEOUT_MS = 25_000;

/**
 * Duração máxima da geração inteira, do envio ao último byte.
 *
 * 55s é escolhido pelo teto da plataforma, não pelo produto: a função de
 * servidor da Vercel roda sem `maxDuration` declarado, então vale o padrão de
 * 60s do runtime Node. Terminar aos 55s é o que garante que quem fecha a
 * conexão somos nós, com um evento de erro explicável, e não a plataforma com
 * um corte cru no meio do texto.
 */
export const GEMINI_TOTAL_TIMEOUT_MS = 55_000;

/**
 * Por que um stream terminou sem resposta completa.
 *
 * Vai no campo `reason` do evento `error`, ao lado da mensagem já legível.
 * Um cliente antigo ignora o campo e continua mostrando a mensagem; o cliente
 * novo usa o motivo para escolher o estado visual certo, sem nunca precisar
 * interpretar o texto da mensagem.
 */
export type AssistantStreamFailure =
  | "inicio-lento"
  | "inatividade"
  | "duracao-maxima"
  | "limite-excedido"
  | "provedor"
  | "rede"
  | "indisponivel";

/**
 * O texto que a pessoa lê. Nenhum deles cita código, nome de exceção ou
 * detalhe de protocolo: quem abre o assistente quer saber o que aconteceu com
 * a pergunta dela, não em que camada o problema apareceu.
 */
export const ASSISTANT_STREAM_MESSAGES: Record<AssistantStreamFailure, string> = {
  "inicio-lento": "O Gemini demorou demais para começar a responder. Tente novamente.",
  inatividade: "A resposta parou de chegar no meio do caminho. Tente novamente.",
  "duracao-maxima": "A resposta passou do tempo máximo de geração. Tente uma pergunta mais curta.",
  "limite-excedido":
    "A resposta ficou grande demais para ser exibida com segurança. Tente uma pergunta mais específica.",
  provedor: "O Gemini interrompeu a resposta. Tente novamente.",
  rede: "A conexão com o assistente foi interrompida. Tente novamente.",
  indisponivel: "O assistente está indisponível no momento. Tente novamente depois.",
};

/** Texto mostrado quando foi a própria pessoa que parou a resposta. */
export const ASSISTANT_STOPPED_MESSAGE = "Resposta interrompida.";
