import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { sheetToRows } from "./import";

// Gerador determinístico: cada semente combina banners, linhas vazias,
// colunas espaçadoras, rodapés e números brasileiros de forma diferente.
function problematicSheet(seed: number) {
  const bannerRows = seed % 6;
  const spacer = seed % 3 === 0;
  const aoa: unknown[][] = [];
  for (let index = 0; index < bannerRows; index++)
    aoa.push(index === 0 ? [`RELATÓRIO DE VENDAS ${seed}`] : []);
  aoa.push(spacer ? ["Produto", null, "Valor", "Data"] : ["Produto", "Valor", "Data"]);
  for (let index = 0; index < 12; index++) {
    if (seed % 7 === 0 && index === 5) aoa.push([]);
    const value = index % 2 ? `${index + 1}.234,50` : (index + 1) * 100;
    aoa.push(
      spacer
        ? [`Item ${index + 1}`, null, value, `${String(index + 1).padStart(2, "0")}/01/2026`]
        : [`Item ${index + 1}`, value, `${String(index + 1).padStart(2, "0")}/01/2026`],
    );
  }
  if (seed % 4 === 0) aoa.push(["Fonte: sistema interno"]);
  if (seed % 5 === 0) aoa.push(["Emitido automaticamente"]);
  return XLSX.utils.aoa_to_sheet(aoa as (string | number | null)[][]);
}

describe("corpus determinístico de planilhas defeituosas", () => {
  it("recupera 120 variações sem perder a tabela principal", () => {
    for (let seed = 0; seed < 120; seed++) {
      const result = sheetToRows(problematicSheet(seed));
      expect(result.rows.length, `semente ${seed}`).toBeGreaterThanOrEqual(12);
      const keys = Object.keys(result.rows[0] ?? {})
        .join(" ")
        .toLowerCase();
      expect(keys, `semente ${seed}`).toContain("produto");
      expect(keys, `semente ${seed}`).toContain("valor");
      expect(result.diagnostics?.confidence, `semente ${seed}`).toBeGreaterThan(40);
    }
  });
});
