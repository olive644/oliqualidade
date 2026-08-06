import { describe, expect, it } from "vitest";

import {
  aggregate,
  applyMissingRules,
  detectQualitySignals,
  groupAndAggregate,
  leftJoin,
  NOT_INFORMED,
  toggleClickFilter,
} from "@/lib/data-pipeline";
import type { Column, FilterRule, Row } from "@/lib/types";

const numberCol = (key: string, missingRule?: Column["missingRule"]): Column => ({
  key,
  label: key,
  kind: "number",
  visible: true,
  description: "",
  ...(missingRule ? { missingRule } : {}),
});

const textCol = (key: string, missingRule?: Column["missingRule"]): Column => ({
  key,
  label: key,
  kind: "text",
  visible: true,
  description: "",
  ...(missingRule ? { missingRule } : {}),
});

describe("applyMissingRules", () => {
  it("mantém nulos quando a regra é a padrão (ignore)", () => {
    const rows: Row[] = [{ v: null }, { v: 5 }];
    const { rows: result } = applyMissingRules(rows, [numberCol("v")]);
    expect(result[0]?.["v"]).toBeNull();
  });

  it("preenche com zero quando a regra é zero", () => {
    const rows: Row[] = [{ v: null }, { v: 5 }];
    const { rows: result } = applyMissingRules(rows, [numberCol("v", "zero")]);
    expect(result[0]?.["v"]).toBe(0);
    expect(result[1]?.["v"]).toBe(5);
  });

  it("interpola linearmente entre o valor anterior e o seguinte", () => {
    const rows: Row[] = [{ v: 10 }, { v: null }, { v: 30 }];
    const { rows: result, interpolated } = applyMissingRules(rows, [numberCol("v", "interpolate")]);
    expect(result[1]?.["v"]).toBe(20);
    expect(interpolated.has("1-v")).toBe(true);
  });

  it("repete o valor mais próximo quando não há um dos dois lados para interpolar", () => {
    const rows: Row[] = [{ v: null }, { v: 10 }, { v: null }];
    const { rows: result } = applyMissingRules(rows, [numberCol("v", "interpolate")]);
    expect(result[0]?.["v"]).toBe(10);
    expect(result[2]?.["v"]).toBe(10);
  });

  it("remove a linha inteira quando a regra é hide-row, mesmo em coluna de texto", () => {
    const rows: Row[] = [{ nome: "Suzy" }, { nome: null }, { nome: "" }];
    const { rows: result } = applyMissingRules(rows, [textCol("nome", "hide-row")]);
    expect(result).toHaveLength(1);
    expect(result[0]?.["nome"]).toBe("Suzy");
  });

  it("ignora zero/interpolate em colunas não numéricas", () => {
    const rows: Row[] = [{ nome: null }];
    const { rows: result } = applyMissingRules(rows, [textCol("nome", "zero")]);
    expect(result[0]?.["nome"]).toBeNull();
  });
});

describe("detectQualitySignals", () => {
  it("sinaliza linhas duplicadas", () => {
    const rows: Row[] = [{ v: 1 }, { v: 1 }];
    const signals = detectQualitySignals(rows, [numberCol("v")]);
    expect(signals.some((s) => s.kind === "duplicate-rows")).toBe(true);
  });

  it("sinaliza outlier numérico fora de 3 desvios padrão", () => {
    const rows: Row[] = [
      ...Array.from({ length: 10 }, () => ({ v: 1 })),
      { v: 1000 }, // bem fora do padrão em relação ao restante, quase todo em 1
    ];
    const signals = detectQualitySignals(rows, [numberCol("v")]);
    expect(signals.some((s) => s.kind === "outlier" && s.columnKey === "v")).toBe(true);
  });

  it("sinaliza inconsistência de texto (mesmo valor com grafias diferentes)", () => {
    const rows: Row[] = [{ cidade: "Recife" }, { cidade: "recife" }, { cidade: " Recife " }];
    const signals = detectQualitySignals(rows, [textCol("cidade")]);
    expect(signals.some((s) => s.kind === "text-inconsistency" && s.columnKey === "cidade")).toBe(
      true,
    );
  });

  it("não sinaliza nada para dados limpos e consistentes", () => {
    const rows: Row[] = [
      { v: 1, cidade: "Recife" },
      { v: 2, cidade: "Jaboatão" },
    ];
    const signals = detectQualitySignals(rows, [numberCol("v"), textCol("cidade")]);
    expect(signals).toHaveLength(0);
  });
});

describe("aggregate", () => {
  it("soma, calcula média, mínimo e máximo corretamente", () => {
    const values = [1, 2, 3, 4];
    expect(aggregate(values, "sum")).toBe(10);
    expect(aggregate(values, "avg")).toBe(2.5);
    expect(aggregate(values, "min")).toBe(1);
    expect(aggregate(values, "max")).toBe(4);
    expect(aggregate(values, "count")).toBe(4);
  });

  it("retorna 0 para lista vazia, exceto count que também é 0", () => {
    expect(aggregate([], "sum")).toBe(0);
    expect(aggregate([], "avg")).toBe(0);
    expect(aggregate([], "count")).toBe(0);
  });
});

describe("groupAndAggregate", () => {
  it("agrupa por categoria e soma os valores", () => {
    const rows: Row[] = [
      { categoria: "Bolo", valor: 50 },
      { categoria: "Bolo", valor: 30 },
      { categoria: "Doce", valor: 10 },
    ];
    const result = groupAndAggregate(rows, "categoria", "valor", "sum");
    expect(result).toEqual(
      expect.arrayContaining([
        { name: "Bolo", total: 80 },
        { name: "Doce", total: 10 },
      ]),
    );
  });

  it("usa 'Não informado' para valores de agrupamento ausentes", () => {
    const rows: Row[] = [{ categoria: null, valor: 10 }];
    const result = groupAndAggregate(rows, "categoria", "valor", "sum");
    expect(result[0]?.name).toBe(NOT_INFORMED);
  });
});

describe("leftJoin", () => {
  it("copia campos da segunda planilha quando há correspondência (sem diferenciar maiúsculas)", () => {
    const base: Row[] = [{ cliente: "Suzy" }, { cliente: "ana" }];
    const other: Row[] = [{ nome: "SUZY", telefone: "8199999" }];
    const { rows, addedKeys } = leftJoin(base, "cliente", other, "nome", ["cliente"]);
    expect(addedKeys).toEqual(["telefone"]);
    expect(rows[0]?.["telefone"]).toBe("8199999");
    expect(rows[1]?.["telefone"]).toBeNull();
  });

  it("renomeia colunas da segunda planilha que colidem com colunas já existentes", () => {
    const base: Row[] = [{ cliente: "Suzy", telefone: "0000" }];
    const other: Row[] = [{ nome: "Suzy", telefone: "8199999" }];
    const { addedKeys, rows } = leftJoin(base, "cliente", other, "nome", ["cliente", "telefone"]);
    expect(addedKeys).toEqual(["telefone_2"]);
    expect(rows[0]?.["telefone"]).toBe("0000");
    expect(rows[0]?.["telefone_2"]).toBe("8199999");
  });

  it("não perde nem duplica linhas da base quando não há correspondência", () => {
    const base: Row[] = [{ cliente: "Suzy" }, { cliente: "Lucas" }];
    const other: Row[] = [{ nome: "Outro Nome", telefone: "111" }];
    const { rows } = leftJoin(base, "cliente", other, "nome", ["cliente"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.["telefone"]).toBeNull();
    expect(rows[1]?.["telefone"]).toBeNull();
  });
});

describe("toggleClickFilter", () => {
  it("adiciona um filtro novo quando não havia filtro nessa coluna", () => {
    const result = toggleClickFilter([], "regiao", "Sul");
    expect(result).toEqual([{ key: "regiao", value: "Sul", min: "", max: "" }]);
  });

  it("remove o filtro ao clicar de novo no mesmo valor (alterna)", () => {
    const filters: FilterRule[] = [{ key: "regiao", value: "Sul", min: "", max: "" }];
    const result = toggleClickFilter(filters, "regiao", "Sul");
    expect(result).toEqual([]);
  });

  it("troca o valor do filtro da mesma coluna ao clicar em outro valor", () => {
    const filters: FilterRule[] = [{ key: "regiao", value: "Sul", min: "", max: "" }];
    const result = toggleClickFilter(filters, "regiao", "Norte");
    expect(result).toEqual([{ key: "regiao", value: "Norte", min: "", max: "" }]);
  });

  it("mantém filtros de outras colunas intactos (cross-filter combinando widgets)", () => {
    const filters: FilterRule[] = [{ key: "mes", value: "Janeiro", min: "", max: "" }];
    const result = toggleClickFilter(filters, "regiao", "Sul");
    expect(result).toEqual([
      { key: "mes", value: "Janeiro", min: "", max: "" },
      { key: "regiao", value: "Sul", min: "", max: "" },
    ]);
  });
});
