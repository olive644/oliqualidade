import { describe, expect, it } from "vitest";

import {
  evaluateScheduleValue,
  parseScheduleCriterion,
  parseScheduleNumber,
  scheduleToLong,
} from "@/lib/schedule-normalizer";
import { classifyRows } from "@/lib/structural-model";

describe("estrutura e cronograma canônico", () => {
  const rows = [
    { Item: "Injetora N04", "jun/2025": 60, "set/2025": null, "dez/2025": 24 },
    { Item: "Injetora N05", "jun/2025": 29, "set/2025": 4, "dez/2025": null },
  ];

  it("reconhece cronograma sem depender do nome da aba", () => {
    expect(classifyRows(rows)).toMatchObject({ type: "schedule" });
  });

  it("converte tabela larga sem eliminar vazios planejados", () => {
    const long = scheduleToLong(rows);
    expect(long).toHaveLength(6);
    expect(long[0]).toMatchObject({
      item: "Injetora N04",
      period: "jun/2025",
      value: 60,
      sourceRow: 2,
      dimensions: { Item: "Injetora N04" },
    });
    expect(long.some((item) => item.value === null)).toBe(true);
  });

  it("interpreta decimal brasileiro, máximos, faixas e ausência", () => {
    expect(parseScheduleNumber("0,46 uT")).toBe(0.46);
    expect(evaluateScheduleValue(4, parseScheduleCriterion(25))).toBe("within");
    expect(evaluateScheduleValue(60, parseScheduleCriterion("Máx. 25"))).toBe("outside");
    expect(evaluateScheduleValue("6,7", parseScheduleCriterion("6,0 a 9,5"))).toBe("within");
    expect(evaluateScheduleValue("4,9", parseScheduleCriterion("6,0 a 9,5"))).toBe("outside");
    expect(evaluateScheduleValue(0, parseScheduleCriterion("Ausência"))).toBe("within");
    expect(evaluateScheduleValue(1, parseScheduleCriterion("Ausência"))).toBe("outside");
  });

  it("reconhece matrizes de validação e séries laboratoriais normalizadas", () => {
    expect(
      classifyRows([
        {
          Hora: "07:00h",
          Referência: "N° de peças",
          Aceita: null,
          Rejeita: null,
          Resultado: "OK",
        },
      ]),
    ).toMatchObject({ type: "validation-matrix" });
    expect(
      classifyRows([
        {
          Amostra: "Original",
          Ensaio: "Préforma",
          Identificação: "Amostra 1",
          Resultado: 83.7,
        },
      ]),
    ).toMatchObject({ type: "laboratory-series" });
  });
});
