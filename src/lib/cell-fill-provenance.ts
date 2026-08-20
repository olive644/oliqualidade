import * as XLSX from "xlsx";
import type { ImportAudit, SourceGrid } from "@/lib/import";
import type { ImportDiagnostics } from "@/lib/import-intelligence";
import type { Column, Row } from "@/lib/types";

export type SourceCellFill = {
  rowIndex: number;
  columnKey: string;
  color: string;
};

/**
 * Resolve a cor de preenchimento original do Excel por (linha final, coluna
 * final), casando o rótulo de cada coluna com o texto literal da linha de
 * cabeçalho na grade de origem e assumindo que os dados seguem o cabeçalho
 * sequencialmente, sem lacuna.
 *
 * Deliberadamente conservador: só resolve quando a aba é "simples" o
 * bastante pra essa suposição sequencial ser segura (nenhuma linha oculta,
 * em branco, de rodapé ou de cabeçalho repetido foi descartada; a grade de
 * origem não foi truncada; o rótulo da coluna bate com exatamente uma
 * célula do cabeçalho). Fora dessas condições, devolve `[]` — nunca associa
 * uma cor a uma célula sem ter certeza de qual célula é essa. Ver seção 79
 * do CURRENT_STATE_AUDIT.md para o porquê dessa cautela.
 */
/**
 * Último segmento de um rótulo hierárquico. O import combina grupo e
 * subcoluna de um cabeçalho de duas linhas ("CALIBRAÇÃO 2023 — JAN"), mas na
 * grade de origem o texto da célula é só o segmento ("JAN"), então é por ele
 * que a coluna precisa ser encontrada.
 */
function labelSegments(label: string): string[] {
  const trimmed = label.trim();
  const parts = trimmed.split(" — ").map((part) => part.trim());
  // Do mais específico para o mais geral: uma subcoluna ("JAN") identifica a
  // coluna exata, enquanto o grupo ("CALIBRAÇÃO 2023") aparece uma vez só e
  // serviria de fallback para cabeçalhos não hierárquicos.
  return [...new Set([trimmed, ...parts.reverse()])].filter(Boolean);
}

/**
 * Onde cada coluna importada vive na grade de origem, junto com a linha de
 * origem de cada registro. `columnStart`/`columnEnd` formam uma faixa porque
 * uma coluna pode ter nascido de um cabeçalho mesclado horizontalmente: em
 * cronogramas, um mês costuma cobrir duas células (programado | realizado),
 * e ler só a primeira perde metade da informação.
 */
type SourceLayout = {
  origins: number[];
  columnRanges: Map<string, { start: number; end: number }>;
  fillByAddress: Map<string, string>;
};

function resolveSourceLayout(
  rows: Row[],
  columns: Column[],
  diagnostics: ImportDiagnostics | undefined,
  audit: ImportAudit | undefined,
  sourceGrid: SourceGrid | undefined,
  rowOrigins?: number[],
): SourceLayout | null {
  if (!diagnostics?.cellFills.length || !audit || !sourceGrid) return null;
  if (sourceGrid.truncatedColumns) return null;
  // `rowOrigins` diz exatamente de qual linha da planilha veio cada linha
  // importada, então descartes no meio (ocultas, em branco, cabeçalho
  // repetido, rodapé) deixam de ser um problema. Sem ele, resta a suposição
  // sequencial antiga, que só é segura quando nada foi descartado.
  const origins =
    rowOrigins?.length === rows.length
      ? rowOrigins
      : audit.hiddenRowsIgnored ||
          audit.blankRowsIgnored ||
          audit.trailingRowsIgnored ||
          audit.repeatedHeaderRowsIgnored ||
          sourceGrid.truncatedRows
        ? null
        : rows.map((_, index) => diagnostics.header.row + index);
  if (!origins) return null;

  const headerRowIndex = diagnostics.header.row - 1;
  // Um cabeçalho hierárquico ocupa mais de uma linha; a subcoluna que dá nome
  // à coluna pode estar em qualquer uma delas.
  const headerRows = sourceGrid.rows
    .slice(headerRowIndex, headerRowIndex + 3)
    .filter((row): row is (string | number | boolean | null)[] => Boolean(row));
  if (!headerRows.length) return null;

  const columnStartByKey = new Map<string, number>();
  const takenIndexes = new Set<number>();
  for (const column of columns) {
    for (const segment of labelSegments(column.label)) {
      const matches = new Set<number>();
      for (const headerRow of headerRows) {
        headerRow.forEach((value, index) => {
          if (typeof value === "string" && value.trim() === segment && !takenIndexes.has(index))
            matches.add(index);
        });
      }
      if (matches.size === 1) {
        const index = [...matches][0]!;
        columnStartByKey.set(column.key, index);
        takenIndexes.add(index);
        break;
      }
    }
  }
  if (!columnStartByKey.size) return null;

  const fillByAddress = new Map(diagnostics.cellFills.map((fill) => [fill.address, fill.color]));
  if (!fillByAddress.size) return null;

  // A faixa de uma coluna vai do seu índice até logo antes da próxima coluna
  // reconhecida — as células intermediárias só existem porque o cabeçalho
  // mesclado as cobria.
  const sortedStarts = [...columnStartByKey.values()].sort((a, b) => a - b);
  const gridWidth = Math.max(...sourceGrid.rows.map((row) => row.length), 0);
  const columnRanges = new Map<string, { start: number; end: number }>();
  for (const [key, start] of columnStartByKey) {
    const next = sortedStarts.find((index) => index > start);
    columnRanges.set(key, { start, end: (next ?? gridWidth) - 1 });
  }
  return { origins, columnRanges, fillByAddress };
}

export function resolveSourceCellFills(
  rows: Row[],
  columns: Column[],
  diagnostics: ImportDiagnostics | undefined,
  audit: ImportAudit | undefined,
  sourceGrid: SourceGrid | undefined,
  rowOrigins?: number[],
): SourceCellFill[] {
  const layout = resolveSourceLayout(rows, columns, diagnostics, audit, sourceGrid, rowOrigins);
  if (!layout) return [];

  const results: SourceCellFill[] = [];
  rows.forEach((_, rowIndex) => {
    const sheetRow = layout.origins[rowIndex];
    if (sheetRow === undefined || sheetRow < 0) return;
    for (const [columnKey, range] of layout.columnRanges) {
      // Uma coluna final pode cobrir várias células da grade original (cabeçalho
      // mesclado horizontalmente). Em cronogramas isso é a norma: o mês ocupa
      // duas células, a da esquerda com o previsto e a da direita com o
      // ocorrido. Emitimos todas, da esquerda para a direita, para não perder
      // nenhuma marcação; consumidores que precisam de uma cor só ficam com a
      // última — a mais à direita, que é o desfecho, não a intenção.
      for (let column = range.start; column <= range.end; column++) {
        const address = XLSX.utils.encode_cell({ r: sheetRow, c: column });
        const color = layout.fillByAddress.get(address);
        if (color) results.push({ rowIndex, columnKey, color });
      }
    }
  });
  return results;
}

export type ColorGroupLabel = {
  rowIndex: number;
  columnKey: string;
  label: string;
};

/**
 * Infere um rótulo de agrupamento visual quando uma sequência de linhas
 * compartilha a mesma cor de preenchimento de célula do Excel original numa
 * coluna, mas SEM mesclagem real (ao contrário do preenchimento de
 * mesclagem em `import.ts`, que já expande o valor de origem porque a
 * mesclagem é um fato estrutural do arquivo). Cor de fundo é só um sinal
 * visual — nunca escreve em `rows`, só produz rótulos para exibição, para
 * nunca contaminar cálculo/agregação com um valor que não existia na
 * célula. Ver investigação "Anexo III" no CURRENT_STATE_AUDIT.md.
 */
export function resolveColorGroupLabels(
  rows: Row[],
  columns: Column[],
  sourceCellFills: SourceCellFill[],
): ColorGroupLabel[] {
  if (!sourceCellFills.length) return [];
  const colorByKey = new Map(
    sourceCellFills.map((fill) => [`${fill.rowIndex}:${fill.columnKey}`, fill.color]),
  );
  const results: ColorGroupLabel[] = [];
  for (const column of columns) {
    let bandColor: string | null = null;
    let bandLabel: string | null = null;
    rows.forEach((row, rowIndex) => {
      const color = colorByKey.get(`${rowIndex}:${column.key}`) ?? null;
      const value = row[column.key];
      const hasValue = value !== null && value !== undefined && value !== "";
      if (!color) {
        bandColor = null;
        bandLabel = null;
        return;
      }
      if (hasValue) {
        bandColor = color;
        bandLabel = String(value);
        return;
      }
      if (bandColor === color && bandLabel) {
        results.push({ rowIndex, columnKey: column.key, label: bandLabel });
      } else {
        bandColor = null;
        bandLabel = null;
      }
    });
  }
  return results;
}
