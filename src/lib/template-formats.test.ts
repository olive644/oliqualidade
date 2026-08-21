import { readFileSync } from "node:fs";

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { readWorkbookBytes } from "@/lib/workbook-reader";

/**
 * Fixtures pequenas e sanitizadas mantêm estes testes ativos em qualquer
 * ambiente, inclusive no CI. Os modelos foram derivados da mesma planilha
 * .xlsx, alterando apenas o content-type do pacote OOXML.
 */
const SOURCE_PATH = "test-fixtures/problematic-import.xlsx";
const TEMPLATE_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml";
const MACRO_TEMPLATE_CONTENT_TYPE =
  "application/vnd.ms-excel.template.macroEnabled.main+xml";

const fixtures = [
  {
    path: "test-fixtures/problematic-import.xltx",
    contentType: TEMPLATE_CONTENT_TYPE,
  },
  {
    path: "test-fixtures/problematic-import.xltm",
    contentType: MACRO_TEMPLATE_CONTENT_TYPE,
  },
] as const;

function readFixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

/**
 * Compara o conteúdo importado, não apenas quantidade de linhas e colunas.
 * Assim qualquer valor alterado, omitido ou deslocado faz o teste falhar.
 */
function contentSnapshot(path: string, bytes: Uint8Array) {
  return readWorkbookBytes(bytes, path).map((sheet) => ({
    name: sheet.name,
    rows: sheet.rows,
    rowOrigins: sheet.rowOrigins,
    divergences: sheet.diagnostics?.readerDivergences?.length ?? 0,
  }));
}

describe("modelos .xltx e .xltm", () => {
  const source = contentSnapshot(SOURCE_PATH, readFixture(SOURCE_PATH));

  for (const fixture of fixtures) {
    it(`lê ${fixture.path} com os mesmos valores da planilha de origem`, () => {
      const bytes = readFixture(fixture.path);
      const contentTypesEntry = unzipSync(bytes)["[Content_Types].xml"];

      expect(contentTypesEntry).toBeDefined();
      expect(strFromU8(contentTypesEntry!)).toContain(fixture.contentType);

      const actual = contentSnapshot(fixture.path, bytes);

      expect(actual.length).toBeGreaterThan(0);
      expect(actual).toEqual(source);
      expect(actual.every((sheet) => sheet.divergences === 0)).toBe(true);
    });
  }
});
