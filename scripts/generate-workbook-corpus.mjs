import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as XLSX from "xlsx";

const sourceManifest = JSON.parse(readFileSync("test-fixtures/wasm-corpus-manifest.json", "utf8"));
const target = "test-fixtures/generated";
mkdirSync(target, { recursive: true });

function workbookFor(testCase) {
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { WBProps: { date1904: testCase.dateSystem === "1904" } };
  const rows = [Array.from({ length: testCase.columns }, (_, column) => `Coluna ${column + 1}`)];
  for (let row = 1; row <= testCase.rows; row++) {
    rows.push(
      Array.from({ length: testCase.columns }, (_, column) => {
        if (column === 0) return `${testCase.id} · linha ${row}`;
        if (column === 1) return new Date(Date.UTC(2024 + (row % 3), row % 12, (row % 27) + 1));
        if (column === 2) return row % 2 === 0;
        // Mantém cabeçalho e largura da planilha, mas deixa uma coluna
        // inteira sem valores. Esse perfil reproduz formulários reais com
        // colunas apenas formatadas e protege o leitor contra uma cascata
        // de "Não informado".
        if (column === testCase.columns - 2 && testCase.features.includes("emptyColumns"))
          return null;
        if (column === testCase.columns - 1 && testCase.features.includes("formulas")) return null;
        return row * 100 + column + testCase.seed / 100;
      }),
    );
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  for (let row = 2; row <= testCase.rows + 1; row++) {
    const date = worksheet[`B${row}`];
    if (date) date.z = "dd/mm/yyyy";
    if (testCase.features.includes("formulas")) {
      const address = XLSX.utils.encode_cell({ r: row - 1, c: testCase.columns - 1 });
      worksheet[address] = {
        t: "n",
        v: (row - 1) * 1000,
        f: `SUM(D${row}:${XLSX.utils.encode_col(testCase.columns - 2)}${row})`,
        z: "0.00",
      };
    }
  }
  if (testCase.features.includes("merges"))
    worksheet["!merges"] = [XLSX.utils.decode_range("D1:F1")];
  if (testCase.features.includes("hiddenRows"))
    worksheet["!rows"] = Array.from({ length: testCase.rows + 1 }, (_, index) => ({
      hidden: index === 7,
    }));
  if (testCase.features.includes("hiddenColumns")) {
    worksheet["!cols"] = Array.from({ length: testCase.columns }, (_, index) => ({
      hidden: index === 6 || index === 7,
    }));
  }
  XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");
  return workbook;
}

const expandedCases = sourceManifest.profiles.flatMap((profile) =>
  Array.from({ length: profile.copies }, (_, copy) => ({
    id: `${profile.id}-${String(copy + 1).padStart(2, "0")}`,
    format: profile.format,
    source: "synthetic",
    seed: profile.seedStart + copy,
    rows: profile.rows,
    columns: profile.columns,
    dateSystem: profile.dateSystem,
    features: profile.features,
  })),
);

for (const testCase of expandedCases) {
  const file = `${testCase.id}.${testCase.format}`;
  const bytes = XLSX.write(workbookFor(testCase), {
    type: "buffer",
    bookType: testCase.format,
    cellDates: true,
  });
  writeFileSync(join(target, file), bytes);
  testCase.file = file;
}

writeFileSync(
  join(target, "manifest.generated.json"),
  `${JSON.stringify(
    {
      schemaVersion: sourceManifest.schemaVersion,
      generatedBy: "scripts/generate-workbook-corpus.mjs",
      cases: expandedCases,
    },
    null,
    2,
  )}\n`,
);
console.log(`Corpus gerado: ${expandedCases.length} planilhas e manifesto em ${target}`);
