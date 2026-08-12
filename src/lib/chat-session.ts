const COOKIE_NAME = "oli_chat_session";
const SESSION_TTL_SECONDS = 2 * 60 * 60;

const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const decodeBase64url = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const cookieValue = (request: Request) => {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies
    .split(";")
    .map((item) => item.trim().split("="))
    .find(([name]) => name === COOKIE_NAME)?.[1];
};

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

export async function createChatSession(request: Request, secret: string, now = Date.now()) {
  const payload = base64url(
    encoder.encode(
      JSON.stringify({
        exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
        nonce: crypto.randomUUID(),
        ua: await userAgentFingerprint(request),
      }),
    ),
  );
  const { signature } = await hmac(secret, payload);
  return `${payload}.${base64url(signature)}`;
}

export async function verifyChatSession(request: Request, secret: string, now = Date.now()) {
  const token = cookieValue(request);
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

export async function withChatSession(
  response: Response,
  request: Request,
  secret: string | undefined,
) {
  if (!secret || (await verifyChatSession(request, secret))) return response;
  const headers = new Headers(response.headers);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  headers.append(
    "set-cookie",
    `${COOKIE_NAME}=${await createChatSession(request, secret)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const chatSessionCookieName = COOKIE_NAME;
