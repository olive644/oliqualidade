import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildRecommendedWidgets, generateAutoDashboardPlan } from "@/lib/auto-dashboard";
import { infer } from "@/lib/format";
import { sheetsWithData } from "@/lib/import";
import { attachWorkbookFeatures } from "@/lib/workbook-metadata";

describe("fluxo integrado com planilha problemática", () => {
  const fixtureBytes = readFileSync("test-fixtures/problematic-import.xlsx");
  const workbook = XLSX.read(fixtureBytes, {
    type: "buffer",
    cellDates: true,
    sheetStubs: true,
  });
  attachWorkbookFeatures(workbook, fixtureBytes);
  const sheets = sheetsWithData(workbook);

  it("preserva as abas e separa regiões independentes confirmadas", () => {
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      "Cabeçalho deslocado",
      "Regiões lado a lado · Região 1",
      "Regiões lado a lado · Região 2",
    ]);
    const first = sheets[0];
    expect(first?.diagnostics?.header.row).toBe(4);
    expect(first?.diagnostics?.tableRegions.length).toBeGreaterThanOrEqual(2);
    expect(first?.diagnostics?.formulaCells).toBe(2);
    expect(first?.diagnostics?.mergedRanges).toBe(1);
    expect(first?.diagnostics?.hasAutoFilter).toBe(true);
    expect(first?.diagnostics?.structuredTableNames).toEqual(["VendasImportadas"]);
    expect(first?.diagnostics?.calculatedColumns).toEqual(["Total calculado"]);
    expect(first?.diagnostics?.pivotTables[0]?.name).toBe("ResumoPorCidade");
    expect(first?.diagnostics?.columns.find((column) => column.key === "CPF")?.sensitive).toBe(
      true,
    );
  });

  it("gera um dashboard explicável sem transformar CPF em métrica", () => {
    const first = sheets[0];
    expect(first).toBeDefined();
    if (!first) return;
    const columns = infer(first.rows);
    const plan = generateAutoDashboardPlan({
      columns,
      rows: first.rows,
      ...(first.diagnostics ? { diagnostics: first.diagnostics } : {}),
    });
    const widgets = buildRecommendedWidgets(plan, columns, first.rows);
    expect(plan.classifications.find((column) => column.key === "CPF")?.role).toBe("identifier");
    expect(widgets.some((widget) => widget.type === "table")).toBe(true);
    expect(widgets.some((widget) => widget.metricKey === "CPF" || widget.valueKey === "CPF")).toBe(
      false,
    );
    expect(plan.recommendations.every((item) => item.reasons.length > 0)).toBe(true);
  });
});
