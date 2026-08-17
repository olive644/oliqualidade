import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import * as XLSX from "xlsx";

import { sheetToRows } from "@/lib/import";
import { measureWorkbookFidelity } from "@/lib/fidelity-meter";
import { compareAndRepairWithOoxml, inspectOoxml } from "@/lib/ooxml-reader";
import { verifyWorkbookWithExcelJs } from "@/lib/workbook-verifier";
import { worksheetCellAtAddress } from "@/lib/worksheet-cell";

function minimalWorkbookPackage(sharedStringXml: string): Uint8Array {
  return zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Teste" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/sharedStrings.xml": strToU8(sharedStringXml),
    "xl/worksheets/sheet1.xml": strToU8(
      '<worksheet><dimension ref="A1"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>',
    ),
  });
}

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
    expect(report.unsupportedFeatures.some((feature) => feature.startsWith("Macros VBA"))).toBe(
      true,
    );
  });

  it("concatena os trechos de shared string rich text (múltiplos <r>)", () => {
    // Uma string rica no Excel ("negrito" + "normal" na mesma célula) grava
    // um <r> (run) por trecho de formatação diferente, cada um com seu
    // próprio <t>. O leitor precisa juntar todos os trechos de um mesmo
    // <si>, não só o primeiro <t>.
    const bytes = minimalWorkbookPackage(
      "<sst><si><r><rPr><b/></rPr><t>Alerta: </t></r><r><t>limite excedido</t></r></si></sst>",
    );
    const inspection = inspectOoxml(bytes);
    expect(inspection.sheets.get("Teste")?.get("A1")?.rawValue).toBe("Alerta: limite excedido");
  });

  it("decodifica referências numéricas de caractere no texto OOXML", () => {
    // Algumas ferramentas exportam XLSX com acentos como &#199; (decimal) ou
    // &#xC7; (hex) em vez do caractere UTF-8 direto. Isso é XML válido e
    // apareceu em arquivos reais; o leitor independente não pode devolver o
    // texto cru da entidade como se fosse o conteúdo da célula.
    const bytes = minimalWorkbookPackage(
      "<sst><si><t>SOLICITA&#199;&#213;ES / &#xE9; v&#xE1;lido &amp; escapado &amp;#38;</t></si></sst>",
    );
    const inspection = inspectOoxml(bytes);
    expect(inspection.sheets.get("Teste")?.get("A1")?.rawValue).toBe(
      "SOLICITAÇÕES / é válido & escapado &#38;",
    );
  });

  it("normaliza \\r\\n para \\n no texto OOXML, como o SheetJS já faz", () => {
    // Texto multilinha (xml:space="preserve") de um arquivo real gerado no
    // Windows guarda \r\n literal no XML. O SheetJS normaliza para \n na
    // leitura; sem a mesma normalização aqui, o mesmo texto virava uma
    // divergência de severidade "warning" entre os dois leitores só por
    // causa do fim de linha — 9 falsos positivos num arquivo real, todos
    // pelo mesmo motivo. Ver seção 77 do CURRENT_STATE_AUDIT.md.
    const bytes = minimalWorkbookPackage(
      '<sst><si><t xml:space="preserve">Linha 1\r\nLinha 2</t></si></sst>',
    );
    const inspection = inspectOoxml(bytes);
    expect(inspection.sheets.get("Teste")?.get("A1")?.rawValue).toBe("Linha 1\nLinha 2");

    const primary: XLSX.WorkBook = {
      SheetNames: ["Teste"],
      Sheets: {
        Teste: {
          "!ref": "A1:A1",
          A1: { t: "s", v: "Linha 1\nLinha 2" } as XLSX.CellObject,
        },
      },
    };
    const divergences = compareAndRepairWithOoxml(primary, inspection);
    expect(divergences).toEqual([]);
  });

  it("respeita workbookPr date1904 ao converter datas seriais no leitor OOXML", () => {
    // O inventário OOXML independente (usado para reconciliação e como
    // referência do shadow mode) nunca lia `workbookPr date1904` e sempre
    // assumia o sistema 1900. Num arquivo de origem Mac (1904), isso
    // produzia datas ~4 anos erradas silenciosamente.
    const packageFor = (date1904: string) =>
      zipSync({
        "xl/workbook.xml": strToU8(
          `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${date1904}"/><sheets><sheet name="Teste" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        ),
        "xl/_rels/workbook.xml.rels": strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        ),
        "xl/styles.xml": strToU8(
          '<styleSheet><cellXfs count="1"><xf numFmtId="14"/></cellXfs></styleSheet>',
        ),
        "xl/worksheets/sheet1.xml": strToU8(
          '<worksheet><dimension ref="A1"/><sheetData><row r="1"><c r="A1" s="0"><v>1</v></c></row></sheetData></worksheet>',
        ),
      });

    const inspection1900 = inspectOoxml(packageFor("0"));
    expect(inspection1900.sheets.get("Teste")?.get("A1")?.displayValue).toBe("1/1/00");
    const materialized1900 = inspection1900.workbook.Sheets["Teste"]?.["A1"] as XLSX.CellObject;
    expect(materialized1900.v).toBeInstanceOf(Date);
    expect((materialized1900.v as Date).toISOString().slice(0, 10)).toBe("1900-01-01");

    const inspection1904 = inspectOoxml(packageFor("1"));
    expect(inspection1904.sheets.get("Teste")?.get("A1")?.displayValue).toBe("1/2/04");
    const materialized1904 = inspection1904.workbook.Sheets["Teste"]?.["A1"] as XLSX.CellObject;
    expect(materialized1904.v).toBeInstanceOf(Date);
    expect((materialized1904.v as Date).toISOString().slice(0, 10)).toBe("1904-01-02");
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
