import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { strFromU8, unzipSync } from "fflate";
import * as XLSX from "xlsx";

import { privateSourceId, sha256 } from "./workbook-sanitizer.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function cellsOf(sheet) {
  return Object.entries(sheet).filter(([address]) => !address.startsWith("!"));
}

function metrics(workbook) {
  return {
    sheets: workbook.SheetNames.length,
    cells: workbook.SheetNames.reduce(
      (total, name) =>
        total +
        cellsOf(workbook.Sheets[name] ?? {}).filter(
          ([, cell]) => cell?.v != null || typeof cell?.f === "string",
        ).length,
      0,
    ),
    formulas: workbook.SheetNames.reduce(
      (total, name) =>
        total + cellsOf(workbook.Sheets[name] ?? {}).filter(([, cell]) => cell?.f).length,
      0,
    ),
    merges: workbook.SheetNames.reduce(
      (total, name) => total + (workbook.Sheets[name]?.["!merges"]?.length ?? 0),
      0,
    ),
    hiddenRows: workbook.SheetNames.reduce(
      (total, name) =>
        total + (workbook.Sheets[name]?.["!rows"] ?? []).filter((row) => row?.hidden).length,
      0,
    ),
    hiddenColumns: workbook.SheetNames.reduce(
      (total, name) =>
        total + (workbook.Sheets[name]?.["!cols"] ?? []).filter((column) => column?.hidden).length,
      0,
    ),
  };
}

function contentTypeFor(bytes) {
  const parts = unzipSync(bytes);
  const contentTypes = parts["[Content_Types].xml"];
  return contentTypes ? strFromU8(contentTypes) : "";
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

const sourceArgument = argument("--source");
const sanitizedArgument = argument("--sanitized");
const salt = process.env.OLI_CORPUS_SANITIZE_SALT;

if (!sourceArgument || !sanitizedArgument || !salt || salt.length < 16) {
  console.error(
    "Uso: OLI_CORPUS_SANITIZE_SALT=<chave> node scripts/validate-sanitized-workbook-corpus.mjs --source <origem> --sanitized <destino>",
  );
  process.exit(2);
}

const sourceRoot = resolve(sourceArgument);
const sanitizedRoot = resolve(sanitizedArgument);
const manifestPath = join(sanitizedRoot, "manifest.local.json");
if (!existsSync(manifestPath)) throw new Error("manifest.local.json nao encontrado.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const derivationPath = join(sourceRoot, "derivation.local.json");
const derivedFiles = existsSync(derivationPath)
  ? new Set(JSON.parse(readFileSync(derivationPath, "utf8")).cases.map((entry) => entry.file))
  : new Set();
const sourceFiles = readdirSync(sourceRoot)
  .filter((file) => /\.(xlsx|xlsm|xltx|xltm)$/i.test(file))
  .map((file) => ({ file, bytes: readFileSync(join(sourceRoot, file)) }));
const sourcesById = new Map(
  sourceFiles.map((entry) => [privateSourceId(entry.bytes, salt), entry]),
);
const failures = [];
let comparedCells = 0;

for (const entry of manifest.cases ?? []) {
  const source = sourcesById.get(entry.id);
  assert(!!source, `${entry.file}: origem correspondente nao encontrada.`, failures);
  if (!source) continue;
  const expectedSource = derivedFiles.has(source.file)
    ? "sanitized-derived-real"
    : "sanitized-real";
  assert(
    entry.source === expectedSource,
    `${entry.file}: proveniencia incorreta (${entry.source} em vez de ${expectedSource}).`,
    failures,
  );
  const sanitizedPath = join(sanitizedRoot, entry.file);
  assert(existsSync(sanitizedPath), `${entry.file}: arquivo sanitizado ausente.`, failures);
  if (!existsSync(sanitizedPath)) continue;
  const sanitizedBytes = readFileSync(sanitizedPath);
  assert(sha256(sanitizedBytes) === entry.sha256, `${entry.file}: SHA-256 divergente.`, failures);

  const sourceBook = XLSX.read(source.bytes, { type: "buffer", cellDates: true, cellStyles: true });
  const sanitizedBook = XLSX.read(sanitizedBytes, {
    type: "buffer",
    cellDates: true,
    cellStyles: true,
    bookVBA: false,
  });
  const before = metrics(sourceBook);
  const after = metrics(sanitizedBook);
  comparedCells += before.cells;
  for (const key of ["sheets", "cells", "formulas", "merges", "hiddenRows", "hiddenColumns"])
    assert(
      before[key] === after[key],
      `${entry.file}: ${key} mudou (${before[key]} -> ${after[key]}).`,
      failures,
    );

  assert(
    sanitizedBook.SheetNames.every(
      (name, index) => name === `SHEET_${String(index + 1).padStart(3, "0")}`,
    ),
    `${entry.file}: nomes de abas nao foram neutralizados.`,
    failures,
  );
  const remainingNames = sanitizedBook.Workbook?.Names ?? [];
  assert(
    remainingNames.every(
      (name) =>
        name.Name === "_xlnm._FilterDatabase" &&
        typeof name.Ref === "string" &&
        // O SheetJS só cita o nome da aba entre aspas simples quando o
        // identificador exige (espaços, caracteres especiais); "SHEET_NNN"
        // nunca exige, então a referência sai sem aspas na escrita real.
        /^'?SHEET_\d{3}'?!\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+$/.test(name.Ref),
    ),
    `${entry.file}: nome definido do usuario sobreviveu.`,
    failures,
  );
  assert(!sanitizedBook.vbaraw, `${entry.file}: conteudo VBA sobreviveu.`, failures);
  for (const name of sanitizedBook.SheetNames) {
    for (const [address, cell] of cellsOf(sanitizedBook.Sheets[name] ?? {})) {
      if ((cell.t === "s" || cell.t === "str") && cell.v !== "")
        assert(
          /^TXT_[A-F0-9]{16}$/.test(String(cell.v)),
          `${entry.file}:${name}!${address}: texto nao pseudonimizado.`,
          failures,
        );
      assert(!cell.l, `${entry.file}:${name}!${address}: hyperlink sobreviveu.`, failures);
      assert(!cell.c, `${entry.file}:${name}!${address}: comentario sobreviveu.`, failures);
      if (typeof cell.f === "string")
        assert(
          !cell.f.includes("[") && !/(?:https?|ftp):\/\//i.test(cell.f),
          `${entry.file}:${name}!${address}: referencia externa sobreviveu.`,
          failures,
        );
    }
  }

  const contentTypes = contentTypeFor(sanitizedBytes);
  if (entry.format === "xltx")
    assert(
      contentTypes.includes("spreadsheetml.template.main+xml"),
      `${entry.file}: Content-Type nao e XLTX.`,
      failures,
    );
  if (entry.format === "xltm")
    assert(
      contentTypes.includes("template.macroEnabled.main+xml"),
      `${entry.file}: Content-Type nao e XLTM.`,
      failures,
    );
}

assert(
  manifest.cases?.length === sourcesById.size,
  `Manifesto tem ${manifest.cases?.length ?? 0} caso(s), mas a origem tem ${sourcesById.size} fonte(s) unica(s).`,
  failures,
);

if (failures.length) {
  console.error(`Validacao falhou com ${failures.length} problema(s):`);
  for (const failure of failures.slice(0, 50)) console.error(`- ${failure}`);
  process.exit(1);
}

console.info(
  `Corpus sanitizado validado: ${manifest.cases.length} arquivo(s), ${comparedCells} celula(s), paridade estrutural e privacidade aprovadas.`,
);
