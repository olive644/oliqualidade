import * as XLSX from "xlsx";
import type { StructuredTableDiagnostic } from "@/lib/workbook-metadata";

export type TableTotalsRegion = {
  /** Nome da tabela do Excel que declarou este total. */
  table: string;
  /** Linha, já relativa ao início da grade lida. */
  row: number;
  /** Primeira e última coluna da tabela, também relativas ao início da grade. */
  startColumn: number;
  endColumn: number;
};

const RANGE_PATTERN = /^[A-Z]+\d+:[A-Z]+\d+$/i;

/**
 * Localiza as células de totais declaradas pelas Tabelas do Excel da aba.
 *
 * Modelos do Office (orçamento pessoal, lista de compras, controle de
 * estoque) são feitos de várias Tabelas do Excel, cada uma com sua própria
 * linha de totais. Achatadas em uma tabela só na importação, essas linhas
 * viram registros comuns: em um orçamento real do usuário, somar "Custo
 * previsto" devolvia R$ 4.120 quando o valor certo era R$ 2.060 — exatamente
 * o dobro, porque cada bloco entrava uma vez pelos itens e outra pelo total.
 *
 * Não há adivinhação: o arquivo declara `totalsRowCount` em cada tabela.
 *
 * O resultado é por célula, e não por linha, porque nesses modelos os blocos
 * também ficam lado a lado: a linha de totais de "Moradia" é uma linha comum
 * de "Entretenimento", que ocupa outras colunas da mesma linha. Descartar a
 * linha inteira apagaria dados reais do bloco vizinho; limitar a limpeza às
 * colunas da tabela que declarou o total resolve os dois casos ao mesmo
 * tempo.
 */
export function tableTotalsRegions(
  tables: StructuredTableDiagnostic[],
  sheetStartRow: number,
  sheetStartColumn: number,
): TableTotalsRegion[] {
  const regions: TableTotalsRegion[] = [];
  for (const table of tables) {
    if (table.totalsRowCount < 1) continue;
    // decode_range aceita lixo sem reclamar e devolve a célula A1, o que
    // transformaria um intervalo inválido em "a primeira linha é um total".
    // Por isso a forma é validada antes, e não só o resultado.
    if (!table.range || !RANGE_PATTERN.test(table.range.trim())) continue;
    const decoded = XLSX.utils.decode_range(table.range.trim());
    if (!Number.isFinite(decoded.s.r) || !Number.isFinite(decoded.e.r)) continue;
    const firstTotalsRow = Math.max(decoded.s.r, decoded.e.r - table.totalsRowCount + 1);
    for (let row = firstTotalsRow; row <= decoded.e.r; row++) {
      regions.push({
        table: table.name,
        row: row - sheetStartRow,
        startColumn: decoded.s.c - sheetStartColumn,
        endColumn: decoded.e.c - sheetStartColumn,
      });
    }
  }
  return regions;
}
