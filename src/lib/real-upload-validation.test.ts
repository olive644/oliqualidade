import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { readWorkbookBytes } from "@/lib/workbook-reader";
import { verifyWorkbookWithExcelJs } from "@/lib/workbook-verifier";
import { buildRecommendedWidgets, generateAutoDashboardPlan } from "@/lib/auto-dashboard";
import { scheduleDetailColumns, schedulePeriodColumns } from "@/lib/widgets";
import type { Column } from "@/lib/types";

const fixture = [
  "upload/FRS-QA-BR-405 - Brasil - Cronograma de Análises Microbiológicas e Água - FY25-26 (5).xlsx",
  "upload/FRS-QA-BR-405 - Brasil - Cronograma de Análises Microbiológicas e Água - FY25-26 (5)(1).xlsx",
].find(existsSync);

describe.skipIf(!fixture)("validação local do cronograma real", () => {
  const source = fixture!;
  const bytes = readFileSync(source);

  it("preserva mês/ano, Máx. e não inventa 2028", () => {
    const sheets = readWorkbookBytes(bytes, source);
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

  it("não vaza os marcadores 4s das linhas ocultas para nenhum painel", () => {
    const sheets = readWorkbookBytes(bytes, source);
    const displayedValues = sheets.flatMap((sheet) =>
      sheet.rows.flatMap((row) => Object.values(row)),
    );
    const original = XLSX.read(bytes, { type: "buffer", cellStyles: true });
    const sourceSheet = original.Sheets["FRS QA BR 405 Brasil"];

    expect(sourceSheet?.["I87"]?.v).toBe("4s");
    expect(sourceSheet?.["!rows"]?.[86]?.hidden).toBe(true);
    expect(displayedValues).not.toContain("4s");
    expect(sheets.some((sheet) => (sheet.audit?.hiddenRowsIgnored ?? 0) > 0)).toBe(true);
    expect(sheets.some((sheet) => (sheet.diagnostics?.hiddenRows ?? 0) > 0)).toBe(true);
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
    const sheets = readWorkbookBytes(bytes, source);
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
    const sheets = readWorkbookBytes(bytes, source);
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

  it("recupera todas as abas com validade e fidelidade integrais", () => {
    const sheets = readWorkbookBytes(bytes, source);
    expect(sheets).toHaveLength(18);
    expect(sheets.every((sheet) => sheet.rows.length > 0)).toBe(true);
    for (const sheet of sheets) {
      const keys = Object.keys(sheet.rows[0] ?? {});
      expect(keys.join(" ")).not.toMatch(/NaN|undefined|Invalid Date/i);
      expect(sheet.diagnostics?.qualityAudit?.dimensions.validity.score).toBe(100);
      expect(sheet.diagnostics?.qualityAudit?.dimensions.fidelity.score).toBeGreaterThanOrEqual(90);
      expect(sheet.diagnostics?.qualityAudit?.unresolvedReaderDivergences).toBe(0);
    }
  });

  it("preserva comentários de célula e o bloco textual de observações", () => {
    const sheets = readWorkbookBytes(bytes, source);
    const notes = sheets.flatMap((sheet) => sheet.diagnostics?.sourceNotes ?? []);
    expect(notes).toHaveLength(21);
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: "A99",
          kind: "observation",
          text: expect.stringContaining("programa de monitoramento ambiental"),
        }),
        expect.objectContaining({
          kind: "comment",
          text: expect.stringContaining("Portaria n.º 25/2021"),
        }),
      ]),
    );
  });

  it("reconhece Abril-26 como período nas duas abas mensais", () => {
    const sheets = readWorkbookBytes(bytes, source);
    for (const name of ["Monitoramento - Micro. Mensal", "Monitoramento - F-Q Mensal"]) {
      const sheet = sheets.find((candidate) => candidate.name === name);
      expect(sheet).toBeDefined();
      const columns: Column[] = Object.keys(sheet?.rows[0] ?? {}).map((key) => ({
        key,
        label: key,
        kind: "number",
        visible: true,
        description: "",
      }));
      expect(schedulePeriodColumns(columns).map((column) => column.key)).toContain("Abril-26");
      expect(sheet?.diagnostics?.structuralClassification).toMatchObject({ type: "schedule" });
      expect(sheet?.diagnostics?.structuralClassification?.reasons).toContain(
        "9 colunas de período",
      );
    }
  });

  it("gera um cronograma visual automático para cada bloco de monitoramento", () => {
    const sheets = readWorkbookBytes(bytes, source);
    for (const name of [
      "Monitoramento - Microbiologico",
      "Monitoramento - Micro. Mensal",
      "Monitoramento - F-Q Mensal",
    ]) {
      const sheet = sheets.find((candidate) => candidate.name === name)!;
      const columns: Column[] = Object.keys(sheet.rows[0] ?? {}).map((key) => ({
        key,
        label: key,
        kind: key === "Bloco" || key === "Ponto / Item" ? "category" : "number",
        visible: true,
        description: "",
      }));
      const expectedBlocks = new Set(sheet.rows.map((row) => String(row["Bloco"]))).size;
      const plan = generateAutoDashboardPlan({ columns, rows: sheet.rows });
      const widgets = buildRecommendedWidgets(plan, columns, sheet.rows).filter(
        (widget) => widget.type === "schedule-heatmap",
      );
      expect(widgets).toHaveLength(expectedBlocks);
      expect(new Set(widgets.map((widget) => widget.blockValue)).size).toBe(expectedBlocks);
      expect(widgets.every((widget) => widget.blockKey === "Bloco")).toBe(true);
    }
  });

  it("não cria cronograma falso nas tabelas de amostragem com subcolunas compostas", () => {
    const sheets = readWorkbookBytes(bytes, source);
    const sampling = sheets.filter((sheet) => sheet.name.startsWith(" Anexo I - Amostragem ·"));
    expect(sampling.length).toBeGreaterThan(0);
    for (const sheet of sampling) {
      const columns: Column[] = Object.keys(sheet.rows[0] ?? {}).map((key) => ({
        key,
        label: key,
        kind: "text",
        visible: true,
        description: "",
      }));
      expect(
        generateAutoDashboardPlan({ columns, rows: sheet.rows }).recommendations.some(
          (item) => item.widgetType === "schedule-heatmap",
        ),
        sheet.name,
      ).toBe(false);
    }
  });
});
