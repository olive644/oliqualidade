import { describe, expect, it, vi } from "vitest";
import { checkHuman, humanProofCookieName } from "@/lib/human-check";
import { TURNSTILE_TOKEN_HEADER } from "@/lib/turnstile";
import { chatSessionCookieName, createChatSession, verifyChatSession } from "@/lib/chat-session";

const SEGREDO_DA_PROVA = "segredo-de-teste-para-assinar-a-prova";

const requisicao = (headers: Record<string, string> = {}) =>
  new Request("https://exemplo.test/api/gemini/chat", {
    method: "POST",
    headers: { "user-agent": "navegador-de-teste", ...headers },
  });

const aceita = () =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
const recusa = () =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
      status: 200,
    }),
  );

describe("checkHuman", () => {
  it("passa direto quando o Turnstile não está configurado", async () => {
    const fetchMock = vi.fn();
    const resultado = await checkHuman(
      requisicao(),
      { TURNSTILE_SECRET_KEY: undefined },
      SEGREDO_DA_PROVA,
      fetchMock as unknown as typeof fetch,
    );

    expect(resultado).toEqual({ status: "ok", cookie: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pede o desafio quando não há prova nem token", async () => {
    const resultado = await checkHuman(
      requisicao(),
      { TURNSTILE_SECRET_KEY: "segredo" },
      SEGREDO_DA_PROVA,
      aceita() as unknown as typeof fetch,
    );

    expect(resultado).toEqual({ status: "challenge", reason: "sem-token" });
  });

  it("aceita o token e emite a prova com as defesas do cookie", async () => {
    const resultado = await checkHuman(
      requisicao({ [TURNSTILE_TOKEN_HEADER]: "token-valido" }),
      { TURNSTILE_SECRET_KEY: "segredo" },
      SEGREDO_DA_PROVA,
      aceita() as unknown as typeof fetch,
    );

    expect(resultado.status).toBe("ok");
    const cookie = resultado.status === "ok" ? resultado.cookie : null;
    expect(cookie).toContain(`${humanProofCookieName}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
  });

  it("reconhece a prova já emitida sem perguntar de novo à Cloudflare", async () => {
    const fetchMock = aceita();
    const primeira = await checkHuman(
      requisicao({ [TURNSTILE_TOKEN_HEADER]: "token-valido" }),
      { TURNSTILE_SECRET_KEY: "segredo" },
      SEGREDO_DA_PROVA,
      fetchMock as unknown as typeof fetch,
    );
    const cookie = primeira.status === "ok" ? (primeira.cookie ?? "") : "";
    const valor = cookie.split(";")[0] ?? "";

    const segunda = await checkHuman(
      requisicao({ cookie: valor }),
      { TURNSTILE_SECRET_KEY: "segredo" },
      SEGREDO_DA_PROVA,
      fetchMock as unknown as typeof fetch,
    );

    expect(segunda).toEqual({ status: "ok", cookie: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("não aceita prova assinada com outro segredo", async () => {
    const emitida = await checkHuman(
      requisicao({ [TURNSTILE_TOKEN_HEADER]: "token-valido" }),
      { TURNSTILE_SECRET_KEY: "segredo" },
      "outro-segredo-completamente-diferente",
      aceita() as unknown as typeof fetch,
    );
    const valor = (emitida.status === "ok" ? (emitida.cookie ?? "") : "").split(";")[0] ?? "";

    const resultado = await checkHuman(
      requisicao({ cookie: valor }),
      { TURNSTILE_SECRET_KEY: "segredo" },
      SEGREDO_DA_PROVA,
      recusa() as unknown as typeof fetch,
    );

    expect(resultado.status).toBe("challenge");
  });

  it("sem segredo para assinar, exige token a cada requisição", async () => {
    // Acontece só fora de produção: em produção o servidor já recusa sem
    // OLI_SESSION_SECRET. É mais rígido que o normal, não menos.
    const resultado = await checkHuman(
      requisicao({ [TURNSTILE_TOKEN_HEADER]: "token-valido" }),
      { TURNSTILE_SECRET_KEY: "segredo" },
      undefined,
      aceita() as unknown as typeof fetch,
    );

    expect(resultado).toEqual({ status: "ok", cookie: null });
  });

  it("não aceita a sessão do chat no lugar da prova humana", async () => {
    // Regressão de uma falha real encontrada na revisão de segurança desta
    // mudança. `oli_chat_session` é emitido para qualquer um que carregue a
    // página, e antes do `scope` ele era assinado com o mesmo segredo e o
    // mesmo prazo da prova. Bastava copiar o valor para o nome `oli_human`
    // em uma requisição feita à mão, sem navegador nenhum, e o Turnstile
    // inteiro era contornado sem uma única chamada à Cloudflare.
    const base = requisicao();
    const daSessao = await createChatSession(base, SEGREDO_DA_PROVA);
    const fetchMock = recusa();

    const resultado = await checkHuman(
      requisicao({ cookie: `${humanProofCookieName}=${daSessao}` }),
      { TURNSTILE_SECRET_KEY: "segredo" },
      SEGREDO_DA_PROVA,
      fetchMock as unknown as typeof fetch,
    );

    expect(resultado.status).toBe("challenge");
    // E o mesmo token continua valendo para o que ele é de verdade, senão a
    // correção teria só trocado uma quebra por outra.
    expect(
      await verifyChatSession(
        requisicao({ cookie: `${chatSessionCookieName}=${daSessao}` }),
        SEGREDO_DA_PROVA,
      ),
    ).toBe(true);
  });

  it("recusa token inválido", async () => {
    const resultado = await checkHuman(
      requisicao({ [TURNSTILE_TOKEN_HEADER]: "token-ruim" }),
      { TURNSTILE_SECRET_KEY: "segredo" },
      SEGREDO_DA_PROVA,
      recusa() as unknown as typeof fetch,
    );

    expect(resultado).toEqual({ status: "challenge", reason: "invalid-input-response" });
  });
});
