import { describe, expect, it } from "vitest";
import { isSameOriginBrowserRequest, readLimitedJson, withSecurityHeaders } from "./http-security";

describe("HTTP security", () => {
  it("aplica cabeçalhos defensivos", () => {
    const response = withSecurityHeaders(new Response("ok"));
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("object-src 'none'");
  });

  it("sem nonce, cai de volta pra 'unsafe-inline' no script-src", () => {
    const response = withSecurityHeaders(new Response("ok"));
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("com nonce, script-src usa o nonce em vez de 'unsafe-inline'", () => {
    const response = withSecurityHeaders(new Response("ok"), "abc123==");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self' 'nonce-abc123=='");
    // style-src continua com 'unsafe-inline' (não afetado pelo nonce) —
    // só o script-src deve deixar de anunciar 'unsafe-inline'.
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("rejeita corpo acima do limite mesmo sem Content-Length", async () => {
    const request = new Request("https://oli.test/api", {
      method: "POST",
      body: JSON.stringify({ value: "12345" }),
    });
    await expect(readLimitedJson(request, 5)).rejects.toThrow("PAYLOAD_TOO_LARGE");
  });

  it("exige origem do próprio site", () => {
    const safe = new Request("https://oli.test/api", {
      headers: { origin: "https://oli.test", "sec-fetch-site": "same-origin" },
    });
    const unsafe = new Request("https://oli.test/api", {
      headers: { origin: "https://evil.test" },
    });
    expect(isSameOriginBrowserRequest(safe)).toBe(true);
    expect(isSameOriginBrowserRequest(unsafe)).toBe(false);
  });
});
