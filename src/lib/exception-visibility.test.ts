import { describe, expect, it } from "vitest";
import { markSourceRows } from "@/lib/data-review";
import { exceptionsWithinVisibleRows, visibleSourceRowNumbers } from "@/lib/exception-visibility";
import type { Row } from "@/lib/types";

const planilha: Row[] = [
  { produto: "A", valor: 10 },
  { produto: "B", valor: 20 },
  { produto: "C", valor: 30 },
  { produto: "D", valor: 40 },
];

/** As linhas como chegam ao painel: com o rastro da posição original. */
const todas = markSourceRows(planilha);

const pendencias = [{ id: "p1", rowIndex: 1 }, { id: "p2", rowIndex: 3 }, { id: "p3" }];

describe("visibleSourceRowNumbers", () => {
  it("traduz posição base 0 para número de linha base 1", () => {
    expect([...visibleSourceRowNumbers(todas)]).toEqual([1, 2, 3, 4]);
  });

  it("ignora linha sem rastro de origem", () => {
    const derivada: Row = { produto: "Bloco unificado", valor: 100 };
    expect([...visibleSourceRowNumbers([...todas.slice(0, 2), derivada])]).toEqual([1, 2]);
  });

  it("devolve conjunto vazio quando o filtro não deixou nenhuma linha", () => {
    expect(visibleSourceRowNumbers([]).size).toBe(0);
  });
});

describe("exceptionsWithinVisibleRows", () => {
  it("mantém tudo quando nenhum filtro está ativo", () => {
    expect(exceptionsWithinVisibleRows(pendencias, todas).map((p) => p.id)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
  });

  it("descarta a pendência cuja linha o filtro escondeu", () => {
    // Filtro que deixou só as duas primeiras linhas: a pendência da linha 3
    // some, a da linha 1 fica.
    const visiveis = todas.slice(0, 2);
    expect(exceptionsWithinVisibleRows(pendencias, visiveis).map((p) => p.id)).toEqual([
      "p1",
      "p3",
    ]);
  });

  it("mantém pendência da planilha inteira mesmo sem nenhuma linha visível", () => {
    // Pendência sem `rowIndex` é da planilha como um todo (divergência entre
    // leitores, unidade incompatível). Nenhum filtro de linha pode escondê-la,
    // nem o filtro que não deixou linha nenhuma passar.
    expect(exceptionsWithinVisibleRows(pendencias, []).map((p) => p.id)).toEqual(["p3"]);
  });

  it("não confunde posição com número de linha", () => {
    // A linha de posição 0 é a linha 1. Se a soma de 1 sumisse, a pendência
    // da linha 1 seria comparada com a posição 1 (a segunda linha) e este
    // caso passaria a devolver a pendência errada.
    const soPrimeiraLinha = todas.slice(0, 1);
    expect(exceptionsWithinVisibleRows(pendencias, soPrimeiraLinha).map((p) => p.id)).toEqual([
      "p1",
      "p3",
    ]);
  });
});
