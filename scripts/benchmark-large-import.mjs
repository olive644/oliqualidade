import * as XLSX from "xlsx";

const quick = process.argv.includes("--quick");
const scenarios = quick
  ? [{ rows: 10_000, budgetMs: 5_000 }]
  : [
      { rows: 10_000, budgetMs: 5_000 },
      { rows: 100_000, budgetMs: 20_000 },
      { rows: 500_000, budgetMs: 90_000 },
    ];

function buildCsv(rowCount) {
  const lines = new Array(rowCount + 1);
  // Três colunas mantêm o cenário de 500 mil linhas em 1,5 milhão de
  // células, dentro do limite seguro de 2 milhões do importador real.
  lines[0] = "Id;Data;Valor";
  for (let index = 1; index <= rowCount; index++) {
    const month = String((index % 12) + 1).padStart(2, "0");
    const day = String((index % 28) + 1).padStart(2, "0");
    lines[index] = `${index};2026-${month}-${day};${(index * 1.37).toFixed(2)}`;
  }
  return lines.join("\n");
}

function formatMib(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

const results = [];
let failed = false;

for (const scenario of scenarios) {
  const heapBefore = process.memoryUsage().heapUsed;
  const csvStartedAt = performance.now();
  const csv = buildCsv(scenario.rows);
  const csvMs = performance.now() - csvStartedAt;

  const parseStartedAt = performance.now();
  const workbook = XLSX.read(csv, { type: "string", raw: true, FS: ";" });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const parsed = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: null });
  const parseMs = performance.now() - parseStartedAt;
  const heapAfter = process.memoryUsage().heapUsed;
  const totalMs = csvMs + parseMs;
  const valid =
    parsed.length === scenario.rows &&
    Number(parsed.at(-1)?.Id) === scenario.rows &&
    totalMs <= scenario.budgetMs;
  if (!valid) failed = true;

  results.push({
    linhas: scenario.rows.toLocaleString("pt-BR"),
    "CSV ms": Math.round(csvMs),
    "leitura ms": Math.round(parseMs),
    "total ms": Math.round(totalMs),
    "orçamento ms": scenario.budgetMs,
    "memória adicional MiB": formatMib(Math.max(0, heapAfter - heapBefore)),
    resultado: valid ? "ok" : "falhou",
  });
}

console.table(results);
if (failed) {
  console.error("O benchmark excedeu o orçamento ou perdeu linhas.");
  process.exit(1);
}
console.log("Benchmark de 10 mil, 100 mil e 500 mil linhas concluído sem perda.");
