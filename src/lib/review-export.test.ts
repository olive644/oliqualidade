import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  auditExportRows,
  comparisonExportRows,
  importDiagnosticsExportPayload,
  rowsToCsv,
} from "@/lib/review-export";
import { buildCorrectedWorkbook } from "@/lib/review-workbook";
import { auditFidelityPercent, sheetToRows } from "@/lib/import";
import type { Dashboard } from "@/lib/types";

const dashboard: Dashboard = {
  id: "qa",
  name: "FRS QA",
  sourceFileName: "FRS-QA-BR-405.xlsx",
  activeSheetIndex: 0,
  createdAt: 1,
  updatedAt: 2,
  pinned: false,
  sheets: [
    {
      name: "Cronograma",
      rows: [{ análise: "Água", resultado: 0, conforme: false, desvio: -4, percentual: 0.005 }],
      columns: [
        { key: "análise", label: "Análise", kind: "text", visible: true, description: "" },
        { key: "resultado", label: "Resultado", kind: "number", visible: true, description: "" },
        { key: "conforme", label: "Conforme", kind: "category", visible: true, description: "" },
        { key: "desvio", label: "Desvio", kind: "number", visible: true, description: "" },
        {
          key: "percentual",
          label: "Percentual",
          kind: "percentage",
          visible: true,
          description: "",
        },
      ],
      filters: [],
      previousSnapshot: {
        capturedAt: 1,
        rows: [{ análise: "Água", resultado: 1, conforme: false, desvio: -4, percentual: 0.005 }],
      },
      auditTrail: [
        {
          id: "a",
          timestamp: 10,
          action: "cell-correction",
          exceptionId: "e",
          address: "B2",
          rowIndex: 1,
          columnKey: "resultado",
          before: 1,
          after: 0,
          reason: "Conferido no laudo.",
        },
      ],
    },
    {
      name: "Observações",
      rows: [{ nota: "=NÃO EXECUTAR()" }],
      columns: [{ key: "nota", label: "Nota", kind: "text", visible: true, description: "" }],
      filters: [],
    },
  ],
};

describe("review export", () => {
  it("exports traceable audit and cell comparison", () => {
    expect(auditExportRows(dashboard)[0]).toMatchObject({
      Origem: "FRS-QA-BR-405.xlsx",
      Aba: "Cronograma",
      Local: "B2",
      Antes: 1,
      Depois: 0,
    });
    const changes = comparisonExportRows(dashboard);
    expect(
      changes.some((row) => row.Tipo === "Célula alterada" && row.Coluna === "resultado"),
    ).toBe(true);
  });

  it("creates a new all-sheet workbook without mutating the dashboard", () => {
    const before = JSON.stringify(dashboard);
    const workbook = buildCorrectedWorkbook(dashboard);
    expect(workbook.SheetNames).toEqual([
      "Cronograma",
      "Observações",
      "Histórico de auditoria",
      "Comparação de versões",
    ]);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["Cronograma"]!, {
      raw: true,
    });
    expect(rows[0]).toMatchObject({ Resultado: 0, Conforme: false, Desvio: -4, Percentual: 0.005 });
    expect(JSON.stringify(dashboard)).toBe(before);
  });

  it("uses semicolon CSV, BOM and neutralizes spreadsheet formulas", () => {
    const csv = rowsToCsv([{ valor: "=SUM(A1:A2)", zero: 0, falso: false }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=SUM(A1:A2)"');
    expect(csv).toContain('"0";"false"');
  });

  it("diagn\u00F3stico baix\u00E1vel remove dataUrl das imagens mas preserva o resto do invent\u00E1rio", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Item", "Valor"],
      ["Po\u00E7o", 5],
    ]);
    const { diagnostics, audit } = sheetToRows(ws);
    const withImage = {
      ...diagnostics!,
      images: [
        { name: "logo.png", anchor: "A1", format: "png", dataUrl: "data:image/png;base64,ABC" },
      ],
    };
    const payload = importDiagnosticsExportPayload("planilha.xlsx", "Cronograma", withImage, audit);
    expect(payload.file).toBe("planilha.xlsx");
    expect(payload.sheet).toBe("Cronograma");
    expect(payload.fidelityPercent).toBe(auditFidelityPercent(audit!));
    expect(payload.diagnostics.images).toEqual([{ name: "logo.png", anchor: "A1", format: "png" }]);
    expect(JSON.stringify(payload)).not.toContain("base64");
    expect(payload.diagnostics.columns).toEqual(diagnostics!.columns);
  });

  it("diagn\u00F3stico baix\u00E1vel aceita aba sem auditoria (fidelityPercent nulo)", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Item", "Valor"],
      ["Po\u00E7o", 5],
    ]);
    const { diagnostics } = sheetToRows(ws);
    const payload = importDiagnosticsExportPayload("planilha.xlsx", "Cronograma", diagnostics!);
    expect(payload.fidelityPercent).toBeNull();
    expect(payload.audit).toBeNull();
  });
});
