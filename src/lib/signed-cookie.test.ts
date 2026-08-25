import { describe, expect, it } from "vitest";
import { createSignedToken, signedCookieHeader, verifySignedCookie } from "@/lib/signed-cookie";

const SEGREDO = "segredo-de-teste-para-assinar-cookie";

const requisicao = (cookie?: string, userAgent = "navegador-de-teste") =>
  new Request("https://exemplo.test/", {
    headers: { "user-agent": userAgent, ...(cookie ? { cookie } : {}) },
  });

describe("cookie assinado", () => {
  it("valida o próprio token", async () => {
    const token = await createSignedToken(requisicao(), SEGREDO, 3_600, "oli_alguma_coisa");
    expect(
      await verifySignedCookie(
        requisicao(`oli_alguma_coisa=${token}`),
        "oli_alguma_coisa",
        SEGREDO,
      ),
    ).toBe(true);
  });

  it("não aceita token emitido para outro cookie", async () => {
    // Esta é a regressão que originou o `scope`. Dois cookies assinados com o
    // mesmo segredo e o mesmo prazo eram intercambiáveis: bastava copiar o
    // valor de um para o nome do outro. Como a sessão do chat é entregue a
    // qualquer um que carregue a página, e a prova de verificação humana usa
    // o mesmo segredo, isso contornava o Turnstile inteiro sem nunca falar
    // com a Cloudflare.
    const daSessao = await createSignedToken(requisicao(), SEGREDO, 3_600, "oli_chat_session");
    expect(
      await verifySignedCookie(requisicao(`oli_human=${daSessao}`), "oli_human", SEGREDO),
    ).toBe(false);
  });

  it("não aceita token sem escopo declarado", async () => {
    // Um token antigo, anterior ao `scope`, não pode passar por omissão: é
    // exatamente o token que o atacante teria em mãos.
    const semEscopo = await createSignedToken(requisicao(), SEGREDO, 3_600, "");
    expect(
      await verifySignedCookie(requisicao(`oli_human=${semEscopo}`), "oli_human", SEGREDO),
    ).toBe(false);
  });

  it("o cabeçalho emitido declara o escopo do próprio cookie", async () => {
    const cabecalho = await signedCookieHeader(requisicao(), "oli_human", SEGREDO, 3_600);
    const valor = cabecalho.split(";")[0]?.split("=").slice(1).join("=") ?? "";
    expect(await verifySignedCookie(requisicao(`oli_human=${valor}`), "oli_human", SEGREDO)).toBe(
      true,
    );
    expect(
      await verifySignedCookie(
        requisicao(`oli_chat_session=${valor}`),
        "oli_chat_session",
        SEGREDO,
      ),
    ).toBe(false);
  });

  it("rejeita adulteração, outro navegador e prazo vencido", async () => {
    const token = await createSignedToken(requisicao(), SEGREDO, 3_600, "oli_human", 1_000);
    const cookie = `oli_human=${token}`;
    expect(await verifySignedCookie(requisicao(`${cookie}x`), "oli_human", SEGREDO, 1_000)).toBe(
      false,
    );
    expect(await verifySignedCookie(requisicao(cookie, "outro"), "oli_human", SEGREDO, 1_000)).toBe(
      false,
    );
    expect(await verifySignedCookie(requisicao(cookie), "oli_human", SEGREDO, 10_000_000)).toBe(
      false,
    );
  });
});
