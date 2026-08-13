import { describe, expect, it } from "vitest";
import {
  applyCellEdit,
  auditEntry,
  parseEditedValue,
  markSourceRows,
  recordUndo,
  sourceRowIndexOf,
  stepRedo,
  stepUndo,
  suggestCorrection,
} from "@/lib/data-review";

describe("revisão e correção de dados", () => {
  it("preserva zero, falso e converte números brasileiros", () => {
    expect(
      parseEditedValue("0", {
        key: "v",
        label: "Valor",
        kind: "number",
        visible: true,
        description: "",
      }),
    ).toBe(0);
    expect(parseEditedValue("false")).toBe(false);
    expect(
      parseEditedValue("-25%", {
        key: "p",
        label: "Percentual",
        kind: "percentage",
        visible: true,
        description: "",
      }),
    ).toBe(-0.25);
    expect(
      parseEditedValue("1.234,50", {
        key: "v",
        label: "Valor",
        kind: "currency",
        visible: true,
        description: "",
      }),
    ).toBe(1234.5);
  });

  it("sugere correção explicável sem inventar outro valor", () => {
    expect(
      suggestCorrection(
        {
          id: "x",
          kind: "outlier",
          severity: "info",
          title: "Fora",
          detail: "",
          columnKey: "v",
          value: " 12 ",
        },
        { key: "v", label: "Valor", kind: "number", visible: true, description: "" },
      ),
    ).toEqual({ value: "12", reason: "Normalizar o valor para o formato numérico da coluna." });
  });

  it("cria evento de auditoria estável", () => {
    expect(
      auditEntry({ action: "exception-resolved", exceptionId: "x", reason: "revisado" }, 10),
    ).toMatchObject({ id: "x-10", timestamp: 10 });
  });

  it("edita somente a célula indicada e mantém a origem imutável", () => {
    const original = [
      { nome: "A", valor: 4 },
      { nome: "B", valor: false },
    ];
    const edited = applyCellEdit(original, 1, "valor", 0);
    expect(edited).toEqual([
      { nome: "A", valor: 4 },
      { nome: "B", valor: 0 },
    ]);
    expect(original).toEqual([
      { nome: "A", valor: 4 },
      { nome: "B", valor: false },
    ]);
  });

  it("desfaz e refaz dados junto com a trilha de auditoria", () => {
    const before = { rows: [{ resultado: 4 }], audit: [] as string[] };
    const after = { rows: [{ resultado: 0 }], audit: ["4 → 0"] };
    const recorded = recordUndo({ undo: [], redo: [] }, before);
    const undone = stepUndo(recorded, after);
    expect(undone?.next).toEqual(before);
    const redone = undone ? stepRedo(undone.history, undone.next) : null;
    expect(redone?.next).toEqual(after);
  });

  it("mantém a linha de origem após filtrar, ordenar e clonar", () => {
    const marked = markSourceRows([{ nome: "B" }, { nome: "A" }, { nome: "C" }]);
    const visible = marked
      .filter((row) => row["nome"] !== "B")
      .sort((a, b) => String(a["nome"]).localeCompare(String(b["nome"])))
      .map((row) => ({ ...row }));
    expect(visible.map(sourceRowIndexOf)).toEqual([1, 2]);
    expect(Object.keys(visible[0] ?? {})).toEqual(["nome"]);
  });
});
