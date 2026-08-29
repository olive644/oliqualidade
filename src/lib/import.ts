import * as XLSX from "xlsx";
import type { Row } from "@/lib/types";
import { isVolatileFormula, resolveFormulaCell } from "@/lib/formula";
import { diagnoseImportedSheet, type ImportDiagnostics } from "@/lib/import-intelligence";
import { worksheetCellAtAddress } from "@/lib/worksheet-cell";
import { tableTotalsRegions } from "@/lib/excel-table-totals";
import { buildTableBlocksGrid, detectTableBlockGroup } from "@/lib/excel-table-blocks";
import { scheduleToLong, type LongScheduleRow } from "@/lib/schedule-normalizer";
import { isPeriodColumnLabel } from "@/lib/widgets";
import {
  sliceAdvancedMetadata,
  type AdvancedMetadataRangeRemapper,
  type WorksheetWithAdvancedMetadata,
} from "@/lib/workbook-metadata";

export type SheetImportResult = {
  rows: Row[];
  warning: string | null; // aviso não bloqueante: colunas renomeadas, linha de cabeçalho deslocada, colunas quase vazias e/ou linhas em branco ignoradas
  diagnostics?: ImportDiagnostics;
  sourceGrid?: SourceGrid;
  audit?: ImportAudit;
  /**
   * Para cada linha de `rows`, o índice (base 0, relativo ao início da grade
   * de origem) da linha da planilha que a originou. Permite voltar de uma
   * linha importada à célula original — cor de preenchimento, por exemplo —
   * mesmo quando linhas ocultas, em branco ou de rodapé foram descartadas
   * no meio do caminho.
   */
  rowOrigins?: number[];
  tableMode?:
    | "single"
    | "repeated-blocks"
    | "validation-matrix"
    | "measurement-series"
    | "laboratory-series"
    | "attendance-roster";
};

export type ImportAudit = {
  sourceNonEmptyCells: number;
  outputNonEmptyCells: number;
  formulaCellsRecovered: number;
  mergedCellsExpanded: number;
  numericCellsConverted: number;
  rowsAboveHeaderIgnored: number;
  hiddenRowsIgnored: number;
  blankRowsIgnored: number;
  trailingRowsIgnored: number;
  columnsIgnored: number;
  notesPreserved?: number;
  repeatedHeaderRowsIgnored?: number;
  /** Linhas de totais declaradas por Tabelas do Excel, mantidas fora dos registros. */
  totalsRowsIgnored?: number;
  /** Regiões independentes detectadas nesta aba, mas mantidas juntas por segurança (ver regionsAreSafeToSplit). */
  regionsKeptTogether?: number;
};

/**
 * Percentual de células não vazias da origem que sobreviveram até a tabela
 * importada. Sem células de origem, considera 100% (nada a preservar).
 */
export function auditFidelityPercent(audit: ImportAudit): number {
  if (audit.sourceNonEmptyCells <= 0) return 100;
  const preserved = Math.min(audit.outputNonEmptyCells, audit.sourceNonEmptyCells);
  return Math.round((preserved / audit.sourceNonEmptyCells) * 100);
}

export type SourceGrid = {
  startRow: number;
  startColumn: number;
  totalRows: number;
  totalColumns: number;
  rows: (string | number | boolean | null)[][];
  truncatedRows: boolean;
  truncatedColumns: boolean;
};

const SOURCE_GRID_CELL_BUDGET = 50_000;
const SOURCE_GRID_MAX_ROWS = 1_000;
const SOURCE_GRID_MAX_COLUMNS = 100;

function buildSourceGrid(
  aoa: (string | number | boolean | null)[][],
  range: XLSX.Range,
): SourceGrid {
  const totalRows = range.e.r - range.s.r + 1;
  const totalColumns = range.e.c - range.s.c + 1;
  const columnLimit = Math.min(totalColumns, SOURCE_GRID_MAX_COLUMNS);
  const rowLimit = Math.min(
    totalRows,
    SOURCE_GRID_MAX_ROWS,
    Math.max(1, Math.floor(SOURCE_GRID_CELL_BUDGET / Math.max(1, columnLimit))),
  );
  return {
    startRow: range.s.r + 1,
    startColumn: range.s.c + 1,
    totalRows,
    totalColumns,
    rows: aoa.slice(0, rowLimit).map((row) =>
      Array.from({ length: columnLimit }, (_, column) => {
        const value = row[column];
        return value === undefined ? null : value;
      }),
    ),
    truncatedRows: rowLimit < totalRows,
    truncatedColumns: columnLimit < totalColumns,
  };
}

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

// Número mínimo de colunas com rótulo de período (mês/ano) no cabeçalho para
// tratar a planilha como um cronograma largo real, onde uma coluna de
// período vazia é uma etapa futura, não lixo. Duas colunas isoladas com nome
// de mês não são evidência suficiente.
const MIN_SCHEDULE_PERIOD_COLUMNS = 3;

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
function calendarParts(d: Date, cell?: XLSX.CellObject) {
  // Quando a data veio de XLSX.read(cellDates:true), o SheetJS preserva em
  // `w` o dia civil exibido no Excel, mas o objeto Date pode cair no dia
  // anterior no fuso do navegador (ex.: Jun-25 vira 31/05 às 21h no Brasil).
  // Nesses casos os componentes UTC representam o serial original. Datas
  // criadas diretamente pelo app/testes, sem `w`, continuam usando o fuso
  // local para não alterar seu significado.
  const display = typeof cell?.w === "string" ? cell.w.trim() : "";
  const namedMonths: Record<string, number> = {
    jan: 1,
    feb: 2,
    fev: 2,
    mar: 3,
    apr: 4,
    abr: 4,
    may: 5,
    mai: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    ago: 8,
    sep: 9,
    set: 9,
    oct: 10,
    out: 10,
    nov: 11,
    dec: 12,
    dez: 12,
  };
  const named =
    /^(jan|feb|fev|mar|apr|abr|may|mai|jun|jul|aug|ago|sep|set|oct|out|nov|dec|dez)[-/. ](\d{2,4})$/i.exec(
      display,
    );
  const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(display);
  const shortYear = (value: string) => (Number(value) < 100 ? 2000 + Number(value) : Number(value));
  let displayed: { year: number; month: number; day: number } | null = null;
  if (named)
    displayed = {
      year: shortYear(named[2]!),
      month: namedMonths[named[1]!.toLowerCase()]!,
      day: 1,
    };
  if (numeric) {
    const dayFirst = /^d/i.test(String(cell?.z ?? "").replace(/[^dmy]/gi, ""));
    displayed = {
      year: shortYear(numeric[3]!),
      month: Number(dayFirst ? numeric[2] : numeric[1]),
      day: Number(dayFirst ? numeric[1] : numeric[2]),
    };
  }
  const fromWorkbook = display.length > 0;
  return {
    year: displayed?.year ?? (fromWorkbook ? d.getUTCFullYear() : d.getFullYear()),
    month: displayed?.month ?? (fromWorkbook ? d.getUTCMonth() + 1 : d.getMonth() + 1),
    day: displayed?.day ?? (fromWorkbook ? d.getUTCDate() : d.getDate()),
    hours: fromWorkbook ? d.getUTCHours() : d.getHours(),
    minutes: fromWorkbook ? d.getUTCMinutes() : d.getMinutes(),
    seconds: fromWorkbook ? d.getUTCSeconds() : d.getSeconds(),
  };
}

function formatDateCell(d: Date, cell?: XLSX.CellObject): string {
  if (!Number.isFinite(d.getTime())) return "";
  const parts = calendarParts(d, cell);
  const dd = String(parts.day).padStart(2, "0");
  const mm = String(parts.month).padStart(2, "0");
  return `${dd}/${mm}/${parts.year}`;
}

function formatTemporalCell(d: Date, cell?: XLSX.CellObject): string {
  if (!Number.isFinite(d.getTime())) return "";
  const numberFormat = String(cell?.z ?? "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, "");
  const hasDate = /[dy]/i.test(numberFormat);
  const hasTime = /h|s|am\/pm|a\/p|\[(?:h+|m+|s+)\]/i.test(numberFormat);
  const hasYear = /y/i.test(numberFormat);
  const hasMonth = /m/i.test(numberFormat);
  // Mês por nome (`mmm`/`mmmm`, ex. "mmm-yy") é o sinal deliberado de que a
  // célula representa um PERÍODO (cabeçalho de cronograma), não um dia —
  // caso em que vale colapsar a granularidade (ver abaixo). Mês numérico
  // (`mm`, ex. "mm/yy") é só um formato de data compacto, comum em
  // planilhas brasileiras, e não implica que o dia seja irrelevante: uma
  // coluna de "DATA" por linha formatada como "mm/yy" pode ter um dia real
  // e diferente por linha (ex.: FRS-QA-BR-413) que colapsar destruiria,
  // fazendo linhas com datas distintas parecerem idênticas.
  const hasNamedMonth = /m{3,}/i.test(numberFormat);
  const hasDay = /d/i.test(numberFormat);

  // Para hora e duração, a representação pronta do SheetJS é mais fiel ao
  // Excel: preserva segundos, AM/PM e durações acima de 24 h (`[h]:mm`) sem
  // transformá-las numa data fictícia de 1899.
  if (hasTime && !hasDate && cell?.w) return cell.w;

  const parts = calendarParts(d, cell);

  // Cabeçalhos de cronograma como `mmm-yy` representam um PERÍODO, não um
  // dia. Transformá-los em dd/mm/aaaa inventava o dia 31 e ainda deslocava
  // o mês pelo fuso horário. Mantemos a granularidade declarada no formato.
  if (hasYear && hasNamedMonth && !hasDay && !hasTime) {
    const monthNames = [
      "jan",
      "fev",
      "mar",
      "abr",
      "mai",
      "jun",
      "jul",
      "ago",
      "set",
      "out",
      "nov",
      "dez",
    ];
    return `${monthNames[parts.month - 1]}/${parts.year}`;
  }
  if (hasYear && !hasMonth && !hasDay && !hasTime) return String(parts.year);

  const date = formatDateCell(d, cell);
  if (!date || !hasTime) return date;
  const hh = String(parts.hours).padStart(2, "0");
  const mm = String(parts.minutes).padStart(2, "0");
  const ss = String(parts.seconds).padStart(2, "0");
  return `${date} ${hh}:${mm}${/s/i.test(numberFormat) ? `:${ss}` : ""}`;
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
function normalizeRawRow(
  row: SheetSourceRow,
  worksheet: XLSX.WorkSheet,
  rowIndex: number,
  start: XLSX.CellAddress,
): (string | number | boolean | null)[] {
  return row.map((value, columnIndex) => {
    if (!(value instanceof Date)) return value;
    const address = XLSX.utils.encode_cell({
      r: start.r + rowIndex,
      c: start.c + columnIndex,
    });
    const sourceCell = worksheetCellAtAddress(worksheet, address);

    // O SheetJS 0.20 pode tentar converter uma célula textual para Date
    // apenas porque o estilo dela é de data. Nesse caso ele entrega
    // `Invalid Date` no AOA, apesar de o objeto original ainda preservar o
    // texto correto. Isso ocorre, por exemplo, com o cabeçalho "Torre de
    // Processo" no formulário FRS-QA-028. Checar isso ANTES de tentar
    // formatar como data (não depois) importa num segundo caso real: uma
    // célula de fórmula não calculada por um gerador fora do Excel
    // (`t="s"`, valor cru `""`) com formato de data no estilo. Nesse caso
    // `sourceCell.v` não é `Date`, então o código abaixo cairia no valor
    // "fantasma" que o SheetJS sintetizou (`new Date(0)`, formatado como
    // "31/12/1899" — o epoch zero do Excel) em vez de reconhecer que a
    // célula nunca teve data nenhuma. Recuperar a string original (mesmo
    // vazia) evita alterar o tratamento normal de datas e números
    // legítimos.
    if (sourceCell?.t === "s" && typeof sourceCell.v === "string") {
      return sourceCell.v || null;
    }

    const sourceDate = sourceCell?.v instanceof Date ? sourceCell.v : value;
    const formatted = formatTemporalCell(sourceDate, sourceCell);
    if (formatted) return formatted;

    return null;
  });
}

const INVALID_HEADER_PATTERN = /^(?:nan(?:[\s/.-]*nan)*|invalid date|undefined|null)$/i;

function headerName(raw: NormalizedCellValue, index: number) {
  const value = raw == null ? "" : String(raw).trim();
  return !value || INVALID_HEADER_PATTERN.test(value) ? `coluna_${index + 1}` : value;
}

function headerIsInvalid(raw: NormalizedCellValue) {
  const value = raw == null ? "" : String(raw).trim();
  return !value || INVALID_HEADER_PATTERN.test(value);
}

const IDENTIFIER_HEADER_PATTERN =
  /(^|[\s_-])(id|c[oó]digo|cod|n[º°o]\.?|n[uú]mero|sku|protocolo)([\s_.-]|\d|$)/i;
const QUANTITATIVE_HEADER_PATTERN =
  /(valor|pre[cç]o|total|quantidade|qtd|receita|custo|saldo|taxa|percentual|porcentagem|medida|medi[cç][aã]o|peso|altura|volume|temperatura|press[aã]o|concentra[cç][aã]o)/i;

function parseLocalizedNumericText(value: string): number | null {
  let text = value.trim().replace(/[\u00a0\s]/g, "");
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  const percentage = /%$/.test(text);
  text = text
    .replace(/%$/, "")
    .replace(/^(?:R\$|US\$|€|£|¥|\$)/i, "")
    .replace(/(?:R\$|US\$|€|£|¥|\$)$/i, "");
  if (!/^[-+]?\d+(?:[.,]\d+)*$/.test(text)) return null;
  if (/^[-+]?0\d+$/.test(text)) return null;

  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const grouping = decimal === "," ? /\./g : /,/g;
    text = text.replace(grouping, "").replace(decimal, ".");
  } else if (comma >= 0) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^[-+]?\d{1,3}(?:\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  const signed = negative ? -Math.abs(parsed) : parsed;
  return percentage ? signed / 100 : signed;
}

/**
 * Alguns formulários reais mudam o tipo de célula no meio da mesma coluna:
 * medições antigas são números do Excel e as mais recentes são texto
 * ("1.50"), embora representem a mesma grandeza. Quando a coluna tem pelo
 * menos um número real e 90% ou mais dos valores preenchidos são números ou
 * texto numérico simples, convertemos apenas esses textos para number.
 *
 * A exigência de um número real, a proteção por nome de identificador e a
 * preservação de inteiros com zero à esquerda evitam transformar códigos,
 * protocolos e SKUs em métricas por engano.
 */
function normalizeMixedNumericColumns(rows: Row[]): { rows: Row[]; changes: number } {
  if (!rows.length) return { rows, changes: 0 };
  const headers = Object.keys(rows[0] ?? {});
  const numericHeaders = new Set<string>();

  for (const header of headers) {
    if (IDENTIFIER_HEADER_PATTERN.test(header)) continue;
    const values = rows.map((row) => row[header]).filter((value) => value !== null && value !== "");
    const hasRealNumber = values.some((value) => typeof value === "number");
    if (!hasRealNumber && !QUANTITATIVE_HEADER_PATTERN.test(header)) continue;
    const numericLike = values.filter((value) => {
      if (typeof value === "number") return Number.isFinite(value);
      if (typeof value !== "string") return false;
      return parseLocalizedNumericText(value) !== null;
    }).length;
    if (values.length && numericLike / values.length >= 0.9) numericHeaders.add(header);
  }

  if (!numericHeaders.size) return { rows, changes: 0 };
  let changes = 0;
  const normalized = rows.map((row) => {
    let next = row;
    for (const header of numericHeaders) {
      const value = row[header];
      if (typeof value !== "string") continue;
      const parsed = parseLocalizedNumericText(value);
      if (parsed === null) continue;
      if (next === row) next = { ...row };
      next[header] = parsed;
      changes++;
    }
    return next;
  });
  return { rows: normalized, changes };
}

// Códigos de erro que o Excel escreve quando uma fórmula não consegue
// calcular (ex: divisão por zero num "Ticket médio" antes de ter vendas).
// Sintaticamente são texto, mas semanticamente são um valor quebrado, típico
// de célula de dado — nunca o nome de uma coluna.
const EXCEL_ERROR_PATTERN =
  /^#(?:ERROR!|NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/?A|GETTING_DATA|SPILL!|CALC!|FIELD!|BLOCKED!|UNKNOWN!|CONNECT!|BUSY!)$/i;

function cellLooksNumeric(v: unknown): boolean {
  if (v === null || v === "") return false;
  if (typeof v === "number") return true;
  const s = String(v).trim();
  return /^-?\d+([.,]\d+)?%?$/.test(s) || EXCEL_ERROR_PATTERN.test(s);
}

function cellLooksDate(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return true;
  const s = String(v).trim();
  return (
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s) ||
    /^\d{4}-\d{1,2}-\d{1,2}(?:[T\s].*)?$/.test(s) ||
    /^\d{1,2}[-/](?:jan|feb|fev|mar|apr|abr|may|mai|jun|jul|aug|ago|sep|set|oct|out|nov|dec|dez)(?:[-/]\d{2,4})?$/i.test(
      s,
    )
  );
}

/**
 * Uma linha "claramente não é cabeçalho" quando está inteiramente vazia ou
 * quando pelo menos uma célula preenchida parece um valor numérico. Um
 * cabeçalho de tabela de verdade é feito de rótulos (texto); qualquer
 * célula numérica nele é sinal de que a linha é, na verdade, um dado —
 * por exemplo um bloco de resumo tipo "Total de vendas: 12", onde cada
 * linha é um par rótulo/valor e não existe cabeçalho nenhum ali.
 */
function isClearlyNotHeaderRow(row: NormalizedSheetRow): boolean {
  const filled = row.filter((c) => c !== null && c !== "");
  if (!filled.length) return true;
  return filled.some(cellLooksNumeric);
}

const MIN_REPEATED_NEXT_ROW_RATIO = 0.3;

/**
 * Detecta se uma linha repete, palavra por palavra e na mesma coluna, uma
 * fração relevante dos valores da linha seguinte — sinal de que ambas são
 * linhas de dado agrupadas (ex: várias linhas de "Balança" seguidas), não
 * um cabeçalho seguido do primeiro registro. Um rótulo de cabeçalho de
 * verdade praticamente nunca é idêntico ao valor de dado logo abaixo dele
 * na mesma coluna.
 */
function rowRepeatsNextRow(row: NormalizedSheetRow, next: NormalizedSheetRow): boolean {
  let comparable = 0;
  let matches = 0;
  const width = Math.max(row.length, next.length);
  for (let column = 0; column < width; column++) {
    const a = row[column];
    const b = next[column];
    if (a === null || a === "" || b === null || b === "") continue;
    comparable++;
    if (String(a).trim().toLocaleLowerCase("pt-BR") === String(b).trim().toLocaleLowerCase("pt-BR"))
      matches++;
  }
  return comparable > 0 && matches / comparable >= MIN_REPEATED_NEXT_ROW_RATIO;
}

function isYearHeaderRow(row: NormalizedSheetRow): boolean {
  const filled = row.filter((cell) => cell !== null && cell !== "");
  const numeric = filled.filter(cellLooksNumeric);
  return (
    filled.length >= 2 &&
    numeric.length > 0 &&
    numeric.length < filled.length &&
    numeric.every((cell) => {
      const value = Number(cell);
      return Number.isInteger(value) && value >= 1900 && value <= 2200;
    })
  );
}

function isMetadataRow(row: NormalizedSheetRow): boolean {
  const labels = [
    ...new Set(
      row
        .filter((cell) => cell !== null && cell !== "")
        .map((cell) => String(cell).trim())
        .filter(Boolean),
    ),
  ];
  return (
    labels.length > 0 &&
    labels.filter((label) => /^[^:]{1,50}:/.test(label)).length / labels.length >= 0.6
  );
}

function isSheetContextRow(row: NormalizedSheetRow): boolean {
  const labels = row
    .filter((cell) => cell !== null && cell !== "")
    .map((cell) => String(cell).trim())
    .filter(Boolean);
  const firstLabel = labels[0] ?? "";
  if (/^ano fiscal$/i.test(firstLabel)) return true;
  if (!/^produto$/i.test(firstLabel)) return false;
  const distinct = new Set(labels.map((label) => label.toLocaleLowerCase("pt-BR")));
  return (
    labels.some((label) => /^resultados?$/i.test(label)) ||
    (labels.length > 2 && distinct.size === 2)
  );
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
function findHeaderRowIndex(aoa: NormalizedSheetRow[], bannerRows?: Set<number>): number {
  if (!aoa.length) return 0;
  const scanLimit = Math.min(HEADER_SCAN_LIMIT, aoa.length);
  const width = Math.max(1, ...aoa.slice(0, scanLimit).map((r) => r.length));

  const fillRatio = (row: NormalizedSheetRow) =>
    row.filter((c) => c !== null && c !== "").length / width;
  const isBanner = (i: number) => bannerRows?.has(i) ?? false;

  const firstRow = aoa[0] ?? [];
  if (
    !isBanner(0) &&
    !isMetadataRow(firstRow) &&
    !isSheetContextRow(firstRow) &&
    !isClearlyNotHeaderRow(firstRow) &&
    !rowRepeatsNextRow(firstRow, aoa[1] ?? []) &&
    fillRatio(firstRow) >= SPARSE_HEADER_RATIO
  ) {
    return 0;
  }

  let bestIndex = -1;
  let bestScore = -1;
  for (let i = 0; i < scanLimit; i++) {
    if (isBanner(i)) continue;
    const row = aoa[i] ?? [];
    if (isMetadataRow(row)) continue;
    if (isSheetContextRow(row)) continue;
    if (isClearlyNotHeaderRow(row) && !isYearHeaderRow(row)) continue;
    // Uma linha de dado bem preenchida (sem coluna sobrando em branco) pode
    // superar em preenchimento uma linha de cabeçalho legítima que, por
    // acaso, tem uma coluna sem rótulo (comum quando a planilha original
    // não nomeou todas as colunas de dado). O sinal mais forte pra
    // desempatar aqui: valores de rótulo de cabeçalho praticamente nunca se
    // repetem, palavra por palavra, com a linha vizinha — mas linhas de
    // dado agrupadas por categoria (ex: várias "Balança" seguidas) repetem
    // valores entre si o tempo todo. Compara com as duas vizinhas (não só
    // a de baixo): a última linha de um grupo repetido não tem "próxima"
    // linha igual pra comparar, mas ainda repete a de cima.
    if (
      rowRepeatsNextRow(row, aoa[i + 1] ?? []) ||
      rowRepeatsNextRow(row, i > 0 ? (aoa[i - 1] ?? []) : [])
    )
      continue;
    // Cabeçalhos verdadeiros costumam ser seguidos imediatamente por dados.
    // Esse bônus resolve empates com blocos institucionais mesclados
    // (assinaturas/cargos), que podem ter a mesma densidade visual do
    // cabeçalho, mas não têm números nas linhas seguintes.
    const lookahead = aoa.slice(i + 1, Math.min(i + 4, aoa.length));
    const numericBelow = lookahead.reduce(
      (count, candidate) => count + candidate.filter(cellLooksNumeric).length,
      0,
    );
    const dataEvidence = Math.min(0.25, numericBelow / Math.max(1, width * 3));
    // Uma linha de dado costuma vencer no preenchimento a linha de cabeçalho
    // logo acima quando esta deixou alguma coluna sem rótulo. Datas soltas no
    // meio de rótulos textuais são o sinal que separa as duas: um cabeçalho
    // com colunas de período é feito de datas (a maioria das células), mas
    // uma linha de registro só tem uma ou duas ("DATA DA CALIBRAÇÃO") entre
    // vários campos de texto. Penalizar apenas esse caso minoritário mantém
    // cabeçalhos de cronograma por data intactos e evita que o primeiro
    // registro seja promovido a cabeçalho (achado real no FRS-QA-BR-413).
    const filledCells = row.filter((c) => c !== null && c !== "");
    const dateCells = filledCells.filter(cellLooksDate).length;
    const dateNoise = dateCells > 0 && dateCells * 2 < filledCells.length ? 0.5 : 0;
    const score = fillRatio(row) + dataEvidence - dateNoise;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex === -1 ? 0 : bestIndex;
}

type RelativeMerge = { s: XLSX.CellAddress; e: XLSX.CellAddress };

function findHierarchicalHeaderStart(
  aoa: NormalizedSheetRow[],
  selected: number,
  merges: RelativeMerge[],
): number {
  let start = selected;
  while (start > 0 && selected - start < 3) {
    const previous = start - 1;
    const horizontal = merges.filter(
      (merge) => merge.s.r === previous && merge.e.r === previous && merge.e.c > merge.s.c,
    );
    const row = aoa[previous] ?? [];
    const filled = row.filter((value) => value !== null && value !== "");
    if (!filled.length || filled.some((value) => cellLooksNumeric(value) || cellLooksDate(value)))
      break;
    // Linhas de contexto como "ANO FISCAL | FY25" e
    // "PRODUTO | Resinas X" descrevem a planilha inteira. Mesmo quando a
    // segunda também contém um grupo visual como "RESULTADOS", ela não é
    // uma camada do cabeçalho da tabela e não deve prefixar todas as
    // colunas (nem transformar uma aba-modelo vazia em um registro falso).
    if (isSheetContextRow(row)) break;
    const distinctLabels = [
      ...new Set(filled.map((value) => String(value).trim()).filter(Boolean)),
    ];
    // Linhas de formulário como "Instrutor:", "Entidade Promotora: X" e
    // "Carga horária: Y" são metadados acima da tabela, não grupos do
    // cabeçalho. Mesclagens usadas só para dar espaço a esses campos não
    // podem arrastá-los para o nome de todas as colunas.
    if (distinctLabels.length > 0 && distinctLabels.every((label) => /^[^:]{1,50}:/.test(label)))
      break;
    const width = Math.max(1, row.length, aoa[start]?.length ?? 0);
    const isSingleFullWidthGroup =
      horizontal.length === 1 && horizontal[0]!.s.c === 0 && horizontal[0]!.e.c >= width - 1;
    const childLabels = (aoa[start] ?? []).filter((value) => value !== null && value !== "");
    if (childLabels.length < 2) break;

    // Alguns relatórios gerados por ERP usam uma linha esparsa de grupos
    // acima de dezenas de colunas diárias, mas não gravam as mesclagens que
    // visualmente delimitam esses grupos. A repetição de rótulos/data na
    // linha folha, somada a dados numéricos logo abaixo, é um sinal forte o
    // bastante para preservar a camada pai sem transformar uma linha comum
    // de texto em cabeçalho.
    const child = aoa[start] ?? [];
    const normalizedChildren = childLabels.map((value) => String(value).trim().toLowerCase());
    const duplicateChildren = normalizedChildren.length - new Set(normalizedChildren).size;
    const temporalChildren = childLabels.filter(cellLooksDate).length;
    const dataBelow = aoa
      .slice(start + 1, Math.min(start + 4, aoa.length))
      .some((candidate) => candidate.some((value) => cellLooksNumeric(value)));
    const sparseUnmergedParent =
      horizontal.length === 0 &&
      filled.length >= 2 &&
      filled.length < childLabels.length &&
      dataBelow &&
      (duplicateChildren >= 2 || temporalChildren >= 3);

    if (!horizontal.length && !sparseUnmergedParent) break;
    if (isSingleFullWidthGroup) break;
    start = previous;
  }
  return start;
}

/**
 * Reconhece camadas adicionais de cabeçalho somente quando existe uma
 * mesclagem horizontal parcial na camada atual. Esse sinal vem da estrutura
 * real do XLSX e evita confundir a primeira linha textual de dados com um
 * segundo cabeçalho. Uma mesclagem única cobrindo toda a largura continua
 * sendo tratada como título/banner, pois não há informação suficiente para
 * afirmar que ela nomeia todas as colunas.
 */
function findHierarchicalHeaderEnd(
  aoa: NormalizedSheetRow[],
  start: number,
  merges: RelativeMerge[],
): number {
  const width = Math.max(1, ...aoa.slice(start, start + 4).map((row) => row.length));
  let end = start;

  while (end - start < 3 && end + 1 < aoa.length) {
    const horizontal = merges.filter(
      (merge) => merge.s.r === end && merge.e.r === end && merge.e.c > merge.s.c,
    );

    const current = aoa[end] ?? [];
    const unmergedLabels = current.filter((value, column) => {
      if (value === null || value === "") return false;
      return !horizontal.some((merge) => column >= merge.s.c && column <= merge.e.c);
    });
    const distinctParents = new Set(
      current
        .filter((value) => value !== null && value !== "")
        .map((value) => String(value).trim()),
    );
    const next = aoa[end + 1] ?? [];
    const currentFilled = current.filter((value) => value !== null && value !== "");
    const nextFilled = next.filter((value) => value !== null && value !== "");
    const normalizedNext = nextFilled.map((value) => String(value).trim().toLowerCase());
    const duplicateNext = normalizedNext.length - new Set(normalizedNext).size;
    const temporalNext = nextFilled.filter(cellLooksDate).length;
    const numericBelow = aoa
      .slice(end + 2, Math.min(end + 5, aoa.length))
      .some((row) => row.some((value) => cellLooksNumeric(value)));
    const sparseUnmergedParent =
      horizontal.length === 0 &&
      currentFilled.length >= 2 &&
      currentFilled.length < nextFilled.length &&
      numericBelow &&
      (duplicateNext >= 2 || temporalNext >= 3);
    if (!horizontal.length && !sparseUnmergedParent) break;
    // Sem nenhum dado em lugar nenhum abaixo (modelo .xltx/.xltm vazio),
    // as duas travas seguintes (pensadas pra não confundir dado real com
    // cabeçalho) não têm nada de real pra proteger — calculado uma vez e
    // reaproveitado nas duas.
    const noDataAnywhereBelowForLayer = aoa
      .slice(end + 2)
      .every((row) => row.every((value) => value === null || value === ""));
    // A próxima linha subdivide o intervalo de colunas de algum grupo desta
    // linha em duas ou mais mesclagens próprias — sinal estrutural forte
    // (não estatístico) de que aquela linha é a sub-camada de cabeçalho do
    // grupo, não a primeira linha de dado. Ex.: um cronograma real com 10
    // colunas simples (Equipamento, Código...) ao lado de um grupo
    // "Calibração 2023" mesclado cobrindo o ano inteiro, cuja segunda linha
    // mescla os meses dois a dois (Mar:Abr, Mai:Jun...) — várias
    // mesclagens menores dentro do intervalo do grupo. Exige pelo menos
    // duas, não uma só: uma célula de dado às vezes repete a mesma
    // mesclagem cosmética do cabeçalho (ex.: "Limite" alargado visualmente
    // em três colunas, e cada linha de dado abaixo repete a mesma
    // mesclagem de três colunas) — isso não subdivide nada, é a mesma
    // mesclagem inteira ecoando, não deve ser lido como subcabeçalho.
    const nextGroupedMergesWithinGroups = horizontal.some((group) => {
      const nestedMerges = merges.filter(
        (merge) =>
          merge.s.r === end + 1 &&
          merge.e.r === end + 1 &&
          merge.e.c > merge.s.c &&
          merge.s.c >= group.s.c &&
          merge.e.c <= group.e.c,
      );
      return nestedMerges.length >= 2;
    });
    // Um cabeçalho folha pode conter uma ou duas mesclagens apenas para
    // ampliar visualmente um rótulo (ex.: "Limites" em F:H). Quando há
    // vários outros rótulos não mesclados na mesma linha, a próxima linha é
    // dado, não uma nova camada hierárquica — exceto quando (a) a linha
    // atual já mistura colunas simples ("Colaborador", "Função") com
    // colunas realmente agrupadas ("Treinamentos obrigatórios" mesclada
    // cobrindo 4 subcolunas) e não há dado nenhum abaixo pra confundir, ou
    // (b) a própria próxima linha tem mesclagens de grupo dentro do
    // intervalo de algum grupo desta linha: nesses dois casos os rótulos
    // não mesclados são colunas de nível único legítimas, não sinal de que
    // a próxima linha é dado.
    if (
      !sparseUnmergedParent &&
      distinctParents.size >= 3 &&
      unmergedLabels.length >= 2 &&
      !(horizontal.length > 0 && noDataAnywhereBelowForLayer) &&
      !nextGroupedMergesWithinGroups
    )
      break;
    const isSingleFullWidthGroup =
      horizontal.length === 1 &&
      horizontal[0]!.s.c === 0 &&
      horizontal[0]!.e.c >= width - 1 &&
      distinctParents.size === 1;
    if (isSingleFullWidthGroup) break;

    if (nextFilled.length < 2 || (isClearlyNotHeaderRow(next) && !isYearHeaderRow(next))) break;

    // A camada seguinte só é aceita quando as linhas logo abaixo parecem
    // dados de verdade. É uma trava conservadora contra tabelas comuns com
    // linhas textuais, nas quais uma formatação mesclada isolada não deve
    // deslocar o começo dos dados.
    const numericDataEvidence = aoa
      .slice(end + 2, Math.min(end + 5, aoa.length))
      .some((row) => row.some((value) => cellLooksNumeric(value) || cellLooksDate(value)));
    const nextHasGroupedMerges = merges.some(
      (merge) => merge.s.r === end + 1 && merge.e.r === end + 1 && merge.e.c > merge.s.c,
    );
    const nextHasHeaderVocabulary = nextFilled.some((value) => {
      const label = String(value).trim();
      return label.length <= 50 && SECTION_HEADER_HINT.test(label);
    });
    const textualDataBelow =
      (aoa[end + 2] ?? []).filter((value) => value !== null && value !== "").length >= 2;
    // Um modelo (.xltx/.xltm) genuinamente vazio nunca tem nenhuma das
    // evidências de dado acima — não existe dado nenhum na planilha pra
    // comparar. Sem essa saída, a camada folha do cabeçalho (ex.:
    // "Probabilidade"/"Severidade" sob "Avaliação") virava a primeira
    // "linha de dado" fantasma. Como a camada atual só chega até aqui com
    // mesclagem horizontal real (evidência estrutural, não estatística) e
    // não há dado nenhum abaixo pra confundir com cabeçalho, estender é
    // seguro: não há registro real que essa extensão possa engolir.
    const dataEvidence =
      numericDataEvidence ||
      nextHasGroupedMerges ||
      (nextHasHeaderVocabulary && textualDataBelow) ||
      (horizontal.length > 0 && noDataAnywhereBelowForLayer);
    if (!dataEvidence) break;

    end++;
  }

  return end;
}

function composeHierarchicalHeaders(
  aoa: NormalizedSheetRow[],
  start: number,
  end: number,
  merges: RelativeMerge[],
): { raw: NormalizedSheetRow; hierarchical: boolean } {
  const layers = aoa.slice(start, end + 1);
  const width = Math.max(0, ...layers.map((row) => row.length));
  const expandedParents = layers.slice(0, -1).map((layer) => {
    let parent: NormalizedCellValue = null;
    return Array.from({ length: width }, (_, column) => {
      const value = layer[column];
      if (!headerIsInvalid(value ?? null)) parent = value ?? null;
      return parent;
    });
  });
  const leaf = layers.at(-1) ?? [];
  // Uma coluna cujo rótulo, numa camada antes da folha, já veio de uma
  // célula isolada (sem fazer parte de nenhuma mesclagem horizontal de
  // verdade naquela linha) é uma coluna "plana": o rótulo já está completo,
  // não é um grupo esperando sub-rótulo de outra coluna. É o caso comum de
  // um cabeçalho misto — colunas simples (Equipamento, Código...) ao lado
  // de um grupo mesclado (ex.: "Calibração 2023") com sub-cabeçalho próprio
  // na linha seguinte. Uma folha em branco ali é normal (a coluna não tem
  // segundo nível), não motivo pra descartar o cabeçalho inteiro.
  const flatColumn = Array.from({ length: width }, (_, column) => {
    for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex++) {
      const value = layers[layerIndex]![column];
      if (headerIsInvalid(value ?? null)) continue;
      const row = start + layerIndex;
      const isGrouped = merges.some(
        (merge) =>
          merge.s.r === row &&
          merge.e.r === row &&
          merge.e.c > merge.s.c &&
          column >= merge.s.c &&
          column <= merge.e.c,
      );
      return !isGrouped;
    }
    return false;
  });
  const raw = Array.from({ length: width }, (_, column) => {
    // Uma coluna vazia na camada folha é separador visual, mesmo que fique
    // sob o alcance horizontal do último grupo da camada pai — exceto numa
    // coluna plana, cujo rótulo já veio completo de uma camada anterior.
    if (headerIsInvalid(leaf[column] ?? null) && !flatColumn[column]) return null;
    const parts: string[] = [];
    for (const layer of [...expandedParents, leaf]) {
      const value = layer[column];
      if (headerIsInvalid(value ?? null)) continue;
      const label = String(value).trim();
      if (
        !parts.some((part) => part.toLocaleLowerCase("pt-BR") === label.toLocaleLowerCase("pt-BR"))
      )
        parts.push(label);
    }
    return parts.length ? parts.join(" — ") : null;
  });
  return { raw, hierarchical: end > start };
}

function refineGenericDocumentHeaders(headers: string[], dataRows: NormalizedSheetRow[]): string[] {
  const generic = headers
    .map((header, index) => ({ header, index, base: header.replace(/_\d+$/, "") }))
    .filter((item) => /^(?:dados?|informa[cç][oõ]es?)$/i.test(item.base));
  if (generic.length < 2) return headers;

  const next = [...headers];
  const remaining: number[] = [];
  for (const item of generic) {
    const values = dataRows
      .map((row) => row[item.index])
      .filter((value) => value !== null && value !== "")
      .map((value) => String(value).trim());
    const statusRatio = values.length
      ? values.filter((value) =>
          /^(?:planejad[oa]|executad[oa]|realizad[oa]|pendente|conforme|n[aã]o conforme|status)$/i.test(
            value,
          ),
        ).length / values.length
      : 0;
    if (statusRatio >= 0.6) next[item.index] = "Situação";
    else remaining.push(item.index);
  }
  if (remaining[0] !== undefined) next[remaining[0]] = "Categoria";
  if (remaining[1] !== undefined) next[remaining[1]] = "Item / Ponto";
  remaining.slice(2).forEach((index, position) => {
    next[index] = `Detalhe ${position + 1}`;
  });
  return next;
}

const EMPTY_PLACEHOLDER_PATTERN = /^(?:nan(?:[\s/.-]*nan)*|n\/?a|não informado|[-–—])$/i;
const FORMULA_ERROR_PATTERN = EXCEL_ERROR_PATTERN;

function prettyLabel(key: string): string {
  return key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

function removeColumnsWithoutValues(
  rows: Row[],
  headers: string[],
  preserveHeaders = new Set<string>(),
) {
  if (!rows.length) return { rows, headers, emptyColumns: [] as string[] };
  const emptyColumns = headers.filter(
    (header) =>
      !preserveHeaders.has(header) &&
      !rows.some((row) => row[header] !== null && row[header] !== undefined && row[header] !== ""),
  );
  if (!emptyColumns.length) return { rows, headers, emptyColumns };

  const keptHeaders = headers.filter((header) => !emptyColumns.includes(header));
  return {
    headers: keptHeaders,
    emptyColumns,
    rows: rows.map((row) =>
      Object.fromEntries(keptHeaders.map((header) => [header, row[header] ?? null])),
    ),
  };
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
  dataRows: NormalizedSheetRow[];
};

function compactCellValues(values: NormalizedSheetRow): NormalizedCellValue {
  const present = values.filter((value) => value !== null && value !== "");
  if (!present.length) return null;
  const distinct = [...new Map(present.map((value) => [String(value), value])).values()];
  return distinct.length === 1 ? distinct[0]! : distinct.map(String).join(" | ");
}

function attendanceRosterRows(aoa: NormalizedSheetRow[]): Row[] | null {
  const normalize = (value: unknown) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  const headerIndex = aoa.findIndex((row) => {
    const labels = row.map(normalize);
    return labels.includes("n°") && labels.includes("matricula") && labels.includes("nome");
  });
  if (headerIndex < 0) return null;
  const header = aoa[headerIndex] ?? [];
  const indexOf = (pattern: RegExp) => header.findIndex((value) => pattern.test(normalize(value)));
  const numberColumn = indexOf(/^n[°ºo]\.?$/);
  const registrationColumn = indexOf(/^matricula$/);
  const nameColumn = indexOf(/^nome$/);
  const departmentColumn = indexOf(/^setor$/);
  const shiftColumn = indexOf(/^turno$/);
  const signatureColumn = header.findIndex((value) =>
    /^(?:dia:|assinatura)/i.test(String(value ?? "").trim()),
  );
  if (Math.min(numberColumn, registrationColumn, nameColumn) < 0) return null;

  const contextValues = aoa.slice(0, headerIndex).flat();
  const context = (pattern: RegExp) => {
    const value = contextValues.find((candidate) => pattern.test(String(candidate ?? "").trim()));
    if (value === undefined || value === null) return null;
    return String(value).replace(pattern, "").trim() || null;
  };
  const event = context(/^nome do evento:\s*/i);
  const promoter = context(/^entidade promotora:\s*/i);
  const workload = context(/^carga hor[aá]ria:\s*/i);
  const instructor = context(/^instrutor:\s*/i);
  const dateText =
    String(header[signatureColumn] ?? "")
      .replace(/^dia:\s*/i, "")
      .trim() || null;
  const nameEnd =
    [departmentColumn, shiftColumn, signatureColumn]
      .filter((column) => column > nameColumn)
      .sort((a, b) => a - b)[0] ?? nameColumn + 1;
  const signatureEnd = Math.max(signatureColumn + 1, header.length);

  const rows: Row[] = [];
  for (const source of aoa.slice(headerIndex + 1)) {
    const sequence = source[numberColumn];
    if (typeof sequence !== "number" && !/^\d+$/.test(String(sequence ?? "").trim())) continue;
    rows.push({
      Evento: event,
      "Entidade promotora": promoter,
      "Carga horária": workload,
      Instrutor: instructor,
      "N°": sequence ?? null,
      Matrícula: source[registrationColumn] ?? null,
      Nome: compactCellValues(source.slice(nameColumn, nameEnd)),
      Setor: departmentColumn >= 0 ? (source[departmentColumn] ?? null) : null,
      Turno: shiftColumn >= 0 ? (source[shiftColumn] ?? null) : null,
      Data: dateText,
      Assinatura:
        signatureColumn >= 0
          ? compactCellValues(source.slice(signatureColumn, signatureEnd))
          : null,
    });
  }
  return rows.length >= 5 ? rows : null;
}

/**
 * Normaliza formulários de validação compostos por blocos horários. Cada
 * bloco traz HORA, REFERÊNCIA, as subcolunas Aceita/Rejeita e campos de
 * resultado. Em vez de escolher uma dessas linhas como cabeçalho global,
 * produz uma linha por horário e conserva os campos operacionais.
 */
function inspectorValidationRows(aoa: NormalizedSheetRow[]): Row[] | null {
  const hourRows = aoa
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => /^hora$/i.test(String(row[0] ?? "").trim()));
  if (hourRows.length < 2) return null;

  const output: Row[] = [];
  for (let blockIndex = 0; blockIndex < hourRows.length; blockIndex++) {
    const { row: hourRow, index: hourIndex } = hourRows[blockIndex]!;
    const referenceRow = aoa[hourIndex + 1] ?? [];
    const subheaderRow = aoa[hourIndex + 2] ?? [];
    if (!/^refer[eê]ncia$/i.test(String(referenceRow[0] ?? "").trim())) return null;

    const acceptedColumns = subheaderRow
      .map((value, column) => ({ value, column }))
      .filter(({ value, column }) => column > 0 && /^aceit[ao]$/i.test(String(value ?? "").trim()))
      .map(({ column }) => column);
    if (acceptedColumns.length < 2) return null;

    const blockEnd = hourRows[blockIndex + 1]?.index ?? aoa.length;
    const bodyStart = hourIndex + 3;
    const summaryRows = new Map<string, number>();
    for (let rowIndex = bodyStart; rowIndex < blockEnd; rowIndex++) {
      const label = String(aoa[rowIndex]?.[0] ?? "").trim();
      if (/^(?:resultado|aviso\s*#?|inspetor)$/i.test(label)) summaryRows.set(label, rowIndex);
    }
    const firstSummary = Math.min(...summaryRows.values(), blockEnd);

    for (const acceptedColumn of acceptedColumns) {
      const rejectedColumn = acceptedColumn + 1;
      if (!/^rejeit[ao]$/i.test(String(subheaderRow[rejectedColumn] ?? "").trim())) continue;
      const row: Row = {
        Hora: compactCellValues([hourRow[acceptedColumn] ?? null, hourRow[rejectedColumn] ?? null]),
        Referência: compactCellValues([
          referenceRow[acceptedColumn] ?? null,
          referenceRow[rejectedColumn] ?? null,
        ]),
        Aceita: compactCellValues(
          aoa.slice(bodyStart, firstSummary).map((candidate) => candidate[acceptedColumn] ?? null),
        ),
        Rejeita: compactCellValues(
          aoa.slice(bodyStart, firstSummary).map((candidate) => candidate[rejectedColumn] ?? null),
        ),
      };
      for (const [label, rowIndex] of summaryRows) {
        const key = /^aviso/i.test(label)
          ? "Aviso #"
          : /^inspetor/i.test(label)
            ? "Inspetor"
            : "Resultado";
        row[key] = compactCellValues([
          aoa[rowIndex]?.[acceptedColumn] ?? null,
          aoa[rowIndex]?.[rejectedColumn] ?? null,
        ]);
      }
      if (row["Hora"] !== null) output.push(row);
    }
  }
  return output.length ? output : null;
}

function measurementSeriesRows(aoa: NormalizedSheetRow[]): Row[] | null {
  const headerIndex = aoa.findIndex((row) => {
    const first = String(row[0] ?? "").trim();
    const metrics = row.slice(3).filter((value) => value !== null && value !== "");
    return /dimensiona(?:l|is)|funciona(?:l|is)/i.test(first) && metrics.length >= 4;
  });
  if (headerIndex < 0) return null;

  const header = aoa[headerIndex] ?? [];
  const unitRow = aoa[headerIndex + 1] ?? [];
  const metricColumns = header
    .map((value, column) => ({ value, column }))
    .filter(({ value, column }) => column >= 3 && value !== null && value !== "");
  if (metricColumns.length < 4) return null;

  const measurementStart = aoa.findIndex((row, index) => {
    if (index <= headerIndex) return false;
    const time = String(row[0] ?? "").trim();
    return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(time) && cellLooksNumeric(row[1]);
  });
  if (measurementStart < 0) return null;
  const measurementRows = aoa.slice(measurementStart).filter((row) => {
    const time = String(row[0] ?? "").trim();
    return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(time) && cellLooksNumeric(row[1]);
  });
  if (measurementRows.length < 5) return null;

  const metricKeys = metricColumns.map(({ value, column }) => {
    const unit = String(unitRow[column] ?? "").trim();
    return unit ? `${String(value).trim()} ${unit}` : String(value).trim();
  });
  const rows: Row[] = [];
  let currentCategory: string | null = null;
  for (let index = headerIndex + 2; index < measurementStart; index++) {
    const source = aoa[index] ?? [];
    const category = String(source[0] ?? "").trim();
    if (category) currentCategory = category;
    const statistic = String(source[2] ?? "").trim();
    if (!statistic) continue;
    const row: Row = {
      Categoria: currentCategory,
      Estatística: statistic,
      Hora: null,
      Amostra: null,
      Data: null,
    };
    metricColumns.forEach(({ column }, metricIndex) => {
      row[metricKeys[metricIndex]!] = source[column] ?? null;
    });
    rows.push(row);
  }
  for (const source of measurementRows) {
    const row: Row = {
      Categoria: "Medição",
      Estatística: null,
      Hora: source[0] ?? null,
      Amostra: source[1] ?? null,
      Data: source[2] ?? null,
    };
    metricColumns.forEach(({ column }, metricIndex) => {
      row[metricKeys[metricIndex]!] = source[column] ?? null;
    });
    rows.push(row);
  }
  return rows;
}

function laboratorySeriesRows(aoa: NormalizedSheetRow[]): Row[] | null {
  const sectionRows = aoa
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.some((value) => /^viscosidade\s*-/i.test(String(value ?? "").trim())));
  if (sectionRows.length < 2) return null;

  const groupStarts = [
    ...new Set(
      sectionRows.flatMap(({ row }) =>
        row
          .map((value, column) => ({ value, column }))
          .filter(({ value }) => /^viscosidade\s*-/i.test(String(value ?? "").trim()))
          .map(({ column }) => column),
      ),
    ),
  ].sort((a, b) => a - b);
  if (groupStarts.length < 2) return null;

  const rows: Row[] = [];
  const sheetWidth = Math.max(0, ...aoa.map((row) => row.length));
  for (let sectionIndex = 0; sectionIndex < sectionRows.length; sectionIndex++) {
    const { row: section, index: start } = sectionRows[sectionIndex]!;
    const end = sectionRows[sectionIndex + 1]?.index ?? aoa.length;
    for (let groupIndex = 0; groupIndex < groupStarts.length; groupIndex++) {
      const groupStart = groupStarts[groupIndex]!;
      const groupEnd = groupStarts[groupIndex + 1] ?? sheetWidth ?? groupStart + 6;
      const groupName =
        aoa
          .slice(0, start)
          .map((candidate) => candidate[groupStart])
          .find((value) => value !== null && value !== "" && value !== undefined) ??
        `Grupo ${groupIndex + 1}`;
      const assay = String(section[groupStart] ?? "")
        .replace(/^viscosidade\s*-\s*/i, "")
        .trim();
      if (!assay) continue;
      for (let rowIndex = start + 1; rowIndex < end; rowIndex++) {
        const source = aoa[rowIndex] ?? [];
        const sample = source[groupStart];
        if (sample === null || sample === "" || sample === undefined) continue;
        const result = [...source.slice(groupStart + 1, groupEnd)]
          .reverse()
          .find((value) => value !== null && value !== "" && value !== undefined);
        if (result === undefined) continue;
        rows.push({
          Amostra: groupName,
          Ensaio: assay,
          Identificação: sample,
          Resultado: result,
        });
      }
    }
  }

  for (let rowIndex = 0; rowIndex < aoa.length - 1; rowIndex++) {
    const source = aoa[rowIndex] ?? [];
    source.forEach((value, column) => {
      const label = String(value ?? "").trim();
      if (!/^especifica[cç][aã]o t[eé]cnica/i.test(label)) return;
      const next = aoa[rowIndex + 1] ?? [];
      const assay = next[column];
      const result = next
        .slice(column + 1)
        .find((candidate) => candidate !== null && candidate !== "" && candidate !== undefined);
      if (assay === null || assay === "" || assay === undefined || result === undefined) return;
      rows.push({
        Amostra: label.replace(/^especifica[cç][aã]o t[eé]cnica\s*/i, "").trim(),
        Ensaio: assay,
        Identificação: "Especificação",
        Resultado: result,
      });
    });
  }
  return rows.length >= 6 ? rows : null;
}

/**
 * Acha, dentro de uma linha, todas as sequências de pelo menos 2 células
 * preenchidas e não-numéricas seguidas (candidatas a cabeçalho de um
 * bloco). Uma linha pode ter mais de uma sequência dessas quando dois
 * blocos ficam lado a lado, separados por uma ou mais colunas vazias (ex:
 * "Núcleo 2" e "Núcleo 5" no mesmo intervalo de linhas, em colunas
 * diferentes).
 */
function headerRunsInRow(row: NormalizedSheetRow): { startCol: number; endCol: number }[] {
  const runs: { startCol: number; endCol: number }[] = [];
  let c = 0;
  while (c < row.length) {
    const cell = row[c] ?? null;
    if (
      cell !== null &&
      cell !== "" &&
      !cellLooksNumeric(cell) &&
      !FORMULA_ERROR_PATTERN.test(String(cell).trim())
    ) {
      const start = c;
      while (c + 1 < row.length) {
        const next = row[c + 1] ?? null;
        if (
          next === null ||
          next === "" ||
          cellLooksNumeric(next) ||
          FORMULA_ERROR_PATTERN.test(String(next).trim())
        )
          break;
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
function findHeaderCandidates(aoa: NormalizedSheetRow[]): HeaderRun[] {
  const candidates: HeaderRun[] = [];
  for (let r = 0; r < aoa.length; r++) {
    const row = (aoa[r] ?? []) as NormalizedSheetRow;
    const next = (aoa[r + 1] ?? []) as NormalizedSheetRow;
    for (const run of headerRunsInRow(row)) {
      const hasDataBelow = next
        .slice(run.startCol, run.endCol + 1)
        .some((c) => c !== null && c !== "");
      if (!hasDataBelow) continue;
      // Matrizes de monitoramento frequentemente deixam a primeira célula
      // do cabeçalho vazia: os meses começam na coluna seguinte, enquanto
      // a coluna à esquerda contém o ponto de coleta/máquina. Sem incluir
      // essa coluna, o valor que identifica cada linha era perdido.
      const includeLeftIdentity =
        run.startCol > 0 &&
        (row[run.startCol - 1] === null || row[run.startCol - 1] === "") &&
        next[run.startCol - 1] !== null &&
        next[run.startCol - 1] !== "";
      const startCol = includeLeftIdentity ? run.startCol - 1 : run.startCol;
      const headers: string[] = includeLeftIdentity ? ["Ponto / Item"] : [];
      for (let c = run.startCol; c <= run.endCol; c++) headers.push(String(row[c]).trim());
      candidates.push({ row: r, startCol, endCol: run.endCol, headers });
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
  aoa: NormalizedSheetRow[],
  headerRowIndex: number,
  startCol: number,
  endCol: number,
): { label: string; row: number } | null {
  // A janela de busca é exatamente a faixa de colunas do próprio bloco
  // (sem folga pra nenhum dos lados): um título mesclado cobre a mesma
  // largura do cabeçalho abaixo dele, e um título isolado (célula única,
  // sem mesclagem) sempre cai dentro do início dessa faixa. Alargar a
  // janela pra fora da faixa do bloco fazia vazar o título do bloco VIZINHO
  // quando dois blocos ficam lado a lado (ex: "Núcleo 2" e "Núcleo 5" no
  // mesmo intervalo de linhas), misturando os dois valores e descartando o
  // rótulo por engano.
  // Alguns modelos deixam uma linha visual vazia entre o título mesclado e
  // o cabeçalho. Procurar até três linhas acima evita perder esse bloco (e
  // deixar o título repetido como se fosse dado), mas para no primeiro
  // conteúdo real encontrado para não "pular" uma tabela anterior.
  for (let rowIndex = headerRowIndex - 1; rowIndex >= Math.max(0, headerRowIndex - 3); rowIndex--) {
    const aboveRow = (aoa[rowIndex] ?? []) as NormalizedSheetRow;
    const filled: NormalizedCellValue[] = [];
    aboveRow.forEach((v, c) => {
      if (v !== null && v !== "" && c >= startCol && c <= endCol) filled.push(v);
    });
    if (!filled.length) continue;
    // Um título mesclado horizontalmente chega repetido nas células da
    // faixa. Conteúdo com valores diferentes é uma linha de dados, não um
    // título isolado.
    const distinct = new Set(filled.map((v) => String(v).trim()));
    if (distinct.size !== 1) return null;
    const label = [...distinct][0]!;
    if (cellLooksNumeric(label) || FORMULA_ERROR_PATTERN.test(label)) return null;
    return { label, row: rowIndex };
  }
  return null;
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
function detectBlocks(aoa: NormalizedSheetRow[]): Block[] | null {
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
  if (labels.some((label) => label === null)) return null;

  // Linhas "reservadas": o cabeçalho de cada bloco e a linha do título
  // logo acima dele. Ao coletar as linhas de dado de um bloco, paramos ao
  // encontrar qualquer uma dessas linhas — mesmo que não estejam
  // totalmente em branco na faixa de colunas do bloco atual (ex: o título
  // "Núcleo 3" de um bloco empilhado abaixo cai dentro da mesma faixa de
  // colunas do bloco anterior).
  const reservedRows = new Set<number>();
  for (const [index, run] of chosen.entries()) {
    reservedRows.add(run.row);
    const label = labels[index];
    if (label) reservedRows.add(label.row);
  }

  return chosen.map((run, index) => {
    const label = labels[index]?.label ?? `Bloco ${index + 1}`;
    const dataRows: NormalizedSheetRow[] = [];
    let blankStreak = 0;
    for (let r = run.row + 1; r < aoa.length; r++) {
      if (reservedRows.has(r)) break;
      const row = (aoa[r] ?? []) as NormalizedSheetRow;
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
      // Um título mesclado de um bloco seguinte pode cair dentro da faixa
      // vertical do bloco anterior. Como a expansão de mesclagens repete o
      // mesmo texto em todas as células, descarte essa linha visual antes
      // de ela virar vários "resultados" idênticos no cronograma.
      const filled = dataRow.filter((value) => value !== null && value !== "");
      const repeatedMergedTitle =
        filled.length >= 3 &&
        String(filled[0]).trim().length >= 8 &&
        filled.every((value) => String(value).trim() === String(filled[0]).trim());
      if (repeatedMergedTitle) continue;
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
/**
 * Grade de valores crus de uma aba, na forma que a normalização consome.
 *
 * É o mesmo formato que `sheet_to_json` com `header: 1` produz. Existe como
 * tipo próprio porque quem já tem a grade não deveria pagar para reconstruí-la.
 */
/**
 * Os valores que uma grade de aba pode conter.
 *
 * O booleano esteve ausente desta lista por muito tempo, e a ausência era um
 * erro de anotação e não de comportamento: uma célula `t="b"` do Excel chega
 * como `true`/`false` pelo `sheet_to_json`, e o parâmetro de tipo daquela
 * chamada é uma asserção, não uma conversão. O caminho atual sempre produziu
 * booleanos aqui; o tipo é que dizia o contrário.
 *
 * A omissão apareceu ao escrever a grade de OOXML, que precisa declarar o mesmo
 * conjunto de valores que a worksheet já entregava.
 */
export type SheetSourceGrid = (string | number | boolean | Date | null)[][];

/** Uma linha da grade, para quem recebe uma de cada vez. */
export type SheetSourceRow = SheetSourceGrid[number];

/**
 * Uma linha depois de `normalizeRawRow`: sem `Date`, e com booleano.
 *
 * A normalização converte data em texto e deixa o resto passar, então o que sai
 * dela é o conjunto de entrada menos `Date`. Ter um nome para isso evita a
 * repetição da união em duas dezenas de assinaturas internas, que foi o que
 * fez o booleano ficar de fora de todas elas por tanto tempo.
 */
export type NormalizedCellValue = string | number | boolean | null;

export type NormalizedSheetRow = NormalizedCellValue[];

export type SheetToRowsOptions = {
  /**
   * Grade já pronta, para a normalização não reconstruí-la.
   *
   * O caminho de leitura por streaming produz essa grade lendo o arquivo, e sem
   * isto ela seria descartada e refeita a partir da worksheet: medidos 37 MiB e
   * mais de um segundo por aba num arquivo de 200 mil linhas.
   *
   * Quem passa a grade assume a responsabilidade de que ela corresponde à
   * worksheet informada. Todo o resto da normalização (mesclagens, fórmulas,
   * linhas ocultas, diagnóstico) continua lendo a worksheet, porque essas
   * informações não existem numa grade de valores.
   */
  aoa?: SheetSourceGrid;
};

export function sheetToRows(
  ws: XLSX.WorkSheet,
  workbook?: XLSX.WorkBook,
  options?: SheetToRowsOptions,
): SheetImportResult {
  const range = ws["!ref"]
    ? XLSX.utils.decode_range(ws["!ref"])
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const rawAoa =
    options?.aoa ??
    XLSX.utils.sheet_to_json<SheetSourceRow>(ws, {
      header: 1,
      defval: null,
    });
  const sourceAoa = rawAoa.map((row, rowIndex) => normalizeRawRow(row, ws, rowIndex, range.s));
  const sourceNonEmptyCells = sourceAoa.reduce(
    (sum, row) => sum + row.filter((value) => value !== null && value !== "").length,
    0,
  );

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
  // Células com fórmula mas sem valor calculado guardado no arquivo (comum
  // em planilhas geradas por script, que escrevem a fórmula mas nunca a
  // calculam de verdade): tenta recuperar o valor avaliando a fórmula —
  // inclusive fórmulas que referenciam outra aba (SUMIF/COUNTIF/soma entre
  // planilhas), quando `workbook` foi informado; ver resolveFormulaCell.
  // `cache` é compartilhado entre todas as células da aba nesta passagem
  // pra não reavaliar a mesma referência várias vezes.
  const formulaCache = new Map<string, number | null>();
  let formulaCellsRecovered = 0;
  let volatileCellsRecalculated = 0;
  const width = range.e.c - range.s.c + 1;
  for (let r = 0; r < sourceAoa.length; r++) {
    const row = sourceAoa[r] as NormalizedSheetRow;
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
      const addr = XLSX.utils.encode_cell({ r: r + range.s.r, c: c + range.s.c });
      if (v !== null && v !== undefined) {
        // Célula já preenchida: o valor do arquivo é a fonte mais confiável,
        // porque foi o Excel quem calculou. A exceção são as fórmulas que
        // dependem da data de hoje — ali o número gravado responde "quantos
        // dias faltavam quando a planilha foi salva", e um cronograma de
        // 2023 mostraria "-556 dias restantes" como se fosse hoje.
        const formula = worksheetCellAtAddress(ws, addr)?.f;
        if (typeof formula !== "string" || !isVolatileFormula(formula)) continue;
        const recalculated = resolveFormulaCell(ws, addr, new Map(), new Set(), true, workbook);
        if (recalculated === null || recalculated === v) continue;
        row[c] = recalculated;
        volatileCellsRecalculated++;
        continue;
      }
      const resolved = resolveFormulaCell(ws, addr, formulaCache, new Set(), false, workbook);
      if (resolved !== null) {
        row[c] = resolved;
        formulaCellsRecovered++;
      }
    }
  }

  // Mantém uma cópia limitada antes do preenchimento de mesclagens e dos
  // cortes automáticos. É essa grade que permite ao usuário escolher outro
  // cabeçalho ou região sem depender da interpretação já reparada.
  const sourceGrid = buildSourceGrid(sourceAoa, range);

  // A grade original continua disponível para auditoria e seleção manual,
  // mas a interpretação automática deve reproduzir o que o Excel mostra.
  // Linhas ocultas são usadas com frequência como histórico, detalhe
  // recolhido ou rascunho. Incluí-las em widgets criava registros que o
  // usuário não vê na planilha (como os `4s` do FRS-QA-BR-405).
  // Mantemos os índices no lugar, apenas esvaziando essas linhas na cópia
  // de análise, para não deslocar endereços, mesclagens nem fórmulas.
  const hiddenRows = new Set<number>();
  for (let row = 0; row < sourceAoa.length; row++) {
    if (ws["!rows"]?.[range.s.r + row]?.hidden === true) hiddenRows.add(row);
  }
  const hiddenRowsIgnored = hiddenRows.size;
  const aoa = sourceAoa.map((row, index) => (hiddenRows.has(index) ? [] : [...row]));

  // Linhas de totais declaradas pelas Tabelas do Excel desta aba: somam as
  // linhas do próprio bloco, então entram em dobro em qualquer total do
  // painel. Só as colunas da tabela que declarou o total são limpas, porque
  // nesses modelos há blocos lado a lado e o resto da linha costuma ser dado
  // real do bloco vizinho. Mesma escolha das linhas ocultas: a grade de
  // origem permanece intacta para auditoria, só a cópia de análise muda.
  const totalsRegions = tableTotalsRegions(
    (ws as WorksheetWithAdvancedMetadata)["!oliAdvanced"]?.structuredTables ?? [],
    range.s.r,
    range.s.c,
  );
  let totalsRowsIgnored = 0;
  for (const region of totalsRegions) {
    const row = aoa[region.row];
    if (!row) continue;
    let cleared = false;
    for (let column = region.startColumn; column <= region.endColumn; column++) {
      const value = row[column];
      if (value === null || value === undefined || value === "") continue;
      row[column] = null;
      cleared = true;
    }
    if (cleared) totalsRowsIgnored++;
  }
  const hiddenRowsMessage = hiddenRowsIgnored
    ? `${hiddenRowsIgnored} linha${hiddenRowsIgnored > 1 ? "s ocultas foram preservadas" : " oculta foi preservada"} na grade original, mas ignorada${hiddenRowsIgnored > 1 ? "s" : ""} nos registros, métricas e widgets para reproduzir a visualização do Excel.`
    : "";
  const importMessage = (message: string) =>
    hiddenRowsMessage ? `${message} ${hiddenRowsMessage}` : message;

  const merges: RelativeMerge[] = (ws["!merges"] ?? []).map((m) => ({
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
      ((row ?? []) as NormalizedSheetRow).filter((c) => c !== null && c !== "").length,
    );
  });
  const bannerRows = new Set<number>();
  for (const m of merges) {
    // Uma mesclagem retangular (várias linhas E várias colunas na mesma
    // célula) é sempre um bloco de título/assinatura institucional — ex.:
    // o nome do documento ocupando 3 linhas de altura visual, ao lado de um
    // quadro "Revisão/Data/Folha" separado. Um grupo de cabeçalho de
    // tabela real nunca mescla a própria camada de grupo com a camada de
    // sub-coluna dentro da MESMA célula: cada camada usa sua própria
    // mesclagem horizontal, numa linha só. Sem este caso, um bloco de
    // título assim (que preenche a linha inteira via expansão da
    // mesclagem, fillRatio 100%) passava pelo atalho que aceita a primeira
    // linha "cheia" como cabeçalho, engolindo a linha de cabeçalho real
    // mais abaixo como se fosse a primeira linha de dado.
    if (m.e.c > m.s.c && m.e.r > m.s.r) {
      for (let row = m.s.r; row <= m.e.r; row++) bannerRows.add(row);
      continue;
    }
    if (!(m.e.c > m.s.c && m.s.r === m.e.r)) continue;
    if (originalFilledCount.get(m.s.r) === 1) {
      bannerRows.add(m.s.r);
      continue;
    }
    // Alguns geradores de OOXML fora do Excel escrevem o mesmo texto em
    // toda célula do intervalo mesclado, em vez de só na célula de origem
    // (única forma que o Excel de verdade serializa uma mesclagem) — sem
    // esta segunda checagem, um título espalhado assim escapava da
    // detecção acima (`originalFilledCount === 1` falha porque a linha
    // "parece" ter várias células preenchidas) e virava cabeçalho da
    // tabela. Só aceito quando a mesclagem cobre a largura inteira da
    // linha E todas as células preenchidas têm o mesmo texto — um
    // cabeçalho real com duas colunas coincidentemente batizadas igual (o
    // caso que a checagem original protege) nunca cobre a largura inteira
    // sozinho com um valor idêntico em todas as colunas.
    if (m.s.c === 0 && m.e.c >= width - 1) {
      const row = (aoa[m.s.r] ?? []) as NormalizedSheetRow;
      const filled = row.filter((c) => c !== null && c !== "");
      const distinct = new Set(filled.map((c) => String(c).trim()));
      if (filled.length > 1 && distinct.size === 1) bannerRows.add(m.s.r);
    }
  }

  const filledByRow = new Map<number, number>();
  for (const m of merges) {
    const originRow = (aoa[m.s.r] ?? []) as NormalizedSheetRow;
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
      // Uma linha que já não tinha NENHUM valor digitado de forma
      // independente (em qualquer coluna, não só a desta mesclagem) antes
      // de qualquer preenchimento não é um registro real — é só o efeito
      // visual da mesclagem esticando a altura da linha de origem (comum em
      // planilhas de matriz de risco, onde a mesma linha aparece "alta" por
      // formatação, não por ter 3 observações distintas). Preencher mesmo
      // assim faria um registro só virar 3 idênticos, triplicando contagens
      // e somas. A linha de origem (r === m.s.r) sempre tem pelo menos o
      // valor de origem, então nunca é pulada por esta condição.
      if (r !== m.s.r && originalFilledCount.get(r) === 0) continue;
      const row = (aoa[r] ?? []) as NormalizedSheetRow;
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        if (row[c] === null || row[c] === undefined || row[c] === "") {
          row[c] = originValue;
          filledByRow.set(r, (filledByRow.get(r) ?? 0) + 1);
        }
      }
    }
  }

  const attendanceRows = attendanceRosterRows(aoa);
  if (attendanceRows) {
    return {
      rows: attendanceRows,
      warning: importMessage(
        `Esta aba foi reconhecida como lista de presença. ${attendanceRows.length} posições numeradas foram preservadas com evento, identificação, turno, data e assinatura.`,
      ),
      diagnostics: diagnoseImportedSheet(ws, attendanceRows),
      sourceGrid,
      audit: {
        sourceNonEmptyCells,
        outputNonEmptyCells: attendanceRows.reduce(
          (sum, row) =>
            sum + Object.values(row).filter((value) => value !== null && value !== "").length,
          0,
        ),
        formulaCellsRecovered,
        mergedCellsExpanded: [...filledByRow.values()].reduce((sum, count) => sum + count, 0),
        numericCellsConverted: 0,
        rowsAboveHeaderIgnored: 0,
        hiddenRowsIgnored,
        blankRowsIgnored: 0,
        trailingRowsIgnored: 0,
        columnsIgnored: 0,
      },
      tableMode: "attendance-roster",
    };
  }

  const laboratoryRows = laboratorySeriesRows(aoa);
  if (laboratoryRows) {
    return {
      rows: laboratoryRows,
      warning: importMessage(
        `Esta aba contém ensaios laboratoriais em blocos. ${laboratoryRows.length} resultados foram normalizados com amostra, ensaio, identificação e resultado, mantendo as especificações separadas.`,
      ),
      diagnostics: diagnoseImportedSheet(ws, laboratoryRows),
      sourceGrid,
      audit: {
        sourceNonEmptyCells,
        outputNonEmptyCells: laboratoryRows.reduce(
          (sum, row) =>
            sum + Object.values(row).filter((value) => value !== null && value !== "").length,
          0,
        ),
        formulaCellsRecovered,
        mergedCellsExpanded: [...filledByRow.values()].reduce((sum, count) => sum + count, 0),
        numericCellsConverted: 0,
        rowsAboveHeaderIgnored: 0,
        hiddenRowsIgnored,
        blankRowsIgnored: 0,
        trailingRowsIgnored: 0,
        columnsIgnored: 0,
      },
      tableMode: "laboratory-series",
    };
  }

  const measurementRows = measurementSeriesRows(aoa);
  if (measurementRows) {
    return {
      rows: measurementRows,
      warning: importMessage(
        `Esta aba combina especificações, estatísticas e medições dimensionais. ${measurementRows.length} linhas foram normalizadas sem misturar limites, resumos e amostras.`,
      ),
      diagnostics: diagnoseImportedSheet(ws, measurementRows),
      sourceGrid,
      audit: {
        sourceNonEmptyCells,
        outputNonEmptyCells: measurementRows.reduce(
          (sum, row) =>
            sum + Object.values(row).filter((value) => value !== null && value !== "").length,
          0,
        ),
        formulaCellsRecovered,
        mergedCellsExpanded: [...filledByRow.values()].reduce((sum, count) => sum + count, 0),
        numericCellsConverted: 0,
        rowsAboveHeaderIgnored: 0,
        hiddenRowsIgnored,
        blankRowsIgnored: 0,
        trailingRowsIgnored: 0,
        columnsIgnored: 0,
      },
      tableMode: "measurement-series",
    };
  }

  const validationRows = inspectorValidationRows(aoa);
  if (validationRows) {
    return {
      rows: validationRows,
      warning: importMessage(
        `Esta aba usa uma matriz de validação por horário. ${validationRows.length} horários foram normalizados, preservando referência, aceita, rejeita, resultado, aviso e inspetor.`,
      ),
      diagnostics: diagnoseImportedSheet(ws, validationRows),
      sourceGrid,
      audit: {
        sourceNonEmptyCells,
        outputNonEmptyCells: validationRows.reduce(
          (sum, row) =>
            sum + Object.values(row).filter((value) => value !== null && value !== "").length,
          0,
        ),
        formulaCellsRecovered,
        mergedCellsExpanded: [...filledByRow.values()].reduce((sum, count) => sum + count, 0),
        numericCellsConverted: 0,
        rowsAboveHeaderIgnored: 0,
        hiddenRowsIgnored,
        blankRowsIgnored: 0,
        trailingRowsIgnored: 0,
        columnsIgnored: 0,
      },
      tableMode: "validation-matrix",
    };
  }

  // Planilhas com várias mini-tabelas repetidas na mesma aba (ex: um bloco
  // "Núcleo 1", "Núcleo 2"... cada um com seu próprio cabeçalho e linhas)
  // seguem um caminho totalmente diferente do resto da função: não existe
  // "a" linha de cabeçalho da aba, existem várias, uma por bloco. Ver
  // `detectBlocks` para o critério de detecção (conservador o bastante pra
  // nunca disparar numa aba de tabela única normal).
  const blocks = detectBlocks(aoa);
  if (
    blocks &&
    blocks.length >= MIN_BLOCKS_FOR_MULTI_BLOCK_MODE &&
    blocks.every((block) => block.dataRows.length > 0)
  ) {
    const { rows: blockRows, blockColumnName } = blocksToRows(blocks);
    const dataHeaders = blocks[0]!.headers;
    const periodDataHeaders =
      dataHeaders.filter((header) => isPeriodColumnLabel(header)).length >=
        MIN_SCHEDULE_PERIOD_COLUMNS && blockRows.length >= 5
        ? new Set(dataHeaders.filter((header) => isPeriodColumnLabel(header)))
        : new Set<string>();
    const {
      rows: blockRowsWithoutEmptyColumns,
      headers: blockHeadersWithValues,
      emptyColumns: emptyBlockColumns,
    } = removeColumnsWithoutValues(blockRows, [blockColumnName, ...dataHeaders], periodDataHeaders);
    const dataHeadersWithValues = blockHeadersWithValues.filter(
      (header) => header !== blockColumnName,
    );

    const nearEmptyColumns =
      blockRowsWithoutEmptyColumns.length >= 5
        ? dataHeadersWithValues.filter((h) => {
            const filled = blockRowsWithoutEmptyColumns.filter(
              (r) => r[h] !== null && r[h] !== "",
            ).length;
            return filled / blockRowsWithoutEmptyColumns.length < NEAR_EMPTY_RATIO;
          })
        : [];

    const blockMessages: string[] = [
      `Esta aba tem ${blocks.length} blocos de tabela repetidos (${blocks
        .map((b) => `"${b.label}"`)
        .join(
          ", ",
        )}), cada um com seu próprio título e cabeçalho. Foram combinados em uma única tabela, com a coluna "${blockColumnName}" indicando de qual bloco veio cada linha. Confira se a combinação ficou correta.`,
    ];
    if (emptyBlockColumns.length > 0) {
      const names = emptyBlockColumns.map((header) => `"${prettyLabel(header)}"`).join(", ");
      blockMessages.push(
        `${emptyBlockColumns.length > 1 ? "As colunas" : "A coluna"} ${names} não tinha${emptyBlockColumns.length > 1 ? "m" : ""} nenhum valor escrito nos registros e ${emptyBlockColumns.length > 1 ? "foram removidas" : "foi removida"}, em vez de gerar "Não informado".`,
      );
    }
    if (nearEmptyColumns.length > 0) {
      const names = nearEmptyColumns.map((h) => `"${prettyLabel(h)}"`).join(", ");
      blockMessages.push(
        `${nearEmptyColumns.length > 1 ? "As colunas" : "A coluna"} ${names} ${nearEmptyColumns.length > 1 ? "estão" : "está"} quase ${nearEmptyColumns.length > 1 ? "vazias" : "vazia"} em todos os blocos. Confira se ${nearEmptyColumns.length > 1 ? "elas foram importadas" : "ela foi importada"} corretamente antes de usá-la${nearEmptyColumns.length > 1 ? "s" : ""} em um gráfico.`,
      );
    }

    return {
      rows: blockRowsWithoutEmptyColumns,
      warning: importMessage(blockMessages.join(" ")),
      diagnostics: diagnoseImportedSheet(ws, blockRowsWithoutEmptyColumns),
      sourceGrid,
      audit: {
        sourceNonEmptyCells,
        outputNonEmptyCells: blockRowsWithoutEmptyColumns.reduce(
          (sum, row) =>
            sum + Object.values(row).filter((value) => value !== null && value !== "").length,
          0,
        ),
        formulaCellsRecovered,
        mergedCellsExpanded: [...filledByRow.values()].reduce((sum, count) => sum + count, 0),
        numericCellsConverted: 0,
        rowsAboveHeaderIgnored: 0,
        hiddenRowsIgnored,
        blankRowsIgnored: 0,
        trailingRowsIgnored: 0,
        columnsIgnored: emptyBlockColumns.length,
      },
      tableMode: "repeated-blocks",
    };
  }

  const selectedHeaderRowIndex = findHeaderRowIndex(aoa, bannerRows);
  const headerRowIndex = findHierarchicalHeaderStart(aoa, selectedHeaderRowIndex, merges);
  const headerRowEnd = findHierarchicalHeaderEnd(aoa, headerRowIndex, merges);
  const { raw: headerRow, hierarchical: hierarchicalHeader } = composeHierarchicalHeaders(
    aoa,
    headerRowIndex,
    headerRowEnd,
    merges,
  );
  let mergedHeaderCells = 0;
  for (let row = headerRowIndex; row <= headerRowEnd; row++)
    mergedHeaderCells += filledByRow.get(row) ?? 0;
  let mergedCells = 0;
  for (const [row, count] of filledByRow) {
    if (row < headerRowIndex || row > headerRowEnd) mergedCells += count;
  }

  const seen = new Map<string, number>();
  let renamed = 0;
  const headerWasBlank: boolean[] = [];
  const initialHeaders = headerRow.map((raw, i) => {
    const base = headerName(raw, i);
    headerWasBlank[i] = headerIsInvalid(raw);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return base;
    renamed++;
    return `${base}_${count + 1}`;
  });

  const footerMerge = merges
    .filter(
      (merge) =>
        merge.s.r === merge.e.r &&
        merge.s.r >= headerRowEnd + 5 &&
        merge.e.c - merge.s.c + 1 >= Math.max(2, Math.ceil(width * 0.7)) &&
        originalFilledCount.get(merge.s.r) === 1,
    )
    .find((merge) => {
      const value = aoa[merge.s.r]?.[merge.s.c];
      return (
        typeof value === "string" &&
        value.trim().length > MERGE_FILL_MAX_LENGTH &&
        /^(?:observa[cç][õo]es?|informa[cç][õo]es adicionais|legenda|n[ií]vel de revis[aã]o)\b/i.test(
          value.trim(),
        )
      );
    });
  const footerRowIndex = footerMerge?.s.r ?? aoa.length;
  const footerRowsIgnored = Math.max(0, aoa.length - footerRowIndex);
  // Relatórios paginados/exportados costumam repetir a linha de cabeçalho
  // no meio dos dados (ex: a cada quebra de página), sem linha em branco
  // nem título separando o "bloco" — por isso `detectBlocks` não pega esse
  // caso. Sem este filtro, a repetição virava um registro de dado com o
  // próprio texto do cabeçalho nas colunas (ex: {"Nome":"Nome"}).
  // Exigimos pelo menos 2 colunas com cabeçalho não vazio batendo
  // exatamente para não descartar por engano uma linha de dado que só por
  // coincidência repete o texto de uma única coluna.
  let repeatedHeaderRowsSkipped = 0;
  const isRepeatedHeaderRow = (row: NormalizedSheetRow) => {
    const meaningfulColumns = headerRow.filter((h) => !headerIsInvalid(h));
    if (meaningfulColumns.length < 2) return false;
    return headerRow.every((h, i) => {
      if (headerIsInvalid(h)) return true;
      const value = row[i];
      return typeof value === "string" && value.trim() === String(h).trim();
    });
  };
  // Índice (relativo à `aoa`) da linha da planilha que originou cada linha
  // importada. Acompanha todos os descartes abaixo (ocultas, cabeçalho
  // repetido, em branco, notas de rodapé) para que consumidores externos
  // possam voltar da linha final à célula original sem repetir essa lógica
  // nem assumir que os dados seguem o cabeçalho sequencialmente — suposição
  // que quebra em qualquer aba com linha oculta ou em branco no meio.
  const sourceRowOffsets = aoa
    .slice(headerRowEnd + 1, footerRowIndex)
    .map((row, offset) => ({ row, offset: headerRowEnd + 1 + offset }))
    .filter(({ offset }) => !hiddenRows.has(offset))
    .filter(({ row }) => {
      if (!isRepeatedHeaderRow(row)) return true;
      repeatedHeaderRowsSkipped++;
      return false;
    });
  const sourceDataRows = sourceRowOffsets.map(({ row }) => row);
  let rowOrigins = sourceRowOffsets.map(({ offset }) => offset);
  const headers = refineGenericDocumentHeaders(initialHeaders, sourceDataRows);
  let placeholderCellsNormalized = 0;

  const dataRows: Row[] = headers.length
    ? sourceDataRows.map((row) => {
        const obj: Row = {};
        headers.forEach((h, i) => {
          const v = row[i];
          if (typeof v === "string" && EMPTY_PLACEHOLDER_PATTERN.test(v.trim())) {
            obj[h] = null;
            placeholderCellsNormalized++;
          } else obj[h] = v === undefined ? null : v;
        });
        return obj;
      })
    : [];

  // Linhas inteiramente em branco (comum em planilhas com um monte de
  // linhas "sobrando" formatadas mas nunca usadas) são removidas ANTES do
  // corte de notas do fim, senão elas ocupam sozinhas o orçamento do corte
  // e a nota de verdade (que está antes delas no arquivo) nunca é
  // alcançada.
  const keptAfterBlank = dataRows
    .map((row, index) => ({ row, origin: rowOrigins[index] ?? -1 }))
    .filter(({ row }) => Object.values(row).some((v) => v !== null && v !== ""));
  const nonBlankRows = keptAfterBlank.map(({ row }) => row);
  rowOrigins = keptAfterBlank.map(({ origin }) => origin);
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
  const activeTrailingHeaders = headers.filter((header, index) => {
    if (!headerWasBlank[index]) return true;
    return nonBlankRows.some((row) => row[header] !== null && row[header] !== "");
  });
  const identityHeaders = headers
    .slice(0, 8)
    .filter((header) =>
      /(?:^| — )(?:data|n[uú]mero(?: do| de)? recebimento|lote(?:\/op)?|nota fiscal(?: fedex)?)$/i.test(
        header,
      ),
    );
  let preparedTemplateRowsTrimmed = 0;
  while (rows.length > 0 && identityHeaders.length > 0) {
    const last = rows[rows.length - 1 - preparedTemplateRowsTrimmed];
    if (!last) break;
    if (identityHeaders.some((header) => last[header] !== null && last[header] !== "")) break;
    const filled = Object.values(last).filter((value) => value !== null && value !== "").length;
    // Formulários costumam pré-preencher fornecedor, status e responsáveis
    // em dezenas de linhas futuras. Sem data, número, lote ou nota fiscal,
    // esse sufixo ainda não representa recebimentos reais; importá-lo cria
    // uma massa artificial de "Não informado". O limite de densidade evita
    // confundir com um registro legítimo que apenas perdeu um identificador.
    if (filled / Math.max(1, activeTrailingHeaders.length) > 0.5) break;
    preparedTemplateRowsTrimmed++;
  }
  if (preparedTemplateRowsTrimmed > 0) {
    rows.length -= preparedTemplateRowsTrimmed;
    rowOrigins.length -= preparedTemplateRowsTrimmed;
  }

  let trailingNotesTrimmed = 0;
  while (
    rows.length > 1 &&
    trailingNotesTrimmed < MAX_TRAILING_TRIM &&
    trailingNotesTrimmed < rows.length - 1
  ) {
    const last = rows[rows.length - 1 - trailingNotesTrimmed];
    if (!last) break;
    const filled = Object.values(last).filter((v) => v !== null && v !== "").length;
    // Formulários operacionais costumam deixar datas futuras já preparadas
    // para preenchimento. Uma linha só com data é um registro/agendamento
    // válido, não uma nota de rodapé, então o corte deve parar aqui.
    const firstHeader = headers[0];
    if (firstHeader && cellLooksDate(last[firstHeader])) break;
    const onlyValue = Object.values(last).find((value) => value !== null && value !== "");
    if (
      filled === 1 &&
      activeTrailingHeaders.length >= 2 &&
      typeof onlyValue === "string" &&
      /^(?:observa[cç][aã]o|nota|total\b|resumo\b|fonte\b|legenda\b)/i.test(onlyValue.trim())
    ) {
      trailingNotesTrimmed++;
      continue;
    }
    if (filled / Math.max(1, activeTrailingHeaders.length) >= TRAILING_NOTE_FILL_RATIO) break;
    trailingNotesTrimmed++;
  }
  if (trailingNotesTrimmed > 0) {
    rows.length -= trailingNotesTrimmed;
    rowOrigins.length -= trailingNotesTrimmed;
  }

  // Cabeçalho, borda e formatação não tornam uma coluna um dado. Se não há
  // nenhum valor real em nenhuma linha importada, removemos a coluna por
  // completo para que ela não vire uma faixa inteira de "Não informado".
  // Zero e `false` continuam sendo valores válidos e são preservados. Numa
  // planilha larga de cronograma (muitas colunas de período mês/ano), uma
  // coluna de período vazia representa uma etapa futura ainda não realizada,
  // não lixo de formatação — preservamos essas. Duas colunas de período
  // isoladas não bastam como evidência de cronograma real, então o limiar
  // exige pelo menos MIN_SCHEDULE_PERIOD_COLUMNS no cabeçalho inteiro.
  const periodHeaderCount = headers.filter((header) => isPeriodColumnLabel(header)).length;
  const looksLikeWideSchedule =
    periodHeaderCount >= MIN_SCHEDULE_PERIOD_COLUMNS && rows.length >= 5;
  const headersToPreserveWhenEmpty = new Set(
    headers.filter((header, index) => {
      if (looksLikeWideSchedule && isPeriodColumnLabel(header)) return true;
      for (let relativeRow = headerRowEnd + 1; relativeRow < sourceAoa.length; relativeRow++) {
        const address = XLSX.utils.encode_cell({
          r: range.s.r + relativeRow,
          c: range.s.c + index,
        });
        if (typeof ws[address]?.f === "string") return true;
      }
      return false;
    }),
  );
  const {
    rows: rowsWithoutEmptyColumns,
    headers: headersWithValues,
    emptyColumns,
  } = removeColumnsWithoutValues(rows, headers, headersToPreserveWhenEmpty);

  // Colunas sem nenhum texto no cabeçalho E quase sem dados: quase sempre
  // são um fragmento solto capturado só por estar dentro do retângulo de
  // células usadas da planilha (ex: uma anotação de rodapé que sobrou fora
  // do corte de notas acima, ou uma célula formatada mas nunca preenchida),
  // não uma coluna real da tabela. Descartamos em vez de expor como
  // "Coluna N" com dado sem sentido. Uma coluna sem nome mas com dados de
  // verdade continua sendo importada normalmente, com um nome genérico.
  const ghostColumns = headersWithValues.filter((h) => {
    const originalIndex = headers.indexOf(h);
    if (!headerWasBlank[originalIndex]) return false;
    const filled = rowsWithoutEmptyColumns.filter((r) => r[h] !== null && r[h] !== "").length;
    // Colunas 100% vazias já foram removidas acima. Para colunas sem nome e
    // quase vazias, mantemos a exigência de ao menos 5 linhas antes de
    // decidir, evitando apagar dado esparso real.
    return (
      rowsWithoutEmptyColumns.length >= 5 &&
      filled / rowsWithoutEmptyColumns.length < NEAR_EMPTY_RATIO
    );
  });
  const headersWithoutGhosts = ghostColumns.length
    ? headersWithValues.filter((h) => !ghostColumns.includes(h))
    : headersWithValues;
  const rowsWithoutGhosts: Row[] = ghostColumns.length
    ? rowsWithoutEmptyColumns.map((r) => {
        const clean: Row = {};
        for (const h of headersWithoutGhosts) clean[h] = r[h] ?? null;
        return clean;
      })
    : rowsWithoutEmptyColumns;

  // Mesclagens horizontais podem produzir duas colunas com o mesmo rótulo
  // e exatamente os mesmos valores em todas as linhas. A segunda não traz
  // informação e só multiplica células vazias/"Não informado" na tabela.
  const redundantToCanonical = new Map<string, string>();
  const redundantColumns = headersWithoutGhosts.filter((header, index) => {
    const base = header.replace(/_\d+$/, "");
    // Nomes genéricos "Coluna N" (cabeçalho vazio, numerado automaticamente)
    // não contam como redundantes por padrão: duas colunas sem nome com o
    // mesmo valor por coincidência não implicam a mesma origem. Mas quando
    // são vizinhas diretas no cabeçalho, a coincidência deixa de ser
    // plausível — o padrão real é uma célula mesclada horizontalmente (ex:
    // uma nota de rodapé) que transborda pra coluna imediatamente seguinte,
    // ambas sem cabeçalho por não pertencerem à tabela de verdade. Só nesse
    // caso adjacente a redundância genérica é aceita.
    const isGenericPair = /^coluna$/i.test(base);
    const earlier = headersWithoutGhosts.slice(0, index).find((candidate, candidateIndex) => {
      if (candidate.replace(/_\d+$/, "") !== base) return false;
      if (isGenericPair && index - candidateIndex !== 1) return false;
      return rowsWithoutGhosts.every((row) => {
        const current = row[header];
        const previous = row[candidate];
        return (
          current === null ||
          current === "" ||
          previous === null ||
          previous === "" ||
          previous === current
        );
      });
    });
    if (earlier) redundantToCanonical.set(header, earlier);
    return Boolean(earlier);
  });
  const finalHeaders = headersWithoutGhosts.filter((header) => !redundantColumns.includes(header));
  const finalRows: Row[] = redundantColumns.length
    ? rowsWithoutGhosts.map((row) =>
        Object.fromEntries(
          finalHeaders.map((header) => {
            const resolvesTo = (candidate: string) => {
              let current = candidate;
              const seen = new Set<string>();
              while (redundantToCanonical.has(current) && !seen.has(current)) {
                seen.add(current);
                current = redundantToCanonical.get(current)!;
              }
              return current;
            };
            const equivalents = headersWithoutGhosts.filter(
              (candidate) => resolvesTo(candidate) === header,
            );
            const value = equivalents
              .map((candidate) => row[candidate])
              .find(
                (candidate) => candidate !== null && candidate !== "" && candidate !== undefined,
              );
            return [header, value ?? null];
          }),
        ),
      )
    : rowsWithoutGhosts;

  const { rows: normalizedRows, changes: numericTextCellsNormalized } =
    normalizeMixedNumericColumns(finalRows);

  const nearEmptyColumns =
    normalizedRows.length >= 5
      ? finalHeaders.filter((h) => {
          const filled = normalizedRows.filter((r) => r[h] !== null && r[h] !== "").length;
          return filled / normalizedRows.length < NEAR_EMPTY_RATIO;
        })
      : [];

  const messages: string[] = [];
  if (hiddenRowsMessage) messages.push(hiddenRowsMessage);
  if (headerRowIndex > 0) {
    messages.push(
      `O cabeçalho foi identificado na linha ${headerRowIndex + 1} da planilha, porque o conteúdo acima não parecia um cabeçalho válido. Confira se a identificação ficou correta.`,
    );
  }
  if (hierarchicalHeader) {
    messages.push(
      `Foi identificado um cabeçalho hierárquico nas linhas ${headerRowIndex + 1} a ${headerRowEnd + 1}. Os nomes dos grupos e das subcolunas foram combinados para preservar o significado de cada medição.`,
    );
  }
  if (footerRowsIgnored > 0) {
    messages.push(
      `${footerRowsIgnored} linha${footerRowsIgnored > 1 ? "s" : ""} de rodapé institucional após a tabela ${footerRowsIgnored > 1 ? "foram ignoradas" : "foi ignorada"}, preservando apenas os registros do cronograma.`,
    );
  }
  if (mergedHeaderCells > 0) {
    messages.push(
      `${mergedHeaderCells} coluna${mergedHeaderCells > 1 ? "s" : ""} do cabeçalho vinha${mergedHeaderCells > 1 ? "m" : ""} de célula${mergedHeaderCells > 1 ? "s" : ""} mesclada${mergedHeaderCells > 1 ? "s" : ""} na planilha original. Usamos o nome do grupo pra elas, mas talvez você queira renomeá-las individualmente no painel de colunas.`,
    );
  }
  if (volatileCellsRecalculated > 0) {
    messages.push(
      `${volatileCellsRecalculated} célula${volatileCellsRecalculated > 1 ? "s" : ""} ${volatileCellsRecalculated > 1 ? "dependiam" : "dependia"} da data de hoje (fórmulas com TODAY/NOW, como "dias restantes") e ${volatileCellsRecalculated > 1 ? "foram recalculadas" : "foi recalculada"} para a data atual. O arquivo guardava o resultado do dia em que foi salvo.`,
    );
  }
  if (mergedCells > 0) {
    messages.push(
      `${mergedCells} célula${mergedCells > 1 ? "s" : ""} de dado${mergedCells > 1 ? "s" : ""} vinha${mergedCells > 1 ? "m" : ""} de célula${mergedCells > 1 ? "s" : ""} mesclada${mergedCells > 1 ? "s" : ""} verticalmente na planilha original (ex: um item cobrindo várias linhas de fornecedores). Repetimos o valor da célula de origem em cada linha, em vez de deixar "Não informado" nas linhas vazias.`,
    );
  }
  if (trailingNotesTrimmed > 0) {
    messages.push(
      `${trailingNotesTrimmed} linha${trailingNotesTrimmed > 1 ? "s" : ""} no fim da planilha ${trailingNotesTrimmed > 1 ? "pareciam" : "parecia"} nota${trailingNotesTrimmed > 1 ? "s" : ""}/resumo solto${trailingNotesTrimmed > 1 ? "s" : ""} em vez de dado da tabela. O conteúdo de observação foi preservado separadamente, sem poluir os registros do cronograma.`,
    );
  }
  if (preparedTemplateRowsTrimmed > 0) {
    messages.push(
      `${preparedTemplateRowsTrimmed} linha${preparedTemplateRowsTrimmed > 1 ? "s" : ""} futura${preparedTemplateRowsTrimmed > 1 ? "s" : ""} no fim do formulário tinha${preparedTemplateRowsTrimmed > 1 ? "m" : ""} apenas valores pré-preenchidos, sem data, número, lote ou nota fiscal; ${preparedTemplateRowsTrimmed > 1 ? "foram ignoradas" : "foi ignorada"} para não gerar "Não informado" artificial.`,
    );
  }
  if (renamed > 0) {
    messages.push(
      `${renamed} coluna${renamed > 1 ? "s" : ""} com nome repetido no cabeçalho ${renamed > 1 ? "foram" : "foi"} renomeada${renamed > 1 ? "s" : ""} para não perder dados.`,
    );
  }
  if (emptyColumns.length > 0) {
    const names = emptyColumns.map((header) => `"${prettyLabel(header)}"`).join(", ");
    messages.push(
      `${emptyColumns.length > 1 ? "As colunas" : "A coluna"} ${names} não tinha${emptyColumns.length > 1 ? "m" : ""} nenhum valor escrito nos registros e ${emptyColumns.length > 1 ? "foram removidas" : "foi removida"}, em vez de gerar "Não informado".`,
    );
  }
  if (ghostColumns.length > 0) {
    messages.push(
      `${ghostColumns.length > 1 ? "Foram encontradas colunas" : "Foi encontrada uma coluna"} sem nenhum texto no cabeçalho e quase sem dados (provavelmente um fragmento fora da tabela) e ${ghostColumns.length > 1 ? "elas foram removidas" : "ela foi removida"} automaticamente da importação.`,
    );
  }
  if (redundantColumns.length > 0) {
    messages.push(
      `${redundantColumns.length} coluna${redundantColumns.length > 1 ? "s duplicadas foram removidas" : " duplicada foi removida"}, pois repetia${redundantColumns.length > 1 ? "m" : ""} exatamente os mesmos valores de outra coluna criada por mesclagem horizontal.`,
    );
  }
  if (placeholderCellsNormalized > 0) {
    messages.push(
      `${placeholderCellsNormalized} marcador${placeholderCellsNormalized > 1 ? "es vazios" : " vazio"} (como "-" ou "NaN") ${placeholderCellsNormalized > 1 ? "foram tratados" : "foi tratado"} como ausência estrutural, sem aparecer como dado válido.`,
    );
  }
  if (nearEmptyColumns.length > 0) {
    const names = nearEmptyColumns.map((h) => `"${prettyLabel(h)}"`).join(", ");
    messages.push(
      `${nearEmptyColumns.length > 1 ? "As colunas" : "A coluna"} ${names} ${nearEmptyColumns.length > 1 ? "estão" : "está"} quase ${nearEmptyColumns.length > 1 ? "vazias" : "vazia"}. Confira se ${nearEmptyColumns.length > 1 ? "elas foram importadas" : "ela foi importada"} corretamente antes de usá-la${nearEmptyColumns.length > 1 ? "s" : ""} em um gráfico.`,
    );
  }
  if (numericTextCellsNormalized > 0) {
    messages.push(
      `${numericTextCellsNormalized} mediç${numericTextCellsNormalized > 1 ? "ões numéricas estavam" : "ão numérica estava"} salva${numericTextCellsNormalized > 1 ? "s" : ""} como texto no Excel e ${numericTextCellsNormalized > 1 ? "foram convertidas" : "foi convertida"} para número, mantendo a coluna consistente para cálculos e gráficos.`,
    );
  }
  if (blankSkipped > 0) {
    messages.push(
      `${blankSkipped} linha${blankSkipped > 1 ? "s" : ""} em branco no meio dos dados ${blankSkipped > 1 ? "foram" : "foi"} ignorada${blankSkipped > 1 ? "s" : ""}.`,
    );
  }
  if (totalsRowsIgnored > 0) {
    messages.push(
      `${totalsRowsIgnored} linha${totalsRowsIgnored > 1 ? "s de totais declaradas" : " de totais declarada"} pelas tabelas do Excel ${totalsRowsIgnored > 1 ? "ficaram" : "ficou"} fora dos registros. ${totalsRowsIgnored > 1 ? "Elas somam" : "Ela soma"} as linhas do próprio bloco, então ${totalsRowsIgnored > 1 ? "entrariam" : "entraria"} em dobro em qualquer total do painel.`,
    );
  }

  if (repeatedHeaderRowsSkipped > 0) {
    messages.push(
      `${repeatedHeaderRowsSkipped} linha${repeatedHeaderRowsSkipped > 1 ? "s repetiam" : " repetia"} o cabeçalho no meio dos dados (comum em relatórios paginados) e ${repeatedHeaderRowsSkipped > 1 ? "foram ignoradas" : "foi ignorada"}, em vez de virar${repeatedHeaderRowsSkipped > 1 ? "em" : ""} um registro com o próprio texto do cabeçalho.`,
    );
  }

  const diagnostics = diagnoseImportedSheet(ws, normalizedRows);
  return {
    rows: normalizedRows,
    warning: messages.length ? messages.join(" ") : null,
    diagnostics,
    sourceGrid,
    rowOrigins,
    audit: {
      sourceNonEmptyCells,
      outputNonEmptyCells: normalizedRows.reduce(
        (sum, row) =>
          sum + Object.values(row).filter((value) => value !== null && value !== "").length,
        0,
      ),
      formulaCellsRecovered,
      mergedCellsExpanded: mergedHeaderCells + mergedCells,
      numericCellsConverted: numericTextCellsNormalized,
      rowsAboveHeaderIgnored: headerRowIndex,
      hiddenRowsIgnored,
      blankRowsIgnored: blankSkipped,
      trailingRowsIgnored: preparedTemplateRowsTrimmed + trailingNotesTrimmed + footerRowsIgnored,
      columnsIgnored: emptyColumns.length + ghostColumns.length + redundantColumns.length,
      notesPreserved: diagnostics.sourceNotes.length,
      repeatedHeaderRowsIgnored: repeatedHeaderRowsSkipped,
      totalsRowsIgnored,
    },
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
  sourceGrid?: SourceGrid;
  audit?: ImportAudit;
  /** Ver `SheetImportResult.rowOrigins`. */
  rowOrigins?: number[];
  /** Representação canônica para cronogramas, sem alterar a tabela visível. */
  longScheduleRows?: LongScheduleRow[];
};

/** Grade de texto de uma aba, com as linhas ocultas apagadas. */
export type SheetTextGrid = (string | number | boolean | null)[][];

/**
 * Fonte de grade para uma aba, quando ela não vem de uma worksheet completa.
 *
 * `aoa` são os valores crus, no formato que `sheetToRows` consome. `textAoa` é o
 * texto formatado, que a detecção de regiões usa. Numa grade lida de CSV as duas
 * coincidem, porque tudo já é texto; num futuro leitor OOXML progressivo elas
 * podem diferir, e por isso são campos separados em vez de um só.
 */
export type SheetGridSource = {
  aoa: SheetSourceGrid;
  textAoa?: SheetTextGrid;
};

/**
 * De onde a normalização tira a grade de cada aba.
 *
 * A função recebe o nome da aba e devolve a grade, ou `undefined` para dizer
 * "esta aba vem da worksheet, como sempre". É uma função e não um mapa porque
 * quem lê por streaming produz a grade aba a aba e não quer montar todas antes
 * de começar.
 */
export type SheetGridLookup = (sheetName: string) => SheetGridSource | undefined;

export type SheetOptionsSource = { gridFor?: SheetGridLookup };

export type RegionScanOptions = {
  /**
   * Grade de texto já pronta, para não reconstruí-la a partir da worksheet.
   *
   * Mesma ideia da opção de `sheetToRows`, e pelo mesmo motivo: quem lê por
   * streaming já tem a grade, e refazê-la aqui custaria a planilha inteira
   * formatada como texto, duas vezes, uma por função.
   *
   * A grade informada já deve estar na forma que estas funções esperam, ou
   * seja, com o texto formatado de cada célula. Linhas ocultas continuam sendo
   * apagadas a partir da worksheet, porque essa informação não existe na grade;
   * numa fonte sem worksheet não há linha oculta, e a máscara é inofensiva.
   */
  textAoa?: SheetTextGrid;
};

/**
 * Grade de texto usada pela detecção de regiões e de seções independentes.
 *
 * As duas liam a planilha do mesmo jeito, com o mesmo mascaramento de linhas
 * ocultas, em código duplicado. Passaram a compartilhar esta função para que
 * uma não possa mudar de critério sem a outra.
 */
export function visibleTextGrid(
  ws: XLSX.WorkSheet,
  used: XLSX.Range,
  options?: RegionScanOptions,
): SheetTextGrid {
  const rawAoa =
    options?.textAoa ??
    XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(ws, {
      header: 1,
      defval: null,
      raw: false,
    });
  return rawAoa.map((row, index) => (ws["!rows"]?.[used.s.r + index]?.hidden === true ? [] : row));
}

function independentRegionWorksheet(
  ws: XLSX.WorkSheet,
  region: { startRow: number; endRow: number; startColumn: number; endColumn: number },
): XLSX.WorkSheet | null {
  if (!ws["!ref"]) return null;
  const used = XLSX.utils.decode_range(ws["!ref"]);
  const range = {
    s: {
      r: used.s.r + region.startRow - 1,
      c: used.s.c + region.startColumn - 1,
    },
    e: {
      r: used.s.r + region.endRow - 1,
      c: used.s.c + region.endColumn - 1,
    },
  };
  const sliced: XLSX.WorkSheet = { "!ref": XLSX.utils.encode_range(range) };
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let column = range.s.c; column <= range.e.c; column++) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = worksheetCellAtAddress(ws, address);
      if (cell) sliced[address] = { ...cell };
    }
  }
  const merges = (ws["!merges"] ?? []).filter(
    (merge) =>
      merge.s.r >= range.s.r &&
      merge.s.c >= range.s.c &&
      merge.e.r <= range.e.r &&
      merge.e.c <= range.e.c,
  );
  if (merges.length) sliced["!merges"] = merges;
  if (ws["!rows"]) sliced["!rows"] = ws["!rows"].map((row) => (row ? { ...row } : row));
  const advanced = (ws as WorksheetWithAdvancedMetadata)["!oliAdvanced"];
  if (advanced) {
    const remapRange: AdvancedMetadataRangeRemapper = (source, mode) => {
      let decoded: XLSX.Range;
      try {
        decoded = XLSX.utils.decode_range(source.replaceAll("$", ""));
      } catch {
        return null;
      }
      const clipped = {
        s: {
          r: Math.max(decoded.s.r, range.s.r),
          c: Math.max(decoded.s.c, range.s.c),
        },
        e: {
          r: Math.min(decoded.e.r, range.e.r),
          c: Math.min(decoded.e.c, range.e.c),
        },
      };
      if (clipped.s.r > clipped.e.r || clipped.s.c > clipped.e.c) return null;
      if (
        mode === "contained" &&
        (clipped.s.r !== decoded.s.r ||
          clipped.s.c !== decoded.s.c ||
          clipped.e.r !== decoded.e.r ||
          clipped.e.c !== decoded.e.c)
      )
        return null;
      return XLSX.utils.encode_range({
        s: { r: clipped.s.r - range.s.r, c: clipped.s.c - range.s.c },
        e: { r: clipped.e.r - range.s.r, c: clipped.e.c - range.s.c },
      });
    };
    (sliced as WorksheetWithAdvancedMetadata)["!oliAdvanced"] = sliceAdvancedMetadata(
      advanced,
      (address) => {
        const cell = XLSX.utils.decode_cell(address);
        if (cell.r < range.s.r || cell.r > range.e.r || cell.c < range.s.c || cell.c > range.e.c)
          return null;
        return XLSX.utils.encode_cell({ r: cell.r - range.s.r, c: cell.c - range.s.c });
      },
      remapRange,
    );
  }
  return sliced;
}

type IndependentSection = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  label: string;
  contextRows: number[];
};

/**
 * Recorte de uma região retangular sobre a grade.
 *
 * Equivale a `independentRegionWorksheet` para uma fonte que não tem worksheet.
 * Aquela função também recorta mesclagens, linhas ocultas e o pacote
 * `!oliAdvanced` (hyperlinks, comentários, imagens, formas, gráficos, cor de
 * preenchimento), com remapeamento de intervalos. Numa grade de valores nada
 * disso existe, então o recorte é só de linhas e colunas.
 *
 * As coordenadas são relativas e começam em 1, iguais às da função de
 * worksheet, para que os dois caminhos possam ser confrontados diretamente.
 */
/**
 * Worksheet com o mínimo que a normalização exige de uma fonte de grade.
 *
 * Só `!ref`. Verificado por teste: com a grade passada à parte, isso produz as
 * mesmas linhas, o mesmo aviso e o mesmo diagnóstico que a worksheet completa,
 * porque todas as outras leituras são de metadado opcional que uma grade de
 * valores não tem.
 */
export function minimalWorksheetForGrid(grid: SheetSourceGrid): XLSX.WorkSheet {
  const rows = Math.max(1, grid.length);
  const columns = Math.max(1, ...grid.map((row) => row.length));
  return {
    "!ref": XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows - 1, c: columns - 1 } }),
  } as XLSX.WorkSheet;
}

export function sliceGridRegion(
  grid: SheetSourceGrid,
  region: { startRow: number; endRow: number; startColumn: number; endColumn: number },
): SheetSourceGrid {
  const linhas = grid.slice(region.startRow - 1, region.endRow);
  return linhas.map((linha) => linha.slice(region.startColumn - 1, region.endColumn));
}

/**
 * Recorte de uma seção independente sobre a grade.
 *
 * Equivale a `independentSectionWorksheet`. A seleção de linhas é a mesma:
 * primeiro as linhas de contexto, depois o intervalo da seção, sem repetir
 * nenhuma. A ordem importa, porque é ela que define a linha de cabeçalho da
 * planilha recortada.
 */
export function sliceGridSection(
  grid: SheetSourceGrid,
  section: IndependentSection,
): SheetSourceGrid {
  const relativeRows = [
    ...section.contextRows,
    ...Array.from(
      { length: section.endRow - section.startRow + 1 },
      (_, index) => section.startRow + index,
    ),
  ].filter((row, index, all) => all.indexOf(row) === index);

  return relativeRows.map((linha) =>
    (grid[linha - 1] ?? []).slice(section.startColumn - 1, section.endColumn),
  );
}

const SECTION_HEADER_HINT =
  /^(?:m[eê]s|data|nome|c[oó]digo|item|descri[cç][aã]o|cliente|produto|material|objeto|ponto|m[aá]quina|gramatura|quantidade|amostra|an[aá]lise|refer[eê]ncia|limite|tipo|ferramenta|t[eé]cnica|frequ[eê]ncia|status|valor|pre[cç]o|unidade|resultado)/i;
const SECTION_TITLE_HINT =
  /(?:cronograma|anexo|crit[eé]rio|plano|monitoramento|an[aá]lise (?:de|por)|ambiente|processo|superf[ií]cie|manipulador|[aá]gua|bebidas?|produtos? aliment[ií]cios?)/i;
const INSTITUTIONAL_FOOTER =
  /^(?:observa[cç][oõ]es|informa[cç][oõ]es adicionais|legenda|n[ií]vel de revis[aã]o)\b/i;

function cellHasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function independentSectionWorksheet(
  ws: XLSX.WorkSheet,
  section: IndependentSection,
): XLSX.WorkSheet | null {
  if (!ws["!ref"]) return null;
  const used = XLSX.utils.decode_range(ws["!ref"]);
  const relativeRows = [
    ...section.contextRows,
    ...Array.from(
      { length: section.endRow - section.startRow + 1 },
      (_, index) => section.startRow + index,
    ),
  ].filter((row, index, all) => all.indexOf(row) === index);
  if (!relativeRows.length) return null;

  const sourceToDestination = new Map<number, number>();
  relativeRows.forEach((relativeRow, destinationRow) => {
    sourceToDestination.set(used.s.r + relativeRow - 1, destinationRow);
  });
  const width = section.endColumn - section.startColumn + 1;
  const sliced: XLSX.WorkSheet = {
    "!ref": XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: relativeRows.length - 1, c: width - 1 },
    }),
  };
  for (const [sourceRow, destinationRow] of sourceToDestination) {
    for (
      let relativeColumn = section.startColumn;
      relativeColumn <= section.endColumn;
      relativeColumn++
    ) {
      const sourceColumn = used.s.c + relativeColumn - 1;
      const sourceAddress = XLSX.utils.encode_cell({ r: sourceRow, c: sourceColumn });
      const cell = worksheetCellAtAddress(ws, sourceAddress);
      if (!cell) continue;
      const destinationAddress = XLSX.utils.encode_cell({
        r: destinationRow,
        c: relativeColumn - section.startColumn,
      });
      sliced[destinationAddress] = { ...cell };
    }
  }
  const translatedRows: XLSX.RowInfo[] = [];
  relativeRows.forEach((relativeRow, destinationRow) => {
    const source = ws["!rows"]?.[used.s.r + relativeRow - 1];
    if (source) translatedRows[destinationRow] = { ...source };
  });
  if (translatedRows.length) sliced["!rows"] = translatedRows;

  const translatedMerges = (ws["!merges"] ?? []).flatMap((merge) => {
    const sourceStartColumn = used.s.c + section.startColumn - 1;
    const sourceEndColumn = used.s.c + section.endColumn - 1;
    if (merge.e.c < sourceStartColumn || merge.s.c > sourceEndColumn) return [];
    const destinationStart = sourceToDestination.get(merge.s.r);
    const destinationEnd = sourceToDestination.get(merge.e.r);
    if (destinationStart === undefined || destinationEnd === undefined) return [];
    if (destinationEnd - destinationStart !== merge.e.r - merge.s.r) return [];
    return [
      {
        s: {
          r: destinationStart,
          c: Math.max(merge.s.c, sourceStartColumn) - sourceStartColumn,
        },
        e: {
          r: destinationEnd,
          c: Math.min(merge.e.c, sourceEndColumn) - sourceStartColumn,
        },
      },
    ];
  });
  if (translatedMerges.length) sliced["!merges"] = translatedMerges;
  const advanced = (ws as WorksheetWithAdvancedMetadata)["!oliAdvanced"];
  if (advanced) {
    const sourceStartColumn = used.s.c + section.startColumn - 1;
    const sourceEndColumn = used.s.c + section.endColumn - 1;
    const remapRange: AdvancedMetadataRangeRemapper = (source, mode) => {
      let decoded: XLSX.Range;
      try {
        decoded = XLSX.utils.decode_range(source.replaceAll("$", ""));
      } catch {
        return null;
      }
      const startColumn = Math.max(decoded.s.c, sourceStartColumn);
      const endColumn = Math.min(decoded.e.c, sourceEndColumn);
      if (startColumn > endColumn) return null;
      if (mode === "contained" && (startColumn !== decoded.s.c || endColumn !== decoded.e.c))
        return null;

      const mappedRows: number[] = [];
      for (let row = decoded.s.r; row <= decoded.e.r; row++) {
        const destination = sourceToDestination.get(row);
        if (destination !== undefined) mappedRows.push(destination);
      }
      if (!mappedRows.length) return null;
      if (mode === "contained" && mappedRows.length !== decoded.e.r - decoded.s.r + 1) return null;

      mappedRows.sort((left, right) => left - right);
      const runs: Array<{ start: number; end: number }> = [];
      for (const row of mappedRows) {
        const current = runs.at(-1);
        if (current && row === current.end + 1) current.end = row;
        else runs.push({ start: row, end: row });
      }
      if (mode === "contained" && runs.length !== 1) return null;
      return runs
        .map((run) =>
          XLSX.utils.encode_range({
            s: { r: run.start, c: startColumn - sourceStartColumn },
            e: { r: run.end, c: endColumn - sourceStartColumn },
          }),
        )
        .join(" ");
    };
    (sliced as WorksheetWithAdvancedMetadata)["!oliAdvanced"] = sliceAdvancedMetadata(
      advanced,
      (address) => {
        const cell = XLSX.utils.decode_cell(address);
        const destinationRow = sourceToDestination.get(cell.r);
        if (destinationRow === undefined || cell.c < sourceStartColumn || cell.c > sourceEndColumn)
          return null;
        return XLSX.utils.encode_cell({ r: destinationRow, c: cell.c - sourceStartColumn });
      },
      remapRange,
    );
  }
  return sliced;
}

/**
 * Algumas planilhas de qualidade usam uma aba como uma página de documento:
 * vários quadros com títulos próprios são empilhados sem uma linha vazia entre
 * eles. A análise de regiões geométricas não consegue separá-los porque os
 * quadros se tocam. Aqui detectamos somente reinícios fortes de cabeçalho:
 * linha textual com vocabulário de coluna, dados logo abaixo e um título ou
 * separador imediatamente acima. Isso evita tratar uma linha comum de dados
 * como uma nova tabela.
 */
function detectIndependentSections(
  ws: XLSX.WorkSheet,
  options?: RegionScanOptions,
): IndependentSection[] {
  if (!ws["!ref"]) return [];
  const used = XLSX.utils.decode_range(ws["!ref"]);
  const aoa = visibleTextGrid(ws, used, options);
  if (aoa.length < 4) return [];

  const filled = (row: (string | number | boolean | null)[] | undefined) =>
    (row ?? []).filter(cellHasValue);
  const isBlank = (row: (string | number | boolean | null)[] | undefined) =>
    filled(row).length === 0;
  const hasHorizontalMerge = (relativeRow: number) =>
    (ws["!merges"] ?? []).some(
      (merge) =>
        merge.s.r <= used.s.r + relativeRow &&
        merge.e.r >= used.s.r + relativeRow &&
        merge.e.c > merge.s.c &&
        cellHasValue(worksheetCellAtAddress(ws, XLSX.utils.encode_cell(merge.s))?.v),
    );

  // Não procurar novas tabelas dentro do rodapé de controle do documento.
  let scanEnd = aoa.length;
  for (let row = 5; row < aoa.length; row++) {
    const values = filled(aoa[row]);
    const first = values.length ? String(values[0]).trim() : "";
    if (values.length <= 2 && INSTITUTIONAL_FOOTER.test(first)) {
      scanEnd = row;
      break;
    }
  }

  const candidates: { header: number; titleStart: number; label: string }[] = [];
  for (let row = 0; row < scanEnd - 1; row++) {
    const values = filled(aoa[row]);
    if (values.length < 2) continue;
    const textual = values.filter((value) => !cellLooksNumeric(value) && !cellLooksDate(value));
    if (textual.length / values.length < 0.75) continue;
    if (
      !textual.some((value) => {
        const label = String(value).trim();
        return label.length <= 50 && SECTION_HEADER_HINT.test(label);
      })
    )
      continue;
    if (textual.filter((value) => String(value).trim().length <= 50).length < 2) continue;
    if (new Set(textual.map((value) => String(value).trim().toLocaleLowerCase())).size < 2)
      continue;

    let next = row + 1;
    while (next < scanEnd && isBlank(aoa[next])) next++;
    if (next >= scanEnd || filled(aoa[next]).length < 2) continue;

    let titleStart = row;
    for (let above = row - 1; above >= Math.max(0, row - 3); above--) {
      const titleValues = filled(aoa[above]);
      if (!titleValues.length) break;
      const absoluteAbove = used.s.r + above;
      const continuesVerticalDataMerge = (ws["!merges"] ?? []).some(
        (merge) => merge.s.r < absoluteAbove && merge.e.r >= absoluteAbove,
      );
      if (continuesVerticalDataMerge) break;
      const explicitSingleTitle =
        titleValues.length === 1 && /[:：]\s*$/.test(String(titleValues[0]).trim());
      const semanticSingleTitle =
        titleValues.length === 1 &&
        SECTION_TITLE_HINT.test(String(titleValues[0])) &&
        hasHorizontalMerge(above);
      const titleLike =
        titleValues.every((value) => !cellLooksNumeric(value) && !cellLooksDate(value)) &&
        (explicitSingleTitle ||
          semanticSingleTitle ||
          (titleValues.length >= 2 && titleValues.length <= 4 && hasHorizontalMerge(above)));
      if (!titleLike) break;
      titleStart = above;
    }
    const separated = row === 0 || isBlank(aoa[row - 1]) || titleStart < row;
    if (!separated) continue;

    const titleValues = aoa
      .slice(titleStart, row)
      .flatMap((titleRow) => filled(titleRow).map((value) => String(value).trim()))
      .filter((value, index, all) => value && all.indexOf(value) === index);
    const label = titleValues[0] ?? String(textual[0]).trim();
    candidates.push({ header: row, titleStart, label });
  }

  // Tabelas comuns separadas apenas por linhas vazias continuam sob a
  // estratégia geométrica já existente ("Região N"). Esta estratégia é
  // reservada ao formato de documento, que possui ao menos um título de
  // seção explícito antes de um dos cabeçalhos.
  if (
    candidates.length < 2 ||
    !candidates.some((candidate) => candidate.titleStart < candidate.header)
  )
    return [];
  const firstCandidate = candidates[0];
  if (!firstCandidate) return [];
  const sharedHierarchicalContext = Array.from(
    { length: Math.max(0, firstCandidate.header - firstCandidate.titleStart - 1) },
    (_, index) => firstCandidate.titleStart + index,
  )
    .filter((row) => filled(aoa[row]).length >= 2 && hasHorizontalMerge(row))
    .map((row) => row + 1);
  return candidates.map((candidate, index) => {
    const nextCandidate = candidates[index + 1];
    const endRow = nextCandidate ? nextCandidate.titleStart : scanEnd;
    let firstColumn = Number.POSITIVE_INFINITY;
    let lastColumn = -1;
    for (const row of aoa.slice(candidate.titleStart, endRow)) {
      row.forEach((value, column) => {
        if (!cellHasValue(value)) return;
        firstColumn = Math.min(firstColumn, column);
        lastColumn = Math.max(lastColumn, column);
      });
    }
    let label = candidate.label;
    if (
      Number.isFinite(firstColumn) &&
      lastColumn - firstColumn + 1 < (used.e.c - used.s.c + 1) / 2
    ) {
      const localContext = sharedHierarchicalContext
        .map((contextRow) => aoa[contextRow - 1]?.[firstColumn])
        .filter(cellHasValue)
        .map((value) => String(value).trim())
        .filter((value) => value && !/cronograma/i.test(value));
      if (localContext.length) label = `${label} — ${localContext.at(-1)}`;
    }
    // Incluímos o título local para que cabeçalhos hierárquicos continuem
    // carregando o significado visual que possuíam no Excel. Quadros que
    // ocupam só parte da largura (como Legionella) são recortados para não
    // criar colunas vazias herdadas dos outros trimestres.
    return {
      startRow: candidate.titleStart + 1,
      endRow,
      startColumn: Number.isFinite(firstColumn) ? firstColumn + 1 : 1,
      endColumn: lastColumn >= 0 ? lastColumn + 1 : used.e.c - used.s.c + 1,
      label,
      contextRows: index === 0 ? [] : sharedHierarchicalContext,
    };
  });
}

function regionsAreSafeToSplit(
  ws: XLSX.WorkSheet,
  regions: ImportDiagnostics["tableRegions"],
  options?: RegionScanOptions,
): boolean {
  if (!ws["!ref"] || regions.length < 2 || regions.length > 8) return false;
  if (regions.some((region) => region.rows < 3 || region.columns < 2 || region.confidence < 0.75))
    return false;

  const used = XLSX.utils.decode_range(ws["!ref"]);
  const aoa = visibleTextGrid(ws, used, options);
  const occupied = aoa.reduce(
    (sum, row) => sum + row.filter((value) => value !== null && value !== "").length,
    0,
  );

  // Colunas identificadoras à esquerda e uma matriz de períodos à direita
  // continuam sendo uma única tabela quando o autor deixou apenas uma
  // coluna vazia como respiro visual. Separá-las perderia a relação entre
  // máquina/item e seus valores diários.
  const ordered = [...regions].sort(
    (left, right) => left.startRow - right.startRow || left.startColumn - right.startColumn,
  );
  for (let index = 0; index < ordered.length - 1; index++) {
    const left = ordered[index]!;
    const right = ordered[index + 1]!;
    const gap = right.startColumn - left.endColumn - 1;
    if (
      left.startRow !== right.startRow ||
      left.endRow !== right.endRow ||
      gap < 0 ||
      gap > 1 ||
      left.columns < 2 ||
      left.columns > 5 ||
      right.columns < 4
    )
      continue;
    const rightHeader = (aoa[right.startRow - 1] ?? [])
      .slice(right.startColumn - 1, right.endColumn)
      .filter((value) => value !== null && value !== "");
    const temporalRatio = rightHeader.length
      ? rightHeader.filter(cellLooksDate).length / rightHeader.length
      : 0;
    if (temporalRatio >= 0.6) return false;
  }

  let covered = 0;
  for (const region of regions) {
    const rows = aoa.slice(region.startRow - 1, region.endRow);
    const header = (rows[0] ?? []).slice(region.startColumn - 1, region.endColumn);
    const headerValues = header.filter((value) => value !== null && value !== "");
    if (headerValues.length < 2 || headerValues.some((value) => cellLooksNumeric(value)))
      return false;
    const dataRows = rows
      .slice(1)
      .filter((row) =>
        row
          .slice(region.startColumn - 1, region.endColumn)
          .some((value) => value !== null && value !== ""),
      );
    if (dataRows.length < 2) return false;
    if (
      !dataRows.some((row) =>
        row
          .slice(region.startColumn - 1, region.endColumn)
          .some((value) => cellLooksNumeric(value) || cellLooksDate(value)),
      )
    )
      return false;
    covered += rows.reduce(
      (sum, row) =>
        sum +
        row
          .slice(region.startColumn - 1, region.endColumn)
          .filter((value) => value !== null && value !== "").length,
      0,
    );
  }
  return occupied > 0 && covered / occupied >= 0.85;
}

/**
 * Converte todas as abas de um workbook em opções de importação, pulando
 * automaticamente abas sem nenhuma linha de dado (ex: uma aba "Página1"
 * vazia que sobrou de um template). Usada para montar o seletor de aba
 * quando o arquivo tem mais de uma aba com dado.
 */
/**
 * Leitura unificada de uma aba montada como vários blocos com a mesma
 * estrutura (ver `detectTableBlockGroup`). Vem antes da leitura da aba
 * inteira porque é a única em que o nome do bloco existe como dimensão: sem
 * ela, um orçamento com doze blocos vira uma tabela cuja coluna de itens se
 * chama "MORADIA" e não permite perguntar quanto foi gasto por bloco.
 *
 * A aba inteira continua disponível como segunda opção — a unificação
 * descarta o que não couber na assinatura comum, e essa escolha é do usuário,
 * não nossa.
 */
function unifiedBlocksOption(name: string, wb: XLSX.WorkBook): SheetOption | null {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  const advanced = (ws as WorksheetWithAdvancedMetadata)["!oliAdvanced"];
  const group = detectTableBlockGroup(advanced?.structuredTables ?? []);
  if (!group) return null;
  const grid = buildTableBlocksGrid((address) => worksheetCellAtAddress(ws, address), group);
  if (!grid) return null;

  const unified: XLSX.WorkSheet = {
    "!ref": XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: grid.rows - 1, c: group.sharedColumns.length + 1 },
    }),
  };
  for (const [address, cell] of grid.cells) unified[address] = cell;
  if (advanced) {
    // Sem remapeador de intervalo: um intervalo do arquivo original (uma
    // validação, o autofiltro) não tem equivalente numa grade remontada a
    // partir de blocos espalhados, e inventar um seria pior que perdê-lo.
    (unified as WorksheetWithAdvancedMetadata)["!oliAdvanced"] = sliceAdvancedMetadata(
      advanced,
      (address) => grid.addressMap.get(address) ?? null,
    );
  }

  const imported = sheetToRows(unified, wb);
  if (!imported.rows.length) return null;
  const blocksWarning = `A aba "${name}" é formada por ${group.blocks.length} blocos com a mesma estrutura (${group.blocks
    .map((block) => block.name)
    .slice(0, 3)
    .join(
      ", ",
    )}${group.blocks.length > 3 ? "…" : ""}). Esta opção junta todos em uma tabela só, com a coluna "${group.blockLabel}" dizendo de onde veio cada linha, e sem as linhas de total de cada bloco.`;
  return {
    name: `${name} · Blocos unificados`,
    ...imported,
    warning: imported.warning ? `${blocksWarning} ${imported.warning}` : blocksWarning,
  };
}

/**
 * Opções de importação de uma aba, sem contar a leitura unificada por
 * blocos (ver `unifiedBlocksOption`): a aba inteira, ou as tabelas
 * independentes quando a separação automática se aplica.
 */
/** Linhas do topo que a checagem de relatório de compatibilidade precisa ver. */
const COMPATIBILITY_PREVIEW_ROWS = 12;

/**
 * Intervalo do topo da aba, para não formatar a planilha inteira à toa.
 *
 * A checagem abaixo lê só as primeiras linhas, mas fazia isso a partir de um
 * `sheet_to_json` com `raw: false` sobre a aba toda. Esse modo formata **cada
 * célula** como texto, e o resultado inteiro era descartado fora do topo: num
 * CSV de 200 mil linhas por 8 colunas, medidos 37 MiB alocados e jogados fora
 * em toda importação, de todo formato.
 */
function compatibilityPreviewRange(ws: XLSX.WorkSheet): XLSX.Range | undefined {
  const ref = ws["!ref"];
  if (!ref) return undefined;
  const range = XLSX.utils.decode_range(ref);
  return {
    s: range.s,
    e: { r: Math.min(range.e.r, range.s.r + COMPATIBILITY_PREVIEW_ROWS - 1), c: range.e.c },
  };
}

function sheetOptionsForName(
  name: string,
  wb: XLSX.WorkBook,
  source?: SheetOptionsSource,
): SheetOption[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  // Quando existe grade, ela é a fonte dos valores e do texto. A worksheet
  // continua sendo consultada para o que só ela sabe (mesclagem, fórmula, linha
  // oculta, metadado avançado); numa fonte sem worksheet completa esses campos
  // simplesmente não existem, e ausência é a resposta correta.
  const grid = source?.gridFor?.(name);
  const scan: RegionScanOptions | undefined = grid?.textAoa ? { textAoa: grid.textAoa } : undefined;
  const previewRange = grid ? undefined : compatibilityPreviewRange(ws);
  const preview: (string | number | boolean | Date | null)[][] = grid
    ? (grid.textAoa ?? grid.aoa).slice(0, COMPATIBILITY_PREVIEW_ROWS)
    : previewRange
      ? XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(ws, {
          header: 1,
          defval: null,
          raw: false,
          range: previewRange,
        })
      : [];
  const compatibilityText = preview
    .slice(0, COMPATIBILITY_PREVIEW_ROWS)
    .flat()
    .filter((value) => value !== null && value !== "")
    .map(String)
    .join(" ");
  if (
    /Compatibility Report for/i.test(compatibilityText) &&
    /loss of functionality|loss of fidelity/i.test(compatibilityText)
  )
    return [];
  const result = sheetToRows(ws, wb, grid ? { aoa: grid.aoa } : undefined);
  if (result.tableMode !== "repeated-blocks") {
    const sections = detectIndependentSections(ws, scan);
    if (sections.length > 1) {
      const labelTotals = new Map<string, number>();
      for (const section of sections)
        labelTotals.set(section.label, (labelTotals.get(section.label) ?? 0) + 1);
      const split = sections.flatMap((section, index) => {
        const slicedGrid = grid ? sliceGridSection(grid.aoa, section) : null;
        const sectionSheet = slicedGrid
          ? minimalWorksheetForGrid(slicedGrid)
          : independentSectionWorksheet(ws, section);
        if (!sectionSheet) return [];
        const imported = sheetToRows(
          sectionSheet,
          wb,
          slicedGrid ? { aoa: slicedGrid } : undefined,
        );
        if (!imported.rows.length) return [];
        const separationWarning = `A aba "${name}" continha ${sections.length} tabelas independentes empilhadas e foi separada automaticamente. Esta opção corresponde à tabela ${index + 1}.`;
        return [
          {
            name: `${name} · ${section.label || `Tabela ${index + 1}`}${(labelTotals.get(section.label) ?? 0) > 1 ? ` · Tabela ${index + 1}` : ""}`,
            ...imported,
            ...(scheduleToLong(imported.rows).length
              ? { longScheduleRows: scheduleToLong(imported.rows) }
              : {}),
            warning: imported.warning
              ? `${separationWarning} ${imported.warning}`
              : separationWarning,
          },
        ];
      });
      if (split.length === sections.length) return split;
    }
  }
  if (
    result.tableMode !== "repeated-blocks" &&
    result.diagnostics &&
    regionsAreSafeToSplit(ws, result.diagnostics.tableRegions, scan)
  ) {
    const split = result.diagnostics.tableRegions.flatMap((region, index) => {
      const slicedGrid = grid ? sliceGridRegion(grid.aoa, region) : null;
      const regionSheet = slicedGrid
        ? minimalWorksheetForGrid(slicedGrid)
        : independentRegionWorksheet(ws, region);
      if (!regionSheet) return [];
      const imported = sheetToRows(regionSheet, wb, slicedGrid ? { aoa: slicedGrid } : undefined);
      if (!imported.rows.length) return [];
      const separationWarning = `A aba "${name}" continha ${result.diagnostics!.tableRegions.length} tabelas independentes e foi separada automaticamente. Esta opção corresponde à região ${index + 1}.`;
      return [
        {
          name: `${name} · Região ${index + 1}`,
          ...imported,
          ...(scheduleToLong(imported.rows).length
            ? { longScheduleRows: scheduleToLong(imported.rows) }
            : {}),
          warning: imported.warning
            ? `${separationWarning} ${imported.warning}`
            : separationWarning,
        },
      ];
    });
    if (split.length === result.diagnostics.tableRegions.length) return split;
  }
  const { rows, warning, diagnostics, sourceGrid, audit } = result;
  // Uma aba sem nenhuma linha de dado tabular normalmente é descartada
  // (filtro abaixo), mas se ela tiver gráficos, formas com texto ou
  // imagens nativos do Excel, ainda vale a pena aparecer como opção —
  // o usuário perderia esse conteúdo silenciosamente. `visualOnlyWarning`
  // substitui o aviso padrão (que falaria de estrutura de tabela
  // inexistente) por um específico desse caso.
  const visualOnlyContent = Boolean(
    diagnostics &&
    (diagnostics.charts.length || diagnostics.shapes.length || diagnostics.images.length),
  );
  const visualOnlyWarning =
    !rows.length && visualOnlyContent
      ? `A aba "${name}" não tem linhas de dado tabular, só conteúdo visual nativo do Excel (${diagnostics!.charts.length} gráfico(s), ${diagnostics!.shapes.length} forma(s) com texto, ${diagnostics!.images.length} imagem(ns)). Sem dados para tabela ou widgets, mas o inventário fica disponível no painel.`
      : undefined;
  const longScheduleRows = scheduleToLong(rows);
  // Regiões independentes foram detectadas (diagnostics.tableRegions), mas a
  // separação automática não ocorreu acima: ou regionsAreSafeToSplit recusou
  // por segurança (ex: matriz de identificadores + períodos, cabeçalho
  // numérico, poucas linhas de dado), ou uma das regiões não produziu linha
  // nenhuma. Nos dois casos as regiões continuam mescladas numa única aba
  // sem nenhum registro de que a divisão foi considerada e descartada.
  const regionsKeptTogether =
    audit && result.tableMode !== "repeated-blocks" && (diagnostics?.tableRegions.length ?? 0) > 1
      ? diagnostics!.tableRegions.length
      : undefined;
  return [
    {
      name,
      rows,
      warning: visualOnlyWarning ?? warning,
      ...(diagnostics ? { diagnostics } : {}),
      ...(sourceGrid ? { sourceGrid } : {}),
      ...(audit ? { audit: regionsKeptTogether ? { ...audit, regionsKeptTogether } : audit } : {}),
      ...(result.rowOrigins ? { rowOrigins: result.rowOrigins } : {}),
      ...(longScheduleRows.length ? { longScheduleRows } : {}),
    },
  ];
}

/**
 * Percorre as abas entregando cada opção assim que ela fica pronta.
 *
 * Existe separada de `sheetsWithData` porque esta é a fase mais cara depois do
 * parse (medida em 27% do tempo total num arquivo de 61 MiB, 12 abas) e a única
 * em que o trabalho já concluído é utilizável antes do fim: quem lê pode mostrar
 * a primeira aba enquanto as outras ainda estão sendo montadas, e quem roda em
 * worker pode soltar cada aba em vez de acumular o conjunto inteiro para mandar
 * de uma vez.
 *
 * `onSheetDone` é chamado por aba do workbook, não por opção emitida: uma aba
 * pode virar nenhuma opção (vazia) ou várias (blocos independentes), e o
 * denominador que interessa a quem mostra progresso é o de abas.
 */
export function streamSheetsWithData(
  wb: XLSX.WorkBook,
  onOption: (option: SheetOption) => void,
  onSheetDone?: (completed: number, total: number) => void,
  source?: SheetOptionsSource,
): void {
  const total = wb.SheetNames.length;
  for (const [index, name] of wb.SheetNames.entries()) {
    const unified = unifiedBlocksOption(name, wb);
    const options = sheetOptionsForName(name, wb, source);
    for (const option of unified ? [unified, ...options] : options)
      if (option.rows.length > 0 || hasVisualOnlyContent(option)) onOption(option);
    onSheetDone?.(index + 1, total);
  }
}

export function sheetsWithData(wb: XLSX.WorkBook, source?: SheetOptionsSource): SheetOption[] {
  const collected: SheetOption[] = [];
  streamSheetsWithData(wb, (option) => collected.push(option), undefined, source);
  return collected;
}

/** Uma aba sem linha de dado ainda vale como opção se tiver gráfico, forma com texto ou imagem nativos do Excel — ver `sheetsWithData`. */
function hasVisualOnlyContent(s: SheetOption): boolean {
  const d = s.diagnostics;
  return Boolean(d && (d.charts.length || d.shapes.length || d.images.length));
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
