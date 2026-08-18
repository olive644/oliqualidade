import "./lib/error-capture";

import { consumeLastCapturedError, runWithErrorCapture } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleGeminiChat, handleSmartImportAnalysis } from "./lib/gemini-server";
import { withSecurityHeaders } from "./lib/http-security";
import { withChatSession } from "./lib/chat-session";
import { generateNonce, runWithNonce } from "./lib/csp-nonce";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  fetch(request: Request, env: unknown, ctx: unknown) {
    const environment = (env ?? {}) as Record<string, string>;
    const sessionSecret = environment["OLI_SESSION_SECRET"] ?? process.env["OLI_SESSION_SECRET"];
    const chatAuthToken = environment["OLI_CHAT_AUTH_TOKEN"] ?? process.env["OLI_CHAT_AUTH_TOKEN"];
    const geminiApiKey = environment["GEMINI_API_KEY"] ?? process.env["GEMINI_API_KEY"];
    const nonce = generateNonce();
    return runWithNonce(nonce, () =>
      runWithErrorCapture(
        [sessionSecret, chatAuthToken, geminiApiKey],
        async (): Promise<Response> => {
          try {
            if (new URL(request.url).pathname === "/api/gemini/chat") {
              return withSecurityHeaders(await handleGeminiChat(request, environment), nonce);
            }
            if (new URL(request.url).pathname === "/api/gemini/import-analysis") {
              return withSecurityHeaders(
                await handleSmartImportAnalysis(request, environment),
                nonce,
              );
            }
            const handler = await getServerEntry();
            const response = await handler.fetch(request, env, ctx);
            return withSecurityHeaders(
              await withChatSession(
                await normalizeCatastrophicSsrResponse(response),
                request,
                sessionSecret,
              ),
              nonce,
            );
          } catch (error) {
            console.error(error);
            return withSecurityHeaders(
              new Response(renderErrorPage(), {
                status: 500,
                headers: { "content-type": "text/html; charset=utf-8" },
              }),
              nonce,
            );
          }
        },
      ),
    );
  },
};
