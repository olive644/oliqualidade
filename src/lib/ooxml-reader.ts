import { strFromU8 } from "fflate";
import * as XLSX from "xlsx";

import { isOoxmlArchive, unzipOoxmlArchive, type OoxmlArchive } from "@/lib/ooxml-archive";
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

export type OoxmlInspection = {
  sheets: Map<string, Map<string, ReaderCell>>;
  structures: Map<string, OoxmlSheetStructure>;
  workbook: XLSX.WorkBook;
};

export type OoxmlSheetStructure = {
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

function readSheet(xml: string, strings: string[], formats: string[], date1904: boolean) {
  const cells = new Map<string, ReaderCell>();
  const worksheet: XLSX.WorkSheet = {};
  let range: XLSX.Range | null = null;
  const rows: XLSX.RowInfo[] = [];
  const hiddenRows: number[] = [];
  const hiddenColumns: Array<{ start: number; end: number }> = [];
  const mergedRanges: string[] = [];
  for (const match of xml.matchAll(/<row\b[^>]*(?:\/>|>)/g)) {
    const attrs = attributes(match[0]);
    const rowNumber = Number(attrs["r"]);
    if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
    const hidden = attrs["hidden"] === "1" || attrs["hidden"] === "true";
    if (hidden) {
      rows[rowNumber - 1] = { hidden: true };
      hiddenRows.push(rowNumber);
    }
  }
  if (rows.length) worksheet["!rows"] = rows;
  for (const match of xml.matchAll(/<col\b[^>]*(?:\/>|>)/g)) {
    const attrs = attributes(match[0]);
    if (attrs["hidden"] !== "1" && attrs["hidden"] !== "true") continue;
    const start = Number(attrs["min"]);
    const end = Number(attrs["max"]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) continue;
    hiddenColumns.push({ start, end });
  }
  if (hiddenColumns.length) {
    const columns: XLSX.ColInfo[] = [];
    for (const { start, end } of hiddenColumns)
      for (let column = start; column <= end; column++) columns[column - 1] = { hidden: true };
    worksheet["!cols"] = columns;
  }
  for (const match of xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"[^>]*\/>/g)) {
    const reference = match[1]!;
    try {
      worksheet["!merges"] ??= [];
      worksheet["!merges"].push(XLSX.utils.decode_range(reference));
      mergedRanges.push(reference);
    } catch {
      // Estruturas inválidas são ignoradas pelo verificador independente.
    }
  }
  // A alternativa autocontida precisa vir primeiro. Caso contrário, `<c .../>`
  // também casa como uma tag de abertura e captura o conteúdo da próxima
  // célula até `</c>`, transformando formatação vazia em dado inexistente.
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
    cells.set(address, {
      address,
      rawValue,
      displayValue,
      ...(numberFormat !== "General" ? { numberFormat } : {}),
      ...(formula ? { formula: `=${decodedFormula!}` } : {}),
    });
    if (rawValue == null && !formula) continue;
    const cell: XLSX.CellObject = {
      t: typeof rawValue === "boolean" ? "b" : typeof rawValue === "number" ? "n" : "s",
      v: rawValue ?? "",
      w: displayValue,
      ...(numberFormat !== "General" ? { z: numberFormat } : {}),
      ...(formula ? { f: decodedFormula! } : {}),
    };
    if (typeof rawValue === "number" && XLSX.SSF.is_date(numberFormat)) {
      const converted = serialDate(rawValue, date1904);
      if (converted) {
        cell.t = "d";
        cell.v = converted;
      }
    }
    worksheet[address] = cell;
    const decoded = XLSX.utils.decode_cell(address);
    range = range
      ? {
          s: { r: Math.min(range.s.r, decoded.r), c: Math.min(range.s.c, decoded.c) },
          e: { r: Math.max(range.e.r, decoded.r), c: Math.max(range.e.c, decoded.c) },
        }
      : { s: decoded, e: decoded };
  }
  const dimension = /<dimension\b[^>]*ref="([^"]+)"/.exec(xml)?.[1];
  worksheet["!ref"] = dimension || (range ? XLSX.utils.encode_range(range) : "A1");
  return { cells, worksheet, structure: { mergedRanges, hiddenRows, hiddenColumns } };
}

export function inspectOoxml(input: ArrayBuffer | Uint8Array | OoxmlArchive): OoxmlInspection {
  const archive = isOoxmlArchive(input) ? input : unzipOoxmlArchive(input);
  const workbookXml = archiveText(archive, "xl/workbook.xml");
  if (!workbookXml) throw new Error("O pacote OOXML não contém xl/workbook.xml.");
  const rels = relationshipMap(archiveText(archive, "xl/_rels/workbook.xml.rels"), "xl");
  const strings = sharedStrings(archiveText(archive, "xl/sharedStrings.xml"));
  const formats = styleFormats(archiveText(archive, "xl/styles.xml"));
  const workbookPrAttrs = attributes(/<workbookPr\b[^>]*\/?>/.exec(workbookXml)?.[0] ?? "");
  const date1904 = workbookPrAttrs["date1904"] === "1" || workbookPrAttrs["date1904"] === "true";
  const workbook = XLSX.utils.book_new();
  const sheets = new Map<string, Map<string, ReaderCell>>();
  const structures = new Map<string, OoxmlSheetStructure>();
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/>/g)) {
    const attrs = attributes(match[0]);
    const name = decodeOoxmlText(attrs["name"] ?? "Planilha");
    const path = rels.get(attrs["r:id"] ?? "");
    if (!path) continue;
    const parsed = readSheet(archiveText(archive, path), strings, formats, date1904);
    XLSX.utils.book_append_sheet(workbook, parsed.worksheet, name.slice(0, 31));
    sheets.set(name, parsed.cells);
    structures.set(name, parsed.structure);
  }
  if (!workbook.SheetNames.length) throw new Error("Nenhuma aba OOXML legível foi encontrada.");
  return { sheets, structures, workbook };
}

function comparable(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "").trim();
}

export function compareAndRepairWithOoxml(
  primary: XLSX.WorkBook,
  inspection: OoxmlInspection,
): ReaderDivergence[] {
  const divergences: ReaderDivergence[] = [];
  for (const [sheetName, independentCells] of inspection.sheets) {
    let sheet = primary.Sheets[sheetName];
    if (!sheet) {
      const recoveredSheet = inspection.workbook.Sheets[sheetName];
      if (!recoveredSheet) continue;
      if (!primary.SheetNames.includes(sheetName)) {
        const sourceIndex = inspection.workbook.SheetNames.indexOf(sheetName);
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
        const fallbackCell = inspection.workbook.Sheets[sheetName]?.[address] as
          XLSX.CellObject | undefined;
        if (fallbackCell) setWorksheetCellAtAddress(sheet, address, { ...fallbackCell });
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
  return divergences.slice(0, 2_000);
}
