import { describe, expect, it } from "vitest";
import { investigationMetricFor } from "./insight-sidebar";
import type { Column } from "@/lib/types";

const col = (key: string): Column => ({
  key,
  label: key,
  kind: "number",
  visible: true,
  description: "",
});

describe("investigationMetricFor", () => {
  const resultado = col("resultado");
  const meta = col("meta");
  const nums = [resultado, meta];

  it("resolve pela metricKey da própria pergunta, não pela métrica global do painel", () => {
    // Bug real: o botão "Investigar" sempre abria com a métrica global
    // (aqui "meta"), mesmo clicando numa pergunta que aponta pra outra
    // métrica ("resultado") — investigava a coisa errada.
    const question = { metricKey: "resultado" };
    expect(investigationMetricFor(question, nums, meta)).toBe(resultado);
  });

  it("cai na métrica global quando a pergunta não aponta pra nenhuma", () => {
    const question = {};
    expect(investigationMetricFor(question, nums, meta)).toBe(meta);
  });

  it("cai na métrica global quando a metricKey da pergunta não existe entre as colunas numéricas", () => {
    const question = { metricKey: "coluna_removida" };
    expect(investigationMetricFor(question, nums, meta)).toBe(meta);
  });

  it("retorna undefined quando nem a pergunta nem o painel têm métrica", () => {
    const question = {};
    expect(investigationMetricFor(question, nums, undefined)).toBeUndefined();
  });
});
