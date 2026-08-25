import {
  createSignedToken,
  signedCookieHeader,
  verifySignedCookie,
  withAppendedCookie,
} from "@/lib/signed-cookie";

const COOKIE_NAME = "oli_chat_session";
const SESSION_TTL_SECONDS = 2 * 60 * 60;

// A mecânica de assinatura mora em lib/signed-cookie.ts desde que a prova de
// verificação humana passou a precisar dela também. O comportamento aqui é o
// mesmo de antes: mesmo nome de cookie, mesmo prazo, mesmas defesas.

export async function createChatSession(request: Request, secret: string, now = Date.now()) {
  return createSignedToken(request, secret, SESSION_TTL_SECONDS, now);
}

export async function verifyChatSession(request: Request, secret: string, now = Date.now()) {
  return verifySignedCookie(request, COOKIE_NAME, secret, now);
}

export async function withChatSession(
  response: Response,
  request: Request,
  secret: string | undefined,
) {
  if (!secret || (await verifyChatSession(request, secret))) return response;
  return withAppendedCookie(
    response,
    await signedCookieHeader(request, COOKIE_NAME, secret, SESSION_TTL_SECONDS),
  );
}

export const chatSessionCookieName = COOKIE_NAME;
