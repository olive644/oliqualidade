import { describe, expect, it } from "vitest";
import { currentNonce, generateNonce, runWithNonce } from "./csp-nonce";

describe("csp-nonce", () => {
  it("gera valores diferentes a cada chamada", () => {
    expect(generateNonce()).not.toBe(generateNonce());
  });

  it("fica indisponível fora de runWithNonce", () => {
    expect(currentNonce()).toBeUndefined();
  });

  it("expõe o nonce só dentro do escopo de runWithNonce, inclusive através de await", async () => {
    const nonce = generateNonce();
    const observed = await runWithNonce(nonce, async () => {
      await Promise.resolve();
      return currentNonce();
    });
    expect(observed).toBe(nonce);
    expect(currentNonce()).toBeUndefined();
  });

  it("isola nonces de chamadas concorrentes (mesmo padrão de error-capture.ts)", async () => {
    const [a, b] = await Promise.all([
      runWithNonce("nonce-a", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return currentNonce();
      }),
      runWithNonce("nonce-b", async () => {
        return currentNonce();
      }),
    ]);
    expect(a).toBe("nonce-a");
    expect(b).toBe("nonce-b");
  });
});
