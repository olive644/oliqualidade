import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

import { describe, expect, it } from "vitest";

import { inspectOoxml } from "@/lib/ooxml-reader";
import { readWorkbookBytes } from "@/lib/workbook-reader";
import { infer } from "@/lib/format";
import { generateAutoDashboardPlan } from "@/lib/auto-dashboard";

const candidates = [
  "001Política de segurança 2 (1) (1) (2).xlsx",
  "PESO 50 CV 1 GREN PCR 1.xlsx",
  "FRS-QA-BR-009-SUAPE Registro de Validação de Inspetores Automáticos.xlsx",
  "Plano de Produção Suape AGOSTO V4.xlsx",
  "Testes GREEN PCR 1.xlsx",
];

const fixtures = candidates
  .map((name) => [`upload/${name}`, `../upload/${name}`].find(existsSync))
  .filter((path): path is string => Boolean(path));

describe.skipIf(!fixtures.length)("corpus local de planilhas reais", () => {
  for (const fixture of fixtures) {
    it(`preserva as células reconhecidas de ${basename(fixture)}`, () => {
      const bytes = readFileSync(fixture);
      const imported = readWorkbookBytes(bytes, fixture);
      const independent = inspectOoxml(bytes);
      expect(independent.sheets.size).toBeGreaterThan(0);
      expect(imported.length).toBeGreaterThan(0);
      expect(imported.flatMap((sheet) => sheet.diagnostics?.readerDivergences ?? [])).toEqual([]);

      const name = basename(fixture);
      if (name.startsWith("001Política")) {
        expect(imported).toHaveLength(17);
        expect(imported.every((sheet) => sheet.rows.length >= 30)).toBe(true);
        expect(Object.keys(imported[0]?.rows[0] ?? {})).toEqual([
          "Evento",
          "Entidade promotora",
          "Carga horária",
          "Instrutor",
          "N°",
          "Matrícula",
          "Nome",
          "Setor",
          "Turno",
          "Data",
          "Assinatura",
        ]);
        expect(imported[0]?.diagnostics?.structuralClassification?.type).toBe("attendance-roster");
        expect(
          generateAutoDashboardPlan({
            columns: infer(imported[0]!.rows),
            rows: imported[0]!.rows,
          }).recommendations.map((item) => item.widgetType),
        ).toContain("attendance-overview");
      }
      if (name.startsWith("FRS-QA-BR-009")) {
        expect(imported.map((sheet) => sheet.rows.length)).toEqual([24, 12]);
        expect(Object.keys(imported[0]?.rows[0] ?? {})).toEqual([
          "Hora",
          "Referência",
          "Aceita",
          "Rejeita",
          "Resultado",
          "Aviso #",
          "Inspetor",
        ]);
        expect(imported[0]?.diagnostics?.structuralClassification?.type).toBe("validation-matrix");
        expect(
          generateAutoDashboardPlan({
            columns: infer(imported[0]!.rows),
            rows: imported[0]!.rows,
          }).recommendations.map((item) => item.widgetType),
        ).toContain("validation-overview");
      }
      if (name.startsWith("Testes GREEN")) {
        expect(imported).toHaveLength(4);
        expect(imported.find((sheet) => sheet.name === "Viscosidades")?.rows).toHaveLength(12);
        const finish = imported.find((sheet) => sheet.name === "Finish");
        expect(finish?.rows).toHaveLength(91);
        expect(finish?.diagnostics?.structuralClassification?.type).toBe("measurement-series");
        expect(
          generateAutoDashboardPlan({
            columns: infer(finish!.rows),
            rows: finish!.rows,
          }).recommendations.map((item) => item.widgetType),
        ).toContain("control-chart");
      }
      if (name.startsWith("Plano de Produção")) {
        expect(independent.sheets.size).toBe(13);
        expect(imported.find((sheet) => sheet.name === "OEE")?.rows).toHaveLength(12);
        expect(imported.some((sheet) => sheet.name.startsWith("Atendimento Geral ·"))).toBe(false);
        expect(
          Object.keys(imported.find((sheet) => sheet.name === "Comparativo SKU")?.rows[0] ?? {}),
        ).toContain("Programado — 01/07/2026");
        const comparison = imported.find((sheet) => sheet.name === "Comparativo SKU")!;
        expect(
          generateAutoDashboardPlan({
            columns: infer(comparison.rows),
            rows: comparison.rows,
          }).recommendations.map((item) => item.widgetType),
        ).toContain("plan-vs-actual");
      }
    });
  }
});
