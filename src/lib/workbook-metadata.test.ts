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
      '<worksheet xmlns:r="r"><autoFilter ref="A1:C5"/><dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="B2:B10" promptTitle="Selecione o nível" prompt="Escolha uma das opções da lista"><formula1>"Baixo,Médio,Alto"</formula1></dataValidation></dataValidations><hyperlinks><hyperlink ref="A2" r:id="rIdLink" tooltip="Abrir &amp; revisar"/><hyperlink ref="B2" location="Resumo!A1"/></hyperlinks><sheetData><row r="1"><c r="C1" s="1"><v>3</v></c><c r="D1" s="2"><v>6</v></c></row></sheetData><tableParts><tablePart r:id="rIdTable"/></tableParts><pivotTableDefinition r:id="rIdPivot"/><drawing r:id="rIdDrawing"/></worksheet>',
    ),
    "xl/worksheets/_rels/sheet1.xml.rels": xml(
      '<Relationships><Relationship Id="rIdTable" Type="table" Target="../tables/table1.xml"/><Relationship Id="rIdPivot" Type="pivotTable" Target="../pivotTables/pivotTable1.xml"/><Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/revisao?a=1&amp;b=2" TargetMode="External"/><Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    ),
    "xl/drawings/drawing1.xml": xml(
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="rIdImage1"/></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>' +
        '<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>12</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="3" name="Nota"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/><xdr:txBody><a:bodyPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Revisar totais</a:t></a:r><a:r><a:t> antes de enviar</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>' +
        '<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>13</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>14</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="4" name="Retangulo"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>' +
        '<xdr:twoCellAnchor><xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="5" name="Gráfico 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:ext cx="0" cy="0" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></xdr:xfrm><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>',
    ),
    "xl/drawings/_rels/drawing1.xml.rels": xml(
      '<Relationships><Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rIdChart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
    ),
    "xl/media/image1.png": new Uint8Array([137, 80, 78, 71]),
    "xl/charts/chart1.xml": xml(
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Tendência mensal</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart/></c:plotArea></c:chart></c:chartSpace>',
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
    "xl/vbaProject.bin": new Uint8Array([1, 2, 3]),
    "xl/styles.xml": xml(
      '<styleSheet><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor theme="0" tint="-0.15"/><bgColor indexed="64"/></patternFill></fill></fills><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="1" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/></cellXfs></styleSheet>',
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
    expect(metadata?.hasVbaMacros).toBe(true);
    expect(metadata?.images).toEqual([
      { name: "Logo", anchor: "B3", format: "PNG", dataUrl: "data:image/png;base64,iVBORw==" },
    ]);
    // "Retangulo" (sem xdr:txBody) fica de fora: sem texto, não há o que revisar.
    expect(metadata?.shapes).toEqual([
      { name: "Nota", anchor: "A11", text: "Revisar totais antes de enviar" },
    ]);
    expect(metadata?.charts).toEqual([{ type: "bar", title: "Tendência mensal", anchor: "E1" }]);
    // D1 tem cor de tema (fillId 2): não resolvida, fica de fora.
    expect(metadata?.cellFills).toEqual([{ address: "C1", color: "#FF0000" }]);
  });

  it("detecta ausência de macros VBA quando xl/vbaProject.bin não está no pacote", () => {
    const zip = zipSync({
      "xl/workbook.xml": xml(
        '<workbook xmlns:r="r"><sheets><sheet name="Dados" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": xml(
        '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/worksheets/sheet1.xml": xml('<worksheet xmlns:r="r"/>'),
    });
    expect(inspectWorkbookFeatures(zip).get("Dados")?.hasVbaMacros).toBe(false);
  });

  it("inventaria uma imagem EMF (metarquivo do Windows) sem gerar dataUrl, por não ser renderizável no navegador", () => {
    const zip = zipSync({
      "xl/workbook.xml": xml(
        '<workbook xmlns:r="r"><sheets><sheet name="Dados" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": xml(
        '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/worksheets/sheet1.xml": xml(
        '<worksheet xmlns:r="r"><drawing r:id="rIdDrawing"/></worksheet>',
      ),
      "xl/worksheets/_rels/sheet1.xml.rels": xml(
        '<Relationships><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
      ),
      "xl/drawings/drawing1.xml": xml(
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Diagrama"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="rIdImage1"/></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>',
      ),
      "xl/drawings/_rels/drawing1.xml.rels": xml(
        '<Relationships><Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.emf"/></Relationships>',
      ),
      "xl/media/image1.emf": new Uint8Array([1, 0, 0, 0]),
    });
    expect(inspectWorkbookFeatures(zip).get("Dados")?.images).toEqual([
      { name: "Diagrama", anchor: "A1", format: "EMF" },
    ]);
  });

  it("trata título de gráfico vinculado a uma célula (c:strRef) como ausente, e tipo não reconhecido como desconhecido", () => {
    const zip = zipSync({
      "xl/workbook.xml": xml(
        '<workbook xmlns:r="r"><sheets><sheet name="Dados" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": xml(
        '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/worksheets/sheet1.xml": xml(
        '<worksheet xmlns:r="r"><drawing r:id="rIdDrawing"/></worksheet>',
      ),
      "xl/worksheets/_rels/sheet1.xml.rels": xml(
        '<Relationships><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
      ),
      "xl/drawings/drawing1.xml": xml(
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Gráfico 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/><a:ext cx="0" cy="0" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></xdr:xfrm><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>',
      ),
      "xl/drawings/_rels/drawing1.xml.rels": xml(
        '<Relationships><Relationship Id="rIdChart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
      ),
      "xl/charts/chart1.xml": xml(
        '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:title><c:tx><c:strRef><c:f>Dados!$A$1</c:f></c:strRef></c:tx></c:title><c:plotArea><c:custom3DChart/></c:plotArea></c:chart></c:chartSpace>',
      ),
    });
    expect(inspectWorkbookFeatures(zip).get("Dados")?.charts).toEqual([
      { type: "desconhecido", title: null, anchor: "A1" },
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
    expect(diagnostics.hasVbaMacros).toBe(true);
    expect(diagnostics.warnings.some((warning) => warning.includes("macros VBA"))).toBe(true);
  });

  it("mantém o workbook utilizável quando os metadados avançados não podem ser lidos", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Valor"], [10]]), "Dados");
    expect(attachWorkbookFeatures(workbook, new Uint8Array([1, 2, 3]))).toBe(workbook);
    expect(workbook.Sheets["Dados"]?.["A2"]?.v).toBe(10);
  });
});
