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
 * linha (comportamento de sempre), só olhando para linhas seguintes quando
 * a primeira linha claramente não parece um cabeçalho (linha em branco, ou
 * dominada por valores numéricos, como uma linha de título quebrada ou uma
 * célula que vazou de outro lugar da planilha).
 */
function findHeaderRowIndex(aoa: (string | number | null)[][]): number {
  if (!aoa.length) return 0;
  if (!isClearlyNotHeaderRow(aoa[0] ?? [])) return 0;
  const scanLimit = Math.min(HEADER_SCAN_LIMIT, aoa.length);
  for (let i = 1; i < scanLimit; i++) {
    if (!isClearlyNotHeaderRow(aoa[i] ?? [])) return i;
  }
  return 0; // não achou nada melhor nas primeiras linhas: mantém o padrão anterior
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
