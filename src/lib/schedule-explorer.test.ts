import { describe, expect, it } from "vitest";

import {
  exploreScheduleRows,
  type ScheduleExplorerEntry,
  type ScheduleExplorerOptions,
} from "@/lib/schedule-explorer";

const options: ScheduleExplorerOptions = {
  query: "",
  state: "all",
  section: "",
  sort: "source",
  direction: "asc",
};

const entries: ScheduleExplorerEntry[] = [
  {
    row: { item: "Balança 10", jan: "Programado" },
    sourceIndex: 0,
    item: "Balança 10",
    section: "Calibração",
    status: "",
    details: ["Laboratório Norte"],
    periods: ["Programado"],
    states: ["planned"],
  },
  {
    row: { item: "Balança 2", jan: 4 },
    sourceIndex: 1,
    item: "Balança 2",
    section: "Inspeção",
    status: "",
    details: ["Recife"],
    periods: ["4"],
    states: ["neutral"],
  },
  {
    row: { item: "Torneira", jan: "Não conforme" },
    sourceIndex: 2,
    item: "Torneira",
    section: "Inspeção",
    status: "Atenção",
    details: ["Área sul"],
    periods: ["Não conforme"],
    states: ["failed"],
  },
];

describe("exploração do cronograma", () => {
  it("busca em item, seção, situação e detalhes sem diferenciar acentos", () => {
    expect(exploreScheduleRows(entries, { ...options, query: "calibracao" })).toHaveLength(1);
    expect(exploreScheduleRows(entries, { ...options, query: "recife" })[0]?.item).toBe(
      "Balança 2",
    );
    expect(exploreScheduleRows(entries, { ...options, query: "nao conforme" })[0]?.item).toBe(
      "Torneira",
    );
  });

  it("combina filtros de situação e seção", () => {
    expect(
      exploreScheduleRows(entries, { ...options, state: "failed", section: "Inspeção" }).map(
        (entry) => entry.item,
      ),
    ).toEqual(["Torneira"]);
  });

  it("não inclui número isolado no filtro de realizado", () => {
    expect(
      exploreScheduleRows(entries, { ...options, state: "done" }).map((entry) => entry.item),
    ).not.toContain("Balança 2");
    expect(
      exploreScheduleRows(entries, { ...options, state: "neutral" }).map((entry) => entry.item),
    ).toEqual(["Balança 2"]);
  });

  it("ordena naturalmente e preserva a origem para desempates", () => {
    expect(
      exploreScheduleRows(entries, { ...options, sort: "item" }).map((entry) => entry.item),
    ).toEqual(["Balança 2", "Balança 10", "Torneira"]);
    expect(
      exploreScheduleRows(entries, { ...options, sort: "source", direction: "desc" }).map(
        (entry) => entry.sourceIndex,
      ),
    ).toEqual([2, 1, 0]);
  });
});
