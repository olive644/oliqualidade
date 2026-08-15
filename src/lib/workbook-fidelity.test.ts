import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import * as XLSX from "xlsx";

import { sheetToRows } from "@/lib/import";
import { measureWorkbookFidelity } from "@/lib/fidelity-meter";
import { compareAndRepairWithOoxml, inspectOoxml } from "@/lib/ooxml-reader";
import { verifyWorkbookWithExcelJs } from "@/lib/workbook-verifier";
import { worksheetCellAtAddress } from "@/lib/worksheet-cell";

describe("fidelidade entre leitores independentes", () => {
  const bytes = readFileSync("test-fixtures/problematic-import.xlsx");

  it("lê o pacote OOXML diretamente e preserva endereços", () => {
    const fallback = inspectOoxml(bytes);
    expect(fallback.sheets.get("Cabeçalho deslocado")?.get("A4")?.rawValue).toBe("Data");
    expect(fallback.workbook.SheetNames).toContain("Regiões lado a lado");
    expect(fallback.structures.get("Cabeçalho deslocado")).toEqual({
      mergedRanges: ["A1:F1"],
      hiddenRows: [2],
      hiddenColumns: [{ start: 3, end: 3 }],
    });
    expect(fallback.workbook.Sheets["Cabeçalho deslocado"]?.["!merges"]).toHaveLength(1);
    expect(fallback.workbook.Sheets["Cabeçalho deslocado"]?.["!cols"]?.[2]?.hidden).toBe(true);
  });

  it("compara SheetJS com OOXML célula a célula", () => {
    const primary = XLSX.read(bytes, {
      type: "buffer",
      cellDates: true,
      cellNF: true,
      cellText: true,
    });
    const divergences = compareAndRepairWithOoxml(primary, inspectOoxml(bytes));
    expect(divergences.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("restaura uma aba inteira ausente e registra cada célula recuperada", () => {
    const inspection = inspectOoxml(bytes);
    const missingSheet = "Cabeçalho deslocado";
    const retainedSheet = inspection.workbook.SheetNames.at(-1)!;
    const primary: XLSX.WorkBook = {
      SheetNames: [retainedSheet],
      Sheets: { [retainedSheet]: inspection.workbook.Sheets[retainedSheet]! },
    };

    const divergences = compareAndRepairWithOoxml(primary, inspection);

    expect(primary.SheetNames).toEqual(inspection.workbook.SheetNames);
    expect(primary.SheetNames.filter((name) => name === missingSheet)).toHaveLength(1);
    expect(worksheetCellAtAddress(primary.Sheets[missingSheet]!, "A4")?.v).toBe("Data");
    expect(divergences).toContainEqual(
      expect.objectContaining({
        sheet: missingSheet,
        address: "A4",
        primary: "",
        independent: "Data",
        severity: "error",
        repaired: true,
      }),
    );
  });

  it("usa ExcelJS como terceiro leitor independente nos testes", async () => {
    const primary = XLSX.read(bytes, {
      type: "buffer",
      cellDates: true,
      cellNF: true,
      cellText: true,
    });
    const divergences = await verifyWorkbookWithExcelJs(bytes, primary);
    expect(divergences.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("o workbook de fallback alimenta o importador normal", () => {
    const fallback = inspectOoxml(bytes);
    const sheet = fallback.workbook.Sheets["Cabeçalho deslocado"];
    expect(sheet).toBeDefined();
    expect(sheetToRows(sheet!).rows.length).toBeGreaterThanOrEqual(4);
  });

  it("mede fidelidade celular com meta mínima explícita de 99%", async () => {
    const report = await measureWorkbookFidelity(bytes);
    expect(report.readers).toEqual(["SheetJS", "OOXML", "ExcelJS"]);
    expect(report.sourceCells).toBeGreaterThan(20);
    expect(report.score).toBeGreaterThanOrEqual(99);
  });

  it("expõe avisos e recursos não suportados sem alterar a pontuação", async () => {
    const report = await measureWorkbookFidelity(bytes);
    // Avisos (severidade "warning") não entram no denominador de erro, mas
    // não podem mais desaparecer silenciosamente do relatório.
    expect(Array.isArray(report.warnings)).toBe(true);
    for (const warning of report.warnings) expect(warning.severity).toBe("warning");
    for (const divergence of report.divergences) expect(divergence.severity).toBe("error");
    // "Não suportado" é um estado explícito, não uma redução silenciosa da nota.
    expect(report.unsupportedFeatures.length).toBeGreaterThan(0);
    expect(report.unsupportedFeatures).toContain("Macros VBA");
  });

  it("não transforma célula autocontida de estilo no valor da célula seguinte", () => {
    const bytes = zipSync({
      "xl/workbook.xml": strToU8(
        '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Teste" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/sharedStrings.xml": strToU8("<sst><si><t>valor real</t></si></sst>"),
      "xl/styles.xml": strToU8(
        '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="0"/></cellXfs></styleSheet>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><dimension ref="A1:B1"/><sheetData><row r="1"><c r="A1" s="1"/><c r="B1" t="s"><v>0</v></c></row></sheetData></worksheet>',
      ),
    });
    const inspection = inspectOoxml(bytes);
    expect(inspection.sheets.get("Teste")?.get("A1")?.rawValue).toBeNull();
    expect(inspection.sheets.get("Teste")?.get("B1")?.rawValue).toBe("valor real");

    const denseSheet = { "!data": [[]], "!ref": "A1:B1" } as unknown as XLSX.WorkSheet;
    const primary: XLSX.WorkBook = {
      SheetNames: ["Teste"],
      Sheets: { Teste: denseSheet },
    };
    const divergences = compareAndRepairWithOoxml(primary, inspection);
    expect(divergences.some((item) => item.address === "B1" && item.repaired)).toBe(true);
    expect(worksheetCellAtAddress(denseSheet, "B1")?.v).toBe("valor real");
  });
});
