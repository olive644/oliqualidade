const base = process.env.OLI_SMOKE_BASE_URL;
if (!base) {
  console.error("Defina OLI_SMOKE_BASE_URL, por exemplo http://127.0.0.1:3000");
  process.exit(2);
}

const response = await fetch(new URL("/", base), { redirect: "manual" });
const required = {
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  // Verificado aqui, e não só no teste de unidade, porque o que importa é o
  // cabeçalho chegar ao navegador depois de passar pela pipeline de SSR —
  // um cabeçalho correto na função e perdido no caminho seria invisível
  // para o teste de unidade.
  "strict-transport-security": "max-age=63072000",
  "x-permitted-cross-domain-policies": "none",
};
for (const [header, expected] of Object.entries(required)) {
  const value = response.headers.get(header) ?? "";
  if (!value.includes(expected)) throw new Error(`${header} ausente ou incorreto: ${value}`);
}
const csp = response.headers.get("content-security-policy") ?? "";
if (!/script-src 'self' 'nonce-[^']+'/.test(csp))
  throw new Error(`script-src sem nonce (deveria vir de router.tsx via lib/csp-nonce): ${csp}`);
if (csp.includes("'unsafe-inline'") && csp.match(/script-src[^;]*'unsafe-inline'/))
  throw new Error(`script-src ainda tem 'unsafe-inline': ${csp}`);
const cookie = response.headers.get("set-cookie") ?? "";
if (process.env.OLI_EXPECT_CHAT_SESSION === "1") {
  for (const expected of ["oli_chat_session=", "HttpOnly", "SameSite=Strict"])
    if (!cookie.includes(expected)) throw new Error(`Cookie seguro sem ${expected}`);
}
const crossOrigin = await fetch(new URL("/api/gemini/chat", base), {
  method: "POST",
  headers: { origin: "https://attacker.invalid", "content-type": "application/json" },
  body: "{}",
});
if (crossOrigin.status !== 403)
  throw new Error(`Origem externa deveria retornar 403, retornou ${crossOrigin.status}`);
console.log("Security smoke test aprovado.");
