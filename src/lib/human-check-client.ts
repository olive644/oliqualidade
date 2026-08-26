import { HUMAN_CHECK_REQUIRED } from "@/lib/human-check";
import { TURNSTILE_TOKEN_HEADER } from "@/lib/turnstile";
import { requestTurnstileToken, turnstileSiteKey } from "@/lib/turnstile-client";

/**
 * POST que sabe reagir a um pedido de verificação humana.
 *
 * O caminho normal é uma requisição só. O servidor responde 403 com o código
 * de verificação quando não reconhece a prova; só aí o widget da Cloudflare é
 * carregado, o desafio acontece e a mesma requisição é repetida uma vez, com
 * o token no cabeçalho.
 *
 * Uma repetição, nunca duas. Se a segunda também voltar pedindo verificação,
 * há algo errado do lado do servidor ou da chave, e insistir viraria um laço
 * de desafios com a pessoa presa no meio.
 */
export async function postResponseWithHumanCheck(url: string, body: unknown, signal?: AbortSignal) {
  const send = (token?: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { [TURNSTILE_TOKEN_HEADER]: token } : {}),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

  let response = await send();
  const raw = response.status === 403 ? await response.clone().text() : "";
  if (response.status === 403 && needsHumanCheck(raw) && turnstileSiteKey()) {
    const token = await requestTurnstileToken();
    response = await send(token);
  }
  return response;
}

export async function postWithHumanCheck(url: string, body: unknown, signal?: AbortSignal) {
  const response = await postResponseWithHumanCheck(url, body, signal);
  return { response, raw: await response.text() };
}

function needsHumanCheck(raw: string) {
  try {
    return (JSON.parse(raw) as { code?: string }).code === HUMAN_CHECK_REQUIRED;
  } catch {
    return false;
  }
}
