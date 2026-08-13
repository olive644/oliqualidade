import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { sheetToRows } from "@/lib/import";
import { measureWorkbookFidelity } from "@/lib/fidelity-meter";
import { compareAndRepairWithOoxml, inspectOoxml } from "@/lib/ooxml-reader";
import { verifyWorkbookWithExcelJs } from "@/lib/workbook-verifier";

describe("fidelidade entre leitores independentes", () => {
  const bytes = readFileSync("test-fixtures/problematic-import.xlsx");

  it("lê o pacote OOXML diretamente e preserva endereços", () => {
    const fallback = inspectOoxml(bytes);
    expect(fallback.sheets.get("Cabeçalho deslocado")?.get("A4")?.rawValue).toBe("Data");
    expect(fallback.workbook.SheetNames).toContain("Regiões lado a lado");
  });

  it("compara SheetJS com OOXML célula a célula", () => {
    const primary = XLSX.read(bytes, {
      type: "buffer",
      cellDates: true,
      cellNF: true,
      cellText: true,
    });
    const divergences = compareAndRepairWithOoxml(primary, inspectOoxml(bytes));
    expect(divergences.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("usa ExcelJS como terceiro leitor independente nos testes", async () => {
    const primary = XLSX.read(bytes, {
      type: "buffer",
      cellDates: true,
      cellNF: true,
      cellText: true,
    });
    const divergences = await verifyWorkbookWithExcelJs(bytes, primary);
    expect(divergences.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("o workbook de fallback alimenta o importador normal", () => {
    const fallback = inspectOoxml(bytes);
    const sheet = fallback.workbook.Sheets["Cabeçalho deslocado"];
    expect(sheet).toBeDefined();
    expect(sheetToRows(sheet!).rows.length).toBeGreaterThanOrEqual(4);
  });

  it("mede fidelidade celular com meta mínima explícita de 99%", async () => {
    const report = await measureWorkbookFidelity(bytes);
    expect(report.readers).toEqual(["SheetJS", "OOXML", "ExcelJS"]);
    expect(report.sourceCells).toBeGreaterThan(20);
    expect(report.score).toBeGreaterThanOrEqual(99);
  });
});
