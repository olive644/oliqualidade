import { describe, expect, it } from "vitest";

import {
  buildAttendanceStats,
  buildControlSeries,
  buildPlanVsActualSeries,
  buildValidationStats,
  detectOperationalWidgetTypes,
} from "@/lib/operational-widgets";
import type { Column, Row } from "@/lib/types";

const column = (label: string, kind: Column["kind"] = "text"): Column => ({
  key: label,
  label,
  kind,
  visible: true,
  description: "",
});

describe("widgets operacionais", () => {
  it("reconhece automaticamente cada estrutura especializada", () => {
    expect(
      detectOperationalWidgetTypes([
        column("Matrícula"),
        column("Nome"),
        column("Setor"),
        column("Assinatura"),
      ]),
    ).toEqual(["attendance-overview"]);
    expect(
      detectOperationalWidgetTypes([
        column("Hora"),
        column("Referência"),
        column("Aceita", "number"),
        column("Rejeita", "number"),
      ]),
    ).toEqual(["validation-overview"]);
    expect(
      detectOperationalWidgetTypes([column("Amostra"), column("Resultado", "number")]),
    ).toEqual(["control-chart"]);
    expect(
      detectOperationalWidgetTypes([
        column("Programado — 01/07/2026", "number"),
        column("Realizado — 01/07/2026", "number"),
      ]),
    ).toEqual(["plan-vs-actual"]);
  });

  it("resume presença sem contar linhas sem participante", () => {
    const columns = [
      column("Nome"),
      column("Matrícula"),
      column("Setor"),
      column("Turno"),
      column("Assinatura"),
    ];
    const rows: Row[] = [
      { Nome: "Ana", Matrícula: "1", Setor: "QA", Turno: "D", Assinatura: "Ana" },
      { Nome: "Bia", Matrícula: "2", Setor: "QA", Turno: "N", Assinatura: "-" },
      { Nome: null, Matrícula: null, Setor: null, Turno: null, Assinatura: null },
    ];
    expect(buildAttendanceStats(columns, rows)).toMatchObject({
      total: 2,
      signed: 1,
      missingSignatures: 1,
      completion: 50,
      bySector: [{ label: "QA", value: 2 }],
    });
  });

  it("separa aprovações, rejeições e pendências por inspetor", () => {
    const columns = [
      column("Resultado"),
      column("Aceita", "number"),
      column("Rejeita", "number"),
      column("Inspetor"),
    ];
    const stats = buildValidationStats(columns, [
      { Resultado: "Aprovado", Aceita: null, Rejeita: null, Inspetor: "José" },
      { Resultado: "Reprovado", Aceita: null, Rejeita: null, Inspetor: "José" },
      { Resultado: "", Aceita: null, Rejeita: null, Inspetor: "Maria" },
    ]);
    expect(stats).toMatchObject({ total: 3, approved: 1, rejected: 1, pending: 1 });
    expect(stats.byInspector).toContainEqual({
      label: "José",
      approved: 1,
      rejected: 1,
      pending: 0,
    });
  });

  it("calcula limites estatísticos e pontos fora de controle", () => {
    const columns = [column("Amostra"), column("Peso", "number")];
    const rows = [10, 10, 10, 10, 100].map((value, index) => ({
      Amostra: index + 1,
      Peso: value,
    }));
    const series = buildControlSeries(columns, rows);
    expect(series.metric?.key).toBe("Peso");
    expect(series.points).toHaveLength(5);
    expect(series.mean).toBe(28);
    expect(series.lower).toBeLessThan(series.mean);
    expect(series.upper).toBeGreaterThan(series.mean);
  });

  it("pareia programado e realizado pelo período", () => {
    const columns = [
      column("Programado — 01/07/2026", "number"),
      column("Realizado — 01/07/2026", "number"),
      column("Programado — 02/07/2026", "number"),
      column("Realizado — 02/07/2026", "number"),
    ];
    const series = buildPlanVsActualSeries(columns, [
      {
        "Programado — 01/07/2026": 100,
        "Realizado — 01/07/2026": 90,
        "Programado — 02/07/2026": 50,
        "Realizado — 02/07/2026": 60,
      },
    ]);
    expect(series).toEqual([
      { period: "01/07/2026", planned: 100, actual: 90, delta: -10, attainment: 0.9 },
      { period: "02/07/2026", planned: 50, actual: 60, delta: 10, attainment: 1.2 },
    ]);
  });
});
