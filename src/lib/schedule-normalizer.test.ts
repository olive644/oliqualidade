import { describe, expect, it } from "vitest";

import { summarizeScheduleRows } from "@/lib/schedule-normalizer";
import type { Column, Row } from "@/lib/types";

const column = (key: string, kind: Column["kind"] = "text"): Column => ({
  key,
  label: key,
  kind,
  visible: true,
  description: "",
});

describe("métricas de cronograma", () => {
  it("separa códigos planejados de resultados executados", () => {
    const rows: Row[] = [
      { item: "Poço", status: "Planejado", jan: "T", fev: "M", observacao: null },
      {
        item: "Poço",
        status: "Executado",
        jan: "C",
        fev: null,
        observacao: "Aguardando laudo de fevereiro",
      },
    ];
    const metrics = summarizeScheduleRows(
      rows,
      [column("item"), column("status"), column("jan"), column("fev"), column("observacao")],
      ["jan", "fev"],
      "status",
      ["observacao"],
    );
    expect(metrics).toMatchObject({
      planned: 2,
      results: 1,
      within: 1,
      outside: 0,
      empty: 1,
      observations: 1,
      coverage: 50,
    });
  });

  it("mede conformidade por limite sem somar ensaios diferentes", () => {
    const rows: Row[] = [{ item: "Torneira", jan: 4, fev: 6, "Máx.": 5 }];
    const metrics = summarizeScheduleRows(
      rows,
      [column("item"), column("jan", "number"), column("fev", "number"), column("Máx.", "number")],
      ["jan", "fev"],
    );
    expect(metrics).toMatchObject({
      planned: 0,
      results: 2,
      within: 1,
      outside: 1,
      coverage: 100,
    });
  });
});
