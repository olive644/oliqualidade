import { describe, expect, it } from "vitest";
import { analyzeAdvancedQuality } from "@/lib/advanced-quality";

describe("qualidade avançada", () => {
  it("calcula quartis, MAD e detecta outlier robusto", () => {
    const rows = [10, 11, 12, 12, 13, 14, 15, 200].map((Valor) => ({ Valor }));
    const report = analyzeAdvancedQuality(rows, [
      { key: "Valor", kind: "number", qualityScore: 100 },
    ]);
    const column = report.columns[0]!;
    expect(column.iqr).toBeGreaterThan(0);
    expect(column.mad).toBeGreaterThan(0);
    expect(column.iqrOutliers).toBe(1);
    expect(column.madOutliers).toBe(1);
    expect(column.anomalyRows).toEqual([7]);
    expect(report.tableScore).toBeLessThan(100);
  });

  it("não classifica identificadores como medidas estatísticas", () => {
    const report = analyzeAdvancedQuality(
      [{ CPF: 12345678900 }],
      [{ key: "CPF", kind: "cpf", qualityScore: 90 }],
    );
    expect(report.columns).toEqual([]);
    expect(report.tableScore).toBe(90);
  });

  it("detecta mudança temporal abrupta", () => {
    const values = [10, 11, 12, 13, 14, 15, 80];
    const rows = values.map((Valor, index) => ({
      Data: `2026-01-${String(index + 1).padStart(2, "0")}`,
      Valor,
    }));
    const report = analyzeAdvancedQuality(rows, [
      { key: "Data", kind: "date", qualityScore: 100 },
      { key: "Valor", kind: "number", qualityScore: 100 },
    ]);
    expect(report.columns[0]?.temporalAnomalies).toBe(1);
  });
});
