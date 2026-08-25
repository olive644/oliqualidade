import { signedCookieHeader, verifySignedCookie, withAppendedCookie } from "@/lib/signed-cookie";
import {
  TURNSTILE_TOKEN_HEADER,
  turnstileSecretFrom,
  verifyTurnstileToken,
  type TurnstileEnvironment,
} from "@/lib/turnstile";

/**
 * Prova de que um desafio do Turnstile foi resolvido, com prazo.
 *
 * Um token do Turnstile vale uma vez só e por poucos minutos. Sem esta prova,
 * cada mensagem ao assistente exigiria um desafio novo, e uma conversa de
 * cinco perguntas viraria cinco verificações — o que faria as pessoas
 * evitarem o assistente muito antes de fazer um abusador desistir.
 *
 * O prazo acompanha o da sessão do chat (duas horas), para que a pessoa não
 * seja interrompida duas vezes por motivos diferentes em momentos
 * diferentes.
 */
const COOKIE_NAME = "oli_human";
const PROOF_TTL_SECONDS = 2 * 60 * 60;

/** Código devolvido ao cliente quando falta a verificação. */
export const HUMAN_CHECK_REQUIRED = "verificacao-humana-necessaria";

export type HumanCheckOutcome =
  /** Turnstile desligado, ou prova válida já apresentada. */
  | { status: "ok"; cookie: null }
  /** Verificação aceita agora; o chamador deve devolver o cookie. */
  | { status: "ok"; cookie: string }
  /** Sem prova e sem token válido: o cliente precisa resolver o desafio. */
  | { status: "challenge"; reason: string };

export function turnstileEnabled(environment: TurnstileEnvironment = {}) {
  return turnstileSecretFrom(environment) !== null;
}

/**
 * Decide se a requisição passa pela verificação humana.
 *
 * Sem `TURNSTILE_SECRET_KEY` a função devolve `ok` sem consultar nada: é o
 * comportamento anterior a esta mudança, e é o que roda até a conta na
 * Cloudflare existir.
 *
 * `proofSecret` é o mesmo `OLI_SESSION_SECRET` que assina a sessão do chat.
 * Quando ele não existe — só acontece fora de produção, porque em produção o
 * servidor já recusa sem ele — a prova não pode ser assinada, e então cada
 * requisição exige um token novo. É mais rígido, não menos, então não é
 * brecha.
 */
export async function checkHuman(
  request: Request,
  environment: TurnstileEnvironment = {},
  proofSecret?: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<HumanCheckOutcome> {
  const secret = turnstileSecretFrom(environment);
  if (!secret) return { status: "ok", cookie: null };
  if (proofSecret && (await verifySignedCookie(request, COOKIE_NAME, proofSecret)))
    return { status: "ok", cookie: null };

  const token = request.headers.get(TURNSTILE_TOKEN_HEADER);
  const remoteIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const result = await verifyTurnstileToken(token, secret, remoteIp, fetchImpl);
  if (!result.ok) return { status: "challenge", reason: result.reason };
  if (!proofSecret) return { status: "ok", cookie: null };
  return {
    status: "ok",
    cookie: await signedCookieHeader(request, COOKIE_NAME, proofSecret, PROOF_TTL_SECONDS),
  };
}

/** Anexa a prova recém-emitida, quando houver uma. */
export function withHumanProof(response: Response, cookie: string | null) {
  return cookie ? withAppendedCookie(response, cookie) : response;
}

export const humanProofCookieName = COOKIE_NAME;
