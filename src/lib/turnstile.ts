/**
 * Verificação Cloudflare Turnstile.
 *
 * O que ela protege é custo. Chave do assistente, cota do Gemini e limite de
 * requisições são gastos por chamada, e o limitador por endereço só encarece
 * o abuso — não o impede, porque endereço é barato de trocar. O Turnstile
 * ataca o outro lado: encarece provar que existe um navegador com uma pessoa
 * atrás dele.
 *
 * Fica desligado enquanto `TURNSTILE_SECRET_KEY` não existir. Isso não é
 * conveniência de desenvolvimento: é o que permite entregar o código antes de
 * a conta na Cloudflare existir, sem que o assistente pare no intervalo.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5_000;

export type TurnstileEnvironment = {
  TURNSTILE_SECRET_KEY?: string | undefined;
};

export function turnstileSecretFrom(environment: TurnstileEnvironment = {}): string | null {
  return environment.TURNSTILE_SECRET_KEY ?? process.env["TURNSTILE_SECRET_KEY"] ?? null;
}

/** Cabeçalho onde o cliente manda o token resolvido pelo widget. */
export const TURNSTILE_TOKEN_HEADER = "x-turnstile-token";

type SiteverifyResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

/**
 * Pergunta à Cloudflare se o token é válido.
 *
 * O token vale uma vez só e por poucos minutos, o que é proposital do lado
 * deles: impede que alguém resolva um desafio e reutilize a prova para
 * sempre. É também o motivo de existir o cookie de prova em `human-check.ts`
 * — sem ele, cada mensagem do assistente exigiria um desafio novo.
 *
 * Falha de rede recusa. Aqui a escolha é o contrário da do limitador, e de
 * propósito: o limitador em queda ainda oferece alguma proteção, enquanto um
 * Turnstile que aceita quando não consegue perguntar não é verificação
 * nenhuma, é uma porta destrancada com aparência de fechada.
 */
export async function verifyTurnstileToken(
  token: string | null,
  secret: string,
  remoteIp?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!token) return { ok: false, reason: "sem-token" };
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: `siteverify-${response.status}` };
    const result = (await response.json()) as SiteverifyResponse;
    if (result.success === true) return { ok: true };
    return { ok: false, reason: result["error-codes"]?.join(",") || "recusado" };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error && error.name === "AbortError" ? "tempo-esgotado" : "rede",
    };
  } finally {
    clearTimeout(timeout);
  }
}
