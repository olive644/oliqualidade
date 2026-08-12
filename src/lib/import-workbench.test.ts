import { describe, expect, it } from "vitest";
import {
  applyImportSelection,
  compareVersions,
  rowsFromSourceGrid,
  workbookSignature,
} from "./import-workbench";

describe("import workbench", () => {
  it("aplica intervalo e colunas ignoradas sem alterar a origem", () => {
    const rows = [
      { id: 1, nome: "A" },
      { id: 2, nome: "B" },
      { id: 3, nome: "C" },
    ];
    expect(applyImportSelection(rows, { startRow: 2, endRow: 3, ignoredColumns: ["id"] })).toEqual([
      { nome: "B" },
      { nome: "C" },
    ]);
    expect(rows[1]).toEqual({ id: 2, nome: "B" });
  });

  it("reconstrói a tabela escolhendo cabeçalho e região na grade original", () => {
    const grid = {
      startRow: 5,
      startColumn: 2,
      totalRows: 6,
      totalColumns: 5,
      rows: [
        ["Relatório", null, null, null, null],
        ["Data", "Poço", "Torre", "Rodapé", null],
        ["01/08/2026", 1, 2, "ignorar", null],
        ["02/08/2026", 3, 4, "ignorar", null],
        [null, null, null, null, null],
        ["Observação", null, null, null, null],
      ],
      truncatedRows: false,
      truncatedColumns: false,
    };
    expect(
      rowsFromSourceGrid(grid, {
        headerRow: 6,
        startRow: 7,
        endRow: 9,
        startColumn: 2,
        endColumn: 4,
      }),
    ).toEqual([
      { Data: "01/08/2026", Poço: 1, Torre: 2 },
      { Data: "02/08/2026", Poço: 3, Torre: 4 },
    ]);
  });

  it("não aplica seleção fora da parte preservada da grade", () => {
    const grid = {
      startRow: 1,
      startColumn: 1,
      totalRows: 2_000,
      totalColumns: 2,
      rows: [["A", "B"]],
      truncatedRows: true,
      truncatedColumns: false,
    };
    expect(
      rowsFromSourceGrid(grid, {
        headerRow: 1,
        startRow: 2,
        endRow: 2_000,
        startColumn: 1,
        endColumn: 2,
      }),
    ).toEqual([]);
  });

  it("gera assinatura estável e detecta mudanças de estrutura", () => {
    expect(workbookSignature([{ b: "x", a: 1 }])).toBe(workbookSignature([{ a: 2, b: "y" }]));
    const diff = compareVersions([{ id: 1, valor: 10 }], [{ id: "1", total: 10 }]);
    expect(diff.addedColumns).toEqual(["total"]);
    expect(diff.removedColumns).toEqual(["valor"]);
    expect(diff.typeChanges).toEqual([{ column: "id", before: "number", after: "string" }]);
  });

  it("não transforma uma troca de cabeçalho em todas as linhas adicionadas e removidas", () => {
    const previous = Array.from({ length: 794 }, (_, index) => ({
      Data: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
      Ponto: `P${index}`,
      "Torre de Processo": index,
      Resultado: index * 2,
    }));
    const next = previous.map(({ "Torre de Processo": value, ...row }) => ({
      ...row,
      "NaN/NaN/NaN": value,
    }));
    const diff = compareVersions(previous, next);
    expect(diff.status).toBe("warning");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.changed).toBe(0);
    expect(diff.invalidColumns).toEqual(["NaN/NaN/NaN"]);
    expect(diff.removedColumns).toEqual(["Torre de Processo"]);
  });

  it("detecta alteração real usando uma chave estável", () => {
    const diff = compareVersions(
      [
        { id: "A", valor: 10 },
        { id: "B", valor: 20 },
      ],
      [
        { id: "A", valor: 15 },
        { id: "C", valor: 30 },
      ],
    );
    expect(diff.comparisonMethod).toBe("key");
    expect(diff).toMatchObject({ added: 1, removed: 1, changed: 1 });
  });

  it("recusa comparação quando a estrutura não tem sobreposição suficiente", () => {
    const diff = compareVersions([{ a: 1, b: 2 }], [{ x: 1, y: 2 }]);
    expect(diff.status).toBe("incompatible");
    expect(diff).toMatchObject({ added: 0, removed: 0, changed: 0 });
  });
});
