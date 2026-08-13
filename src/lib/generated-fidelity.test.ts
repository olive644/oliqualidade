import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { measureWorkbookFidelity } from "@/lib/fidelity-meter";
import { readWorkbookBytes } from "@/lib/workbook-reader";

function generatedWorkbook(seed: number): Uint8Array {
  const bannerRows = seed % 5;
  const rows: unknown[][] = Array.from({ length: bannerRows }, (_, index) =>
    index === 0 ? [`RELATÓRIO ${seed}`] : [],
  );
  rows.push(["Item", new Date(Date.UTC(2025, seed % 12, 1)), "Valor", "Situação"]);
  for (let index = 0; index < 12; index++) {
    if (index === 5 && seed % 4 === 0) rows.push([]);
    rows.push([
      `Ponto ${index + 1}`,
      index % 3 ? index + 1 : null,
      index % 2 ? `${index + 1}.234,50` : (index + 1) * 100,
      index % 2 ? "Planejado" : "Executado",
    ]);
  }
  if (seed % 3 === 0) rows.push(["Fonte: sistema interno"]);
  const worksheet = XLSX.utils.aoa_to_sheet(rows as (string | number | Date | null)[][]);
  const monthCell = XLSX.utils.encode_cell({ r: bannerRows, c: 1 });
  if (worksheet[monthCell]) worksheet[monthCell].z = "mmm-yy";
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

describe("suíte crescente de fidelidade", () => {
  it("mantém no mínimo 99% em 24 combinações problemáticas", async () => {
    const scores: number[] = [];
    for (let seed = 0; seed < 24; seed++) {
      const bytes = generatedWorkbook(seed);
      const report = await measureWorkbookFidelity(bytes);
      scores.push(report.score);
      const sheets = readWorkbookBytes(bytes, `gerada-${seed}.xlsx`);
      expect(sheets[0]?.rows.length, `semente ${seed}`).toBeGreaterThanOrEqual(12);
      expect(report.score, `semente ${seed}`).toBeGreaterThanOrEqual(99);
    }
    expect(scores.reduce((sum, score) => sum + score, 0) / scores.length).toBeGreaterThanOrEqual(99);
  });
});
