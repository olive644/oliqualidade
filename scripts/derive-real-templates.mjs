import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const SHEET_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const TEMPLATE_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const inputArgument = argument("--input");
const outputArgument = argument("--output");

if (!inputArgument || !outputArgument) {
  fail("Uso: node scripts/derive-real-templates.mjs --input <pasta-xlsx> --output <pasta-xltx>");
} else {
  const inputRoot = resolve(inputArgument);
  const outputRoot = resolve(outputArgument);
  const inputBoundary = `${inputRoot}${sep}`.toLowerCase();
  const outputBoundary = `${outputRoot}${sep}`.toLowerCase();
  if (!existsSync(inputRoot) || !statSync(inputRoot).isDirectory()) {
    fail("A pasta de origem nao existe ou nao e um diretorio.");
  } else if (
    inputRoot.toLowerCase() === outputRoot.toLowerCase() ||
    outputBoundary.startsWith(inputBoundary) ||
    inputBoundary.startsWith(outputBoundary)
  ) {
    fail("Origem e destino devem ser pastas separadas e nao podem conter uma a outra.");
  } else if (existsSync(outputRoot) && readdirSync(outputRoot).length > 0) {
    fail("A pasta de destino deve estar vazia para impedir sobrescritas acidentais.");
  } else {
    const candidates = readdirSync(inputRoot)
      .filter((name) => extname(name).toLowerCase() === ".xlsx")
      .sort();
    if (!candidates.length) {
      fail("Nenhum arquivo XLSX foi encontrado na pasta de origem.");
    } else {
      mkdirSync(outputRoot, { recursive: true });
      const cases = [];
      for (const [index, name] of candidates.entries()) {
        const source = readFileSync(join(inputRoot, name));
        const parts = unzipSync(source);
        const contentTypesPath = "[Content_Types].xml";
        if (!parts[contentTypesPath]) throw new Error("Pacote OOXML sem [Content_Types].xml.");
        const contentTypes = strFromU8(parts[contentTypesPath]);
        if (!contentTypes.includes(SHEET_CONTENT_TYPE))
          throw new Error("O arquivo de origem nao declara workbook XLSX valido.");
        parts[contentTypesPath] = strToU8(
          contentTypes.replace(SHEET_CONTENT_TYPE, TEMPLATE_CONTENT_TYPE),
        );
        const derived = Buffer.from(zipSync(parts, { level: 6 }));
        const file = `derived-real-${String(index + 1).padStart(3, "0")}.xltx`;
        writeFileSync(join(outputRoot, file), derived, { flag: "wx" });
        cases.push({
          id: `derived-${sha256(source).slice(0, 12)}`,
          file,
          format: "xltx",
          source: "derived-real",
          parentSha256: sha256(source),
          sha256: sha256(derived),
          transformation: "xlsx-content-type-to-xltx",
        });
      }
      writeFileSync(
        join(outputRoot, "derivation.local.json"),
        `${JSON.stringify({ schemaVersion: "1.0.0", cases }, null, 2)}\n`,
        { flag: "wx" },
      );
      console.info(`${cases.length} modelo(s) XLTX derivado(s) de fontes reais.`);
    }
  }
}
