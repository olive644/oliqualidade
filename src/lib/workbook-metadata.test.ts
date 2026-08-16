import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { diagnoseImportedSheet } from "@/lib/import-intelligence";
import { attachWorkbookFeatures, inspectWorkbookFeatures } from "@/lib/workbook-metadata";

const xml = (value: string) => strToU8(value);

function advancedWorkbookPackage() {
  return zipSync({
    "xl/workbook.xml": xml(
      '<workbook xmlns:r="r"><sheets><sheet name="Vendas" r:id="rId1"/><sheet name="Resumo" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Vendas!$A$1:$C$5</definedName><definedName name="PrecoBase">Vendas!$D$1</definedName><definedName name="MetaLocal" localSheetId="0">Vendas!$E$1</definedName></definedNames><externalReferences><externalReference r:id="rIdExternal"/></externalReferences></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": xml(
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rIdExternal" Type="externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>',
    ),
    "xl/externalLinks/_rels/externalLink1.xml.rels": xml(
      '<Relationships><Relationship Id="rId1" Type="externalLinkPath" Target="https://exemplo.com/planilha-externa.xlsx" TargetMode="External"/></Relationships>',
    ),
    "xl/worksheets/sheet2.xml": xml('<worksheet xmlns:r="r"/>'),
    "xl/worksheets/sheet1.xml": xml(
      '<worksheet xmlns:r="r"><autoFilter ref="A1:C5"/><dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="B2:B10" promptTitle="Selecione o nível" prompt="Escolha uma das opções da lista"><formula1>"Baixo,Médio,Alto"</formula1></dataValidation></dataValidations><hyperlinks><hyperlink ref="A2" r:id="rIdLink" tooltip="Abrir &amp; revisar"/><hyperlink ref="B2" location="Resumo!A1"/></hyperlinks><tableParts><tablePart r:id="rIdTable"/></tableParts><pivotTableDefinition r:id="rIdPivot"/></worksheet>',
    ),
    "xl/worksheets/_rels/sheet1.xml.rels": xml(
      '<Relationships><Relationship Id="rIdTable" Type="table" Target="../tables/table1.xml"/><Relationship Id="rIdPivot" Type="pivotTable" Target="../pivotTables/pivotTable1.xml"/><Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/revisao?a=1&amp;b=2" TargetMode="External"/><Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/></Relationships>',
    ),
    "xl/tables/table1.xml": xml(
      '<table name="VendasTabela" displayName="VendasTabela" ref="A1:C5"><tableColumns><tableColumn id="1" name="Produto"/><tableColumn id="2" name="Quantidade"/><tableColumn id="3" name="Total"><calculatedColumnFormula>[@Quantidade]*10</calculatedColumnFormula></tableColumn></tableColumns></table>',
    ),
    "xl/pivotTables/pivotTable1.xml": xml(
      '<pivotTableDefinition name="ResumoVendas"><location ref="E3:H12"/></pivotTableDefinition>',
    ),
    "xl/comments1.xml": xml(
      '<comments><authors><author>Ana &amp; João</author></authors><commentList><comment ref="C2" authorId="0"><text><r><t>Conferir </t></r><r><t>total</t></r></text></comment></commentList></comments>',
    ),
  });
}

describe("metadados avançados de XLSX", () => {
  it("detecta tabelas estruturadas, colunas calculadas e Pivot Tables", () => {
    const metadata = inspectWorkbookFeatures(advancedWorkbookPackage()).get("Vendas");
    expect(metadata?.structuredTables).toEqual([
      {
        name: "VendasTabela",
        range: "A1:C5",
        columns: ["Produto", "Quantidade", "Total"],
        calculatedColumns: ["Total"],
      },
    ]);
    expect(metadata?.pivotTables).toEqual([{ name: "ResumoVendas", range: "E3:H12" }]);
    expect(metadata?.autoFilterRange).toBe("A1:C5");
    expect(metadata?.comments).toEqual([
      { address: "C2", author: "Ana & João", text: "Conferir total" },
    ]);
    expect(metadata?.hyperlinks).toEqual([
      {
        address: "A2",
        target: "https://example.com/revisao?a=1&b=2",
        tooltip: "Abrir & revisar",
      },
      { address: "B2", target: "#Resumo!A1" },
    ]);
    expect(metadata?.dataValidations).toEqual([
      {
        range: "B2:B10",
        type: "list",
        allowBlank: true,
        formula1: '"Baixo,Médio,Alto"',
        promptTitle: "Selecione o nível",
        prompt: "Escolha uma das opções da lista",
      },
    ]);
  });

  it("expõe nomes definidos por escopo e referências a arquivos externos, ignorando nomes internos do Excel", () => {
    const metadata = inspectWorkbookFeatures(advancedWorkbookPackage());
    expect(metadata.get("Vendas")?.definedNames).toEqual([
      { name: "PrecoBase", refersTo: "Vendas!$D$1", scope: null },
      { name: "MetaLocal", refersTo: "Vendas!$E$1", scope: "Vendas" },
    ]);
    expect(metadata.get("Resumo")?.definedNames).toEqual([
      { name: "PrecoBase", refersTo: "Vendas!$D$1", scope: null },
    ]);
    expect(metadata.get("Vendas")?.externalLinks).toEqual([
      { target: "https://exemplo.com/planilha-externa.xlsx" },
    ]);
  });

  it("integra os metadados ao diagnóstico sem alterar os dados", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Produto", "Quantidade", "Total"],
      ["A", 2, 20],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    attachWorkbookFeatures(workbook, advancedWorkbookPackage());

    expect(worksheet["!autofilter"]).toEqual({ ref: "A1:C5" });
    expect(worksheet["A2"]?.l).toEqual({
      Target: "https://example.com/revisao?a=1&b=2",
      Tooltip: "Abrir & revisar",
    });
    expect(worksheet["B2"]?.l).toEqual({ Target: "#Resumo!A1" });
    expect(worksheet["C2"]?.c).toEqual([{ a: "Ana & João", t: "Conferir total" }]);

    const diagnostics = diagnoseImportedSheet(worksheet, [
      { Produto: "A", Quantidade: 2, Total: 20 },
    ]);
    expect(diagnostics.hasTables).toBe(true);
    expect(diagnostics.structuredTableNames).toEqual(["VendasTabela"]);
    expect(diagnostics.calculatedColumns).toEqual(["Total"]);
    expect(diagnostics.pivotTables[0]?.name).toBe("ResumoVendas");
    expect(diagnostics.warnings.some((warning) => warning.includes("Pivot Table"))).toBe(true);
  });

  it("mantém o workbook utilizável quando os metadados avançados não podem ser lidos", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Valor"], [10]]), "Dados");
    expect(attachWorkbookFeatures(workbook, new Uint8Array([1, 2, 3]))).toBe(workbook);
    expect(workbook.Sheets["Dados"]?.["A2"]?.v).toBe(10);
  });
});
