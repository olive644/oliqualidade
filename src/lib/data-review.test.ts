import { describe, expect, it } from "vitest";
import { auditEntry, parseEditedValue, suggestCorrection } from "@/lib/data-review";

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
});
