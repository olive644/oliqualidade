import { describe, expect, it } from "vitest";

import { decodeOoxmlText } from "@/lib/ooxml-reader";

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
