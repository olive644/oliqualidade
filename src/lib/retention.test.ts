import { describe, expect, it } from "vitest";
import { applyRetention, RETENTION, retentionSummary } from "./retention";

const DIA = 24 * 60 * 60 * 1000;
const agora = 1_700_000_000_000;
const entrada = (diasAtras: number, id = String(diasAtras)) => ({
  id,
  at: agora - diasAtras * DIA,
});

describe("applyRetention", () => {
  const regra = { maxAgeDays: 30, maxEntries: 3 };

  it("descarta o que passou do prazo", () => {
    const mantidas = applyRetention(
      [entrada(1), entrada(10), entrada(40)],
      regra,
      (e) => e.at,
      agora,
    );
    expect(mantidas.map((e) => e.id)).toEqual(["1", "10"]);
  });

  it("aplica o teto depois da idade, mantendo as mais recentes", () => {
    const mantidas = applyRetention(
      [entrada(1), entrada(2), entrada(3), entrada(4)],
      regra,
      (e) => e.at,
      agora,
    );
    expect(mantidas.map((e) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("preserva a ordem em que as entradas chegaram", () => {
    // Quem consome as métricas de importação espera ordem cronológica;
    // reordenar seria efeito colateral que ninguém pediu à retenção.
    const cronologica = [entrada(4, "a"), entrada(3, "b"), entrada(2, "c"), entrada(1, "d")];
    const mantidas = applyRetention(cronologica, regra, (e) => e.at, agora);
    expect(mantidas.map((e) => e.id)).toEqual(["b", "c", "d"]);
  });

  it("mantém entrada sem data conhecida", () => {
    // Descartar por falta de informação apagaria dado que pode ser recente, e
    // o teto ainda a alcança.
    const mantidas = applyRetention(
      [{ id: "sem-data", at: Number.NaN }, entrada(1)],
      regra,
      (e) => e.at,
      agora,
    );
    expect(mantidas.map((e) => e.id)).toContain("sem-data");
  });

  it("não altera a lista recebida", () => {
    const original = [entrada(1), entrada(40)];
    applyRetention(original, regra, (e) => e.at, agora);
    expect(original).toHaveLength(2);
  });
});

describe("RETENTION", () => {
  it("declara prazo e teto para todos os caches", () => {
    for (const regra of Object.values(RETENTION)) {
      expect(regra.maxAgeDays).toBeGreaterThan(0);
      expect(regra.maxEntries).toBeGreaterThan(0);
    }
  });

  it("descreve a regra em uma frase legível", () => {
    expect(retentionSummary(RETENTION.importMetrics)).toBe(
      "Até 200 registros, por no máximo 90 dias.",
    );
  });
});
