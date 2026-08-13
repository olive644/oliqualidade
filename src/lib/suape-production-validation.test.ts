import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { readWorkbookBytes } from "@/lib/workbook-reader";
import { inspectOoxml } from "@/lib/ooxml-reader";

const fixture = [
  "upload/Plano de Produção Suape AGOSTO V4.xlsx",
  "../upload/Plano de Produção Suape AGOSTO V4.xlsx",
].find(existsSync);

describe.skipIf(!fixture)("validação local do plano de produção Suape", () => {
  const source = fixture!;
  const bytes = readFileSync(source);

  it("preserva abas, matrizes e cabeçalhos hierárquicos", () => {
    const primary = XLSX.read(bytes, {
      type: "buffer",
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      cellText: true,
      sheetStubs: true,
      dense: true,
      nodim: true,
      UTC: false,
    });
    const independent = inspectOoxml(bytes);
    const imported = readWorkbookBytes(bytes, source);
    expect(primary.SheetNames).toHaveLength(13);
    expect(imported.length).toBeGreaterThanOrEqual(13);
    expect(independent.sheets.get("Setup AGOSTO")?.get("A1")?.rawValue).toBeNull();
    expect(independent.sheets.get("Setup AGOSTO")?.get("C6")?.rawValue).toBeNull();
    expect(imported.flatMap((sheet) => sheet.diagnostics?.readerDivergences ?? [])).toEqual([]);
    expect(imported.find((sheet) => sheet.name === "OEE")?.rows).toHaveLength(12);
    expect(imported.find((sheet) => sheet.name === "Atendimento Geral")?.rows).toHaveLength(11);
    expect(imported.some((sheet) => sheet.name.startsWith("Atendimento Geral ·"))).toBe(false);
    expect(
      Object.keys(imported.find((sheet) => sheet.name === "Comparativo SKU")?.rows[0] ?? {}),
    ).toContain("Programado — 01/07/2026");
  }, 15_000);
});
