import { strFromU8 } from "fflate";
import * as XLSX from "xlsx";
import { isOoxmlArchive, unzipOoxmlArchive, type OoxmlArchive } from "@/lib/ooxml-archive";
import { setWorksheetCellAtAddress, worksheetCellAtAddress } from "@/lib/worksheet-cell";

export type StructuredTableDiagnostic = {
  name: string;
  range: string | null;
  columns: string[];
  calculatedColumns: string[];
};

export type PivotTableDiagnostic = {
  name: string;
  range: string | null;
};

export type AdvancedSheetMetadata = {
  structuredTables: StructuredTableDiagnostic[];
  pivotTables: PivotTableDiagnostic[];
  autoFilterRange: string | null;
  comments: WorkbookCellComment[];
  hyperlinks: WorkbookCellHyperlink[];
  definedNames: WorkbookDefinedName[];
  externalLinks: WorkbookExternalLink[];
  dataValidations: DataValidationDiagnostic[];
  /** `xl/vbaProject.bin` presente no pacote. As macros nunca são executadas nem decompiladas. */
  hasVbaMacros: boolean;
  /** Imagens embutidas (fotos/logos coladas na planilha). Formas/gráficos nativos não são inventariados. */
  images: WorkbookImageDiagnostic[];
};

export type WorkbookCellComment = {
  address: string;
  author?: string;
  text: string;
};

export type WorkbookCellHyperlink = {
  address: string;
  target: string;
  tooltip?: string;
};

export type WorkbookDefinedName = {
  name: string;
  refersTo: string;
  /** Aba a que o nome pertence, ou `null` quando o escopo é o workbook inteiro. */
  scope: string | null;
};

export type WorkbookExternalLink = {
  target: string;
};

export type DataValidationDiagnostic = {
  range: string;
  /** Tipo OOXML bruto: list, whole, decimal, date, time, textLength, custom etc. */
  type: string;
  allowBlank: boolean;
  formula1?: string;
  formula2?: string;
  promptTitle?: string;
  prompt?: string;
  errorTitle?: string;
  error?: string;
};

export type WorkbookImageDiagnostic = {
  name: string;
  /** Célula de ancoragem (canto superior esquerdo), ou `null` se não for possível determinar. */
  anchor: string | null;
  /** Formato inferido pela extensão do arquivo de mídia: PNG, JPEG, GIF etc. */
  format: string;
};

export type WorksheetWithAdvancedMetadata = XLSX.WorkSheet & {
  "!oliAdvanced"?: AdvancedSheetMetadata;
};

const attr = (xml: string, name: string) =>
  xml.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? null;

const decodeXml = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

function normalizePart(base: string, target: string): string {
  const parts = `${base}/${target}`.replaceAll("\\", "/").split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function relationships(xml: string, base: string) {
  const result = new Map<
    string,
    { target: string; rawTarget: string; type: string; external: boolean }
  >();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/gi)) {
    const id = attr(match[0], "Id");
    const target = attr(match[0], "Target");
    if (!id || !target) continue;
    result.set(id, {
      target: normalizePart(base, target),
      rawTarget: decodeXml(target),
      type: attr(match[0], "Type") ?? "",
      external: attr(match[0], "TargetMode")?.toLowerCase() === "external",
    });
  }
  return result;
}

function parseComments(xml: string): WorkbookCellComment[] {
  const authors = [...xml.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/gi)].map((match) =>
    decodeXml(match[1]!.replace(/<[^>]+>/g, "")),
  );
  const comments: WorkbookCellComment[] = [];
  for (const match of xml.matchAll(/<comment\b([^>]*)>([\s\S]*?)<\/comment>/gi)) {
    const address = attr(match[1]!, "ref");
    if (!address) continue;
    const text = [...match[2]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)]
      .map((part) => decodeXml(part[1]!))
      .join("");
    const rawAuthorId = attr(match[1]!, "authorId");
    const authorId = rawAuthorId === null ? null : Number(rawAuthorId);
    const author = authorId !== null && Number.isInteger(authorId) ? authors[authorId] : undefined;
    comments.push({ address, ...(author ? { author } : {}), text });
  }
  return comments;
}

function cellAddresses(reference: string): string[] {
  try {
    const range = XLSX.utils.decode_range(reference);
    const size = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
    if (size > 10_000) return [XLSX.utils.encode_cell(range.s)];
    const addresses: string[] = [];
    for (let row = range.s.r; row <= range.e.r; row++)
      for (let column = range.s.c; column <= range.e.c; column++)
        addresses.push(XLSX.utils.encode_cell({ r: row, c: column }));
    return addresses;
  } catch {
    return [];
  }
}

function parseHyperlinks(
  worksheetXml: string,
  sheetRels: ReturnType<typeof relationships>,
): WorkbookCellHyperlink[] {
  const hyperlinks: WorkbookCellHyperlink[] = [];
  for (const match of worksheetXml.matchAll(/<hyperlink\b[^>]*\/?\s*>/gi)) {
    const address = attr(match[0], "ref");
    const relationshipId = attr(match[0], "r:id");
    const relationship = relationshipId ? sheetRels.get(relationshipId) : undefined;
    const location = attr(match[0], "location");
    const target = relationship
      ? relationship.external
        ? relationship.rawTarget
        : relationship.target
      : location
        ? `#${decodeXml(location)}`
        : null;
    if (!address || !target) continue;
    const tooltip = attr(match[0], "tooltip");
    hyperlinks.push({
      address,
      target,
      ...(tooltip ? { tooltip: decodeXml(tooltip) } : {}),
    });
  }
  return hyperlinks;
}

function parseDefinedNames(workbookXml: string, sheetNames: string[]): WorkbookDefinedName[] {
  const names: WorkbookDefinedName[] = [];
  for (const match of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/gi)) {
    const attributes = match[1]!;
    const name = decodeXml(attr(attributes, "name") ?? "");
    // Nomes internos do Excel (área de impressão, banco de filtro etc.) não são
    // definições do usuário; ficam de fora do inventário para não virar ruído.
    if (!name || name.startsWith("_xlnm.")) continue;
    const refersTo = decodeXml(match[2]!.trim());
    if (!refersTo) continue;
    const localSheetId = attr(attributes, "localSheetId");
    const scope = localSheetId !== null ? (sheetNames[Number(localSheetId)] ?? null) : null;
    names.push({ name, refersTo, scope });
  }
  return names;
}

function parseExternalLinks(
  workbookXml: string,
  workbookRels: ReturnType<typeof relationships>,
  text: (part: string) => string,
): WorkbookExternalLink[] {
  const links: WorkbookExternalLink[] = [];
  for (const match of workbookXml.matchAll(/<externalReference\b[^>]*\/?\s*>/gi)) {
    const relationshipId = attr(match[0], "r:id");
    const relationship = relationshipId ? workbookRels.get(relationshipId) : undefined;
    if (!relationship) continue;
    const parts = relationship.target.split("/");
    const file = parts.pop();
    const dir = parts.join("/");
    if (!file) continue;
    const linkRels = relationships(text(`${dir}/_rels/${file}.rels`), dir);
    const linkTarget = [...linkRels.values()][0];
    if (linkTarget)
      links.push({ target: linkTarget.external ? linkTarget.rawTarget : linkTarget.target });
  }
  return links;
}

function parseDataValidations(worksheetXml: string): DataValidationDiagnostic[] {
  const validations: DataValidationDiagnostic[] = [];
  for (const match of worksheetXml.matchAll(
    /<dataValidation\b([^>]*)\/>|<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/gi,
  )) {
    const attributes = match[1] ?? match[2] ?? "";
    const body = match[3] ?? "";
    const range = attr(attributes, "sqref");
    if (!range) continue;
    const type = attr(attributes, "type") ?? "none";
    const allowBlank = attr(attributes, "allowBlank") === "1";
    const formula1 = body.match(/<formula1>([\s\S]*?)<\/formula1>/i)?.[1];
    const formula2 = body.match(/<formula2>([\s\S]*?)<\/formula2>/i)?.[1];
    const promptTitle = attr(attributes, "promptTitle");
    const prompt = attr(attributes, "prompt");
    const errorTitle = attr(attributes, "errorTitle");
    const error = attr(attributes, "error");
    validations.push({
      range,
      type,
      allowBlank,
      ...(formula1 ? { formula1: decodeXml(formula1) } : {}),
      ...(formula2 ? { formula2: decodeXml(formula2) } : {}),
      ...(promptTitle ? { promptTitle: decodeXml(promptTitle) } : {}),
      ...(prompt ? { prompt: decodeXml(prompt) } : {}),
      ...(errorTitle ? { errorTitle: decodeXml(errorTitle) } : {}),
      ...(error ? { error: decodeXml(error) } : {}),
    });
  }
  return validations;
}

const IMAGE_FORMATS_BY_EXTENSION: Record<string, string> = {
  png: "PNG",
  jpg: "JPEG",
  jpeg: "JPEG",
  gif: "GIF",
  bmp: "BMP",
  emf: "EMF",
  wmf: "WMF",
  tif: "TIFF",
  tiff: "TIFF",
};

function parseImages(
  worksheetXml: string,
  sheetRels: ReturnType<typeof relationships>,
  text: (part: string) => string,
): WorkbookImageDiagnostic[] {
  const drawingRelId = attr(worksheetXml.match(/<drawing\b[^>]*\/?\s*>/i)?.[0] ?? "", "r:id");
  const drawingRelationship = drawingRelId ? sheetRels.get(drawingRelId) : undefined;
  if (!drawingRelationship) return [];
  const drawingXml = text(drawingRelationship.target);
  const parts = drawingRelationship.target.split("/");
  const file = parts.pop();
  const dir = parts.join("/");
  if (!file) return [];
  const drawingRels = relationships(text(`${dir}/_rels/${file}.rels`), dir);

  const images: WorkbookImageDiagnostic[] = [];
  for (const match of drawingXml.matchAll(
    /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/gi,
  )) {
    const body = match[1]!;
    const picBody = body.match(/<xdr:pic\b[^>]*>([\s\S]*?)<\/xdr:pic>/i)?.[1];
    if (!picBody) continue;
    const name = decodeXml(attr(picBody, "name") ?? "Imagem");
    const embedId = attr(picBody, "r:embed");
    const relationship = embedId ? drawingRels.get(embedId) : undefined;
    const extension = relationship?.target.split(".").pop()?.toLowerCase();
    const format = (extension && IMAGE_FORMATS_BY_EXTENSION[extension]) || "desconhecido";
    const fromBody = body.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/i)?.[1] ?? "";
    const col = fromBody.match(/<xdr:col>(\d+)<\/xdr:col>/i)?.[1];
    const row = fromBody.match(/<xdr:row>(\d+)<\/xdr:row>/i)?.[1];
    const anchor =
      col !== undefined && row !== undefined
        ? XLSX.utils.encode_cell({ r: Number(row), c: Number(col) })
        : null;
    images.push({ name, anchor, format });
  }
  return images;
}

function parseTable(xml: string): StructuredTableDiagnostic {
  const root = xml.match(/<table\b[^>]*>/i)?.[0] ?? "";
  const columns: string[] = [];
  const calculatedColumns: string[] = [];
  for (const match of xml.matchAll(
    /<tableColumn\b([^>]*)\/>|<tableColumn\b([^>]*)>([\s\S]*?)<\/tableColumn>/gi,
  )) {
    const attributes = match[1] ?? match[2] ?? "";
    const body = match[3] ?? "";
    const name = decodeXml(attr(attributes, "name") ?? "Coluna");
    columns.push(name);
    if (/<calculatedColumnFormula\b/i.test(body)) calculatedColumns.push(name);
  }
  return {
    name: decodeXml(attr(root, "displayName") ?? attr(root, "name") ?? "Tabela"),
    range: attr(root, "ref"),
    columns,
    calculatedColumns,
  };
}

function parsePivot(xml: string): PivotTableDiagnostic {
  const root = xml.match(/<pivotTableDefinition\b[^>]*>/i)?.[0] ?? "";
  const location = xml.match(/<location\b[^>]*>/i)?.[0] ?? "";
  return {
    name: decodeXml(attr(root, "name") ?? "Tabela dinâmica"),
    range: attr(location, "ref"),
  };
}

export function inspectWorkbookFeatures(data: ArrayBuffer | Uint8Array | OoxmlArchive) {
  const zip = isOoxmlArchive(data) ? data : unzipOoxmlArchive(data);
  const text = (part: string) => (zip[part] ? strFromU8(zip[part]!) : "");
  const workbookXml = text("xl/workbook.xml");
  const workbookRels = relationships(text("xl/_rels/workbook.xml.rels"), "xl");
  const result = new Map<string, AdvancedSheetMetadata>();
  const sheetNames = [...workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/gi)].map((match) =>
    decodeXml(attr(match[0], "name") ?? ""),
  );
  const definedNames = parseDefinedNames(workbookXml, sheetNames);
  const externalLinks = parseExternalLinks(workbookXml, workbookRels, text);
  const hasVbaMacros = Boolean(zip["xl/vbaProject.bin"]);

  for (const sheet of workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/gi)) {
    const name = attr(sheet[0], "name");
    const relationshipId = attr(sheet[0], "r:id");
    const worksheetPart = relationshipId ? workbookRels.get(relationshipId)?.target : null;
    if (!name || !worksheetPart) continue;
    const file = worksheetPart.split("/").pop();
    const worksheetRelsPart = `xl/worksheets/_rels/${file}.rels`;
    const sheetRels = relationships(text(worksheetRelsPart), "xl/worksheets");
    const worksheetXml = text(worksheetPart);
    const structuredTables: StructuredTableDiagnostic[] = [];
    const pivotTables: PivotTableDiagnostic[] = [];
    const autoFilterRange = attr(
      worksheetXml.match(/<autoFilter\b[^>]*\/?\s*>/i)?.[0] ?? "",
      "ref",
    );
    const hyperlinks = parseHyperlinks(worksheetXml, sheetRels);
    const dataValidations = parseDataValidations(worksheetXml);
    const images = parseImages(worksheetXml, sheetRels, text);
    const commentsRelationship = [...sheetRels.values()].find((relationship) =>
      relationship.type.toLowerCase().endsWith("/comments"),
    );
    const comments = commentsRelationship ? parseComments(text(commentsRelationship.target)) : [];

    for (const tablePart of worksheetXml.matchAll(
      /<tablePart\b[^>]*r:id="([^"]+)"[^>]*\/?\s*>/gi,
    )) {
      const relationship = sheetRels.get(tablePart[1]!);
      if (relationship) structuredTables.push(parseTable(text(relationship.target)));
    }
    for (const pivotPart of worksheetXml.matchAll(
      /<pivotTableDefinition\b[^>]*r:id="([^"]+)"[^>]*\/?\s*>/gi,
    )) {
      const relationship = sheetRels.get(pivotPart[1]!);
      if (relationship) pivotTables.push(parsePivot(text(relationship.target)));
    }
    const sheetName = decodeXml(name);
    result.set(sheetName, {
      structuredTables,
      pivotTables,
      autoFilterRange,
      comments,
      hyperlinks,
      definedNames: definedNames.filter((d) => d.scope === null || d.scope === sheetName),
      externalLinks,
      dataValidations,
      hasVbaMacros,
      images,
    });
  }
  return result;
}

export function attachWorkbookFeatures(
  wb: XLSX.WorkBook,
  data: ArrayBuffer | Uint8Array | OoxmlArchive,
) {
  try {
    const metadata = inspectWorkbookFeatures(data);
    for (const [sheetName, advanced] of metadata) {
      const worksheet = wb.Sheets[sheetName] as WorksheetWithAdvancedMetadata | undefined;
      if (!worksheet) continue;
      worksheet["!oliAdvanced"] = advanced;
      if (advanced.autoFilterRange) worksheet["!autofilter"] = { ref: advanced.autoFilterRange };
      for (const comment of advanced.comments) {
        const cell =
          worksheetCellAtAddress(worksheet, comment.address) ?? ({ t: "z" } as XLSX.CellObject);
        cell.c = [{ ...(comment.author ? { a: comment.author } : {}), t: comment.text }];
        setWorksheetCellAtAddress(worksheet, comment.address, cell);
      }
      for (const hyperlink of advanced.hyperlinks) {
        for (const address of cellAddresses(hyperlink.address)) {
          const cell =
            worksheetCellAtAddress(worksheet, address) ?? ({ t: "z" } as XLSX.CellObject);
          cell.l = {
            Target: hyperlink.target,
            ...(hyperlink.tooltip ? { Tooltip: hyperlink.tooltip } : {}),
          };
          setWorksheetCellAtAddress(worksheet, address, cell);
        }
      }
    }
  } catch {
    // Metadados avançados são complementares: um pacote incomum ou protegido
    // nunca deve impedir o parser principal de importar os valores da planilha.
  }
  return wb;
}
