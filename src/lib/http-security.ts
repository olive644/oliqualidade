export const MAX_CHAT_BODY_BYTES = 4 * 1024 * 1024;

// TanStack Start injeta o estado inicial de hidratação como <script> inline
// no HTML. router.tsx passa o mesmo nonce (gerado uma vez por requisição em
// server.ts, via AsyncLocalStorage — ver lib/csp-nonce.ts) pro
// `createRouter({ ssr: { nonce } })`, então o script inline sai marcado com
// esse nonce e passa na CSP sem precisar de 'unsafe-inline'. Sem um nonce
// (ex: chamada direta em teste), caímos de volta pra 'unsafe-inline' — pior
// que nonce, mas nunca pior que o comportamento anterior.
export function buildSecurityHeaders(nonce?: string): Record<string, string> {
  return {
    "content-security-policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org",
      "connect-src 'self' https://docs.google.com https://nominatim.openstreetmap.org",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

export function withSecurityHeaders(response: Response, nonce?: string): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(buildSecurityHeaders(nonce))) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function readLimitedJson(
  request: Request,
  limit = MAX_CHAT_BODY_BYTES,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw new Error("PAYLOAD_TOO_LARGE");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function isSameOriginBrowserRequest(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin !== expected) return false;
  return !site || site === "same-origin";
}
