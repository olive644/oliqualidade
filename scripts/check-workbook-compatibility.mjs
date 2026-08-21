import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const resultDirectory = "test-results";
const vitestPath = `${resultDirectory}/workbook-compatibility-vitest.json`;
const jsonPath = `${resultDirectory}/workbook-compatibility-report.json`;
const markdownPath = `${resultDirectory}/workbook-compatibility-report.md`;
const matrix = JSON.parse(readFileSync("test-fixtures/workbook-compatibility-matrix.json", "utf8"));

// Chamar o binário do vitest pelo Node, e não por `npx`, mantém o relatório
// reproduzível fora do CI: no Windows `spawnSync("npx")` falha com ENOENT
// porque o executável é um .cmd, que só roda através do shell.
const vitestBin = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

mkdirSync(resultDirectory, { recursive: true });
const run = spawnSync(
  process.execPath,
  [
    vitestBin,
    "run",
    "src/lib/workbook-compatibility.test.ts",
    "--reporter=json",
    `--outputFile=${vitestPath}`,
  ],
  { encoding: "utf8" },
);
process.stdout.write(run.stdout ?? "");
process.stderr.write(run.stderr ?? "");

let vitest;
try {
  vitest = JSON.parse(readFileSync(vitestPath, "utf8"));
} catch (error) {
  vitest = {
    numTotalTests: 0,
    numPassedTests: 0,
    numFailedTests: 1,
    numPendingTests: 0,
    testResults: [],
    reportError: error instanceof Error ? error.message : String(error),
  };
}

const assertions = (vitest.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
const formatResults = matrix.formats.map((format) => {
  if (format.coverage === "manual") return { ...format, status: "manual" };
  const assertion = assertions.find((item) =>
    String(item.fullName ?? item.title ?? "").includes(`.${format.extension} `),
  );
  return {
    ...format,
    status: assertion?.status ?? "unknown",
    ...(assertion?.failureMessages?.length ? { failureMessages: assertion.failureMessages } : {}),
  };
});
const regressions = assertions
  .filter((assertion) => assertion.status === "failed")
  .map((assertion) => ({
    name: assertion.fullName ?? assertion.title ?? "Teste sem nome",
    failureMessages: assertion.failureMessages ?? [],
  }));
const automatedFormats = formatResults.filter((format) => format.coverage === "generated");
const missingResults = automatedFormats.filter((format) => format.status !== "passed");
const passed = run.status === 0 && missingResults.length === 0 && regressions.length === 0;
const report = {
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? null,
  passed,
  totals: {
    formats: formatResults.length,
    automated: automatedFormats.length,
    manual: formatResults.filter((format) => format.coverage === "manual").length,
    tests: vitest.numTotalTests ?? assertions.length,
    passedTests: vitest.numPassedTests ?? 0,
    failedTests: vitest.numFailedTests ?? regressions.length,
    skippedTests: vitest.numPendingTests ?? 0,
  },
  regressions,
  formats: formatResults,
};

const statusIcon = (status) => {
  if (status === "passed") return "✅";
  if (status === "manual") return "🟡";
  return "❌";
};
const markdown = [
  "# Relatório de compatibilidade de planilhas",
  "",
  `**Resultado:** ${passed ? "aprovado" : "reprovado"}`,
  "",
  `- ${report.totals.automated} formatos validados automaticamente`,
  `- ${report.totals.manual} formato com validação manual declarada`,
  `- ${report.totals.passedTests}/${report.totals.tests} testes passaram`,
  "",
  "| Formato | Família | Cobertura | Leitor | Resultado |",
  "| --- | --- | --- | --- | --- |",
  ...formatResults.map(
    (format) =>
      `| .${format.extension} | ${format.family} | ${format.coverage} | ${format.reader} | ${statusIcon(format.status)} ${format.status} |`,
  ),
  "",
  ...(regressions.length
    ? ["## Regressões", "", ...regressions.map((regression) => `- ${regression.name}`), ""]
    : ["## Regressões", "", "Nenhuma regressão detectada.", ""]),
].join("\n");

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownPath, `${markdown}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
console.log(`Relatório de compatibilidade salvo em ${markdownPath}`);
if (!passed) process.exitCode = run.status || 1;
