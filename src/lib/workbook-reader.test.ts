import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { detectDelimiter, readWorkbookBytes } from "@/lib/workbook-reader";

describe("leitor universal de planilhas", () => {
  it("detecta separadores sem contar delimitadores dentro de campos entre aspas", () => {
    expect(detectDelimiter('produto;observação;valor\nBolo;"doce, caseiro";12,50')).toBe(";");
    expect(detectDelimiter("produto\tvalor\nBolo\t12")).toBe("\t");
    expect(detectDelimiter("produto|valor\nBolo|12")).toBe("|");
  });

  it("lê CSV brasileiro em Windows-1252 preservando acentos e decimal como texto", () => {
    const source = "produto;região;valor\r\nAçaí;São Paulo;1.234,50";
    const bytes = Uint8Array.from(
      [...source].map((character) => {
        const code = character.charCodeAt(0);
        const cp1252: Record<number, number> = { 227: 0xe3, 231: 0xe7, 237: 0xed };
        return cp1252[code] ?? code;
      }),
    );
    const [sheet] = readWorkbookBytes(bytes, "vendas.csv");
    expect(sheet?.rows[0]).toMatchObject({
      produto: "Açaí",
      região: "São Paulo",
      valor: "1.234,50",
    });
  });

  it.each(["xlsx", "xlsb", "ods"] as const)("lê o formato %s", (bookType) => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType });
    const [sheet] = readWorkbookBytes(bytes, `vendas.${bookType}`);
    expect(sheet?.rows).toEqual([{ Produto: "Bolo", Valor: 42 }]);
  });

  it("preserva valor bruto, exibição e formato de células relevantes", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([["Taxa"], [0.125]]);
    worksheet.A2!.z = "0.0%";
    worksheet.A2!.w = "12.5%";
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Indicadores");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const [sheet] = readWorkbookBytes(bytes, "indicadores.xlsx");
    expect(sheet?.rows[0]?.Taxa).toBe(0.125);
    expect(sheet?.diagnostics?.sourceCellRepresentations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: "A2",
          rawValue: 0.125,
          displayValue: "12.5%",
          numberFormat: "0.0%",
        }),
      ]),
    );
  });
});
