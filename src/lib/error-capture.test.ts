import { describe, expect, it, vi } from "vitest";
import { consumeLastCapturedError, describeError, runWithErrorCapture } from "./error-capture";

describe("error-capture: isolamento por requisição", () => {
  it("não vaza o erro de uma requisição para outra rodando em paralelo", async () => {
    // Simula duas "requisições" concorrentes: a primeira demora mais para
    // registrar seu erro (via console.error, como h3 faz internamente) do
    // que a segunda leva para terminar inteira. Antes desta mudança, a
    // variável global era sobrescrita pela segunda e a primeira lia o erro
    // errado (ou nenhum).
    const errorA = new Error("falha da requisição A");
    const errorB = new Error("falha da requisição B");

    const taskA = runWithErrorCapture([], async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      console.error(errorA);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return consumeLastCapturedError();
    });
    const taskB = runWithErrorCapture([], async () => {
      console.error(errorB);
      return consumeLastCapturedError();
    });

    const [resultA, resultB] = await Promise.all([taskA, taskB]);
    expect(resultA).toBe(errorA);
    expect(resultB).toBe(errorB);
  });

  it("retorna undefined fora de qualquer contexto de captura", () => {
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("consome o erro só uma vez", async () => {
    const error = new Error("único");
    const [first, second] = await runWithErrorCapture([], async () => {
      console.error(error);
      return [consumeLastCapturedError(), consumeLastCapturedError()];
    });
    expect(first).toBe(error);
    expect(second).toBeUndefined();
  });

  it("expira o erro capturado após o TTL", async () => {
    vi.useFakeTimers();
    try {
      const error = new Error("expira");
      const result = await runWithErrorCapture([], async () => {
        console.error(error);
        vi.advanceTimersByTime(6_000);
        return consumeLastCapturedError();
      });
      expect(result).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("error-capture: redação de segredos", () => {
  it("remove segredos conhecidos da requisição do texto do erro", async () => {
    const secret = "sk-super-secreta-123456";
    const description = await runWithErrorCapture([secret], async () => {
      const error = new Error(`Falha ao chamar API com chave ${secret}`);
      return describeError(error);
    });
    expect(description).not.toContain(secret);
    expect(description).toContain("[REDACTED]");
  });

  it("ignora segredos indefinidos/vazios sem lançar erro", async () => {
    const description = await runWithErrorCapture([undefined, ""], async () =>
      describeError(new Error("mensagem normal")),
    );
    expect(description).toContain("mensagem normal");
  });

  it("não redige strings curtas (evita falso positivo em texto comum)", async () => {
    const description = await runWithErrorCapture(["abc"], async () =>
      describeError(new Error("um erro qualquer com abc no meio")),
    );
    expect(description).toContain("abc");
  });

  it("não redige nada fora de um contexto de captura", () => {
    const description = describeError(new Error("sem contexto nenhum segredo aqui"));
    expect(description).toContain("sem contexto nenhum segredo aqui");
  });
});

describe("error-capture: describeError", () => {
  it("expande a cadeia de causas preservando mensagem e status", async () => {
    const root = new Error("causa raiz");
    const wrapped = new Error("erro de camada superior", { cause: root });
    (wrapped as unknown as { status: number }).status = 502;
    const description = await runWithErrorCapture([], async () => describeError(wrapped));
    expect(description).toContain("erro de camada superior");
    expect(description).toContain("(status 502)");
    expect(description).toContain("caused by:");
    expect(description).toContain("causa raiz");
  });

  it("lida com valores não-Error sem lançar", () => {
    expect(describeError("uma string qualquer")).toBe("uma string qualquer");
    expect(describeError({ foo: "bar" })).toContain("foo");
  });
});
