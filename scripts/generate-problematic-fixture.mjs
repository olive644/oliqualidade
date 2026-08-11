import * as XLSX from "xlsx";
import { mkdirSync } from "node:fs";

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
XLSX.writeFile(workbook, "test-fixtures/problematic-import.xlsx");
