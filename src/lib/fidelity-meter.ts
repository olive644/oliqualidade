import * as XLSX from "xlsx";

import { compareAndRepairWithOoxml, inspectOoxml, type ReaderDivergence } from "@/lib/ooxml-reader";
import { verifyWorkbookWithExcelJs } from "@/lib/workbook-verifier";

/**
 * Recursos que nenhum leitor reconcilia célula a célula hoje (ver
 * `docs/CURRENT_STATE_AUDIT.md`, seção 3). Uma pontuação de 100% mede apenas
 * o que foi comparado; esta lista torna o que não foi comparado visível em
 * vez de implicitamente "validado". Por decisão de projeto, "não suportado"
 * não soma nem subtrai da pontuação — é um estado próprio.
 */
export const UNSUPPORTED_FIDELITY_FEATURES: readonly string[] = [
  "Preenchimento, fonte, borda e cor semântica de célula",
  "Imagens, desenhos, objetos e gráficos nativos",
  "Agrupamentos/outlines e segmentações",
  "Macros VBA (detectadas, mas nunca executadas nem decompiladas)",
  "Recálculo integral de fórmulas do Excel",
];

export type WorkbookFidelityReport = {
  score: number;
  sourceCells: number;
  divergentCells: number;
  divergences: ReaderDivergence[];
  /**
   * Divergências de severidade `warning`: o valor difere entre leitores, mas
   * sem perda de célula. Antes desta versão eram descartadas silenciosamente
   * e não apareciam em lugar nenhum do relatório; agora ficam visíveis para
   * auditoria, mesmo não entrando no cálculo da pontuação.
   */
  warnings: ReaderDivergence[];
  unsupportedFeatures: readonly string[];
  readers: ["SheetJS", "OOXML", "ExcelJS"];
  /**
   * Nomes de `readers` que não conseguiram sequer carregar o arquivo (ex.:
   * ExcelJS falha em alguns workbooks reais com desenhos/imagens). Uma
   * falha de leitor não pode virar "sem divergências" por omissão: o score
   * só considera as divergências dos leitores que responderam, e este campo
   * torna essa ausência visível em vez de inflar a pontuação silenciosamente.
   */
  failedReaders: string[];
};

/** Mede preservação de células, sem confundir vazio legítimo com falha. */
export async function measureWorkbookFidelity(
  input: ArrayBuffer | Uint8Array,
): Promise<WorkbookFidelityReport> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const primary = XLSX.read(bytes, {
    type: "array",
    cellDates: true,
    cellFormula: true,
    cellNF: true,
    cellText: true,
    sheetStubs: true,
    nodim: true,
    UTC: false,
  });
  const ooxml = inspectOoxml(bytes);
  const ooxmlDivergences = compareAndRepairWithOoxml(primary, ooxml);
  const failedReaders: string[] = [];
  let excelJsDivergences: ReaderDivergence[] = [];
  try {
    excelJsDivergences = await verifyWorkbookWithExcelJs(bytes, primary);
  } catch {
    // ExcelJS tem bugs conhecidos ao carregar certos workbooks reais com
    // desenhos/imagens (ver docs/CURRENT_STATE_AUDIT.md). Uma falha de
    // parsing não pode derrubar a medição inteira nem virar "0 divergências".
    failedReaders.push("ExcelJS");
  }
  const errorsByCell = new Map<string, ReaderDivergence>();
  const warningsByCell = new Map<string, ReaderDivergence>();
  for (const divergence of [...ooxmlDivergences, ...excelJsDivergences]) {
    const key = `${divergence.sheet}!${divergence.address}`;
    if (divergence.severity === "error") errorsByCell.set(key, divergence);
    else warningsByCell.set(key, divergence);
  }
  const sourceCells = [...ooxml.sheets.values()].reduce((sum, cells) => sum + cells.size, 0);
  const divergentCells = errorsByCell.size;
  return {
    score: Math.round((1 - divergentCells / Math.max(1, sourceCells)) * 10_000) / 100,
    sourceCells,
    divergentCells,
    divergences: [...errorsByCell.values()],
    warnings: [...warningsByCell.values()],
    unsupportedFeatures: UNSUPPORTED_FIDELITY_FEATURES,
    readers: ["SheetJS", "OOXML", "ExcelJS"],
    failedReaders,
  };
}
