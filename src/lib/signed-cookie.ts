/**
 * Cookie assinado com HMAC, sem estado no servidor.
 *
 * Nasceu do `chat-session.ts`, que já fazia exatamente isto para a sessão do
 * assistente. A prova de verificação humana (`human-check.ts`) precisa da
 * mesma coisa com outro nome e outro prazo, e copiar código de assinatura é a
 * pior forma de duplicação: o dia em que a verificação mudar num dos dois, o
 * outro fica para trás em silêncio, e o silêncio aqui significa cookie
 * aceito indevidamente.
 *
 * O que o cookie carrega: um prazo, um valor aleatório e uma marca do
 * navegador. A marca existe para que um cookie copiado para outro cliente
 * não valha — não é identificação de pessoa, é o resumo do `user-agent`
 * cortado, que não distingue duas pessoas com o mesmo navegador.
 */

const encoder = new TextEncoder();

export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

export const decodeBase64url = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies
    .split(";")
    .map((item) => item.trim().split("="))
    .find(([cookieName]) => cookieName === name)?.[1];
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return {
    key,
    signature: new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))),
  };
}

const userAgentFingerprint = async (request: Request) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode((request.headers.get("user-agent") ?? "unknown").slice(0, 300)),
  );
  return base64url(new Uint8Array(digest)).slice(0, 16);
};

export async function createSignedToken(
  request: Request,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
) {
  const payload = base64url(
    encoder.encode(
      JSON.stringify({
        exp: Math.floor(now / 1000) + ttlSeconds,
        nonce: crypto.randomUUID(),
        ua: await userAgentFingerprint(request),
      }),
    ),
  );
  const { signature } = await hmac(secret, payload);
  return `${payload}.${base64url(signature)}`;
}

export async function verifySignedCookie(
  request: Request,
  cookieName: string,
  secret: string,
  now = Date.now(),
) {
  const token = readCookie(request, cookieName);
  if (!token) return false;
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra) return false;
  try {
    const { key } = await hmac(secret, payload);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64url(encodedSignature),
      encoder.encode(payload),
    );
    if (!valid) return false;
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64url(payload))) as {
      exp?: unknown;
      ua?: unknown;
    };
    return (
      typeof claims.exp === "number" &&
      claims.exp >= Math.floor(now / 1000) &&
      claims.ua === (await userAgentFingerprint(request))
    );
  } catch {
    return false;
  }
}

/** Monta o `set-cookie` com as mesmas defesas nos dois usos. */
export async function signedCookieHeader(
  request: Request,
  cookieName: string,
  secret: string,
  ttlSeconds: number,
) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const token = await createSignedToken(request, secret, ttlSeconds);
  return `${cookieName}=${token}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; SameSite=Strict${secure}`;
}

export function withAppendedCookie(response: Response, cookie: string) {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
