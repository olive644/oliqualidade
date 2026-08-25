import { describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "@/lib/turnstile";

const siteverify = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("verifyTurnstileToken", () => {
  it("recusa sem token, sem gastar uma chamada à Cloudflare", async () => {
    const fetchMock = vi.fn();
    const result = await verifyTurnstileToken(
      null,
      "segredo",
      null,
      fetchMock as unknown as typeof fetch,
    );

    expect(result).toEqual({ ok: false, reason: "sem-token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aceita quando a Cloudflare confirma", async () => {
    const fetchMock = vi.fn().mockResolvedValue(siteverify({ success: true }));
    expect(
      await verifyTurnstileToken("token", "segredo", null, fetchMock as unknown as typeof fetch),
    ).toEqual({ ok: true });
  });

  it("manda o segredo e o endereço no corpo, nunca na URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(siteverify({ success: true }));
    await verifyTurnstileToken(
      "token",
      "segredo",
      "203.0.113.7",
      fetchMock as unknown as typeof fetch,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("segredo");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("secret")).toBe("segredo");
    expect(body.get("response")).toBe("token");
    expect(body.get("remoteip")).toBe("203.0.113.7");
  });

  it("repassa o motivo da recusa da Cloudflare", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    expect(
      await verifyTurnstileToken("token", "segredo", null, fetchMock as unknown as typeof fetch),
    ).toEqual({ ok: false, reason: "timeout-or-duplicate" });
  });

  it("recusa quando a Cloudflare responde erro de HTTP", async () => {
    const fetchMock = vi.fn().mockResolvedValue(siteverify({}, 500));
    expect(
      await verifyTurnstileToken("token", "segredo", null, fetchMock as unknown as typeof fetch),
    ).toEqual({ ok: false, reason: "siteverify-500" });
  });

  it("recusa quando não consegue perguntar", async () => {
    // Oposto da escolha do limitador, e de propósito: um Turnstile que aceita
    // quando não consegue verificar não é verificação nenhuma.
    const fetchMock = vi.fn().mockRejectedValue(new Error("rede fora"));
    expect(
      await verifyTurnstileToken("token", "segredo", null, fetchMock as unknown as typeof fetch),
    ).toEqual({ ok: false, reason: "rede" });
  });
});
