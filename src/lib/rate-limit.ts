/**
 * Limite de requisições, com armazenamento compartilhado quando existe.
 *
 * O limitador anterior era um `Map` no processo. Ele funciona enquanto há um
 * processo só, e a Vercel não garante isso: cada instância da função tem a
 * própria memória, e um reinício zera a contagem. Na prática o limite valia
 * por instância e por ciclo de vida, o que é bem mais frouxo do que o número
 * configurado sugere.
 *
 * O Redis do Upstash resolve porque é alcançável por HTTP, sem conexão
 * persistente — o que é a única forma que serve para uma função que pode
 * morrer entre duas requisições.
 *
 * A memória continua aqui, e não como código morto: é o caminho usado quando
 * o Redis não está configurado (desenvolvimento, e produção antes de o
 * usuário criar a conta) e o caminho de queda quando ele está configurado mas
 * não responde.
 */

const buckets = new Map<string, number[]>();
const MAX_RATE_LIMIT_BUCKETS = 10_000;

/**
 * Janela deslizante em memória. Mantida com a assinatura original porque ela
 * é o comportamento de referência: o caminho do Redis foi escrito para
 * responder o mesmo, e os testes comparam os dois.
 */
export function checkRateLimit(key: string, now = Date.now(), limit = 12, windowMs = 60_000) {
  if (!buckets.has(key) && buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
    for (const [bucketKey, timestamps] of buckets) {
      if (!timestamps.some((timestamp) => now - timestamp < windowMs)) buckets.delete(bucketKey);
      if (buckets.size < MAX_RATE_LIMIT_BUCKETS) break;
    }
    if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) buckets.delete(buckets.keys().next().value!);
  }
  const recent = (buckets.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

export function resetRateLimitsForTests() {
  buckets.clear();
}

export type UpstashConfig = { url: string; token: string };

type RateLimitEnvironment = {
  UPSTASH_REDIS_REST_URL?: string | undefined;
  UPSTASH_REDIS_REST_TOKEN?: string | undefined;
};

/**
 * Lê a configuração do Upstash do ambiente.
 *
 * Os nomes são os que a própria integração do Upstash com a Vercel cria, e
 * não nomes próprios: assim a configuração é ligar a integração, sem
 * ninguém copiar valor de um lugar para outro e errar.
 *
 * Sem as duas variáveis não há configuração pela metade — meia configuração
 * viraria uma chamada que falha em toda requisição e cai para a memória, o
 * que é o mesmo resultado com mais latência.
 */
export function upstashConfigFrom(environment: RateLimitEnvironment = {}): UpstashConfig | null {
  const url = environment.UPSTASH_REDIS_REST_URL ?? process.env["UPSTASH_REDIS_REST_URL"];
  const token = environment.UPSTASH_REDIS_REST_TOKEN ?? process.env["UPSTASH_REDIS_REST_TOKEN"];
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

/** De onde saiu a decisão. Serve para observar a queda para a memória. */
export type RateLimitStore = "memory" | "redis";

export type RateLimitDecision = { allowed: boolean; store: RateLimitStore };

export type RateLimitRule = {
  key: string;
  limit: number;
  windowMs: number;
};

/** Tempo máximo esperando o Redis antes de decidir pela memória. */
const UPSTASH_TIMEOUT_MS = 1_500;

type PipelineEntry = { result?: unknown; error?: unknown };

async function upstashPipeline(
  config: UpstashConfig,
  commands: (string | number)[][],
  fetchImpl: typeof fetch,
): Promise<PipelineEntry[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstash respondeu ${response.status}`);
    const body = (await response.json()) as PipelineEntry[];
    if (!Array.isArray(body)) throw new Error("upstash respondeu fora do formato de pipeline");
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Consome uma unidade do limite e diz se a requisição pode seguir.
 *
 * No Redis a janela deslizante é um conjunto ordenado por instante: apaga o
 * que saiu da janela, acrescenta este instante, conta o que sobrou e renova a
 * expiração. Os quatro comandos vão num pipeline só, então não há brecha
 * entre contar e gravar — que é justamente onde um limitador ingênuo deixa
 * passar uma rajada.
 *
 * Requisição recusada não conta. O limitador em memória nunca registrou a
 * tentativa recusada, e manter isso importa: contar a recusa faria uma
 * rajada empurrar o próprio limite para frente, punindo por mais tempo do que
 * a janela configurada.
 *
 * Qualquer falha do Redis cai para a memória em vez de recusar. Recusar
 * deixaria o assistente fora do ar por uma instabilidade de terceiro; cair
 * para a memória devolve exatamente a proteção que existia antes desta
 * mudança, que é frouxa mas não é nenhuma.
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  config: UpstashConfig | null,
  now = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<RateLimitDecision> {
  if (!config) {
    return { allowed: checkRateLimit(rule.key, now, rule.limit, rule.windowMs), store: "memory" };
  }
  const redisKey = `oli:rate:${rule.key}`;
  // O membro precisa ser único: dois pedidos no mesmo milissegundo com o
  // mesmo membro seriam um só dentro do conjunto, e o segundo passaria de
  // graça.
  const member = `${now}-${crypto.randomUUID()}`;
  try {
    const entries = await upstashPipeline(
      config,
      [
        ["ZREMRANGEBYSCORE", redisKey, 0, now - rule.windowMs],
        ["ZADD", redisKey, now, member],
        ["ZCARD", redisKey],
        ["PEXPIRE", redisKey, rule.windowMs],
      ],
      fetchImpl,
    );
    const failed = entries.find((entry) => entry.error !== undefined);
    if (failed) throw new Error(String(failed.error));
    const count = Number(entries[2]?.result);
    if (!Number.isFinite(count)) throw new Error("upstash não devolveu a contagem da janela");
    if (count <= rule.limit) return { allowed: true, store: "redis" };
    await upstashPipeline(config, [["ZREM", redisKey, member]], fetchImpl).catch(() => {
      // A entrada sai sozinha quando a janela passar; perder esta limpeza
      // aperta o limite por um instante, nunca o afrouxa.
    });
    return { allowed: false, store: "redis" };
  } catch (error) {
    console.error("Limitador distribuído indisponível; usando a memória do processo", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { allowed: checkRateLimit(rule.key, now, rule.limit, rule.windowMs), store: "memory" };
  }
}
