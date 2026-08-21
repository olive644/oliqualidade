import { readFileSync } from "node:fs";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { readWorkbookBytes, WORKBOOK_ACCEPT } from "@/lib/workbook-reader";

type CompatibilityFormat = {
  extension: string;
  family: string;
  coverage: "generated" | "manual";
  reader: string;
  note?: string;
};

type CompatibilityMatrix = {
  schemaVersion: string;
  formats: CompatibilityFormat[];
};

const matrix = JSON.parse(
  readFileSync(
    new URL("../../test-fixtures/workbook-compatibility-matrix.json", import.meta.url),
    "utf8",
  ),
) as CompatibilityMatrix;

const WORKBOOK_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const MACRO_CONTENT_TYPE = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";
const TEMPLATE_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml";
const MACRO_TEMPLATE_CONTENT_TYPE = "application/vnd.ms-excel.template.macroEnabled.main+xml";

function workbook() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Produto", "Valor"],
    ["Bolo", 42],
  ]);
  const result = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(result, sheet, "Dados");
  return result;
}

function toTemplate(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const parts = unzipSync(bytes);
  const contentTypes = strFromU8(parts["[Content_Types].xml"]!);
  expect(contentTypes).toContain(from);
  parts["[Content_Types].xml"] = strToU8(contentTypes.replace(from, to));
  return zipSync(parts);
}

function write(bookType: XLSX.BookType, options: Partial<XLSX.WritingOptions> = {}) {
  return new Uint8Array(
    XLSX.write(workbook(), { type: "array", bookType, ...options }) as ArrayBuffer,
  );
}

function generatedBytes(extension: string): Uint8Array {
  if (extension === "xltx") {
    return toTemplate(write("xlsx"), WORKBOOK_CONTENT_TYPE, TEMPLATE_CONTENT_TYPE);
  }
  if (extension === "xltm") {
    return toTemplate(write("xlsm"), MACRO_CONTENT_TYPE, MACRO_TEMPLATE_CONTENT_TYPE);
  }
  if (extension === "tsv") return write("csv", { FS: "\t" });
  if (extension === "txt") return write("csv", { FS: ";" });
  if (extension === "xml") return write("xlml");
  if (extension === "htm") return write("html");
  return write(extension as XLSX.BookType);
}

describe("matriz de compatibilidade de planilhas", () => {
  it("cobre exatamente todas as extensões anunciadas pelo seletor", () => {
    const accepted = WORKBOOK_ACCEPT.split(",")
      .map((extension) => extension.replace(/^\./, ""))
      .sort();
    const documented = matrix.formats.map((format) => format.extension).sort();

    expect(matrix.schemaVersion).toBe("1.0.0");
    expect(documented).toEqual(accepted);
    expect(new Set(documented).size).toBe(documented.length);
  });

  for (const format of matrix.formats.filter((item) => item.coverage === "generated")) {
    it(`lê .${format.extension} com cabeçalho, texto e número preservados`, () => {
      const sheets = readWorkbookBytes(
        generatedBytes(format.extension),
        `compatibilidade.${format.extension}`,
      );

      expect(sheets).toHaveLength(1);
      expect(sheets[0]?.rows[0]).toMatchObject({ Produto: "Bolo", Valor: 42 });
    });
  }

  it("expõe explicitamente o formato que ainda depende de fixture manual", () => {
    const manual = matrix.formats.filter((format) => format.coverage === "manual");
    expect(manual).toEqual([
      expect.objectContaining({
        extension: "numbers",
        note: expect.stringContaining("fixture real"),
      }),
    ]);
  });
});
