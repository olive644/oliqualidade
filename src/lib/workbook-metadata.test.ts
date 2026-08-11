import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { diagnoseImportedSheet } from "@/lib/import-intelligence";
import { attachWorkbookFeatures, inspectWorkbookFeatures } from "@/lib/workbook-metadata";

const xml = (value: string) => strToU8(value);

function advancedWorkbookPackage() {
  return zipSync({
    "xl/workbook.xml": xml(
      '<workbook xmlns:r="r"><sheets><sheet name="Vendas" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": xml(
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": xml(
      '<worksheet xmlns:r="r"><tableParts><tablePart r:id="rIdTable"/></tableParts><pivotTableDefinition r:id="rIdPivot"/></worksheet>',
    ),
    "xl/worksheets/_rels/sheet1.xml.rels": xml(
      '<Relationships><Relationship Id="rIdTable" Type="table" Target="../tables/table1.xml"/><Relationship Id="rIdPivot" Type="pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>',
    ),
    "xl/tables/table1.xml": xml(
      '<table name="VendasTabela" displayName="VendasTabela" ref="A1:C5"><tableColumns><tableColumn id="1" name="Produto"/><tableColumn id="2" name="Quantidade"/><tableColumn id="3" name="Total"><calculatedColumnFormula>[@Quantidade]*10</calculatedColumnFormula></tableColumn></tableColumns></table>',
    ),
    "xl/pivotTables/pivotTable1.xml": xml(
      '<pivotTableDefinition name="ResumoVendas"><location ref="E3:H12"/></pivotTableDefinition>',
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
  });

  it("integra os metadados ao diagnóstico sem alterar os dados", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Produto", "Quantidade", "Total"],
      ["A", 2, 20],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    attachWorkbookFeatures(workbook, advancedWorkbookPackage());

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
