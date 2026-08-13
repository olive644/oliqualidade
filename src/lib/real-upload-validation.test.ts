import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { readWorkbookBytes } from "@/lib/workbook-reader";
import { verifyWorkbookWithExcelJs } from "@/lib/workbook-verifier";
import { scheduleDetailColumns, schedulePeriodColumns } from "@/lib/widgets";
import type { Column } from "@/lib/types";

const fixture =
  "upload/FRS-QA-BR-405 - Brasil - Cronograma de Análises Microbiológicas e Água - FY25-26 (5)(1).xlsx";

describe("validação local do cronograma real", () => {
  const bytes = readFileSync(fixture);

  it("preserva mês/ano, Máx. e não inventa 2028", () => {
    const sheets = readWorkbookBytes(bytes, fixture);
    const schedule = sheets.find((sheet) =>
      sheet.name.startsWith("Monitoramento - Microbiologico"),
    );
    expect(schedule).toBeDefined();
    const keys = Object.keys(schedule?.rows[0] ?? {});
    expect(keys).toEqual(
      expect.arrayContaining(["jun/2025", "set/2025", "dez/2025", "mar/2026", "Máx."]),
    );
    expect(keys.join(" ")).not.toMatch(/2028|NaN|undefined|Invalid Date/i);
    expect(
      schedule?.diagnostics?.temporalCells?.some((cell) => cell.normalizedValue === "2025-06"),
    ).toBe(true);
    expect(schedule?.diagnostics?.structuralClassification?.type).toBe("schedule");
    expect(schedule?.diagnostics?.qualityAudit?.dimensions.completeness.score).toBeGreaterThan(90);
  });

  it("não perde células confirmadas pelo ExcelJS", async () => {
    const primary = XLSX.read(bytes, {
      type: "buffer",
      cellDates: true,
      cellNF: true,
      cellText: true,
      sheetStubs: true,
    });
    const divergences = await verifyWorkbookWithExcelJs(bytes, primary);
    expect(divergences.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("mantém no cronograma linhas que possuem apenas limite e nenhum mês preenchido", () => {
    const sheets = readWorkbookBytes(bytes, fixture);
    const schedule = sheets.find((sheet) =>
      sheet.name.startsWith("Monitoramento - Microbiologico"),
    );
    expect(schedule).toBeDefined();
    const keys = Object.keys(schedule?.rows[0] ?? {});
    const columns: Column[] = keys.map((key) => ({
      key,
      label: key,
      kind: key === "Máx." || /^\w{3}\/\d{4}$/i.test(key) ? "number" : "text",
      visible: true,
      description: "",
    }));
    const periods = schedulePeriodColumns(columns).map((column) => column.key);
    const limitOnly = schedule?.rows.find(
      (row) =>
        row["Máx."] !== null &&
        row["Máx."] !== "" &&
        periods.every((period) => row[period] === null || row[period] === ""),
    );
    expect(limitOnly).toBeDefined();
    expect(
      scheduleDetailColumns(columns, periods, schedule?.rows ?? [], keys[0]).map(
        (column) => column.key,
      ),
    ).toContain("Máx.");
  });

  it("recupera o bloco físico-químico de Cor sem vazar o título nas células mensais", () => {
    const sheets = readWorkbookBytes(bytes, fixture);
    const schedule = sheets.find((sheet) => sheet.name === "Monitoramento - F-Q Mensal");
    expect(schedule).toBeDefined();
    const colorRows =
      schedule?.rows.filter((row) => row["Bloco"] === "Físico- Químico - Cor") ?? [];
    expect(colorRows).toHaveLength(8);
    expect(colorRows.some((row) => row["Ponto / Item"] === "Torneira Qualidade")).toBe(true);
    expect(
      schedule?.rows.some((row) =>
        Object.entries(row).some(
          ([key, value]) => /^\w{3}\/\d{4}$/i.test(key) && value === "Físico- Químico - Cor",
        ),
      ),
    ).toBe(false);
  });
});
