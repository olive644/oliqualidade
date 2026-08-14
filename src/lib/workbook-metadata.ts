import { strFromU8, unzipSync } from "fflate";
import * as XLSX from "xlsx";
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

export function inspectWorkbookFeatures(data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const zip = unzipSync(bytes);
  const text = (part: string) => (zip[part] ? strFromU8(zip[part]!) : "");
  const workbookXml = text("xl/workbook.xml");
  const workbookRels = relationships(text("xl/_rels/workbook.xml.rels"), "xl");
  const result = new Map<string, AdvancedSheetMetadata>();

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
    result.set(decodeXml(name), {
      structuredTables,
      pivotTables,
      autoFilterRange,
      comments,
      hyperlinks,
    });
  }
  return result;
}

export function attachWorkbookFeatures(wb: XLSX.WorkBook, data: ArrayBuffer | Uint8Array) {
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
