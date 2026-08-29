import { describe, expect, it } from "vitest";

import { migrateDashboard } from "@/lib/dashboard";
import { createWidget } from "@/lib/widgets";
import type { Column, Row, Widget } from "@/lib/types";

/**
 * Um widget configurado pela pessoa precisa sobreviver a recarregar o painel.
 *
 * `repairInvalidWidgets` existe para consertar painéis salvos cuja planilha
 * mudou: se um widget aponta para uma coluna que não existe mais, ele sai e o
 * painel volta a ter um conjunto que funciona. A regra que decide isso,
 * `widgetCompatible`, exigia `groupKey` de todo tipo sem ramo próprio.
 *
 * Histograma e dispersão não têm `groupKey` por definição, e o próprio
 * `createWidget` diz isso em comentário. O resultado é que eles eram julgados
 * incompatíveis com a planilha que os originou, e o conserto os destruía.
 *
 * O teste é sobre identidade, e não sobre tipo: um histograma recomendado
 * aparecia no lugar do configurado, então "existe um histograma no painel"
 * continuava verdadeiro enquanto o trabalho da pessoa sumia.
 */

const columns: Column[] = [
  { key: "categoria", label: "Categoria", kind: "category", visible: true },
  { key: "valor", label: "Valor", kind: "number", visible: true },
  { key: "indice", label: "Índice", kind: "number", visible: true },
] as Column[];

const rows: Row[] = Array.from({ length: 30 }, (_, indice) => ({
  categoria: ["A", "B", "C"][indice % 3]!,
  valor: 10 + indice * 3,
  indice: 5 + indice,
}));

function painelCom(widgets: Widget[]) {
  return {
    id: "painel",
    name: "Painel",
    sheets: [{ name: "Aba", rows, columns, widgets }],
    activeSheetIndex: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function recarregar(widgets: Widget[]) {
  return migrateDashboard(painelCom(widgets)).sheets[0]?.widgets ?? [];
}

describe("widget configurado sobrevive ao recarregar o painel", () => {
  it("o histograma mantém id, título, coluna e faixas", () => {
    const histograma: Widget = {
      ...createWidget("histogram", columns, undefined, rows),
      id: "meu-histograma",
      title: "Distribuição escolhida por mim",
      valueKey: "indice",
      binCount: 15,
    };

    const depois = recarregar([histograma]);
    const mesmo = depois.find((widget) => widget.id === "meu-histograma");

    expect(mesmo?.title).toBe("Distribuição escolhida por mim");
    expect(mesmo?.valueKey).toBe("indice");
    expect(mesmo?.binCount).toBe(15);
  });

  it("a dispersão mantém id e os dois eixos", () => {
    const dispersao: Widget = {
      ...createWidget("scatter", columns, undefined, rows),
      id: "minha-dispersao",
      title: "Cruzamento escolhido por mim",
      valueKey: "indice",
      valueKey2: "valor",
    };

    const depois = recarregar([dispersao]);
    const mesmo = depois.find((widget) => widget.id === "minha-dispersao");

    expect(mesmo?.title).toBe("Cruzamento escolhido por mim");
    expect(mesmo?.valueKey).toBe("indice");
    expect(mesmo?.valueKey2).toBe("valor");
  });

  it("um painel só com eles não é inundado de widgets recomendados", () => {
    // O efeito colateral do conserto indevido: bastava um widget parecer
    // incompatível para a grade inteira de recomendações ser acrescentada.
    const depois = recarregar([
      { ...createWidget("histogram", columns, undefined, rows), id: "h" },
      { ...createWidget("scatter", columns, undefined, rows), id: "d" },
    ]);

    expect(depois.map((widget) => widget.id)).toEqual(["h", "d"]);
  });

  it("continua descartando o widget que aponta para coluna inexistente", () => {
    // A rede que `repairInvalidWidgets` existe para dar não pode ter afrouxado:
    // um histograma sobre uma coluna que a planilha não tem continua saindo.
    const orfao: Widget = {
      ...createWidget("histogram", columns, undefined, rows),
      id: "orfao",
      valueKey: "coluna-que-nao-existe",
    };

    const depois = recarregar([orfao]);

    expect(depois.find((widget) => widget.id === "orfao")).toBeUndefined();
  });

  it("continua descartando a dispersão cujo segundo eixo sumiu", () => {
    const meioOrfao: Widget = {
      ...createWidget("scatter", columns, undefined, rows),
      id: "meio-orfao",
      valueKey: "valor",
      valueKey2: "coluna-que-nao-existe",
    };

    const depois = recarregar([meioOrfao]);

    expect(depois.find((widget) => widget.id === "meio-orfao")).toBeUndefined();
  });

  it("continua descartando o histograma sobre coluna de texto", () => {
    const textual: Widget = {
      ...createWidget("histogram", columns, undefined, rows),
      id: "textual",
      valueKey: "categoria",
    };

    const depois = recarregar([textual]);

    expect(depois.find((widget) => widget.id === "textual")).toBeUndefined();
  });
});
