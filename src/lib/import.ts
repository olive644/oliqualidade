import * as XLSX from "xlsx";
import type { Row } from "@/lib/types";

export type SheetImportResult = {
  rows: Row[];
  warning: string | null; // aviso não bloqueante: colunas renomeadas, linha de cabeçalho deslocada, colunas quase vazias e/ou linhas em branco ignoradas
};

// Quantas linhas do topo da planilha são avaliadas para achar a linha de
// cabeçalho de verdade (cobre o caso comum de uma linha de título ou uma
// linha em branco acima do cabeçalho real).
const HEADER_SCAN_LIMIT = 10;

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

function cellLooksNumeric(v: string | number | null): boolean {
  if (v === null || v === "") return false;
  if (typeof v === "number") return true;
  return /^-?\d+([.,]\d+)?%?$/.test(String(v).trim());
}

/**
 * Uma linha "claramente não é cabeçalho" quando está inteiramente vazia ou
 * quando a maioria das células preenchidas parece um valor numérico (o que
 * é típico de uma linha de dados, ou de um valor solto que vazou para cima
 * do cabeçalho real, ex: uma célula mesclada quebrada).
 */
function isClearlyNotHeaderRow(row: (string | number | null)[]): boolean {
  const filled = row.filter((c) => c !== null && c !== "");
  if (!filled.length) return true;
  const numericCount = filled.filter(cellLooksNumeric).length;
  return numericCount / filled.length > 0.5;
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
function findHeaderRowIndex(aoa: (string | number | null)[][]): number {
  if (!aoa.length) return 0;
  const scanLimit = Math.min(HEADER_SCAN_LIMIT, aoa.length);
  const width = Math.max(1, ...aoa.slice(0, scanLimit).map((r) => r.length));

  const fillRatio = (row: (string | number | null)[]) =>
    row.filter((c) => c !== null && c !== "").length / width;

  const firstRow = aoa[0] ?? [];
  if (!isClearlyNotHeaderRow(firstRow) && fillRatio(firstRow) >= SPARSE_HEADER_RATIO) {
    return 0;
  }

  let bestIndex = -1;
  let bestScore = -1;
  for (let i = 0; i < scanLimit; i++) {
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
  const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

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
  const merges = ws["!merges"] ?? [];
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
    // soltas no fim da planilha), então essas mesclagens são ignoradas.
    if (typeof originValue === "string" && originValue.length > MERGE_FILL_MAX_LENGTH) continue;
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

  const headerRowIndex = findHeaderRowIndex(aoa);
  const headerRow = (aoa[headerRowIndex] ?? []) as (string | number | null)[];
  const mergedHeaderCells = filledByRow.get(headerRowIndex) ?? 0;
  let mergedCells = 0;
  for (const [row, count] of filledByRow) {
    if (row !== headerRowIndex) mergedCells += count;
  }

  const seen = new Map<string, number>();
  let renamed = 0;
  const headers = headerRow.map((raw, i) => {
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

  // Notas/resumo soltos no fim da planilha (comum em formulários que
  // fecham com um texto corrido, ex: "Total da compra: R$X — verificar
  // documentação da empresa vencedora") acabam contaminando uma coluna
  // quase vazia com fragmentos de texto, como se fossem mais uma linha de
  // dado da tabela. Cortamos uma sequência contígua de linhas no FIM da
  // planilha que estão claramente esparsas demais pra pertencer à mesma
  // tabela (a maioria das colunas vazia), parando assim que encontrarmos,
  // de baixo pra cima, uma linha que parece dado de verdade. O corte é
  // limitado a um número pequeno de linhas para não arriscar apagar dados
  // reais caso o arquivo simplesmente tenha linhas finais esparsas.
  const TRAILING_NOTE_FILL_RATIO = 0.25;
  const MAX_TRAILING_TRIM = 10;
  let trailingNotesTrimmed = 0;
  while (
    dataRows.length > 1 &&
    trailingNotesTrimmed < MAX_TRAILING_TRIM &&
    trailingNotesTrimmed < dataRows.length - 1
  ) {
    const last = dataRows[dataRows.length - 1 - trailingNotesTrimmed];
    if (!last) break;
    const filled = Object.values(last).filter((v) => v !== null && v !== "").length;
    if (filled / headers.length >= TRAILING_NOTE_FILL_RATIO) break;
    trailingNotesTrimmed++;
  }
  if (trailingNotesTrimmed > 0) dataRows.length -= trailingNotesTrimmed;

  const rows = dataRows.filter((r) => Object.values(r).some((v) => v !== null && v !== ""));
  const blankSkipped = dataRows.length - rows.length;

  const nearEmptyColumns =
    rows.length >= 5
      ? headers.filter((h) => {
          const filled = rows.filter((r) => r[h] !== null && r[h] !== "").length;
          return filled / rows.length < NEAR_EMPTY_RATIO;
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
      `${renamed} coluna${renamed > 1 ? "s" : ""} com nome repetido no cabeçalho foi${renamed > 1 ? "ram" : ""} renomeada${renamed > 1 ? "s" : ""} para não perder dados.`,
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
      `${blankSkipped} linha${blankSkipped > 1 ? "s" : ""} em branco no meio dos dados foi${blankSkipped > 1 ? "ram" : ""} ignorada${blankSkipped > 1 ? "s" : ""}.`,
    );
  }

  return { rows, warning: messages.length ? messages.join(" ") : null };
}

// Acima desse tamanho, mostramos um aviso de que o processamento pode
// demorar alguns segundos (não há como medir progresso real de bytes com a
// biblioteca de leitura usada, que processa o arquivo de uma vez).
export const LARGE_FILE_BYTES = 5 * 1024 * 1024;
