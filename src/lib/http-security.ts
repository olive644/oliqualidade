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
      // O Turnstile é servido pela Cloudflare e desenha o desafio dentro de
      // um iframe do domínio deles, então precisa das três permissões:
      // carregar o script, abrir o quadro e conversar de volta. Nenhum outro
      // domínio entra por isso — a lista continua sendo uma lista, não um
      // curinga.
      nonce
        ? `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`
        : "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "frame-src 'self' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org",
      "connect-src 'self' https://docs.google.com https://nominatim.openstreetmap.org https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
    // Faltava. O domínio atual (*.vercel.app) já está na lista de pré-carga
    // do HSTS, então hoje o navegador impõe HTTPS mesmo sem este cabeçalho —
    // mas essa proteção pertence ao domínio da Vercel, não a este app, e
    // desaparece no dia em que houver domínio próprio. Enviar o cabeçalho
    // agora é o que faz a migração de domínio não abrir uma janela em que a
    // primeira visita aceita HTTP.
    //
    // Sem "preload": entrar na lista de pré-carga é praticamente
    // irreversível e vale para todos os subdomínios, incluindo os que ainda
    // não existem. É um compromisso a se tomar com domínio próprio já
    // definido, não de passagem.
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    // Impede que um cliente antigo (leitores de PDF, plugins herdados) leia
    // dados deste domínio a partir de outro. Não custa nada e fecha uma
    // classe inteira de leitura entre origens que a CSP não descreve.
    "x-permitted-cross-domain-policies": "none",
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
