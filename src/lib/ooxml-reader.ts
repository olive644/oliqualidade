import { strFromU8 } from "fflate";
import * as XLSX from "xlsx";

import { isOoxmlArchive, unzipOoxmlArchive, type OoxmlArchive } from "@/lib/ooxml-archive";
import type { SheetCellFormatLookup } from "@/lib/import";
import { setWorksheetCellAtAddress, worksheetCellAtAddress } from "@/lib/worksheet-cell";
import { stripXmlMarkup } from "@/lib/xml-text";

export type ReaderCell = {
  address: string;
  rawValue: string | number | boolean | null;
  displayValue: string;
  numberFormat?: string;
  formula?: string;
};

export type ReaderDivergence = {
  sheet: string;
  address: string;
  primary: string;
  independent: string;
  severity: "warning" | "error";
  repaired: boolean;
};

/**
 * O resultado da leitura independente do pacote.
 *
 * `sheets` é o inventário por célula, que é o que a comparação lê. A
 * worksheet equivalente **não** é montada junto: ela só existe quando alguém
 * a pede, e é reconstruída a partir do próprio inventário, que já está vivo.
 *
 * O motivo é medido. Montar a worksheet de toda aba custa 129,8 MiB num
 * arquivo de 1,44 milhão de células, e ela só é consultada quando há reparo, o
 * que é a exceção. Ver
 * [[CURRENT_STATE_AUDIT#158. A verificação carregava uma worksheet de reparo que quase nunca é lida]].
 */
export type OoxmlInspection = {
  sheets: Map<string, Map<string, ReaderCell>>;
  structures: Map<string, OoxmlSheetStructure>;
  /** As abas legíveis, na ordem em que o pacote as declara. */
  sheetNames: string[];
  /**
   * Uma célula da aba, montada na hora a partir do inventário.
   *
   * É o que o reparo por célula precisa, e reconstruir uma célula custa uma
   * célula. Reconstruir a aba inteira para ler uma delas seria pagar a
   * worksheet que este desenho existe para não pagar.
   */
  cellFor: (sheetName: string, address: string) => XLSX.CellObject | undefined;
  /** A aba inteira como worksheet, montada na hora. Para recuperar uma aba que o leitor principal perdeu. */
  worksheetFor: (sheetName: string) => XLSX.WorkSheet | undefined;
  /**
   * O pacote inteiro como workbook, materializado na primeira leitura.
   *
   * Só o caminho de fallback o usa, e ali ele é o produto: o leitor principal
   * falhou e este workbook é o que vai ser importado. Na verificação, que é o
   * caminho comum, ninguém toca nele e nada é montado.
   */
  readonly workbook: XLSX.WorkBook;
};

export type OoxmlSheetStructure = {
  /**
   * O `!ref` da aba, como o XML o declara ou como as células o delimitam.
   *
   * Viaja junto porque quem reconstrói a worksheet a partir do inventário
   * precisa dele, e recalculá-lo exigiria percorrer as células de novo.
   */
  ref: string;
  mergedRanges: string[];
  hiddenRows: number[];
  hiddenColumns: Array<{ start: number; end: number }>;
};

const BUILTIN_FORMATS: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  9: "0%",
  10: "0.00%",
  14: "m/d/yy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yy h:mm",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
};

/**
 * Decodifica **só** as entidades e referências de caractere do XML.
 *
 * Existe separada de `decodeOoxmlText` porque valor de atributo e nó de texto
 * têm contratos diferentes. Todo atributo XML é escapado por entidade, e
 * decodificá-las é obrigatório para ler o valor real. Já as outras conversões
 * de `decodeOoxmlText` — remoção de marcação, normalização de fim de linha e o
 * escape `_xNNNN_` — são convenções de conteúdo textual do OOXML, e aplicá-las
 * a todo atributo alcança muito mais do que se pretende.
 *
 * O caso concreto que motivou a separação está no próprio código de formato
 * numérico, onde `_` é o operador "pule a largura do próximo caractere". Uma
 * sequência de `_` com quatro hexadecimais e outro `_` viraria caractere de
 * controle em silêncio. Nos formatos comuns o caractere seguinte ao `_` é `-`,
 * `(` ou `)`, então não casa, mas nada no código impedia.
 */
export function decodeXmlEntities(value: string): string {
  return (
    value
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      // Referências numéricas de caractere (`&#199;`, `&#xC7;`) são XML válido
      // e aparecem em arquivos reais exportados por algumas ferramentas.
      // Decodificadas antes de `&amp;` para que um `&amp;#199;` literal (texto
      // escapado de propósito) continue como texto, não como caractere.
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(parseInt(decimal, 10)))
      .replace(/&amp;/g, "&")
  );
}

/**
 * Decodifica texto vindo do XML. Ver o contrato em `xml-text.ts`: o retorno é
 * texto puro, e pode conter `<` e `>` quando a célula os continha de verdade.
 */
export function decodeOoxmlText(value: string): string {
  return (
    decodeXmlEntities(stripXmlMarkup(value))
      // Texto de célula com quebra de linha (`xml:space="preserve"`) às vezes
      // guarda `\r\n` literal no XML; o SheetJS normaliza para `\n` na
      // leitura. Sem isso, o mesmo texto diverge entre os dois leitores só
      // por causa do fim de linha, gerando falso positivo de fidelidade.
      .replace(/\r\n?/g, "\n")
      // Caractere de controle que o XML não aceita literalmente é gravado
      // pelo Excel como `_xXXXX_` (ECMA-376). Aparece em arquivo real: um
      // código de documento digitado com um caractere invisível no meio
      // vira "FRS-SA_x0002_009" no XML. O SheetJS decodifica; sem fazer o
      // mesmo aqui, a verificação independente acusava divergência em cada
      // célula com esse texto — sete alarmes falsos num único arquivo, que
      // derrubam a confiança da importação sem haver nada errado.
      //
      // Uma passada só, de propósito: `replace` continua a busca depois do
      // trecho substituído, nunca dentro dele. Assim um literal "_x0002_"
      // escrito de propósito — que o Excel grava como "_x005F_x0002_" —
      // resolve sozinho: o primeiro trecho vira "_" e o resto ("x0002_") já
      // não casa com o padrão, devolvendo o texto original em vez de um
      // caractere de controle.
      .replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  );
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Entidades, e só elas: ver o contrato em `decodeXmlEntities`.
  for (const match of tag.matchAll(/([\w:-]+)="([^"]*)"/g))
    result[match[1]!] = decodeXmlEntities(match[2]!);
  return result;
}

function archiveText(archive: OoxmlArchive, path: string): string {
  const bytes = archive[path];
  return bytes ? strFromU8(bytes) : "";
}

function relationshipMap(xml: string, base: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const attrs = attributes(match[0]);
    const target = attrs["Target"];
    if (!attrs["Id"] || !target) continue;
    const normalized = target.startsWith("/")
      ? target.slice(1)
      : `${base}/${target}`
          .split("/")
          .reduce<string[]>((parts, part) => {
            if (part === "..") parts.pop();
            else if (part !== ".") parts.push(part);
            return parts;
          }, [])
          .join("/");
    result.set(attrs["Id"], normalized);
  }
  return result;
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((part) => decodeOoxmlText(part[1]!))
      .join(""),
  );
}

function styleFormats(xml: string): string[] {
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(/<numFmt\b[^>]*\/>/g)) {
    const attrs = attributes(match[0]);
    if (attrs["numFmtId"] && attrs["formatCode"])
      custom.set(Number(attrs["numFmtId"]), attrs["formatCode"]);
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  return [...xfs.matchAll(/<xf\b[^>]*(?:\/>|>)/g)].map((match) => {
    const id = Number(attributes(match[0])["numFmtId"] ?? 0);
    return custom.get(id) ?? BUILTIN_FORMATS[id] ?? "General";
  });
}

function serialDate(value: number, date1904: boolean): Date | null {
  const parsed = XLSX.SSF.parse_date_code(value, { date1904 });
  if (!parsed) return null;
  return new Date(
    Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S)),
  );
}

/** Compartilhadas entre a leitura para worksheet e a leitura para grade. */
const ROW_TAG = /<row\b[^>]*(?:\/>|>)/g;
const MERGE_TAG = /<mergeCell\b[^>]*\bref="([^"]+)"[^>]*\/>/g;

/**
 * Uma célula do XML da aba, já interpretada.
 *
 * Existe para o mesmo XML ser lido uma vez só e servir a dois consumidores: a
 * worksheet que o verificador independente monta e a grade que a normalização
 * consome. Duas leituras seriam dois lugares onde a interpretação de tipo,
 * formato e data pode divergir sem ninguém notar, e é justamente essa
 * interpretação que o corpus real conferiu célula a célula.
 */
type ParsedSheetCell = {
  address: string;
  rawValue: string | number | boolean | null;
  displayValue: string;
  numberFormat: string;
  /** Já decodificada, e sem o `=` que o inventário acrescenta. */
  formula?: string;
  /** Preenchida quando o número tem formato de data e a conversão deu certo. */
  dateValue?: Date;
};

/**
 * Percorre as células do XML da aba, na ordem em que o arquivo as declara.
 *
 * A alternativa autocontida precisa vir primeiro. Caso contrário, `<c .../>`
 * também casa como uma tag de abertura e captura o conteúdo da próxima
 * célula até `</c>`, transformando formatação vazia em dado inexistente.
 */
function* parseSheetCells(
  xml: string,
  strings: string[],
  formats: string[],
  date1904: boolean,
): Generator<ParsedSheetCell> {
  for (const match of xml.matchAll(/<c\b([^>]*)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
    const attrs = attributes(match[1] ?? match[2] ?? "");
    const address = attrs["r"];
    if (!address) continue;
    const body = match[3] ?? "";
    const type = attrs["t"] ?? "n";
    const style = Number(attrs["s"] ?? 0);
    const numberFormat = formats[style] ?? "General";
    const rawText = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
    const inline = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1];
    const formula = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(body)?.[1];
    const decodedFormula = formula ? decodeOoxmlText(formula) : undefined;
    let rawValue: string | number | boolean | null = null;
    if (type === "s") rawValue = strings[Number(rawText)] ?? "";
    else if (type === "inlineStr") rawValue = decodeOoxmlText(inline ?? "");
    else if (type === "b") rawValue = rawText === "1";
    else if (type === "str" || type === "e") rawValue = decodeOoxmlText(rawText ?? "");
    else if (rawText != null && rawText !== "") {
      const numeric = Number(rawText);
      rawValue = Number.isFinite(numeric) ? numeric : decodeOoxmlText(rawText);
    }

    let displayValue = rawValue == null ? "" : String(rawValue);
    if (typeof rawValue === "number") {
      try {
        displayValue = XLSX.SSF.format(numberFormat, rawValue, { date1904 });
      } catch {
        displayValue = String(rawValue);
      }
    }
    const dateValue =
      typeof rawValue === "number" && XLSX.SSF.is_date(numberFormat)
        ? (serialDate(rawValue, date1904) ?? undefined)
        : undefined;

    yield {
      address,
      rawValue,
      displayValue,
      numberFormat,
      ...(decodedFormula ? { formula: decodedFormula } : {}),
      ...(dateValue ? { dateValue } : {}),
    };
  }
}

/**
 * Uma célula sem valor e sem fórmula não vira célula na worksheet.
 *
 * Ela existe no XML só para carregar formatação, e o inventário a registra,
 * mas o modelo do SheetJS não. A grade segue a worksheet, e não o inventário,
 * porque é com a worksheet que ela precisa ser intercambiável.
 */
const cellReachesWorksheet = (cell: ParsedSheetCell) =>
  cell.rawValue != null || cell.formula !== undefined;

/**
 * Lê a aba para inventário e estrutura, sem montar worksheet nenhuma.
 *
 * A worksheet equivalente sai de `worksheetFromInventory`, e só quando alguém a
 * pede. Montá-la aqui significava montá-la para toda aba de todo arquivo,
 * quando o único consumidor é o reparo, que é a exceção.
 */
function readSheet(xml: string, strings: string[], formats: string[], date1904: boolean) {
  const cells = new Map<string, ReaderCell>();
  let range: XLSX.Range | null = null;
  const hiddenRows: number[] = [];
  const hiddenColumns: Array<{ start: number; end: number }> = [];
  const mergedRanges: string[] = [];
  for (const match of xml.matchAll(ROW_TAG)) {
    const attrs = attributes(match[0]);
    const rowNumber = Number(attrs["r"]);
    if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
    const hidden = attrs["hidden"] === "1" || attrs["hidden"] === "true";
    if (hidden) {
      hiddenRows.push(rowNumber);
    }
  }
  for (const match of xml.matchAll(/<col\b[^>]*(?:\/>|>)/g)) {
    const attrs = attributes(match[0]);
    if (attrs["hidden"] !== "1" && attrs["hidden"] !== "true") continue;
    const start = Number(attrs["min"]);
    const end = Number(attrs["max"]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) continue;
    hiddenColumns.push({ start, end });
  }
  for (const match of xml.matchAll(MERGE_TAG)) {
    const reference = match[1]!;
    try {
      // Decodificar aqui é o que separa uma mesclagem válida de uma inválida: a
      // inválida lança, e o verificador independente a ignora. O resultado não
      // é guardado porque quem monta a worksheet decodifica de novo, e guardar
      // um `Range` por mesclagem custaria mais do que a string.
      XLSX.utils.decode_range(reference);
      mergedRanges.push(reference);
    } catch {
      // Estruturas inválidas são ignoradas pelo verificador independente.
    }
  }
  for (const parsed of parseSheetCells(xml, strings, formats, date1904)) {
    const { address, rawValue, displayValue, numberFormat, formula, dateValue } = parsed;
    cells.set(address, {
      address,
      rawValue,
      displayValue,
      ...(numberFormat !== "General" ? { numberFormat } : {}),
      ...(formula ? { formula: `=${formula}` } : {}),
    });
    // O `!ref` continua saindo daqui porque ele delimita as células que
    // **chegam** à worksheet, e esta é a única passagem que as conhece.
    if (!cellReachesWorksheet(parsed)) continue;
    const decoded = XLSX.utils.decode_cell(address);
    range = range
      ? {
          s: { r: Math.min(range.s.r, decoded.r), c: Math.min(range.s.c, decoded.c) },
          e: { r: Math.max(range.e.r, decoded.r), c: Math.max(range.e.c, decoded.c) },
        }
      : { s: decoded, e: decoded };
  }
  const dimension = /<dimension\b[^>]*ref="([^"]+)"/.exec(xml)?.[1];
  const ref = dimension || (range ? XLSX.utils.encode_range(range) : "A1");
  return { cells, structure: { ref, mergedRanges, hiddenRows, hiddenColumns } };
}

/**
 * Uma célula da worksheet, reconstruída a partir da entrada do inventário.
 *
 * O inventário guarda tudo o que a célula da worksheet carrega: valor cru,
 * texto exibido, formato numérico e fórmula. A data é a única que não viaja
 * pronta, e ela é recalculável do valor cru mais o formato, que é exatamente o
 * que a leitura original faz. Por isso a reconstrução não retém nada a mais.
 */
function cellFromInventory(cell: ReaderCell, date1904: boolean): XLSX.CellObject {
  const { rawValue, displayValue, numberFormat, formula } = cell;
  const built: XLSX.CellObject = {
    t: typeof rawValue === "boolean" ? "b" : typeof rawValue === "number" ? "n" : "s",
    v: rawValue ?? "",
    w: displayValue,
    ...(numberFormat ? { z: numberFormat } : {}),
    // O inventário guarda a fórmula com o `=` que ele mesmo acrescenta; a
    // worksheet a quer sem.
    ...(formula ? { f: formula.slice(1) } : {}),
  };
  const dateValue =
    typeof rawValue === "number" && XLSX.SSF.is_date(numberFormat ?? "General")
      ? serialDate(rawValue, date1904)
      : null;
  if (dateValue) {
    built.t = "d";
    built.v = dateValue;
  }
  return built;
}

/**
 * A aba inteira como worksheet, reconstruída a partir do inventário.
 *
 * Vale a mesma regra de `cellFromInventory`: uma célula sem valor e sem fórmula
 * existe no inventário mas não na worksheet, porque ela está no XML só para
 * carregar formatação.
 */
function worksheetFromInventory(
  cells: Map<string, ReaderCell>,
  structure: OoxmlSheetStructure,
  date1904: boolean,
): XLSX.WorkSheet {
  const worksheet: XLSX.WorkSheet = {};
  if (structure.hiddenRows.length) {
    const rows: XLSX.RowInfo[] = [];
    for (const rowNumber of structure.hiddenRows) rows[rowNumber - 1] = { hidden: true };
    worksheet["!rows"] = rows;
  }
  if (structure.hiddenColumns.length) {
    const columns: XLSX.ColInfo[] = [];
    for (const { start, end } of structure.hiddenColumns)
      for (let column = start; column <= end; column++) columns[column - 1] = { hidden: true };
    worksheet["!cols"] = columns;
  }
  if (structure.mergedRanges.length)
    worksheet["!merges"] = structure.mergedRanges.map((reference) =>
      XLSX.utils.decode_range(reference),
    );
  for (const [address, cell] of cells) {
    if (cell.rawValue == null && cell.formula === undefined) continue;
    worksheet[address] = cellFromInventory(cell, date1904);
  }
  worksheet["!ref"] = structure.ref;
  return worksheet;
}

/**
 * Progresso por aba de uma varredura OOXML.
 *
 * As duas fases mais caras da leitura depois do parse percorrem abas uma a
 * uma, então são as únicas que conseguem dizer o quanto falta. Sem isto, a
 * interface fica parada num rótulo fixo durante a maior parte da espera.
 */
export type OoxmlSheetProgress = (completed: number, total: number) => void;

/**
 * O que é preciso ler do pacote antes de olhar qualquer aba.
 *
 * Os textos compartilhados, os formatos numéricos e a base de datas valem para
 * o pacote inteiro, e a lista de abas declaradas define a ordem e o
 * denominador do progresso. Existe extraído porque `inspectOoxml` e
 * `readOoxmlSheetGrids` precisam exatamente disto, e ler o mesmo pacote de dois
 * jeitos seria a forma mais fácil de as duas leituras divergirem na base de
 * datas ou na tabela de formatos.
 */
function readWorkbookParts(archive: OoxmlArchive) {
  const workbookXml = archiveText(archive, "xl/workbook.xml");
  if (!workbookXml) throw new Error("O pacote OOXML não contém xl/workbook.xml.");
  const rels = relationshipMap(archiveText(archive, "xl/_rels/workbook.xml.rels"), "xl");
  const strings = sharedStrings(archiveText(archive, "xl/sharedStrings.xml"));
  const formats = styleFormats(archiveText(archive, "xl/styles.xml"));
  const workbookPrAttrs = attributes(/<workbookPr\b[^>]*\/?>/.exec(workbookXml)?.[0] ?? "");
  const date1904 = workbookPrAttrs["date1904"] === "1" || workbookPrAttrs["date1904"] === "true";
  // O total sai da própria lista de <sheet> do workbook.xml, e não da
  // contagem de abas já lidas: uma aba sem relacionamento é pulada, e usar o
  // que foi lido como denominador faria a fração andar para trás.
  const declaredSheets = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)];
  return { rels, strings, formats, date1904, declaredSheets };
}

/**
 * Monta a consulta de formato de uma aba, no armazenamento mais barato.
 *
 * Medido em 120 mil linhas por 8 colunas com uma coluna de data: guardar o par
 * completo por célula custa 10,8 MiB, só o formato por célula custa 6,3 MiB, e
 * um formato por coluna é praticamente de graça. Como 94% das colunas de data
 * do corpus real têm um formato só, a coluna é o caso comum e a célula é a
 * exceção.
 */
function buildCellFormats(
  porCelula: Map<string, string>,
  textAoa: OoxmlSheetGrid["textAoa"],
  colunas: number,
): SheetCellFormatLookup {
  // Uma coluna cujas células de data compartilham o mesmo formato guarda um
  // valor só; as demais mantêm as entradas por célula.
  const porColuna: (string | null)[] = new Array(colunas).fill(null);
  const formatosDaColuna = new Map<number, Set<string>>();
  for (const [chave, formato] of porCelula) {
    const coluna = Number(chave.slice(chave.indexOf(",") + 1));
    const conhecidos = formatosDaColuna.get(coluna) ?? new Set<string>();
    conhecidos.add(formato);
    formatosDaColuna.set(coluna, conhecidos);
  }
  for (const [coluna, formatos] of formatosDaColuna)
    if (formatos.size === 1) porColuna[coluna] = [...formatos][0]!;

  for (const chave of [...porCelula.keys()]) {
    const coluna = Number(chave.slice(chave.indexOf(",") + 1));
    if (porColuna[coluna] !== null) porCelula.delete(chave);
  }

  return (linha, coluna) => {
    const formato = porColuna[coluna] ?? porCelula.get(`${linha},${coluna}`);
    if (formato === undefined || formato === null) return undefined;
    const exibido = textAoa[linha]?.[coluna];
    return { z: formato, ...(typeof exibido === "string" ? { w: exibido } : {}) };
  };
}

/**
 * A aba do pacote como grade, sem worksheet nenhuma.
 *
 * É o equivalente OOXML do que `csv-stream.ts` produz para CSV, e existe pela
 * mesma medida: a worksheet do SheetJS é a cópia que domina o pico da
 * importação, e a normalização já sabe trabalhar sobre uma grade
 * (`sheetsWithData(wb, { gridFor })`).
 *
 * `aoa` são os valores como `sheetToRows` os consome, com data já convertida.
 * `textAoa` é o texto formatado, que a detecção de regiões usa. Ao contrário do
 * CSV, aqui as duas **não** coincidem: um número com formato de data aparece
 * como `Date` numa e como texto formatado na outra, e é justamente por isso que
 * `SheetGridSource` tem os dois campos separados.
 *
 * `hiddenRows` e `mergedRanges` viajam junto porque a normalização os lê da
 * worksheet, e quem montar a worksheet mínima a partir desta grade precisa
 * saber deles. Sem isso, uma linha oculta entraria como dado.
 */
export type OoxmlSheetGrid = {
  ref: string;
  /**
   * O booleano faz parte do conjunto: uma célula `t="b"` chega como `true` ou
   * `false`, e é assim que a worksheet equivalente já a entrega.
   *
   * Este tipo já coincide com `SheetSourceGrid`, de `import.ts`. Coincidir foi
   * trabalho: aquele tipo omitia o booleano, embora o caminho atual sempre o
   * tenha produzido, e a omissão só apareceu ao escrever esta grade.
   */
  aoa: (string | number | boolean | Date | null)[][];
  textAoa: (string | number | boolean | null)[][];
  hiddenRows: number[];
  mergedRanges: string[];
  /**
   * Formato numérico e texto exibido das células de data.
   *
   * A normalização lê os dois da célula de origem para formatar uma data, e
   * numa fonte de grade essa célula não existe. Sem esta consulta a data é
   * descartada e a coluna some, que foi o que o corpus mostrou.
   *
   * O armazenamento segue o que a medição disse: um formato por coluna quando
   * ela é homogênea, o que é praticamente de graça, e um mapa por célula só nas
   * que não são, que no corpus são 6% das colunas de data. O texto exibido não
   * é guardado de novo, porque `textAoa` já o tem.
   */
  cellFormats: SheetCellFormatLookup;
};

/**
 * Lê o XML de uma aba direto para uma grade densa.
 *
 * A grade é do tamanho do intervalo declarado, e cada linha vem completa. É a
 * forma que `sheet_to_json` produz a partir da worksheet equivalente, e a
 * intercambialidade entre as duas é o que os testes cobram.
 */
export function readOoxmlSheetGrid(
  xml: string,
  strings: string[],
  formats: string[],
  date1904: boolean,
): OoxmlSheetGrid {
  const hiddenRows: number[] = [];
  for (const match of xml.matchAll(ROW_TAG)) {
    const attrs = attributes(match[0]);
    const rowNumber = Number(attrs["r"]);
    if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
    if (attrs["hidden"] === "1" || attrs["hidden"] === "true") hiddenRows.push(rowNumber);
  }

  const mergedRanges: string[] = [];
  for (const match of xml.matchAll(MERGE_TAG)) mergedRanges.push(match[1]!);

  // O intervalo declarado manda, como na worksheet. Quando ele falta, o que
  // sobra é o retângulo que as células ocupam.
  const dimension = /<dimension\b[^>]*ref="([^"]+)"/.exec(xml)?.[1];
  const parsed = [...parseSheetCells(xml, strings, formats, date1904)].filter(cellReachesWorksheet);
  let range: XLSX.Range | null = null;
  if (dimension) {
    try {
      range = XLSX.utils.decode_range(dimension);
    } catch {
      range = null;
    }
  }
  if (!range)
    for (const cell of parsed) {
      const decoded = XLSX.utils.decode_cell(cell.address);
      range = range
        ? {
            s: { r: Math.min(range.s.r, decoded.r), c: Math.min(range.s.c, decoded.c) },
            e: { r: Math.max(range.e.r, decoded.r), c: Math.max(range.e.c, decoded.c) },
          }
        : { s: decoded, e: decoded };
    }
  const usado = range ?? { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const linhas = usado.e.r - usado.s.r + 1;
  const colunas = usado.e.c - usado.s.c + 1;

  const aoa: OoxmlSheetGrid["aoa"] = Array.from({ length: linhas }, () =>
    new Array<string | number | boolean | Date | null>(colunas).fill(null),
  );
  const textAoa: (string | number | boolean | null)[][] = Array.from({ length: linhas }, () =>
    new Array<string | number | boolean | null>(colunas).fill(null),
  );

  // Só as células de data entram: são as únicas que a normalização precisa
  // consultar, e guardar as outras devolveria o custo que a grade remove.
  const formatosDeData = new Map<string, string>();
  for (const cell of parsed) {
    const decoded = XLSX.utils.decode_cell(cell.address);
    const linha = decoded.r - usado.s.r;
    const coluna = decoded.c - usado.s.c;
    if (linha < 0 || coluna < 0 || linha >= linhas || coluna >= colunas) continue;
    aoa[linha]![coluna] = cell.dateValue ?? cell.rawValue ?? "";
    textAoa[linha]![coluna] = cell.displayValue;
    if (cell.dateValue) formatosDeData.set(`${linha},${coluna}`, cell.numberFormat);
  }

  return {
    ref: dimension || (range ? XLSX.utils.encode_range(range) : "A1"),
    aoa,
    textAoa,
    hiddenRows,
    mergedRanges,
    cellFormats: buildCellFormats(formatosDeData, textAoa, colunas),
  };
}

/** As grades de todas as abas do pacote, na ordem em que ele as declara. */
export function readOoxmlSheetGrids(
  input: ArrayBuffer | Uint8Array | OoxmlArchive,
  onSheetDone?: OoxmlSheetProgress,
): Map<string, OoxmlSheetGrid> {
  const archive = isOoxmlArchive(input) ? input : unzipOoxmlArchive(input);
  const { rels, strings, formats, date1904, declaredSheets } = readWorkbookParts(archive);
  const grids = new Map<string, OoxmlSheetGrid>();
  for (const [index, match] of declaredSheets.entries()) {
    const attrs = attributes(match[0]);
    const name = decodeOoxmlText(attrs["name"] ?? "Planilha");
    const path = rels.get(attrs["r:id"] ?? "");
    if (path)
      grids.set(name, readOoxmlSheetGrid(archiveText(archive, path), strings, formats, date1904));
    onSheetDone?.(index + 1, declaredSheets.length);
  }
  return grids;
}

export function inspectOoxml(
  input: ArrayBuffer | Uint8Array | OoxmlArchive,
  onSheetDone?: OoxmlSheetProgress,
): OoxmlInspection {
  const archive = isOoxmlArchive(input) ? input : unzipOoxmlArchive(input);
  const { rels, strings, formats, date1904, declaredSheets } = readWorkbookParts(archive);
  const sheets = new Map<string, Map<string, ReaderCell>>();
  const structures = new Map<string, OoxmlSheetStructure>();
  const sheetNames: string[] = [];
  for (const [index, match] of declaredSheets.entries()) {
    const attrs = attributes(match[0]);
    const name = decodeOoxmlText(attrs["name"] ?? "Planilha");
    const path = rels.get(attrs["r:id"] ?? "");
    if (!path) {
      onSheetDone?.(index + 1, declaredSheets.length);
      continue;
    }
    const parsed = readSheet(archiveText(archive, path), strings, formats, date1904);
    sheets.set(name, parsed.cells);
    structures.set(name, parsed.structure);
    sheetNames.push(name);
    onSheetDone?.(index + 1, declaredSheets.length);
  }
  if (!sheetNames.length) throw new Error("Nenhuma aba OOXML legível foi encontrada.");

  const worksheetFor = (sheetName: string) => {
    const cells = sheets.get(sheetName);
    const structure = structures.get(sheetName);
    if (!cells || !structure) return undefined;
    return worksheetFromInventory(cells, structure, date1904);
  };

  // O workbook inteiro só existe se alguém o pedir, e a partir daí ele é o
  // mesmo objeto: quem o usa está importando este resultado, e devolver uma
  // cópia nova a cada leitura faria duas chamadas divergirem depois de escritas.
  let materialized: XLSX.WorkBook | undefined;

  return {
    sheets,
    structures,
    sheetNames,
    cellFor: (sheetName, address) => {
      const cell = sheets.get(sheetName)?.get(address);
      if (!cell || (cell.rawValue == null && cell.formula === undefined)) return undefined;
      return cellFromInventory(cell, date1904);
    },
    worksheetFor,
    get workbook() {
      if (materialized) return materialized;
      const workbook = XLSX.utils.book_new();
      for (const name of sheetNames)
        XLSX.utils.book_append_sheet(workbook, worksheetFor(name)!, name.slice(0, 31));
      materialized = workbook;
      return workbook;
    },
  };
}

/**
 * O valor de uma célula reduzido à forma que a comparação usa.
 *
 * A data inválida precisa de tratamento próprio, e a razão é concreta. Uma
 * célula que guarda um número grande demais para caber no calendário e carrega
 * formato de data — um código de material com formato `d-mmm`, encontrado em
 * planilha real — faz o leitor principal produzir `Invalid Date`. Chamar
 * `toISOString()` nela lança `RangeError`, e como a verificação inteira é
 * envolvida por um `try/catch` que existe para um arquivo legível não ser
 * recusado por falha da conferência, o efeito era o **arquivo inteiro** passar
 * sem verificação nenhuma, em silêncio.
 *
 * Vazio é a resposta certa, e não um marcador: uma data inválida não carrega
 * valor nenhum, exatamente como `null` e como célula ausente, que já viram
 * vazio aqui. Com isso a célula segue as regras que já existem — se os dois
 * leitores exibem o mesmo texto, não há divergência; se o outro leitor tem
 * valor, a célula é tratada como ausente no principal e reparada com ele.
 */
function comparable(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return String(value ?? "").trim();
}

export function compareAndRepairWithOoxml(
  primary: XLSX.WorkBook,
  inspection: OoxmlInspection,
  onSheetDone?: OoxmlSheetProgress,
): ReaderDivergence[] {
  const divergences: ReaderDivergence[] = [];
  const total = inspection.sheets.size;
  let completed = 0;
  for (const [sheetName, independentCells] of inspection.sheets) {
    // A contagem é reportada no começo de cada aba, não no fim: o corpo do
    // laço tem várias saídas antecipadas, e contar no fim deixaria de fora
    // justamente as abas que saem cedo. O fechamento vem depois do laço.
    onSheetDone?.(completed, total);
    completed += 1;
    let sheet = primary.Sheets[sheetName];
    if (!sheet) {
      const recoveredSheet = inspection.worksheetFor(sheetName);
      if (!recoveredSheet) continue;
      if (!primary.SheetNames.includes(sheetName)) {
        const sourceIndex = inspection.sheetNames.indexOf(sheetName);
        const insertionIndex =
          sourceIndex < 0
            ? primary.SheetNames.length
            : Math.min(sourceIndex, primary.SheetNames.length);
        primary.SheetNames.splice(insertionIndex, 0, sheetName);
      }
      primary.Sheets[sheetName] = recoveredSheet;
      sheet = recoveredSheet;
      for (const [address, independent] of independentCells) {
        divergences.push({
          sheet: sheetName,
          address,
          primary: "",
          independent:
            comparable(independent.rawValue) || independent.formula || independent.displayValue,
          severity: "error",
          repaired: true,
        });
      }
      continue;
    }
    for (const [address, independent] of independentCells) {
      const cell = worksheetCellAtAddress(sheet, address);
      const primaryValue = comparable(cell?.v);
      const independentValue = comparable(independent.rawValue);
      if (primaryValue === independentValue || comparable(cell?.w) === independent.displayValue)
        continue;
      const missingPrimary = !cell || (primaryValue === "" && independentValue !== "");
      if (missingPrimary) {
        const fallbackCell = inspection.cellFor(sheetName, address);
        if (fallbackCell) setWorksheetCellAtAddress(sheet, address, fallbackCell);
      }
      divergences.push({
        sheet: sheetName,
        address,
        primary: primaryValue,
        independent: independentValue,
        severity: missingPrimary ? "error" : "warning",
        repaired: missingPrimary,
      });
    }
  }
  onSheetDone?.(total, total);
  return divergences.slice(0, 2_000);
}
