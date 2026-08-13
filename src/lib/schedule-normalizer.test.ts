import { describe, expect, it } from "vitest";

import {
  evaluateScheduleValue,
  parseScheduleCriterion,
  parseScheduleNumber,
  scheduleCriterionForRow,
  scheduleToLong,
} from "@/lib/schedule-normalizer";
import type { Column, Row } from "@/lib/types";

const column = (key: string, kind: Column["kind"] = "number"): Column => ({
  key,
  label: key,
  kind,
  visible: true,
  description: "",
});

describe("parseScheduleNumber", () => {
  it.each([
    ["0,80", 0.8],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["-4,5", -4.5],
    [0, 0],
  ])("interpreta %j como %j", (input, expected) => {
    expect(parseScheduleNumber(input)).toBe(expected);
  });

  it.each(["05/2025", "2025-06", "12-08-2025"])("não transforma data %s em número", (input) => {
    expect(parseScheduleNumber(input)).toBeNull();
  });
});

describe("parseScheduleCriterion", () => {
  it.each([
    ["> 70", "min", 70, undefined, false, true],
    [">= 70", "min", 70, undefined, true, true],
    ["< 15", "max", undefined, 15, true, false],
    ["≤ 15", "max", undefined, 15, true, true],
    ["0,80 mínimo", "min", 0.8, undefined, true, true],
    ["máx. 4", "max", undefined, 4, true, true],
    ["entre 10 e 20", "range", 10, 20, true, true],
    ["10–20", "range", 10, 20, true, true],
    ["10 ± 2", "range", 8, 12, true, true],
  ])("interpreta %s", (label, kind, min, max, inclusiveMin, inclusiveMax) => {
    const criterion = parseScheduleCriterion(label);
    expect(criterion).toMatchObject({
      kind,
      inclusiveMin,
      inclusiveMax,
    });
    expect(criterion?.min).toBe(min);
    expect(criterion?.max).toBe(max);
  });

  it.each(["ausente", "negativo", "não detectado"])("interpreta %s como ausência", (label) => {
    expect(parseScheduleCriterion(label)?.kind).toBe("absence");
  });

  it("avalia critérios textuais sem inventar números", () => {
    expect(evaluateScheduleValue("Negativo", parseScheduleCriterion("ausente"))).toBe("within");
    expect(evaluateScheduleValue("Presente", parseScheduleCriterion("ausente"))).toBe("outside");
    expect(evaluateScheduleValue("Conforme", parseScheduleCriterion("conforme"))).toBe("within");
    expect(evaluateScheduleValue("Não conforme", parseScheduleCriterion("conforme"))).toBe(
      "outside",
    );
  });
});

describe("scheduleCriterionForRow", () => {
  it("combina limites divididos entre mínimo e máximo", () => {
    const columns = [column("Ensaio", "text"), column("Mín."), column("Máx."), column("jun/2025")];
    const row: Row = { Ensaio: "pH", "Mín.": "6,0", "Máx.": "9,5", "jun/2025": 7 };
    expect(scheduleCriterionForRow(row, columns, ["jun/2025"])).toMatchObject({
      kind: "range",
      min: 6,
      max: 9.5,
    });
  });

  it("lê a coluna de especificação quando não há limites separados", () => {
    const columns = [
      column("Ponto", "category"),
      column("Especificação", "text"),
      column("jun/2025"),
    ];
    const row: Row = { Ponto: "CQ", Especificação: "10 ± 2", "jun/2025": 9 };
    expect(scheduleCriterionForRow(row, columns, ["jun/2025"])).toMatchObject({ min: 8, max: 12 });
  });
});

describe("scheduleToLong", () => {
  it("preserva valor bruto e endereço da célula de origem", () => {
    const rows: Row[] = [{ Ponto: "CQ", Ensaio: "pH", "jun/2025": "7,2", "set/2025": null }];
    const result = scheduleToLong(rows);
    expect(result[0]).toMatchObject({
      sourceAddress: "C2",
      sourceRow: 2,
      sourceColumn: "jun/2025",
      rawValue: "7,2",
      value: "7,2",
    });
  });
});
