import type * as XLSX from "xlsx";
import {
  csvCellToSheetValue,
  readCsvInBlocks,
  sniffCsvEncoding,
  type CsvEncodingSniff,
} from "@/lib/csv-stream";
import { checkWorkbookContent } from "@/lib/file-signature";
import {
  minimalWorksheetForGrid,
  streamSheetsWithData,
  type SheetGridSource,
  type SheetOption,
} from "@/lib/import";
import { type ImportProgressiveSupport } from "@/lib/import-strategy";
import { PROGRESSIVE_BLOCK_SIZE_CANDIDATES } from "@/lib/progressive-import";
import {
  MAX_WORKBOOK_CELLS,
  MAX_WORKBOOK_CELLS_MESSAGE,
  type WorkbookReadProgress,
} from "@/lib/workbook-reader";
import {
  configuredWasmReaderMode,
  estimateProgressiveCsvPeakMemoryBytes,
  ProgressiveImportFallback,
  registeredWasmWorkbookReader,
  workbookFormat,
  type WorkbookReadResult,
} from "@/lib/workbook-reading-engine";

/**
 * Reexportada por compatibilidade: todo o resto do projeto (worker, cliente,
 * testes) importa esta classe daqui. A definição mora em
 * `workbook-reading-engine.ts` porque o coordenador de OOXML também a lança.
 */
export { ProgressiveImportFallback };

/**
 * O coordenador do caminho progressivo de CSV.
 *
 * As três peças já existiam separadas e testadas: `import-strategy.ts` decide,
 * `csv-stream.ts` lê o arquivo por streaming de verdade, e a normalização de
 * `import.ts` aceita uma fonte de grade. Nenhuma delas mudava nada na tela
 * sozinha. Este arquivo é a ligação, e é o ponto em que o ganho medido vira
 * ganho para quem importa.
 *
 * Vocabulário, e ele importa: aqui a leitura do arquivo é streaming de verdade
 * no sentido registrado em `docs/IMPORT_ARCHITECTURE.md`, porque o arquivo
 * nunca entra num `ArrayBuffer` e nenhum ZIP é expandido. O que **não** é
 * ilimitado é a grade: a normalização precisa da aba inteira para achar o
 * cabeçalho e as regiões, então a grade e as linhas ficam vivas ao mesmo tempo.
 * É exatamente isso que a medição contabiliza, e nada aqui deve ser descrito
 * como memória constante.
 *
 * Medido com 120 mil linhas por 8 colunas, contando todas as estruturas vivas:
 *
 * | Caminho        | Worksheet | Grade    | Linhas   | Pico          |
 * | ---            | ---:      | ---:     | ---:     | ---:          |
 * | Atual          | 106,6 MiB | ausente  | 60,5 MiB | **167,1 MiB** |
 * | Fonte de grade | 0 MiB     | 22,4 MiB | 17,6 MiB | **40,0 MiB**  |
 */

/**
 * O nome que o SheetJS dá à aba de um CSV.
 *
 * Não é escolha deste módulo: o caminho atual chama `XLSX.read` e recebe
 * `Sheet1`. Os dois caminhos precisam produzir o mesmo nome de aba, senão a
 * comparação de equivalência acusa divergência e, pior, a pessoa vê um nome
 * diferente conforme o tamanho do arquivo.
 */
const CSV_SHEET_NAME = "Sheet1";

/**
 * Quantos bytes do início bastam para reconhecer o formato real.
 *
 * `checkWorkbookContent` olha a assinatura do começo e decide texto contra
 * binário numa amostra de 4 KiB. Ler 8 KiB do `Blob` dá a mesma resposta que
 * ler o arquivo inteiro, sem trazer o arquivo para a memória.
 */
const CONTENT_SAMPLE_BYTES = 8 * 1024;

/**
 * Linhas por bloco entregue pela leitura.
 *
 * Escolhido por medição entre os três candidatos de `progressive-import.ts`,
 * com `src/lib/csv-progressive-benchmark.test.ts`. Em 120 mil linhas por 8
 * colunas os picos foram 34,9 MiB com mil linhas por bloco, 42,9 com duas mil e
 * 41,8 com cinco mil, repetidos até a décima de MiB entre execuções; os tempos
 * ficaram dentro de 2% uns dos outros, e qual deles sai na frente muda a cada
 * execução. Por isso o critério é o pico, e o escolhido é o menor deles.
 */
export const CSV_PROGRESSIVE_BLOCK_SIZE: number = PROGRESSIVE_BLOCK_SIZE_CANDIDATES[0];

/**
 * O que existe de fato, para o seletor de estratégia.
 *
 * `import-strategy.ts` continua sem saber quais caminhos foram escritos: ele
 * recebe essa informação.
 *
 * `ooxml: true` desde que `ooxml-progressive-import.ts` passou a recusar
 * (`ProgressiveImportFallback`) qualquer arquivo com aba dividida em seções —
 * a única divergência que mudava resultado observável sem aviso. Fórmula
 * volátil continua divergindo (valor gravado em vez de recalculado), mas
 * nunca perde dado, e essa decisão já estava tomada antes da ligação. Ver
 * `docs/CURRENT_STATE_AUDIT.md#170. A divisão em seções não foi alinhada, foi
 * contornada: recusa por nome`.
 */
export const PROGRESSIVE_IMPORT_SUPPORT: ImportProgressiveSupport = { csv: true, ooxml: true };

export type CsvProgressiveImportOptions = {
  fileName: string;
  blockSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: WorkbookReadProgress) => void;
  /**
   * Recebe a aba assim que ela fica pronta. Quando presente, o resultado volta
   * com `sheets` vazio, pela mesma razão do caminho atual: quem recebeu o
   * pedaço já tem o conjunto, e a segunda cópia anularia a economia.
   */
  onSheet?: (sheet: SheetOption) => void;
};

/**
 * Monta a grade no lugar, sem uma segunda cópia da planilha.
 *
 * Os registros vêm do analisador e são nossos: mudar cada um no lugar evita
 * alocar um segundo array por linha só para trocar texto vazio por ausência. O
 * preenchimento até a largura máxima reproduz o retângulo que o SheetJS declara
 * em `!ref`, onde a linha curta aparece completada com célula ausente.
 */
function assembleCsvGrid(records: string[][], width: number): (string | null)[][] {
  const grid = records as unknown as (string | null)[][];
  for (const row of grid) {
    for (let column = 0; column < row.length; column += 1)
      row[column] = csvCellToSheetValue(row[column] as string);
    for (let column = row.length; column < width; column += 1) row[column] = null;
  }
  return grid;
}

function progressiveReport(
  fileName: string,
  sniff: CsvEncodingSniff,
  cells: number,
  sheets: number,
  tempos: { elapsedMs: number; readMs: number; analysisMs: number },
): WorkbookReadResult["report"] {
  return {
    reader: "csv-progressivo",
    format: workbookFormat(fileName),
    elapsedMs: tempos.elapsedMs,
    // A leitura do arquivo ocupa o lugar do parse do caminho atual, e ao
    // contrário dele ela sabe medir o próprio progresso.
    parseMs: tempos.readMs,
    // Não há o que conferir contra o XML original: um CSV não tem pacote OOXML.
    verificationMs: 0,
    analysisMs: tempos.analysisMs,
    sourceBytes: sniff.totalBytes,
    // CSV não é compactado, então o tamanho expandido é o próprio arquivo.
    expandedBytes: sniff.totalBytes,
    visitedCells: cells,
    estimatedPeakMemoryBytes: estimateProgressiveCsvPeakMemoryBytes({ cells }),
    sheets,
    repairedCells: 0,
    divergentCells: 0,
    fallbackUsed: false,
    wasmAvailable: !!registeredWasmWorkbookReader(),
    wasmReaderMode: configuredWasmReaderMode(),
    // O núcleo Rust lê pacotes OOXML. CSV nunca foi candidato dele.
    wasmCandidateStatus: "not-eligible",
    wasmFallbackReason: null,
    wasmOutputUsed: false,
    wasmSampleRate: 0,
    wasmShadowStatus: "unavailable",
    wasmShadowMs: 0,
    wasmComparedCells: 0,
    wasmDivergentCells: 0,
    wasmComparedStructures: 0,
    wasmDivergentStructures: 0,
    wasmDivergentSheets: 0,
    wasmSchemaVersion: null,
  };
}

/**
 * Lê um CSV pelo caminho progressivo e devolve o mesmo resultado do atual.
 *
 * O contrato de saída é o mesmo `WorkbookReadResult` do leitor validado, de
 * propósito: quem chama não deveria precisar saber por qual caminho o arquivo
 * entrou, e a equivalência entre os dois é verificada por teste em cima desse
 * tipo, e não de um tipo paralelo.
 */
export async function readCsvWorkbookProgressively(
  blob: Blob,
  options: CsvProgressiveImportOptions,
): Promise<WorkbookReadResult> {
  const startedAt = Date.now();
  const { fileName, signal } = options;
  const abortIfCancelled = () => {
    if (signal?.aborted) throw new DOMException("Importação cancelada.", "AbortError");
  };

  abortIfCancelled();
  options.onProgress?.({ stage: "decoding" });

  // A estratégia é escolhida pela extensão, mas o arquivo é lido pelo que ele
  // é. Um pacote OOXML renomeado para `.csv` cai no caminho atual, que sabe
  // tratá-lo; um PDF é recusado com a mesma mensagem dos dois lados.
  const head = new Uint8Array(await blob.slice(0, CONTENT_SAMPLE_BYTES).arrayBuffer());
  const content = checkWorkbookContent(head, fileName);
  if (!content.ok) throw new Error(content.message);
  if (content.container !== "text")
    throw new ProgressiveImportFallback(
      `O conteúdo do arquivo é do tipo ${content.container}, e não texto.`,
    );

  const sniff = await sniffCsvEncoding(blob, signal, (lidos, total) =>
    options.onProgress?.({ stage: "decoding", completed: lidos, total }),
  );

  options.onProgress?.({ stage: "streaming", completed: 0, total: sniff.totalBytes });
  const readStartedAt = Date.now();
  const records: string[][] = [];
  let width = 0;
  await readCsvInBlocks(blob, sniff, {
    blockSize: options.blockSize ?? CSV_PROGRESSIVE_BLOCK_SIZE,
    ...(signal ? { signal } : {}),
    onBlock: (rows) => {
      for (const row of rows) {
        if (row.length > width) width = row.length;
        records.push(row);
      }
      // O teto de células do produto é conferido durante a leitura, e não
      // depois dela: recusar só no fim significaria ter montado a planilha
      // inteira na memória antes de dizer que ela não cabe. A conta é a mesma
      // do caminho atual, sobre o retângulo declarado e não sobre os campos
      // presentes, para os dois recusarem exatamente os mesmos arquivos.
      if (records.length * width > MAX_WORKBOOK_CELLS) throw new Error(MAX_WORKBOOK_CELLS_MESSAGE);
    },
    onProgress: (lidos, total) =>
      options.onProgress?.({ stage: "streaming", completed: lidos, total }),
  });
  const readMs = Date.now() - readStartedAt;
  abortIfCancelled();

  const grid = assembleCsvGrid(records, width);
  const cells = grid.length * width;
  const worksheet = minimalWorksheetForGrid(grid);
  const workbook = {
    SheetNames: [CSV_SHEET_NAME],
    Sheets: { [CSV_SHEET_NAME]: worksheet },
  } as XLSX.WorkBook;
  // A mesma grade responde pelos valores e pelo texto. Num CSV lido com as
  // opções do leitor atual toda célula já é texto, então as duas coincidem, e
  // apontar para o mesmo array evita uma segunda cópia da planilha.
  const gridSource: SheetGridSource = { aoa: grid, textAoa: grid };

  options.onProgress?.({ stage: "analyzing", completed: 0, total: 1 });
  const analysisStartedAt = Date.now();
  const collected: SheetOption[] = [];
  let emitted = 0;
  streamSheetsWithData(
    workbook,
    (option) => {
      emitted += 1;
      options.onSheet?.(option);
      if (!options.onSheet) collected.push(option);
    },
    (done, total) => options.onProgress?.({ stage: "analyzing", completed: done, total }),
    { gridFor: (name) => (name === CSV_SHEET_NAME ? gridSource : undefined) },
  );
  const analysisMs = Date.now() - analysisStartedAt;
  options.onProgress?.({ stage: "complete" });

  return {
    sheets: collected,
    report: progressiveReport(fileName, sniff, cells, collected.length || emitted, {
      elapsedMs: Date.now() - startedAt,
      readMs,
      analysisMs,
    }),
  };
}
