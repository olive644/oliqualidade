import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import * as XLSX from "xlsx";

import { sanitizeWorkbookBytes } from "../../scripts/workbook-sanitizer.mjs";

function sensitiveWorkbook() {
  const workbook = XLSX.utils.book_new();
  const main = XLSX.utils.aoa_to_sheet(
    [
      ["Nome", "Email", "Salário", "Data", "Ativo", "Cálculo"],
      ["Maria da Silva", "maria@example.com", 12345.67, new Date("2025-04-03T00:00:00Z"), true],
    ],
    { cellDates: true },
  );
  main["F2"] = { t: "n", v: 24691.34, f: "C2*2" };
  main["A2"]!.l = { Target: "https://example.com/cliente/maria" };
  main["B2"]!.c = [{ a: "Operador", t: "CPF 123.456.789-00" }];
  main["!merges"] = [XLSX.utils.decode_range("A3:B3")];
  main["!rows"] = [{}, { hidden: true }];
  main["!cols"] = [{}, { hidden: true }];
  const detail = XLSX.utils.aoa_to_sheet([["Segredo interno"], [42]]);
  detail["B2"] = { t: "s", v: "cache", f: "'Clientes ACME'!A2&\" confidencial\"" };
  detail["!ref"] = "A1:B2";
  XLSX.utils.book_append_sheet(workbook, main, "Clientes ACME");
  XLSX.utils.book_append_sheet(workbook, detail, "Detalhes");
  workbook.Props = { Author: "Pessoa Real", Company: "Empresa Confidencial" };
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

describe("sanitizador local de corpus", () => {
  it("remove conteúdo sensível e preserva estruturas de paridade", () => {
    const result = sanitizeWorkbookBytes(sensitiveWorkbook(), {
      salt: "chave-local-de-teste-123",
      workbookId: "fixture",
    });
    const workbook = XLSX.read(result.bytes, { type: "buffer", cellDates: true, cellStyles: true });
    const main = workbook.Sheets["SHEET_001"]!;
    const detail = workbook.Sheets["SHEET_002"]!;

    expect(workbook.SheetNames).toEqual(["SHEET_001", "SHEET_002"]);
    expect(main["A2"]!.v).toMatch(/^TXT_[A-F0-9]{16}$/);
    expect(main["B2"]!.v).toMatch(/^TXT_[A-F0-9]{16}$/);
    expect(main["C2"]!.t).toBe("n");
    expect(main["C2"]!.v).not.toBe(12345.67);
    expect(main["D2"]!.t).toBe("d");
    expect(main["E2"]!.v).toBe(true);
    expect(main["F2"]!.f).toBe("C2*2");
    expect(main["A2"]!.l).toBeUndefined();
    expect(main["B2"]!.c).toBeUndefined();
    expect(main["!merges"]).toEqual([XLSX.utils.decode_range("A3:B3")]);
    expect(main["!rows"]?.[1]?.hidden).toBe(true);
    expect(main["!cols"]?.[1]?.hidden).toBe(true);
    expect(detail["B2"]!.f).toMatch(/^'SHEET_001'!A2&"TXT_[A-F0-9]{16}"$/);
    expect(JSON.stringify(workbook)).not.toContain("Maria da Silva");
    expect(JSON.stringify(workbook)).not.toContain("maria@example.com");
    expect(JSON.stringify(workbook)).not.toContain("Pessoa Real");
    expect(JSON.stringify(workbook)).not.toContain("Clientes ACME");
    const packageText = Object.values(unzipSync(result.bytes))
      .map((part) => Buffer.from(part).toString("utf8"))
      .join("\n");
    expect(packageText).not.toContain("Maria da Silva");
    expect(packageText).not.toContain("maria@example.com");
    expect(packageText).not.toContain("Clientes ACME");
    expect(packageText).not.toContain("Empresa Confidencial");
    expect(result.summary.hyperlinksRemoved).toBe(1);
    expect(result.summary.commentsRemoved).toBe(1);
  });

  it("produz os mesmos pseudônimos com a mesma chave e rejeita chave fraca", () => {
    const input = sensitiveWorkbook();
    const first = sanitizeWorkbookBytes(input, { salt: "chave-local-de-teste-123" });
    const second = sanitizeWorkbookBytes(input, { salt: "chave-local-de-teste-123" });
    const firstBook = XLSX.read(first.bytes, { type: "buffer" });
    const secondBook = XLSX.read(second.bytes, { type: "buffer" });
    expect(firstBook.Sheets["SHEET_001"]!["A2"]!.v).toBe(secondBook.Sheets["SHEET_001"]!["A2"]!.v);
    expect(() => sanitizeWorkbookBytes(input, { salt: "curta" })).toThrow(/16 caracteres/);
  });

  it("neutraliza fórmulas com referências externas", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([[1]]);
    sheet["B1"] = { t: "n", v: 7, f: "'[arquivo.xlsx]Dados'!A1" };
    sheet["C1"] = { t: "n", v: 8, f: "ClienteVIP*2" };
    sheet["!ref"] = "A1:C1";
    XLSX.utils.book_append_sheet(workbook, sheet, "Dados");
    workbook.Workbook = { Names: [{ Name: "ClienteVIP", Ref: "Dados!$A$1" }] };
    const result = sanitizeWorkbookBytes(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      { salt: "chave-local-de-teste-123" },
    );
    const sanitized = XLSX.read(result.bytes, { type: "buffer" });
    expect(sanitized.Sheets["SHEET_001"]!["B1"]!.f).toBe("0");
    expect(sanitized.Sheets["SHEET_001"]!["C1"]!.f).toBe("0");
    expect(JSON.stringify(sanitized)).not.toContain("ClienteVIP");
  });
});
