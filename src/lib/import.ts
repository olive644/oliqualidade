import * as XLSX from "xlsx";
import type { Row } from "@/lib/types";
import { resolveFormulaCell } from "@/lib/formula";
import { diagnoseImportedSheet, type ImportDiagnostics } from "@/lib/import-intelligence";

export type SheetImportResult = {
  rows: Row[];
  warning: string | null; // aviso não bloqueante: colunas renomeadas, linha de cabeçalho deslocada, colunas quase vazias e/ou linhas em branco ignoradas
  diagnostics?: ImportDiagnostics;
};

// Quantas linhas do topo da planilha são avaliadas para achar a linha de
// cabeçalho de verdade. Generoso de propósito: cobre não só uma linha de
// título isolada, mas também um bloco de resumo (ex: "Total de vendas: 12",
// um rótulo e um valor por linha) que pode ter várias linhas antes da
// tabela de verdade começar.
const HEADER_SCAN_LIMIT = 40;

// Abaixo dessa proporção de células preenchidas (em relação à largura da
// tabela), a primeira linha é considerada esparsa demais pra ser um
// cabeçalho de tabela de verdade, e a busca continua nas linhas seguintes.
const SPARSE_HEADER_RATIO = 0.34;

// Abaixo desse percentual de preenchimento, uma coluna é avisada como
// "quase vazia" para o usuário revisar, em vez de seguir silenciosamente
// para os widgets (onde uma coluna assim vira agrupamento ruim).
const NEAR_EMPTY_RATIO = 0.1;

// Células mescladas com texto mais comprido que isso (uma frase corrida,
// não um rótulo curto de categoria) não são replicadas pelas outras
// células do intervalo mesclado — ver comentário em sheetToRows.
const MERGE_FILL_MAX_LENGTH = 60;

/**
 * Formata uma data (célula de data de verdade do Excel, não texto) como
 * dd/mm/aaaa — o formato que o resto do app já espera de uma coluna "Data"
 * (é o placeholder mostrado no filtro de intervalo de data, e o formato
 * que a detecção de tipo de coluna em format.ts reconhece).
 */
function formatDateCell(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Normaliza uma linha crua vinda de sheet_to_json: quando o workbook é lido
 * com `cellDates: true` (ver src/routes/index.tsx), uma célula formatada
 * como data no Excel chega aqui como objeto Date de verdade, não como
 * número/texto. Sem essa conversão a data vaza como Date pro resto do app —
 * que só sabe lidar com texto ("dd/mm/aaaa" ou ISO) ou número — e acaba
 * renderizada com o toString() cru do JS (com dia da semana, hora e fuso
 * horário) em vez de uma data legível.
 */
function normalizeRawRow(row: (string | number | Date | null)[]): (string | number | null)[] {
  return row.map((v) => (v instanceof Date ? formatDateCell(v) : v));
}

// Códigos de erro que o Excel escreve quando uma fórmula não consegue
// calcular (ex: divisão por zero num "Ticket médio" antes de ter vendas).
// Sintaticamente são texto, mas semanticamente são um valor quebrado, típico
// de célula de dado — nunca o nome de uma coluna.
const EXCEL_ERROR_PATTERN = /^#(DIV\/0!|N\/A|REF!|VALUE!|NAME\?|NULL!|NUM!|GETTING_DATA)$/;

function cellLooksNumeric(v: string | number | null): boolean {
  if (v === null || v === "") return false;
  if (typeof v === "number") return true;
  const s = String(v).trim();
  return /^-?\d+([.,]\d+)?%?$/.test(s) || EXCEL_ERROR_PATTERN.test(s);
}

/**
 * Uma linha "claramente não é cabeçalho" quando está inteiramente vazia ou
 * quando pelo menos uma célula preenchida parece um valor numérico. Um
 * cabeçalho de tabela de verdade é feito de rótulos (texto); qualquer
 * célula numérica nele é sinal de que a linha é, na verdade, um dado —
 * por exemplo um bloco de resumo tipo "Total de vendas: 12", onde cada
 * linha é um par rótulo/valor e não existe cabeçalho nenhum ali.
 */
function isClearlyNotHeaderRow(row: (string | number | null)[]): boolean {
  const filled = row.filter((c) => c !== null && c !== "");
  if (!filled.length) return true;
  return filled.some(cellLooksNumeric);
}

/**
 * Acha o índice da linha de cabeçalho real. Por padrão assume a primeira
 * linha (comportamento de sempre). Só procura mais abaixo quando a primeira
 * linha claramente não parece um cabeçalho (linha em branco, dominada por
 * valores numéricos) OU quando está esparsa demais (poucas células
 * preenchidas em relação à largura da tabela) — típico de planilhas de
 * formulário, que têm linhas de metadados no topo (ex: "Programa: X", uma
 * célula preenchida e o resto vazio) antes da tabela de verdade começar.
 * Nesse segundo caso, ficamos com a linha mais preenchida dentro da janela
 * de varredura, em vez da primeira linha "aceitável".
 */
function findHeaderRowIndex(aoa: (string | number | null)[][], bannerRows?: Set<number>): number {
  if (!aoa.length) return 0;
  const scanLimit = Math.min(HEADER_SCAN_LIMIT, aoa.length);
  const width = Math.max(1, ...aoa.slice(0, scanLimit).map((r) => r.length));

  const fillRatio = (row: (string | number | null)[]) =>
    row.filter((c) => c !== null && c !== "").length / width;
  const isBanner = (i: number) => bannerRows?.has(i) ?? false;

  const firstRow = aoa[0] ?? [];
  if (
    !isBanner(0) &&
    !isClearlyNotHeaderRow(firstRow) &&
    fillRatio(firstRow) >= SPARSE_HEADER_RATIO
  ) {
    return 0;
  }

  let bestIndex = -1;
  let bestScore = -1;
  for (let i = 0; i < scanLimit; i++) {
    if (isBanner(i)) continue;
    const row = aoa[i] ?? [];
    if (isClearlyNotHeaderRow(row)) continue;
    const score = fillRatio(row);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex === -1 ? 0 : bestIndex;
}

function prettyLabel(key: string): string {
  return key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------
// Blocos repetidos: planilhas onde a mesma mini-tabela (título + cabeçalho
// + linhas) aparece várias vezes dentro de UMA aba só — lado a lado e/ou
// empilhada verticalmente. Exemplo real: um bloco "Núcleo 1", "Núcleo 2"
// etc, cada um com seu próprio "Data | Total de tickets | ...", em vez de
// uma tabela única cobrindo a aba inteira. O caminho de importação normal
// (uma linha de cabeçalho, dados abaixo) não faz sentido nesse formato —
// aqui detectamos o padrão e cada bloco vira um grupo de linhas da mesma
// tabela final, com uma coluna extra identificando de qual bloco veio cada
// linha.
// ---------------------------------------------------------------------

const MIN_BLOCKS_FOR_MULTI_BLOCK_MODE = 2;

type HeaderRun = { row: number; startCol: number; endCol: number; headers: string[] };

type Block = {
  label: string;
  headerRowIndex: number;
  startCol: number;
  endCol: number;
  headers: string[];
  dataRows: (string | number | null)[][];
};

/**
 * Acha, dentro de uma linha, todas as sequências de pelo menos 2 células
 * preenchidas e não-numéricas seguidas (candidatas a cabeçalho de um
 * bloco). Uma linha pode ter mais de uma sequência dessas quando dois
 * blocos ficam lado a lado, separados por uma ou mais colunas vazias (ex:
 * "Núcleo 2" e "Núcleo 5" no mesmo intervalo de linhas, em colunas
 * diferentes).
 */
function headerRunsInRow(row: (string | number | null)[]): { startCol: number; endCol: number }[] {
  const runs: { startCol: number; endCol: number }[] = [];
  let c = 0;
  while (c < row.length) {
    const cell = row[c] ?? null;
    if (cell !== null && cell !== "" && !cellLooksNumeric(cell)) {
      const start = c;
      while (c + 1 < row.length) {
        const next = row[c + 1] ?? null;
        if (next === null || next === "" || cellLooksNumeric(next)) break;
        c++;
      }
      if (c - start + 1 >= 2) runs.push({ startCol: start, endCol: c });
    }
    c++;
  }
  return runs;
}

/**
 * Varre a aba inteira (não só o topo) procurando linhas candidatas a
 * cabeçalho de bloco: uma sequência de rótulos de texto com pelo menos uma
 * célula preenchida na linha logo abaixo, dentro da mesma faixa de
 * colunas — sem isso, seria só uma linha de texto solta (ex: uma legenda),
 * não o cabeçalho de uma tabela de verdade.
 */
function findHeaderCandidates(aoa: (string | number | null)[][]): HeaderRun[] {
  const candidates: HeaderRun[] = [];
  for (let r = 0; r < aoa.length; r++) {
    const row = (aoa[r] ?? []) as (string | number | null)[];
    const next = (aoa[r + 1] ?? []) as (string | number | null)[];
    for (const run of headerRunsInRow(row)) {
      const hasDataBelow = next
        .slice(run.startCol, run.endCol + 1)
        .some((c) => c !== null && c !== "");
      if (!hasDataBelow) continue;
      const headers: string[] = [];
      for (let c = run.startCol; c <= run.endCol; c++) headers.push(String(row[c]).trim());
      candidates.push({ row: r, startCol: run.startCol, endCol: run.endCol, headers });
    }
  }
  return candidates;
}

function normalizedHeaderKey(headers: string[]): string {
  return headers.map((h) => h.trim().toLowerCase()).join("|");
}

/**
 * Procura, na linha logo acima de um cabeçalho de bloco, um título isolado
 * (a única célula preenchida numa janela em volta do início da faixa de
 * colunas do bloco) — ex: "Núcleo 1" sozinho numa linha, imediatamente
 * acima de "Data | Total de tickets | ...". Não exige que o título esteja
 * exatamente alinhado com o cabeçalho, só que seja o único conteúdo por
 * perto.
 */
function findBlockLabel(
  aoa: (string | number | null)[][],
  headerRowIndex: number,
  startCol: number,
  endCol: number,
): string | null {
  // A janela de busca é exatamente a faixa de colunas do próprio bloco
  // (sem folga pra nenhum dos lados): um título mesclado cobre a mesma
  // largura do cabeçalho abaixo dele, e um título isolado (célula única,
  // sem mesclagem) sempre cai dentro do início dessa faixa. Alargar a
  // janela pra fora da faixa do bloco fazia vazar o título do bloco VIZINHO
  // quando dois blocos ficam lado a lado (ex: "Núcleo 2" e "Núcleo 5" no
  // mesmo intervalo de linhas), misturando os dois valores e descartando o
  // rótulo por engano.
  const aboveRow = (aoa[headerRowIndex - 1] ?? []) as (string | number | null)[];
  const filled: (string | number)[] = [];
  aboveRow.forEach((v, c) => {
    if (v !== null && v !== "" && c >= startCol && c <= endCol) filled.push(v);
  });
  if (!filled.length) return null;
  // Um título mesclado horizontalmente (ex: "Núcleo 1" cobrindo F2:K2) já
  // chega aqui com o mesmo valor repetido em várias células, por causa do
  // preenchimento de mesclagem feito antes da detecção de blocos — nesse
  // caso todas as células preenchidas da janela têm o mesmo valor. Um
  // título não-mesclado (uma célula só) sempre bate nesse critério
  // trivialmente. Só desistimos quando a janela tem valores DIFERENTES
  // (não é um título isolado, é conteúdo genuíno de mais de uma célula).
  const distinct = new Set(filled.map((v) => String(v).trim()));
  if (distinct.size !== 1) return null;
  return [...distinct][0]!;
}

/**
 * A partir dos rótulos de cada bloco (ex: "Núcleo 1", "Núcleo 2", "Núcleo
 * 3"...), tenta achar um nome comum pra coluna extra que vai identificar a
 * origem de cada linha (ex: "Núcleo"), removendo o número final de cada
 * rótulo. Se os rótulos não seguirem um padrão comum, usa "Bloco" como
 * nome genérico.
 */
function commonBlockColumnName(labels: string[]): string {
  const stripped = labels.map((l) => l.replace(/\s*\d+\s*$/, "").trim()).filter(Boolean);
  const unique = new Set(stripped);
  return unique.size === 1 ? [...unique][0]! : "Bloco";
}

/**
 * Detecta o padrão de "várias mini-tabelas repetidas na mesma aba". Só é
 * acionado quando pelo menos duas linhas de cabeçalho candidatas têm
 * exatamente o mesmo conjunto de rótulos (sinal forte de tabela repetida,
 * não uma linha de texto solta parecida por coincidência) — uma aba com
 * tabela única normal nunca bate nesse critério (só existe uma linha de
 * cabeçalho na aba inteira), então o caminho de importação de sempre
 * continua funcionando sem mudança pra todo o resto dos arquivos já
 * suportados.
 */
function detectBlocks(aoa: (string | number | null)[][]): Block[] | null {
  const candidates = findHeaderCandidates(aoa);
  if (candidates.length < MIN_BLOCKS_FOR_MULTI_BLOCK_MODE) return null;

  const bySignature = new Map<string, HeaderRun[]>();
  for (const c of candidates) {
    const key = normalizedHeaderKey(c.headers);
    const list = bySignature.get(key) ?? [];
    list.push(c);
    bySignature.set(key, list);
  }
  const repeated = [...bySignature.values()].filter(
    (list) => list.length >= MIN_BLOCKS_FOR_MULTI_BLOCK_MODE,
  );
  if (!repeated.length) return null;
  // Usa o maior grupo de cabeçalhos repetidos (a assinatura que mais se
  // repete na aba) como os blocos de verdade; candidatos isolados de fora
  // desse grupo (texto solto que por acaso parecia cabeçalho) são
  // ignorados.
  const chosen = repeated.reduce((a, b) => (b.length > a.length ? b : a));

  // Uma tabela única grande e homogênea (ex: 150 linhas de vendas) pode ter
  // colunas de texto com poucos valores possíveis (ex: "Forma de Pagamento",
  // "Status", "Cidade") — quando duas linhas de DADO comuns têm, por
  // coincidência, a mesma combinação de valores lado a lado, elas batem no
  // mesmo critério de "cabeçalho candidato" usado acima, e a tabela inteira
  // é destruída, virando blocos sem sentido nenhum. O sinal de verdade que
  // separa um cabeçalho de bloco genuíno (ex: "Núcleo 1", "Núcleo 2"...) de
  // uma linha de dado comum é ter um título isolado bem acima dele — exigir
  // isso pra todos os blocos escolhidos filtra praticamente todo falso
  // positivo, já que dado comum nunca tem um título isolado só seu.
  const labels = chosen.map((run) => findBlockLabel(aoa, run.row, run.startCol, run.endCol));
  if (labels.some((l) => l === null)) return null;

  // Linhas "reservadas": o cabeçalho de cada bloco e a linha do título
  // logo acima dele. Ao coletar as linhas de dado de um bloco, paramos ao
  // encontrar qualquer uma dessas linhas — mesmo que não estejam
  // totalmente em branco na faixa de colunas do bloco atual (ex: o título
  // "Núcleo 3" de um bloco empilhado abaixo cai dentro da mesma faixa de
  // colunas do bloco anterior).
  const reservedRows = new Set<number>();
  for (const run of chosen) {
    reservedRows.add(run.row);
    reservedRows.add(run.row - 1);
  }

  return chosen.map((run, index) => {
    const label = labels[index] ?? `Bloco ${index + 1}`;
    const dataRows: (string | number | null)[][] = [];
    let blankStreak = 0;
    for (let r = run.row + 1; r < aoa.length; r++) {
      if (reservedRows.has(r)) break;
      const row = (aoa[r] ?? []) as (string | number | null)[];
      const slice = row.slice(run.startCol, run.endCol + 1);
      const isBlank = slice.every((c) => c === null || c === "");
      if (isBlank) {
        blankStreak++;
        if (blankStreak >= 3) break; // rede de segurança pro último bloco da aba
        continue;
      }
      blankStreak = 0;
      dataRows.push(slice);
    }
    return {
      label,
      headerRowIndex: run.row,
      startCol: run.startCol,
      endCol: run.endCol,
      headers: run.headers,
      dataRows,
    };
  });
}

/**
 * Combina os blocos detectados numa única tabela: uma coluna extra
 * identifica de qual bloco veio cada linha, e as demais colunas usam os
 * rótulos de cabeçalho do primeiro bloco (todos os blocos do grupo têm o
 * mesmo cabeçalho, por definição de `detectBlocks`).
 */
function blocksToRows(blocks: Block[]): { rows: Row[]; blockColumnName: string } {
  const blockColumnName = commonBlockColumnName(blocks.map((b) => b.label));
  const seen = new Map<string, number>();
  seen.set(blockColumnName, 1);
  const headers = blocks[0]!.headers.map((raw) => {
    const base = raw === "" ? "coluna" : raw;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });

  const rows: Row[] = [];
  for (const block of blocks) {
    for (const dataRow of block.dataRows) {
      const obj: Row = { [blockColumnName]: block.label };
      headers.forEach((h, i) => {
        const v = dataRow[i];
        obj[h] = v === undefined ? null : v;
      });
      rows.push(obj);
    }
  }
  return { rows, blockColumnName };
}

/**
 * Converte uma aba de planilha (XLSX.WorkSheet) em linhas, tratando alguns
 * problemas comuns de arquivos reais:
 * - Linha de cabeçalho deslocada: quando a primeira linha não parece um
 *   cabeçalho (linha de título, célula solta, linha em branco), procura a
 *   linha de cabeçalho real nas próximas linhas em vez de importar tudo a
 *   partir de uma linha errada.
 * - Colunas com o mesmo nome no cabeçalho: em vez de uma sobrescrever a
 *   outra (o que perderia dados silenciosamente), a repetida ganha um
 *   sufixo numérico.
 * - Linhas inteiramente em branco no meio da base: são ignoradas, em vez de
 *   virarem uma linha de valores nulos que atrapalha totais e gráficos.
 * - Colunas quase vazias: geram um aviso para o usuário revisar, em vez de
 *   seguirem silenciosamente para os widgets (onde acabam escolhidas como
 *   agrupamento e dominam o painel de "Não informado").
 * Um arquivo vazio (sem linhas de dados) retorna rows: [].
 */
export function sheetToRows(ws: XLSX.WorkSheet): SheetImportResult {
  const rawAoa = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(ws, {
    header: 1,
    defval: null,
  });
  const aoa = rawAoa.map(normalizeRawRow);

  // Células mescladas: o Excel só guarda o valor na célula de origem
  // (canto superior esquerdo do intervalo mesclado); as demais ficam
  // vazias no arquivo, mesmo aparecendo com o mesmo texto/valor "espalhado"
  // visualmente na planilha inteira. Isso acontece tanto no cabeçalho
  // (mesclagem horizontal, ex: uma categoria cobrindo várias colunas)
  // quanto nas linhas de dados (mesclagem vertical, ex: um item de compra
  // cujo código e descrição cobrem várias linhas de fornecedores
  // concorrentes abaixo dele). Preenchemos aqui, pra toda a planilha, antes
  // de decidir qual linha é o cabeçalho — copiando o valor da célula de
  // origem de cada mesclagem para todas as células vazias dentro do
  // intervalo mesclado.
  // As coordenadas de "!merges" são absolutas (a partir de A1/linha 1),
  // mas `aoa` só cobre o intervalo realmente usado da planilha
  // (`ws["!ref"]`), que raramente começa em A1 num arquivo real (aqui,
  // por exemplo, os dados começam em B2). Sem converter pra coordenadas
  // relativas a esse intervalo antes de indexar `aoa`, o preenchimento de
  // mesclagem mira nas células erradas — silenciosamente, sem gerar erro,
  // só preenchendo (ou deixando de preencher) a coluna/linha vizinha
  // errada. Esse bug já existia antes desta função ter suporte a blocos
  // repetidos; ele só não aparecia nos testes porque `aoa_to_sheet` (usado
  // nos testes) sempre cria planilhas começando em A1, onde o offset é
  // zero e o bug fica invisível.
  const range = ws["!ref"]
    ? XLSX.utils.decode_range(ws["!ref"])
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };

  // Células com fórmula mas sem valor calculado guardado no arquivo (comum
  // em planilhas geradas por script, que escrevem a fórmula mas nunca a
  // calculam de verdade): tenta recuperar o valor avaliando a fórmula
  // (só fórmulas simples da mesma aba/linha — ver resolveFormulaCell).
  // `cache` é compartilhado entre todas as células da aba nesta passagem
  // pra não reavaliar a mesma referência várias vezes.
  const formulaCache = new Map<string, number | null>();
  const width = range.e.c - range.s.c + 1;
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] as (string | number | null)[];
    // Loop com índice explícito até a largura real da planilha (não
    // `row.length`), de propósito, em vez de forEach: uma célula "stub"
    // (fórmula sem valor calculado, só existe no objeto da planilha porque
    // lemos com sheetStubs: true — ver formula.ts) faz sheet_to_json ou
    // deixar um buraco de verdade no array nessa posição (que forEach pula
    // silenciosamente, mesmo aparecendo como null no JSON.stringify), ou —
    // quando é a última coluna com dado real na linha — nem chegar a
    // incluir essa posição no array, encurtando row.length antes da hora.
    for (let c = 0; c < width; c++) {
      const v = row[c];
      if (v !== null && v !== undefined) continue;
      const addr = XLSX.utils.encode_cell({ r: r + range.s.r, c: c + range.s.c });
      const resolved = resolveFormulaCell(ws, addr, formulaCache);
      if (resolved !== null) row[c] = resolved;
    }
  }

  const merges = (ws["!merges"] ?? []).map((m) => ({
    s: { r: m.s.r - range.s.r, c: m.s.c - range.s.c },
    e: { r: m.e.r - range.s.r, c: m.e.c - range.s.c },
  }));

  // Linhas "banner": uma linha cujo único conteúdo original era uma célula
  // só, mesclada horizontalmente por cima de várias colunas (ex: um título
  // de relatório "RESUMO DE VENDAS" cobrindo A1:D1). O preenchimento de
  // mesclagem abaixo faz essa linha parecer um cabeçalho "cheio" (mesmo
  // texto repetido em toda a largura), mas não é uma linha de cabeçalho de
  // tabela de verdade — é só um título espalhado. Guardamos isso com base
  // na mesclagem real, não comparando texto repetido, para não confundir
  // com um cabeçalho legítimo que por acaso tem duas colunas com o mesmo
  // nome digitado à mão (ex: "nome" | "nome").
  const originalFilledCount = new Map<number, number>();
  aoa.forEach((row, i) => {
    originalFilledCount.set(
      i,
      ((row ?? []) as (string | number | null)[]).filter((c) => c !== null && c !== "").length,
    );
  });
  const bannerRows = new Set<number>();
  for (const m of merges) {
    if (m.e.c > m.s.c && m.s.r === m.e.r && originalFilledCount.get(m.s.r) === 1) {
      bannerRows.add(m.s.r);
    }
  }

  const filledByRow = new Map<number, number>();
  for (const m of merges) {
    const originRow = (aoa[m.s.r] ?? []) as (string | number | null)[];
    const originValue = originRow[m.s.c];
    if (originValue === null || originValue === undefined || originValue === "") continue;
    // Uma célula mesclada cobrindo texto muito comprido (uma frase, uma
    // nota de rodapé) normalmente é só um truque visual pra caber o texto
    // na tela — não significa que aquele valor se repete em cada coluna
    // coberta como um rótulo de categoria repetiria. Replicar esse texto
    // em várias colunas faria uma linha de nota parecer uma linha de dado
    // "cheia" pro resto do pipeline (inclusive escapando do corte de notas
    // soltas no fim da planilha). Isso só vale pra mesclagem HORIZONTAL
    // (várias colunas): uma mesclagem VERTICAL (uma coluna só, várias
    // linhas) é sempre dado legítimo repetindo, mesmo com texto longo —
    // por exemplo, a descrição de um item de compra mesclada cobrindo as
    // linhas de cada fornecedor concorrente abaixo dele. Sem essa
    // distinção, descrições longas ficavam com "Não informado" nas linhas
    // de baixo, enquanto descrições curtas (que não disparavam o corte)
    // funcionavam normalmente.
    const isHorizontalMerge = m.e.c > m.s.c;
    if (
      isHorizontalMerge &&
      typeof originValue === "string" &&
      originValue.length > MERGE_FILL_MAX_LENGTH
    )
      continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      const row = (aoa[r] ?? []) as (string | number | null)[];
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        if (row[c] === null || row[c] === undefined || row[c] === "") {
          row[c] = originValue;
          filledByRow.set(r, (filledByRow.get(r) ?? 0) + 1);
        }
      }
    }
  }

  // Planilhas com várias mini-tabelas repetidas na mesma aba (ex: um bloco
  // "Núcleo 1", "Núcleo 2"... cada um com seu próprio cabeçalho e linhas)
  // seguem um caminho totalmente diferente do resto da função: não existe
  // "a" linha de cabeçalho da aba, existem várias, uma por bloco. Ver
  // `detectBlocks` para o critério de detecção (conservador o bastante pra
  // nunca disparar numa aba de tabela única normal).
  const blocks = detectBlocks(aoa);
  if (blocks && blocks.length >= MIN_BLOCKS_FOR_MULTI_BLOCK_MODE) {
    const { rows: blockRows, blockColumnName } = blocksToRows(blocks);
    const dataHeaders = blocks[0]!.headers;

    const nearEmptyColumns =
      blockRows.length >= 5
        ? dataHeaders.filter((h) => {
            const filled = blockRows.filter((r) => r[h] !== null && r[h] !== "").length;
            return filled / blockRows.length < NEAR_EMPTY_RATIO;
          })
        : [];

    const blockMessages: string[] = [
      `Esta aba tem ${blocks.length} blocos de tabela repetidos (${blocks
        .map((b) => `"${b.label}"`)
        .join(
          ", ",
        )}), cada um com seu próprio título e cabeçalho. Foram combinados em uma única tabela, com a coluna "${blockColumnName}" indicando de qual bloco veio cada linha. Confira se a combinação ficou correta.`,
    ];
    if (nearEmptyColumns.length > 0) {
      const names = nearEmptyColumns.map((h) => `"${prettyLabel(h)}"`).join(", ");
      blockMessages.push(
        `${nearEmptyColumns.length > 1 ? "As colunas" : "A coluna"} ${names} ${nearEmptyColumns.length > 1 ? "estão" : "está"} quase ${nearEmptyColumns.length > 1 ? "vazias" : "vazia"} em todos os blocos. Confira se ${nearEmptyColumns.length > 1 ? "elas foram importadas" : "ela foi importada"} corretamente antes de usá-la${nearEmptyColumns.length > 1 ? "s" : ""} em um gráfico.`,
      );
    }

    return { rows: blockRows, warning: blockMessages.join(" "), diagnostics: diagnoseImportedSheet(ws, blockRows) };
  }

  const headerRowIndex = findHeaderRowIndex(aoa, bannerRows);
  const headerRow = (aoa[headerRowIndex] ?? []) as (string | number | null)[];
  const mergedHeaderCells = filledByRow.get(headerRowIndex) ?? 0;
  let mergedCells = 0;
  for (const [row, count] of filledByRow) {
    if (row !== headerRowIndex) mergedCells += count;
  }

  const seen = new Map<string, number>();
  let renamed = 0;
  const headerWasBlank: boolean[] = [];
  const headers = headerRow.map((raw, i) => {
    headerWasBlank[i] = raw === null || raw === "";
    const base = raw === null || raw === "" ? `coluna_${i + 1}` : String(raw).trim();
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return base;
    renamed++;
    return `${base}_${count + 1}`;
  });

  const dataRows: Row[] = headers.length
    ? aoa.slice(headerRowIndex + 1).map((row) => {
        const obj: Row = {};
        headers.forEach((h, i) => {
          const v = row[i];
          obj[h] = v === undefined ? null : v;
        });
        return obj;
      })
    : [];

  // Linhas inteiramente em branco (comum em planilhas com um monte de
  // linhas "sobrando" formatadas mas nunca usadas) são removidas ANTES do
  // corte de notas do fim, senão elas ocupam sozinhas o orçamento do corte
  // e a nota de verdade (que está antes delas no arquivo) nunca é
  // alcançada.
  const nonBlankRows = dataRows.filter((r) => Object.values(r).some((v) => v !== null && v !== ""));
  const blankSkipped = dataRows.length - nonBlankRows.length;

  // Notas/resumo soltos no fim da planilha (comum em formulários que
  // fecham com um texto corrido, ex: "Total da compra: R$X — verificar
  // documentação da empresa vencedora") acabam contaminando uma coluna
  // quase vazia com fragmentos de texto, como se fossem mais uma linha de
  // dado da tabela. Cortamos uma sequência contígua de linhas no FIM da
  // planilha (já sem as linhas em branco) que estão claramente esparsas
  // demais pra pertencer à mesma tabela (a maioria das colunas vazia),
  // parando assim que encontrarmos, de baixo pra cima, uma linha que
  // parece dado de verdade. O corte é limitado a um número pequeno de
  // linhas para não arriscar apagar dados reais caso o arquivo simplesmente
  // tenha linhas finais esparsas.
  const TRAILING_NOTE_FILL_RATIO = 0.25;
  const MAX_TRAILING_TRIM = 10;
  const rows = [...nonBlankRows];
  let trailingNotesTrimmed = 0;
  while (
    rows.length > 1 &&
    trailingNotesTrimmed < MAX_TRAILING_TRIM &&
    trailingNotesTrimmed < rows.length - 1
  ) {
    const last = rows[rows.length - 1 - trailingNotesTrimmed];
    if (!last) break;
    const filled = Object.values(last).filter((v) => v !== null && v !== "").length;
    if (filled / headers.length >= TRAILING_NOTE_FILL_RATIO) break;
    trailingNotesTrimmed++;
  }
  if (trailingNotesTrimmed > 0) rows.length -= trailingNotesTrimmed;

  // Colunas sem nenhum texto no cabeçalho E quase sem dados: quase sempre
  // são um fragmento solto capturado só por estar dentro do retângulo de
  // células usadas da planilha (ex: uma anotação de rodapé que sobrou fora
  // do corte de notas acima, ou uma célula formatada mas nunca preenchida),
  // não uma coluna real da tabela. Descartamos em vez de expor como
  // "Coluna N" com dado sem sentido. Uma coluna sem nome mas com dados de
  // verdade continua sendo importada normalmente, com um nome genérico.
  const ghostColumns =
    rows.length >= 5
      ? headers.filter((h, i) => {
          if (!headerWasBlank[i]) return false;
          const filled = rows.filter((r) => r[h] !== null && r[h] !== "").length;
          return filled / rows.length < NEAR_EMPTY_RATIO;
        })
      : [];
  const finalHeaders = ghostColumns.length
    ? headers.filter((h) => !ghostColumns.includes(h))
    : headers;
  const finalRows: Row[] = ghostColumns.length
    ? rows.map((r) => {
        const clean: Row = {};
        for (const h of finalHeaders) clean[h] = r[h] ?? null;
        return clean;
      })
    : rows;

  const nearEmptyColumns =
    finalRows.length >= 5
      ? finalHeaders.filter((h) => {
          const filled = finalRows.filter((r) => r[h] !== null && r[h] !== "").length;
          return filled / finalRows.length < NEAR_EMPTY_RATIO;
        })
      : [];

  const messages: string[] = [];
  if (headerRowIndex > 0) {
    messages.push(
      `O cabeçalho foi identificado na linha ${headerRowIndex + 1} da planilha, porque o conteúdo acima não parecia um cabeçalho válido. Confira se a identificação ficou correta.`,
    );
  }
  if (mergedHeaderCells > 0) {
    messages.push(
      `${mergedHeaderCells} coluna${mergedHeaderCells > 1 ? "s" : ""} do cabeçalho vinha${mergedHeaderCells > 1 ? "m" : ""} de célula${mergedHeaderCells > 1 ? "s" : ""} mesclada${mergedHeaderCells > 1 ? "s" : ""} na planilha original. Usamos o nome do grupo pra elas, mas talvez você queira renomeá-las individualmente no painel de colunas.`,
    );
  }
  if (mergedCells > 0) {
    messages.push(
      `${mergedCells} célula${mergedCells > 1 ? "s" : ""} de dado${mergedCells > 1 ? "s" : ""} vinha${mergedCells > 1 ? "m" : ""} de célula${mergedCells > 1 ? "s" : ""} mesclada${mergedCells > 1 ? "s" : ""} verticalmente na planilha original (ex: um item cobrindo várias linhas de fornecedores). Repetimos o valor da célula de origem em cada linha, em vez de deixar "Não informado" nas linhas vazias.`,
    );
  }
  if (trailingNotesTrimmed > 0) {
    messages.push(
      `${trailingNotesTrimmed} linha${trailingNotesTrimmed > 1 ? "s" : ""} no fim da planilha ${trailingNotesTrimmed > 1 ? "pareciam" : "parecia"} nota${trailingNotesTrimmed > 1 ? "s" : ""}/resumo solto${trailingNotesTrimmed > 1 ? "s" : ""} em vez de dado da tabela (a maioria das colunas vazia) e ${trailingNotesTrimmed > 1 ? "foram ignoradas" : "foi ignorada"}. Confira o fim do arquivo se algum dado real tiver sumido.`,
    );
  }
  if (renamed > 0) {
    messages.push(
      `${renamed} coluna${renamed > 1 ? "s" : ""} com nome repetido no cabeçalho ${renamed > 1 ? "foram" : "foi"} renomeada${renamed > 1 ? "s" : ""} para não perder dados.`,
    );
  }
  if (ghostColumns.length > 0) {
    messages.push(
      `${ghostColumns.length > 1 ? "Foram encontradas colunas" : "Foi encontrada uma coluna"} sem nenhum texto no cabeçalho e quase sem dados (provavelmente um fragmento fora da tabela) e ${ghostColumns.length > 1 ? "elas foram removidas" : "ela foi removida"} automaticamente da importação.`,
    );
  }
  if (nearEmptyColumns.length > 0) {
    const names = nearEmptyColumns.map((h) => `"${prettyLabel(h)}"`).join(", ");
    messages.push(
      `${nearEmptyColumns.length > 1 ? "As colunas" : "A coluna"} ${names} ${nearEmptyColumns.length > 1 ? "estão" : "está"} quase ${nearEmptyColumns.length > 1 ? "vazias" : "vazia"}. Confira se ${nearEmptyColumns.length > 1 ? "elas foram importadas" : "ela foi importada"} corretamente antes de usá-la${nearEmptyColumns.length > 1 ? "s" : ""} em um gráfico.`,
    );
  }
  if (blankSkipped > 0) {
    messages.push(
      `${blankSkipped} linha${blankSkipped > 1 ? "s" : ""} em branco no meio dos dados ${blankSkipped > 1 ? "foram" : "foi"} ignorada${blankSkipped > 1 ? "s" : ""}.`,
    );
  }

  return {
    rows: finalRows,
    warning: messages.length ? messages.join(" ") : null,
    diagnostics: diagnoseImportedSheet(ws, finalRows),
  };
}

// Acima desse tamanho, mostramos um aviso de que o processamento pode
// demorar alguns segundos (não há como medir progresso real de bytes com a
// biblioteca de leitura usada, que processa o arquivo de uma vez).
export const LARGE_FILE_BYTES = 5 * 1024 * 1024;

export type SheetOption = {
  name: string;
  rows: Row[];
  warning: string | null;
  diagnostics?: ImportDiagnostics;
};

/**
 * Converte todas as abas de um workbook em opções de importação, pulando
 * automaticamente abas sem nenhuma linha de dado (ex: uma aba "Página1"
 * vazia que sobrou de um template). Usada para montar o seletor de aba
 * quando o arquivo tem mais de uma aba com dado.
 */
export function sheetsWithData(wb: XLSX.WorkBook): SheetOption[] {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws) return { name, rows: [], warning: null };
    const { rows, warning, diagnostics } = sheetToRows(ws);
    return { name, rows, warning, diagnostics };
  }).filter((s) => s.rows.length > 0);
}

/**
 * Índice da aba que deveria vir pré-selecionada no seletor: a primeira com
 * pelo menos uma linha de dado. Se nenhuma tiver dado, cai no índice 0 (a
 * UI que chama isso trata separadamente o caso de "nenhuma aba com dado").
 */
export function preferredSheetIndex(sheets: SheetOption[]): number {
  const i = sheets.findIndex((s) => s.rows.length > 0);
  return i === -1 ? 0 : i;
}
