import { describe, expect, it } from "vitest";

import * as XLSX from "xlsx";

import { decodeOoxmlText, inspectOoxml } from "@/lib/ooxml-reader";

describe("decodeOoxmlText", () => {
  it("decodifica o escape de caractere de controle encontrado em arquivo real", () => {
    expect(decodeOoxmlText("FRS-SA_x0002_009")).toBe(`FRS-SA${String.fromCodePoint(2)}009`);
  });

  it("decodifica escapes OOXML consecutivos em uma única passada", () => {
    expect(decodeOoxmlText("_x0002__x0003_")).toBe(
      `${String.fromCodePoint(2)}${String.fromCodePoint(3)}`,
    );
  });

  it("preserva como texto um escape que o Excel marcou como literal", () => {
    expect(decodeOoxmlText("_x005F_x0002_")).toBe("_x0002_");
  });
});

describe("inspectOoxml", () => {
  it("decodifica entidades XML em formatos numéricos personalizados", () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([[888715.25]]);
    worksheet["A1"]!.z = '"R$"\\ #,##0.00';
    XLSX.utils.book_append_sheet(workbook, worksheet, "Custos");

    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const cell = inspectOoxml(bytes).sheets.get("Custos")?.get("A1");

    expect(cell?.numberFormat).toBe('"R$"\\ #,##0.00');
    // Afirmar o valor esperado, e não apenas que ele difere de um pedaço de
    // entidade: `not.toBe("&quot")` passaria para `undefined`, string vazia e
    // qualquer valor errado, o que dá aparência de cobertura sem cobrir.
    expect(cell?.displayValue).toBe("R$ 888,715.25");
  });
});
