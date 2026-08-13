import { mkdirSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

const target = "test-fixtures/generated";
mkdirSync(target, { recursive: true });

function workbookFor(seed) {
  const wb = XLSX.utils.book_new();
  const month = new Date(Date.UTC(2025 + (seed % 2), seed % 12, 1));
  const rows = [];
  for (let banner = 0; banner < seed % 5; banner++) rows.push([banner ? null : `RELATÓRIO ${seed}`]);
  rows.push(["Item", month, "Valor", seed % 3 === 0 ? null : "Situação"]);
  for (let row = 0; row < 10 + (seed % 7); row++) {
    if (row === 4 && seed % 4 === 0) rows.push([]);
    rows.push([
      `Ponto ${row + 1}`,
      row % 3 === 0 ? null : row + 1,
      row % 2 ? `${row + 1}.234,50` : (row + 1) * 100,
      row % 2 ? "Planejado" : "Executado",
    ]);
  }
  if (seed % 3 === 0) rows.push(["Fonte: sistema interno"]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const headerRow = seed % 5;
  const monthCell = XLSX.utils.encode_cell({ r: headerRow, c: 1 });
  if (ws[monthCell]) ws[monthCell].z = "mmm-yy";
  if (seed % 2 === 0) ws["!merges"] = [XLSX.utils.decode_range(`A1:D1`)];
  XLSX.utils.book_append_sheet(wb, ws, `Caso ${seed}`);
  return wb;
}

const count = Number(process.argv[2] ?? 40);
for (let seed = 0; seed < count; seed++) {
  const bytes = XLSX.write(workbookFor(seed), { type: "buffer", bookType: "xlsx" });
  writeFileSync(`${target}/problematic-${String(seed).padStart(3, "0")}.xlsx`, bytes);
}
console.log(`Corpus gerado: ${count} planilhas em ${target}`);
