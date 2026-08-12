import { describe, expect, it } from "vitest";
import { applyImportSelection, compareVersions, workbookSignature } from "./import-workbench";

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

  it("gera assinatura estável e detecta mudanças de estrutura", () => {
    expect(workbookSignature([{ b: "x", a: 1 }])).toBe(workbookSignature([{ a: 2, b: "y" }]));
    const diff = compareVersions([{ id: 1, valor: 10 }], [{ id: "1", total: 10 }]);
    expect(diff.addedColumns).toEqual(["total"]);
    expect(diff.removedColumns).toEqual(["valor"]);
    expect(diff.typeChanges).toEqual([{ column: "id", before: "number", after: "string" }]);
  });
});
