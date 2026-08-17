import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";

import { privateSourceId, sanitizeWorkbookBytes, sha256 } from "./workbook-sanitizer.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function filesBelow(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const inputArgument = argument("--input");
const outputArgument = argument("--output");
const salt = process.env.OLI_CORPUS_SANITIZE_SALT;

if (!inputArgument || !outputArgument) {
  fail("Uso: npm run corpus:sanitize -- --input <pasta-origem> --output <pasta-destino>");
} else if (!salt || salt.length < 16) {
  fail("Defina OLI_CORPUS_SANITIZE_SALT localmente com pelo menos 16 caracteres.");
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
    const sourceFiles = filesBelow(inputRoot);
    // .xlsx/.xlsm/.xltx/.xltm sao todos aceitos. sanitizeWorkbookBytes grava
    // a saida preservando o formato real da origem — inclusive .xltx/.xltm
    // (modelo do Excel): o SheetJS instalado so sabe ESCREVER bookType
    // xlsx/xlsm de verdade, mas a UNICA diferenca OOXML entre documento e
    // modelo e a declaracao de Content-Type da parte /xl/workbook.xml, entao
    // sanitizeWorkbookBytes grava com xlsx/xlsm e depois troca so essa
    // string, sem tocar em mais nada do ZIP (ver comentario em
    // workbook-sanitizer.mjs). O resultado e um `.xltx`/`.xltm` sanitizado
    // que o Excel reconhece como modelo de verdade, entao conta como fonte
    // real no gate de promocao do formato correto (ver
    // docs/WASM_PROMOTION_CRITERIA.md).
    //
    // Arquivos com macro (.xlsm/.xltm) sao aceitos como entrada, mas o
    // conteudo VBA em si nunca chega a ser lido nem reescrito:
    // sanitizeWorkbookBytes le com `bookVBA: false` (o SheetJS nem chega a
    // decodificar o binario da macro) e sempre remove `workbook.vbaraw`
    // antes de gravar. A saida e um arquivo macro-enabled valido (Excel
    // aceita normalmente) so que sem nenhuma macro dentro — o Rust nunca
    // executa VBA mesmo.
    const bookTypeByExtension = {
      ".xlsx": "xlsx",
      ".xltx": "xltx",
      ".xlsm": "xlsm",
      ".xltm": "xltm",
    };
    const candidates = sourceFiles.filter(
      (file) => extname(file).toLowerCase() in bookTypeByExtension,
    );
    if (candidates.length === 0) {
      fail("Nenhum arquivo XLSX/XLSM/XLTX/XLTM foi encontrado na pasta de origem.");
    } else {
      mkdirSync(outputRoot, { recursive: true });
      const cases = [];
      const sourceIds = new Set();
      let duplicateSources = 0;
      for (const sourcePath of candidates.sort()) {
        const sourceBytes = readFileSync(sourcePath);
        const id = privateSourceId(sourceBytes, salt);
        if (sourceIds.has(id)) {
          duplicateSources += 1;
          continue;
        }
        sourceIds.add(id);
        const bookType = bookTypeByExtension[extname(sourcePath).toLowerCase()];
        const file = `sanitized-${String(cases.length + 1).padStart(3, "0")}.${bookType}`;
        const sanitized = sanitizeWorkbookBytes(sourceBytes, { salt, workbookId: id, bookType });
        writeFileSync(join(outputRoot, file), sanitized.bytes, { flag: "wx" });
        cases.push({
          id,
          file,
          format: bookType,
          source: "sanitized-real",
          features: ["local-sanitized"],
          sha256: sha256(sanitized.bytes),
          ...sanitized.summary,
        });
      }
      writeFileSync(
        join(outputRoot, "manifest.local.json"),
        `${JSON.stringify({ schemaVersion: "1.0.0", cases }, null, 2)}\n`,
        { flag: "wx" },
      );
      console.info(
        `${cases.length} arquivo(s) sanitizado(s) em ${relative(process.cwd(), outputRoot) || basename(outputRoot)}.`,
      );
      if (duplicateSources > 0)
        console.info(`${duplicateSources} duplicata(s) exata(s) ignorada(s) no gate de promoção.`);
      console.info("Nenhum nome, caminho de origem ou chave foi gravado no manifesto.");
    }
  }
}
