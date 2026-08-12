import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { sheetsWithData } from "@/lib/import";

describe("importação real do FRS-QA-028", () => {
  // Reproduz a combinação encontrada no arquivo real: texto com estilo de
  // data. É preciso serializar e reler o XLSX para o SheetJS produzir o
  // mesmo `Invalid Date` que aparecia no navegador.
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Ponto", "Torre de Processo"],
    ...Array.from({ length: 794 }, (_, index) => [`P${index + 1}`, index + 1]),
  ]);
  worksheet["B1"]!.z = "d-mmm";
  const source = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(source, worksheet, "Anexo FRS-QA-028-Suape");
  const bytes = XLSX.write(source, { type: "buffer", bookType: "xlsx" });
  const workbook = XLSX.read(bytes, {
    type: "buffer",
    cellDates: true,
    sheetStubs: true,
    dense: true,
  });

  it("preserva o cabeçalho Torre de Processo apesar do estilo de data", () => {
    const sheet = sheetsWithData(workbook).find(
      (candidate) => candidate.name === "Anexo FRS-QA-028-Suape",
    );

    expect(sheet).toBeDefined();
    expect(sheet?.rows).toHaveLength(794);
    expect(Object.keys(sheet?.rows[0] ?? {})).toContain("Torre de Processo");
    expect(sheet?.rows[0]?.["Torre de Processo"]).toBe(1);
    expect(Object.keys(sheet?.rows[0] ?? {})).not.toContain("coluna_2");
  });
});
