import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  detectDelimiter,
  readWorkbookBytes,
  validateWorkbookComplexity,
} from "@/lib/workbook-reader";

describe("leitor universal de planilhas", () => {
  it("bloqueia dimensões abusivas declaradas pelo arquivo", () => {
    expect(() =>
      validateWorkbookComplexity({
        SheetNames: ["Dados"],
        Sheets: { Dados: { "!ref": "A1:XFD1048576" } },
      }),
    ).toThrow("2 milhões de células");
  });
  it("detecta separadores sem contar delimitadores dentro de campos entre aspas", () => {
    expect(detectDelimiter('produto;observação;valor\nBolo;"doce, caseiro";12,50')).toBe(";");
    expect(detectDelimiter("produto\tvalor\nBolo\t12")).toBe("\t");
    expect(detectDelimiter("produto|valor\nBolo|12")).toBe("|");
    expect(detectDelimiter("Produto;Valor\nA;1.234,50\nB;2.000,00")).toBe(";");
  });

  it("lê CSV brasileiro em Windows-1252 preservando acentos e normalizando decimal", () => {
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
      valor: 1234.5,
    });
  });

  it("não confunde vírgulas decimais com o separador do CSV brasileiro", () => {
    const source = "Produto;Valor\nA;1.234,50\nB;2.000,00";
    const [sheet] = readWorkbookBytes(new TextEncoder().encode(source), "valores.csv");
    expect(sheet?.rows).toEqual([
      { Produto: "A", Valor: 1234.5 },
      { Produto: "B", Valor: 2000 },
    ]);
  });

  it("preserva hora do Excel sem convertê-la em 31/12/1899", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([["Hora"], [0.5]]);
    worksheet.A2!.z = "hh:mm";
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Horários");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const [sheet] = readWorkbookBytes(bytes, "horarios.xlsx");
    expect(sheet?.rows).toEqual([{ Hora: "12:00" }]);
  });

  it("preserva duração acima de 24 horas usando o formato exibido no Excel", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([["Duração"], [1.5]]);
    worksheet.A2!.z = "[h]:mm";
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Durações");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const [sheet] = readWorkbookBytes(bytes, "duracoes.xlsx");
    expect(sheet?.rows).toEqual([{ Duração: "36:00" }]);
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
