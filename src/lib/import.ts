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
  const headerRowIndex = findHeaderRowIndex(aoa);
  const headerRow = (aoa[headerRowIndex] ?? []) as (string | number | null)[];

  // Células mescladas: o Excel só guarda o valor na célula de origem
  // (canto superior esquerdo do intervalo mesclado); as demais ficam
  // vazias no arquivo, mesmo aparecendo com o mesmo texto "espalhado"
  // visualmente na planilha. Sem tratar isso, cada célula vazia de uma
  // mesclagem no cabeçalho viraria uma coluna "coluna_N" sem nome, mesmo
  // com um cabeçalho todo preenchido do ponto de vista do usuário. Aqui,
  // pra cada mesclagem que cobre a linha de cabeçalho, copiamos o valor da
  // célula de origem (de qualquer linha do intervalo mesclado, cobrindo
  // tanto mesclagem horizontal quanto vertical) para as células vazias
  // dentro do intervalo, na linha de cabeçalho.
  const merges = ws["!merges"] ?? [];
  let mergedHeaderCells = 0;
  for (const m of merges) {
    if (headerRowIndex < m.s.r || headerRowIndex > m.e.r) continue;
    const originRow = (aoa[m.s.r] ?? []) as (string | number | null)[];
    const originValue = originRow[m.s.c];
    if (originValue === null || originValue === "") continue;
    for (let c = m.s.c; c <= m.e.c; c++) {
      const cell = headerRow[c];
      if (cell === null || cell === undefined || cell === "") {
        headerRow[c] = originValue ?? null;
        mergedHeaderCells++;
      }
    }
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

  const dataRows = headers.length
    ? XLSX.utils.sheet_to_json<Row>(ws, {
        header: headers,
        range: headerRowIndex + 1,
        defval: null,
      })
    : [];
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
