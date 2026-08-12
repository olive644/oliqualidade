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
};
for (const [header, expected] of Object.entries(required)) {
  const value = response.headers.get(header) ?? "";
  if (!value.includes(expected)) throw new Error(`${header} ausente ou incorreto: ${value}`);
}
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
