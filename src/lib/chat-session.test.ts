import { describe, expect, it } from "vitest";
import {
  chatSessionCookieName,
  createChatSession,
  verifyChatSession,
  withChatSession,
} from "./chat-session";

const request = (cookie?: string, userAgent = "Oli Test") =>
  new Request("https://oli.test/", {
    headers: {
      "user-agent": userAgent,
      ...(cookie ? { cookie } : {}),
    },
  });

describe("sessão assinada do chat", () => {
  it("emite cookie HttpOnly e valida assinatura", async () => {
    const response = await withChatSession(new Response("ok"), request(), "secret");
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    const cookie = setCookie.split(";")[0]!;
    expect(await verifyChatSession(request(cookie), "secret")).toBe(true);
  });

  it("rejeita adulteração, outro navegador e expiração", async () => {
    const token = await createChatSession(request(), "secret", 1_000);
    const cookie = `${chatSessionCookieName}=${token}`;
    expect(await verifyChatSession(request(`${cookie}x`), "secret", 1_000)).toBe(false);
    expect(await verifyChatSession(request(cookie, "Outro"), "secret", 1_000)).toBe(false);
    expect(await verifyChatSession(request(cookie), "secret", 10_000_000)).toBe(false);
  });
});
