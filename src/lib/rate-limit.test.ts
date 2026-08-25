import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  consumeRateLimit,
  resetRateLimitsForTests,
  upstashConfigFrom,
} from "@/lib/rate-limit";

const config = { url: "https://exemplo.upstash.io", token: "token-de-teste" };
const rule = { key: "cliente", limit: 2, windowMs: 60_000 };

/** Resposta de pipeline do Upstash com a contagem da janela informada. */
const pipelineWithCount = (count: number) =>
  new Response(JSON.stringify([{ result: 0 }, { result: 1 }, { result: count }, { result: 1 }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  resetRateLimitsForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("upstashConfigFrom", () => {
  it("exige as duas variáveis", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(upstashConfigFrom({ UPSTASH_REDIS_REST_URL: "https://exemplo.upstash.io" })).toBeNull();
    expect(upstashConfigFrom({ UPSTASH_REDIS_REST_TOKEN: "token" })).toBeNull();
  });

  it("remove a barra final da URL para não montar caminho duplicado", () => {
    expect(
      upstashConfigFrom({
        UPSTASH_REDIS_REST_URL: "https://exemplo.upstash.io/",
        UPSTASH_REDIS_REST_TOKEN: "token",
      }),
    ).toEqual({ url: "https://exemplo.upstash.io", token: "token" });
  });
});

describe("consumeRateLimit sem Redis", () => {
  it("usa a memória do processo e respeita o limite", async () => {
    expect(await consumeRateLimit(rule, null, 0)).toEqual({ allowed: true, store: "memory" });
    expect(await consumeRateLimit(rule, null, 1)).toEqual({ allowed: true, store: "memory" });
    expect(await consumeRateLimit(rule, null, 2)).toEqual({ allowed: false, store: "memory" });
  });

  it("libera de novo quando a janela passa", async () => {
    await consumeRateLimit(rule, null, 0);
    await consumeRateLimit(rule, null, 0);
    expect((await consumeRateLimit(rule, null, 60_001)).allowed).toBe(true);
  });
});

describe("consumeRateLimit com Redis", () => {
  it("monta a janela deslizante em um pipeline só", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pipelineWithCount(1));
    const decision = await consumeRateLimit(
      rule,
      config,
      100_000,
      fetchMock as unknown as typeof fetch,
    );

    expect(decision).toEqual({ allowed: true, store: "redis" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://exemplo.upstash.io/pipeline");
    const commands = JSON.parse(String(init.body)) as unknown[][];
    expect(commands.map((command) => command[0])).toEqual([
      "ZREMRANGEBYSCORE",
      "ZADD",
      "ZCARD",
      "PEXPIRE",
    ]);
    // O corte da janela é o instante atual menos a largura dela: sem isso, a
    // limpeza apagaria de menos ou de mais.
    expect(commands[0]?.[3]).toBe(100_000 - rule.windowMs);
  });

  it("recusa quando a contagem passa do limite e devolve a entrada", async () => {
    const fetchMock = vi.fn().mockResolvedValue(pipelineWithCount(3));
    const decision = await consumeRateLimit(rule, config, 0, fetchMock as unknown as typeof fetch);

    expect(decision).toEqual({ allowed: false, store: "redis" });
    // A tentativa recusada não pode ficar contando: sem o ZREM, uma rajada
    // empurraria o próprio limite para frente.
    const segunda = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    ) as unknown[][];
    expect(segunda[0]?.[0]).toBe("ZREM");
  });

  it("cai para a memória quando o Redis falha, em vez de recusar", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("rede fora"));
    const decision = await consumeRateLimit(rule, config, 0, fetchMock as unknown as typeof fetch);

    expect(decision).toEqual({ allowed: true, store: "memory" });
  });

  it("cai para a memória quando o Redis responde fora do formato", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result: "opa" }), { status: 200 }));
    expect(
      (await consumeRateLimit(rule, config, 0, fetchMock as unknown as typeof fetch)).store,
    ).toBe("memory");
  });

  it("cai para a memória quando um comando do pipeline devolve erro", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ result: 0 }, { error: "WRONGTYPE" }, { result: 1 }]), {
        status: 200,
      }),
    );
    expect(
      (await consumeRateLimit(rule, config, 0, fetchMock as unknown as typeof fetch)).store,
    ).toBe("memory");
  });

  it("a queda para a memória ainda limita, não vira passe livre", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("rede fora"));
    const asFetch = fetchMock as unknown as typeof fetch;
    expect((await consumeRateLimit(rule, config, 0, asFetch)).allowed).toBe(true);
    expect((await consumeRateLimit(rule, config, 1, asFetch)).allowed).toBe(true);
    expect((await consumeRateLimit(rule, config, 2, asFetch)).allowed).toBe(false);
  });
});

describe("checkRateLimit", () => {
  it("continua sendo o comportamento de referência", () => {
    for (let index = 0; index < 12; index++) expect(checkRateLimit("ref", index)).toBe(true);
    expect(checkRateLimit("ref", 13)).toBe(false);
  });
});
