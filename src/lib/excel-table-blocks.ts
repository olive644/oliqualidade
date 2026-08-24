import * as XLSX from "xlsx";
import type { StructuredTableDiagnostic } from "@/lib/workbook-metadata";

export type TableBlock = {
  name: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  headerRowCount: number;
  totalsRowCount: number;
};

export type TableBlockGroup = {
  /** Coluna nova que passa a dizer de qual bloco a linha veio. */
  blockLabel: string;
  /** Cabeçalho da primeira coluna de cada bloco, unificado. */
  itemLabel: string;
  /** Colunas compartilhadas por todos os blocos, na ordem original. */
  sharedColumns: string[];
  blocks: TableBlock[];
};

const RANGE_PATTERN = /^[A-Z]+\d+:[A-Z]+\d+$/i;
const MIN_BLOCKS = 2;
const MIN_COLUMNS = 3;
/** Fração mínima das tabelas da aba que precisa entrar no grupo. */
const MIN_GROUP_SHARE = 0.6;

function decoded(table: StructuredTableDiagnostic): TableBlock | null {
  if (!table.range || !RANGE_PATTERN.test(table.range.trim())) return null;
  const range = XLSX.utils.decode_range(table.range.trim());
  if (!Number.isFinite(range.s.r) || !Number.isFinite(range.e.r)) return null;
  return {
    // Nome de tabela do Excel não aceita espaço, então os modelos usam
    // sublinhado ("Animais_de_estimação"). Trocar por espaço devolve o nome
    // que o autor quis escrever. O resto fica como está: quando o modelo usa
    // maiúsculas coladas ("CuidadosPessoais"), separar por conta própria
    // erraria em siglas, e inventar tipografia no nome de um bloco do usuário
    // é pior do que exibi-lo como ele foi salvo.
    name: table.name.replaceAll("_", " ").trim(),
    startRow: range.s.r,
    endRow: range.e.r,
    startColumn: range.s.c,
    endColumn: range.e.c,
    headerRowCount: table.headerRowCount,
    totalsRowCount: table.totalsRowCount,
  };
}

/**
 * Reconhece uma aba montada como vários blocos com a mesma estrutura.
 *
 * É o formato dos modelos do Office: um orçamento pessoal tem doze Tabelas do
 * Excel (Moradia, Transporte, Seguro, Alimentação...), empilhadas e lado a
 * lado, todas com as mesmas colunas de valor e diferindo só no nome da
 * primeira coluna, que é o rótulo do próprio bloco. Achatadas em uma tabela
 * só, o nome do bloco some da análise: a coluna de itens fica chamada
 * "MORADIA" mesmo contendo itens dos doze blocos, e não existe como perguntar
 * "quanto foi gasto por bloco".
 *
 * A detecção é conservadora, porque unificar blocos que não são equivalentes
 * misturaria grandezas diferentes na mesma coluna. Exige pelo menos dois
 * blocos, pelo menos três colunas, assinatura idêntica nas colunas seguintes à
 * primeira, e que o grupo cubra a maioria das tabelas da aba — uma aba onde só
 * duas de dez tabelas combinam não é uma aba de blocos, é uma coincidência.
 */
export function detectTableBlockGroup(tables: StructuredTableDiagnostic[]): TableBlockGroup | null {
  const candidates = tables
    .map((table) => ({ table, block: decoded(table) }))
    .filter(
      (candidate): candidate is { table: StructuredTableDiagnostic; block: TableBlock } =>
        candidate.block !== null && candidate.table.columns.length >= MIN_COLUMNS,
    );
  if (candidates.length < MIN_BLOCKS) return null;

  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const signature = candidate.table.columns.slice(1).join("¦");
    groups.set(signature, [...(groups.get(signature) ?? []), candidate]);
  }
  const [signature, group] = [...groups.entries()].reduce((best, entry) =>
    entry[1].length > best[1].length ? entry : best,
  );
  if (group.length < MIN_BLOCKS) return null;
  if (group.length / candidates.length < MIN_GROUP_SHARE) return null;

  const firstColumns = new Set(group.map(({ table }) => table.columns[0] ?? ""));
  return {
    blockLabel: "Bloco",
    // Quando cada bloco chama a primeira coluna pelo próprio nome ("MORADIA",
    // "TRANSPORTE"), nenhum desses nomes serve para a coluna unificada.
    itemLabel: firstColumns.size === 1 ? ([...firstColumns][0] ?? "Item") : "Item",
    sharedColumns: signature ? signature.split("¦") : [],
    blocks: group
      .map(({ block }) => block)
      .sort(
        (left, right) => left.startRow - right.startRow || left.startColumn - right.startColumn,
      ),
  };
}

/**
 * Monta uma planilha única a partir dos blocos reconhecidos: uma coluna nova
 * com o nome do bloco, a coluna de item unificada e as colunas compartilhadas.
 *
 * As linhas de cabeçalho e de totais de cada bloco ficam de fora — o total de
 * um bloco soma as linhas dele, então entraria em dobro em qualquer conta
 * feita sobre o resultado.
 *
 * As células são copiadas do arquivo original, e não recriadas, para preservar
 * tipo, formato e fórmula. O mapa de endereços devolvido permite remapear os
 * metadados avançados (comentários, hyperlinks, cor de preenchimento) para as
 * novas posições, do mesmo jeito que a separação por região já faz.
 */
export function buildTableBlocksGrid(
  cellAt: (address: string) => XLSX.CellObject | undefined,
  group: TableBlockGroup,
): { cells: Map<string, XLSX.CellObject>; addressMap: Map<string, string>; rows: number } | null {
  const width = group.sharedColumns.length + 2;
  const cells = new Map<string, XLSX.CellObject>();
  const addressMap = new Map<string, string>();

  [group.blockLabel, group.itemLabel, ...group.sharedColumns].forEach((label, column) => {
    cells.set(XLSX.utils.encode_cell({ r: 0, c: column }), { t: "s", v: label });
  });

  let destinationRow = 1;
  for (const block of group.blocks) {
    // Um bloco com largura diferente da assinatura não pode ser encaixado
    // coluna a coluna sem desalinhar os valores; fica de fora em silêncio.
    if (block.endColumn - block.startColumn + 1 !== width - 1) continue;
    const firstDataRow = block.startRow + Math.max(block.headerRowCount, 0);
    const lastDataRow = block.endRow - Math.max(block.totalsRowCount, 0);
    for (let row = firstDataRow; row <= lastDataRow; row++) {
      const sourceCells: Array<{ address: string; cell: XLSX.CellObject }> = [];
      for (let column = block.startColumn; column <= block.endColumn; column++) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        const cell = cellAt(address);
        if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "")
          sourceCells.push({ address, cell });
      }
      if (!sourceCells.length) continue;
      cells.set(XLSX.utils.encode_cell({ r: destinationRow, c: 0 }), { t: "s", v: block.name });
      for (const { address, cell } of sourceCells) {
        const column = XLSX.utils.decode_cell(address).c - block.startColumn + 1;
        const destination = XLSX.utils.encode_cell({ r: destinationRow, c: column });
        cells.set(destination, { ...cell });
        addressMap.set(address, destination);
      }
      destinationRow++;
    }
  }

  if (destinationRow < 2) return null;
  return { cells, addressMap, rows: destinationRow };
}
