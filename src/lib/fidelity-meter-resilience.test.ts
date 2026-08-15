import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("@/lib/workbook-verifier", () => ({
  verifyWorkbookWithExcelJs: vi.fn(async () => {
    throw new Error("ExcelJS não conseguiu carregar (simulado)");
  }),
}));

import { measureWorkbookFidelity } from "@/lib/fidelity-meter";

describe("resiliência da medição de fidelidade a falha de leitor", () => {
  it("não derruba a medição quando o ExcelJS falha ao carregar o workbook", async () => {
    // ExcelJS tem bugs conhecidos com certos workbooks reais que contêm
    // desenhos/imagens (ver docs/CURRENT_STATE_AUDIT.md). Uma falha de
    // parsing não pode propagar como exceção não tratada nem virar "0
    // divergências" silencioso: precisa aparecer em `failedReaders`.
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

    const report = await measureWorkbookFidelity(bytes);

    expect(report.failedReaders).toEqual(["ExcelJS"]);
    expect(report.score).toBe(100);
    expect(report.divergences).toEqual([]);
  });
});
