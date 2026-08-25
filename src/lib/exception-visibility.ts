import { sourceRowIndexOf } from "@/lib/data-review";
import type { Row } from "@/lib/types";

/** O mínimo que uma pendência precisa expor para ser restringida por linha. */
type RowScoped = { rowIndex?: number };

/**
 * Restringe as pendências às linhas que o filtro atual deixou visíveis.
 *
 * Existe porque a contagem de pendências aparece em dois lugares (o aviso no
 * topo e a barra lateral) e o painel de exceções mostra a lista. Se a
 * contagem partisse do conjunto inteiro enquanto a lista respeita o filtro,
 * os dois números nunca bateriam com um filtro ativo, e o de cima seria o
 * errado: ele estaria falando de linhas que a pessoa não está vendo.
 *
 * Duas regras sustentam o resultado:
 *
 * - `rowIndex` das pendências é numerado a partir de 1, como a linha do
 *   Excel; o índice guardado na linha é a posição a partir de 0. A soma de 1
 *   é a tradução entre os dois, e trocá-la desloca a contagem inteira em uma
 *   linha sem quebrar nada visivelmente.
 * - Pendência sem `rowIndex` é da planilha como um todo (divergência entre
 *   leitores, unidade incompatível na coluna). Ela não pertence a linha
 *   nenhuma, então nenhum filtro de linha pode escondê-la.
 */
export function exceptionsWithinVisibleRows<T extends RowScoped>(
  exceptions: readonly T[],
  visibleRows: readonly Row[],
): T[] {
  const visible = visibleSourceRowNumbers(visibleRows);
  return exceptions.filter(
    (exception) => exception.rowIndex === undefined || visible.has(exception.rowIndex),
  );
}

/**
 * Números de linha da planilha original (base 1) presentes nas linhas dadas.
 *
 * Linha sem rastro de origem — criada por transformação, como um bloco
 * unificado — fica de fora, porque não há número de linha para comparar.
 */
export function visibleSourceRowNumbers(rows: readonly Row[]): Set<number> {
  const numbers = new Set<number>();
  for (const row of rows) {
    const index = sourceRowIndexOf(row);
    if (index !== null) numbers.add(index + 1);
  }
  return numbers;
}
