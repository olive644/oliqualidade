import fs from "node:fs";
import path from "node:path";

const assetsDir = path.join(process.cwd(), ".vercel", "output", "static", "assets");
if (!fs.existsSync(assetsDir)) {
  console.error("Build não encontrado. Execute npm run build antes do orçamento de desempenho.");
  process.exit(1);
}

const kib = 1024;
const budgets = [
  { label: "CSS", pattern: /\.css$/, max: 220 * kib },
  { label: "worker", pattern: /worker-.*\.js$/, max: 500 * kib },
  { label: "Leaflet sob demanda", pattern: /^leaflet-.*\.js$/, max: 1400 * kib },
  { label: "Excel sob demanda", pattern: /^xlsx-.*\.js$/, max: 550 * kib },
  {
    label: "chunk JavaScript",
    pattern: /\.js$/,
    max: 420 * kib,
    exclude: /^(leaflet-|xlsx-)|worker-/,
  },
];

const assets = fs
  .readdirSync(assetsDir)
  .map((name) => ({ name, bytes: fs.statSync(path.join(assetsDir, name)).size }));
const failures = [];

for (const budget of budgets) {
  for (const asset of assets) {
    if (!budget.pattern.test(asset.name) || budget.exclude?.test(asset.name)) continue;
    if (asset.bytes > budget.max) failures.push({ ...asset, budget });
  }
}

const largest = [...assets].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
console.log("Maiores artefatos:");
for (const asset of largest) console.log(`- ${asset.name}: ${(asset.bytes / kib).toFixed(1)} KiB`);

if (failures.length) {
  console.error("\nOrçamento excedido:");
  for (const failure of failures) {
    console.error(
      `- ${failure.name}: ${(failure.bytes / kib).toFixed(1)} KiB > ${(
        failure.budget.max / kib
      ).toFixed(1)} KiB (${failure.budget.label})`,
    );
  }
  process.exit(1);
}

console.log("Orçamento de desempenho aprovado.");
