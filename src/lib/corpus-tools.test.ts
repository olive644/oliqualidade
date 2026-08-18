import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import * as XLSX from "xlsx";

const root = mkdtempSync(join(tmpdir(), "oli-corpus-tools-"));
const source = join(root, "source");
const derived = join(root, "derived");
const sanitized = join(root, "sanitized");
const salt = "chave-local-de-teste-123";

function run(script: string, args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, OLI_CORPUS_SANITIZE_SALT: salt },
  });
}

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("ferramentas de corpus derivado real", () => {
  it("deriva, sanitiza, preserva XLTX e registra proveniência sem liberar o gate nativo", () => {
    mkdirSync(source);
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Cliente", "Valor"],
      ["Empresa Confidencial", 123.45],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Operação real");
    writeFileSync(
      join(source, "origem.xlsx"),
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    );

    const derive = run("scripts/derive-real-templates.mjs", [
      "--input",
      source,
      "--output",
      derived,
    ]);
    expect(derive.status, derive.stderr).toBe(0);

    const sanitize = run("scripts/sanitize-workbook-corpus.mjs", [
      "--input",
      derived,
      "--output",
      sanitized,
    ]);
    expect(sanitize.status, sanitize.stderr).toBe(0);

    const manifest = JSON.parse(readFileSync(join(sanitized, "manifest.local.json"), "utf8"));
    expect(manifest.cases).toHaveLength(1);
    expect(manifest.cases[0]).toMatchObject({
      file: "sanitized-001.xltx",
      format: "xltx",
      source: "sanitized-derived-real",
      cells: 4,
    });
    expect(manifest.cases[0].features).toEqual([
      "local-sanitized",
      "derived-real",
      "xlsx-content-type-to-xltx",
    ]);
    expect(manifest.cases[0].parentSha256).toMatch(/^[a-f0-9]{64}$/);

    const parts = unzipSync(readFileSync(join(sanitized, "sanitized-001.xltx")));
    const contentTypes = Buffer.from(parts["[Content_Types].xml"]!).toString("utf8");
    expect(contentTypes).toContain("spreadsheetml.template.main+xml");

    const validate = run("scripts/validate-sanitized-workbook-corpus.mjs", [
      "--source",
      derived,
      "--sanitized",
      sanitized,
    ]);
    expect(validate.status, validate.stderr).toBe(0);
    expect(validate.stdout).toContain("paridade estrutural e privacidade aprovadas");
  });

  it("valida planilha real com autofiltro, cujo _xlnm._FilterDatabase sai sem aspas na aba renomeada", () => {
    // Achado ao sanitizar planilhas reais do usuário: o SheetJS só cita o
    // nome da aba entre aspas simples quando o identificador exige (espaços,
    // caracteres especiais). "SHEET_001" nunca exige, então a referência sai
    // sem aspas — o validador antigo assumia aspas sempre e reprovava um
    // arquivo sanitizado corretamente.
    const filterSource = join(root, "source-filtro");
    const filterSanitized = join(root, "sanitized-filtro");
    mkdirSync(filterSource);
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Nome", "Valor"],
      ["Empresa Confidencial", 123.45],
    ]);
    sheet["!autofilter"] = { ref: "A1:B2" };
    XLSX.utils.book_append_sheet(workbook, sheet, "Dados com filtro");
    writeFileSync(
      join(filterSource, "origem.xlsx"),
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    );

    const sanitize = run("scripts/sanitize-workbook-corpus.mjs", [
      "--input",
      filterSource,
      "--output",
      filterSanitized,
    ]);
    expect(sanitize.status, sanitize.stderr).toBe(0);

    const sanitizedBook = XLSX.read(
      readFileSync(join(filterSanitized, "sanitized-001.xlsx")),
      { type: "buffer" },
    );
    const filterDatabase = sanitizedBook.Workbook?.Names?.[0];
    expect(filterDatabase?.Name).toBe("_xlnm._FilterDatabase");
    expect(filterDatabase?.Ref).not.toMatch(/^'/);

    const validate = run("scripts/validate-sanitized-workbook-corpus.mjs", [
      "--source",
      filterSource,
      "--sanitized",
      filterSanitized,
    ]);
    expect(validate.status, validate.stderr).toBe(0);
    expect(validate.stdout).toContain("paridade estrutural e privacidade aprovadas");
  });
});
