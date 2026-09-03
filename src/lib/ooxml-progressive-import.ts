import type * as XLSX from "xlsx";
import { checkWorkbookContent } from "@/lib/file-signature";
import { sheetsWithData, type SheetOption } from "@/lib/import";
import { unzipOoxmlArchive, type OoxmlArchive } from "@/lib/ooxml-archive";
import {
  minimalWorksheetForOoxmlGrid,
  readOoxmlSheetGrids,
  type OoxmlSheetGrid,
} from "@/lib/ooxml-reader";
import { attachWorkbookFeatures } from "@/lib/workbook-metadata";
import {
  validateWorkbookComplexity,
  validateZipWorkbook,
  type WorkbookReadProgress,
} from "@/lib/workbook-reader";
import {
  configuredWasmReaderMode,
  ProgressiveImportFallback,
  registeredWasmWorkbookReader,
  workbookFormat,
  type WorkbookReadResult,
} from "@/lib/workbook-reading-engine";

/**
 * O coordenador do caminho progressivo de OOXML.
 *
 * Assim como `csv-progressive-import.ts`, as peças já existiam separadas e
 * testadas: `readOoxmlSheetGrids` lê cada aba direto do XML para uma grade
 * densa, sem worksheet nenhuma, e a normalização de `import.ts` já aceita essa
 * fonte (`sheetsWithData(wb, { gridFor })`). Nenhuma delas mudava nada na tela
 * sozinha. Este arquivo é a ligação.
 *
 * Vocabulário, e ele importa: isto é **leitura progressiva**, não streaming
 * verdadeiro, no sentido registrado em `docs/IMPORT_ARCHITECTURE.md`. O ZIP
 * ainda é expandido inteiro em memória por `readOoxmlSheetGrids` — só o
 * workbook do SheetJS deixa de ser construído, que é a cópia que domina o pico
 * medido (cerca de 3,5x o arquivo, contra cerca de 1x do ZIP expandido).
 *
 * Medido pelo coordenador inteiro (`ooxml-progressive-benchmark.test.ts`), com
 * 120 mil linhas por 8 colunas:
 *
 * | Caminho        | Pico       | Tempo     |
 * | ---            | ---:       | ---:      |
 * | Atual          | 337,4 MiB  | 23.026 ms |
 * | Progressivo    | **156,9 MiB** | **14.207 ms** |
 *
 * 53% menos memória, 38% mais rápido, mesma quantidade de linhas. A folga
 * entre este número e os 76% da grade isolada (seção 150 do audit) vem do que
 * o coordenador ainda mantém vivo e a grade sozinha não mede: o ZIP expandido
 * e os recursos de `attachWorkbookFeatures`.
 *
 * O que este caminho **não** faz, de propósito: não roda `XLSX.read`, não roda
 * a verificação cruzada de `inspectOoxml`/`compareAndRepairWithOoxml` contra um
 * segundo motor, e não participa da comparação em sombra do núcleo Rust. Ele
 * confia sozinho no leitor OOXML independente que já serve de recuperação
 * quando o SheetJS falha inteiro no caminho atual — não é um motor novo, é o
 * mesmo, usado como principal em vez de como rede de segurança. `reader:
 * "ooxml-progressivo"` no relatório existe para que isso apareça na
 * telemetria, e não fique disfarçado de `sheetjs-verified`.
 *
 * Hyperlinks, comentários, imagens, formas, gráficos, autofiltro e a cor de
 * preenchimento original **não** vêm da grade: eles são anexados pela mesma
 * `attachWorkbookFeatures` que o caminho atual usa, sobre o mesmo pacote já
 * descompactado. Sem isso, o ganho de memória viria à custa de apagar esses
 * recursos de toda planilha grande o suficiente para cair neste caminho.
 *
 * Duas divergências conhecidas contra o caminho atual são tratadas de jeitos
 * diferentes, e a diferença importa para a segurança deste caminho:
 *
 * - **Fórmula volátil**: o caminho atual recalcula uma fórmula que depende de
 *   hoje; a grade não tem acesso a outras células para recalcular, então o
 *   valor sai como estava gravado no arquivo. Não perde dado, é sempre um
 *   número plausível, e a decisão registrada em `docs/IMPORT_ARCHITECTURE.md`
 *   é conviver com isso.
 * - **Divisão em seções**: `detectIndependentSections` e a divisão geométrica
 *   podem dividir uma aba em quantidades diferentes de tabelas pelos dois
 *   caminhos (mais ou menos seções, nomes diferentes). Aqui **não** se convive
 *   com isso: toda aba que sai dividida (nome com o separador `" · "`, o mesmo
 *   que `sheetOptionsForName`/`unifiedBlocksOption` usam) faz o arquivo
 *   inteiro cair em `ProgressiveImportFallback`, e o leitor validado assume no
 *   lugar. Sem um segundo motor para comparar, não dá para saber aqui se a
 *   divisão que aconteceu é a mesma que o caminho atual faria, e arriscar um
 *   agrupamento de linhas diferente do que a pessoa veria pelo caminho
 *   validado é o tipo de erro que este projeto não aceita pela economia de
 *   memória. O custo desta recusa é baixo: nos arquivos reais do corpus, toda
 *   aba com várias seções tem menos de 1 MiB, muito abaixo do teto que decide
 *   usar este caminho — na prática, um arquivo grande o suficiente para
 *   precisar dele quase nunca é também um documento de seções.
 *
 * `ooxml-sheet-grid.test.ts` mede a grade isolada contra o corpus: 87 de 110
 * abas saem idênticas pelos dois caminhos, e as que não saem só divergem por
 * fórmula volátil ou divisão em seções — nunca por dado perdido.
 *
 * `PROGRESSIVE_IMPORT_SUPPORT.ooxml` continua falso por ora: o módulo existe,
 * está testado (incluindo a recusa contra divisão em seções) e pronto para
 * ser chamado, mas ligar de verdade — fazer `chooseImportStrategy` escolhê-lo
 * — é uma decisão de produto sobre um caminho novo em produção, separada desta
 * ligação.
 */

/**
 * Estimativa de pico para o caminho progressivo de OOXML.
 *
 * `ooxml-sheet-grid.test.ts` mediu a grade isolada (sem o resto do
 * coordenador) em cerca de 43,7 bytes por célula, mas esse número não é o que
 * a pessoa sente: falta o ZIP expandido que `readOoxmlSheetGrids` mantém vivo
 * enquanto lê, e os recursos que `attachWorkbookFeatures` anexa (ver o
 * comentário do topo do arquivo). Quem mede o coordenador inteiro é
 * `ooxml-progressive-benchmark.test.ts`, com 120 mil linhas por 8 colunas (960
 * mil células): 171,4 bytes por célula. É esse número, e não o da grade
 * isolada, que decide a estimativa aqui, arredondado para cima pelo mesmo
 * motivo conservador da razão de 6x do seletor: numa estimativa de pico, errar
 * para baixo é o erro caro.
 *
 * Reaproveitar `estimateWorkbookPeakMemoryBytes` (o caminho atual) não serve:
 * aquele soma duas representações descompactadas mais o pacote de origem, e
 * seus 160 bytes por célula já não cobririam a inspeção cruzada que o caminho
 * atual roda e este não.
 */
export function estimateProgressiveOoxmlPeakMemoryBytes({ cells }: { cells: number }): number {
  return Math.round(Math.max(0, cells) * 175);
}

/**
 * O separador que toda aba dividida em seções carrega no nome, tanto pela
 * divisão geométrica (`... · Região N`) quanto pela detecção de seções por
 * título (`... · <rótulo da seção>`) e pelos blocos unificados
 * (`... · Blocos unificados`). Ver `sheetOptionsForName`/`unifiedBlocksOption`
 * em `import.ts`.
 */
const SECTION_SPLIT_MARKER = " · ";

/** `sheetsWithData` com a fonte de grade já resolvida por nome de aba. */
function sheetsWithDataFromGrids(
  workbook: XLSX.WorkBook,
  grids: Map<string, OoxmlSheetGrid>,
): SheetOption[] {
  return sheetsWithData(workbook, { gridFor: (name) => grids.get(name) });
}

export type OoxmlProgressiveImportOptions = {
  fileName: string;
  signal?: AbortSignal;
  onProgress?: (progress: WorkbookReadProgress) => void;
  /**
   * Recebe a aba assim que ela fica pronta. Quando presente, o resultado volta
   * com `sheets` vazio, pela mesma razão do caminho atual e do coordenador de
   * CSV: quem recebeu o pedaço já tem o conjunto, e a segunda cópia anularia a
   * economia.
   */
  onSheet?: (sheet: SheetOption) => void;
};

function abortIfCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new DOMException("Importação cancelada.", "AbortError");
}

/**
 * Lê um XLSX pelo caminho progressivo e devolve o mesmo contrato do atual.
 *
 * O contrato de saída é o mesmo `WorkbookReadResult` do leitor validado, de
 * propósito: quem chama não deveria precisar saber por qual caminho o arquivo
 * entrou.
 */
export function readOoxmlWorkbookProgressively(
  bytes: ArrayBuffer | Uint8Array,
  options: OoxmlProgressiveImportOptions,
): WorkbookReadResult {
  const startedAt = Date.now();
  const { fileName, signal } = options;
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  abortIfCancelled(signal);
  options.onProgress?.({ stage: "decoding" });

  const content = checkWorkbookContent(raw, fileName);
  if (!content.ok) throw new Error(content.message);
  if (content.container !== "zip")
    throw new ProgressiveImportFallback(
      `O conteúdo do arquivo é do tipo ${content.container}, e não um pacote ZIP.`,
    );

  const { totalUncompressedBytes } = validateZipWorkbook(raw);

  options.onProgress?.({ stage: "parsing" });
  const parseStartedAt = Date.now();
  let archive: OoxmlArchive;
  let grids: Map<string, OoxmlSheetGrid>;
  try {
    archive = unzipOoxmlArchive(raw);
    grids = readOoxmlSheetGrids(archive);
  } catch (error) {
    // O leitor estrito não cobre toda variação de OOXML que existe por aí. Uma
    // falha aqui não é o arquivo estar corrompido — é este caminho não servir
    // para ele. O leitor validado, com sua própria camada de recuperação,
    // assume no lugar.
    throw new ProgressiveImportFallback(
      error instanceof Error ? error.message : "O leitor progressivo de OOXML não leu o pacote.",
    );
  }
  if (!grids.size) throw new ProgressiveImportFallback("Nenhuma aba com relação válida no pacote.");
  const parseMs = Date.now() - parseStartedAt;
  abortIfCancelled(signal);

  const workbook = {
    SheetNames: [...grids.keys()],
    Sheets: Object.fromEntries(
      [...grids].map(([name, grid]) => [name, minimalWorksheetForOoxmlGrid(grid)]),
    ),
  } as XLSX.WorkBook;
  // Hyperlinks, comentários, imagens, formas, gráficos e cor de preenchimento
  // vêm de um leitor independente do SheetJS, e não da grade: `readOoxmlSheetGrids`
  // só carrega o que a normalização de linhas precisa. Sem isto, o caminho
  // progressivo importaria os dados e silenciosamente perderia todo o resto que
  // o caminho atual anexa via `attachWorkbookFeatures`.
  attachWorkbookFeatures(workbook, archive);
  const visitedCells = validateWorkbookComplexity(workbook);

  options.onProgress?.({ stage: "analyzing" });
  const analysisStartedAt = Date.now();
  // Bufferizado antes de emitir qualquer coisa, de propósito: a divisão em
  // seções (`detectIndependentSections`/regiões geométricas) é a divergência
  // conhecida que ainda separa este caminho do atual (ver o comentário do topo
  // do arquivo). Sem o segundo motor para comparar, não dá para saber aqui se
  // uma divisão que aconteceu é a mesma que o caminho atual faria — só dá para
  // saber que ela aconteceu, pelo separador " · " que toda aba dividida
  // carrega no nome (`sheetOptionsForName`/`unifiedBlocksOption`). Detectar
  // isso e recusar é mais seguro que arriscar um nome ou agrupamento de linhas
  // diferente do que a pessoa veria pelo caminho validado. O custo é baixo: nos
  // arquivos reais medidos, toda aba com várias seções tem menos de 1 MiB —
  // muito abaixo do teto que decide usar este caminho.
  const analyzed = sheetsWithDataFromGrids(workbook, grids);
  if (analyzed.some((option) => option.name.includes(SECTION_SPLIT_MARKER)))
    throw new ProgressiveImportFallback(
      "A planilha tem uma aba dividida em várias seções, e este caminho ainda não cobre essa divisão com segurança.",
    );
  const collected: SheetOption[] = [];
  let emitted = 0;
  for (const option of analyzed) {
    emitted += 1;
    options.onSheet?.(option);
    if (!options.onSheet) collected.push(option);
  }
  const analysisMs = Date.now() - analysisStartedAt;
  options.onProgress?.({ stage: "complete" });

  return {
    sheets: collected,
    report: {
      reader: "ooxml-progressivo",
      format: workbookFormat(fileName),
      elapsedMs: Date.now() - startedAt,
      parseMs,
      // Nenhum segundo motor é consultado neste caminho. Ver o comentário do
      // topo do arquivo sobre o que isso custa e por que é aceito por ora.
      verificationMs: 0,
      analysisMs,
      sourceBytes: raw.length,
      expandedBytes: totalUncompressedBytes,
      visitedCells,
      estimatedPeakMemoryBytes: estimateProgressiveOoxmlPeakMemoryBytes({ cells: visitedCells }),
      sheets: collected.length || emitted,
      repairedCells: 0,
      divergentCells: 0,
      fallbackUsed: false,
      wasmAvailable: !!registeredWasmWorkbookReader(),
      wasmReaderMode: configuredWasmReaderMode(),
      // O núcleo Rust é comparado contra a verificação cruzada, que este
      // caminho não roda. Wire-lo aqui é trabalho futuro, não desta ligação.
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
    },
  };
}
