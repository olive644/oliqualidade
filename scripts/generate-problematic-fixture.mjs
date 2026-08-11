import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const rows = [
  ["Relatório de vendas — revisão técnica", null, null, null, null, null],
  ["Período", "01/01/2026 a 30/06/2026", null, null, null, null],
  [null, null, null, null, null, null],
  ["Data", "Cidade", "CPF", "Categoria", "Faturamento", "Taxa"],
  ["01/01/2026", "São Paulo", "123.456.789-00", "Atacado", "R$ 1.234,56", "12,5%"],
  ["02/01/2026", "Curitiba", "987.654.321-00", "Varejo", "R$ 900,00", "8%"],
  ["02/01/2026", "Curitiba", "987.654.321-00", "Varejo", "R$ 900,00", "8%"],
  ["03/01/2026", null, "111.222.333-44", "varejo ", null, "10%"],
];

const sheet = XLSX.utils.aoa_to_sheet(rows);
sheet["!merges"] = [XLSX.utils.decode_range("A1:F1")];
sheet["!rows"] = [{}, { hidden: true }];
sheet["!cols"] = [{}, {}, { hidden: true }];
sheet["!autofilter"] = { ref: "A4:F8" };
sheet["G4"] = { t: "s", v: "Total calculado" };
sheet["G5"] = { t: "n", v: 1234.56, f: "E5" };
sheet["G6"] = { t: "n", v: 2134.56, f: "SUM(E5:E6)" };
sheet["!ref"] = "A1:G8";

const sideBySide = XLSX.utils.aoa_to_sheet([
  ["Produto", "Quantidade", null, null, "Estado", "Receita"],
  ["A", 10, null, null, "SP", 1000],
  ["B", 20, null, null, "PR", 1500],
  ["C", 15, null, null, "SC", 1200],
]);

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "Cabeçalho deslocado");
XLSX.utils.book_append_sheet(workbook, sideBySide, "Regiões lado a lado");
mkdirSync("test-fixtures", { recursive: true });
const workbookBytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
const archive = unzipSync(new Uint8Array(workbookBytes));
const worksheetPart = "xl/worksheets/sheet1.xml";
archive[worksheetPart] = strToU8(
  strFromU8(archive[worksheetPart]).replace(
    "</worksheet>",
    '<tableParts count="1"><tablePart r:id="rIdTable"/></tableParts><pivotTableDefinition r:id="rIdPivot"/></worksheet>',
  ),
);
archive["xl/worksheets/_rels/sheet1.xml.rels"] = strToU8(
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/><Relationship Id="rIdPivot" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>',
);
archive["xl/tables/table1.xml"] = strToU8(
  '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="VendasImportadas" displayName="VendasImportadas" ref="A4:G8"><tableColumns count="7"><tableColumn id="1" name="Data"/><tableColumn id="2" name="Cidade"/><tableColumn id="3" name="CPF"/><tableColumn id="4" name="Categoria"/><tableColumn id="5" name="Faturamento"/><tableColumn id="6" name="Taxa"/><tableColumn id="7" name="Total calculado"><calculatedColumnFormula>Faturamento</calculatedColumnFormula></tableColumn></tableColumns></table>',
);
archive["xl/pivotTables/pivotTable1.xml"] = strToU8(
  '<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="ResumoPorCidade"><location ref="I4:L10"/></pivotTableDefinition>',
);
writeFileSync("test-fixtures/problematic-import.xlsx", zipSync(archive));
