import { strFromU8, unzipSync } from "fflate";
import type * as XLSX from "xlsx";

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
  const result = new Map<string, { target: string; type: string }>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/gi)) {
    const id = attr(match[0], "Id");
    const target = attr(match[0], "Target");
    if (!id || !target) continue;
    result.set(id, {
      target: normalizePart(base, target),
      type: attr(match[0], "Type") ?? "",
    });
  }
  return result;
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
    result.set(decodeXml(name), { structuredTables, pivotTables });
  }
  return result;
}

export function attachWorkbookFeatures(wb: XLSX.WorkBook, data: ArrayBuffer | Uint8Array) {
  try {
    const metadata = inspectWorkbookFeatures(data);
    for (const [sheetName, advanced] of metadata) {
      const worksheet = wb.Sheets[sheetName] as WorksheetWithAdvancedMetadata | undefined;
      if (worksheet) worksheet["!oliAdvanced"] = advanced;
    }
  } catch {
    // Metadados avançados são complementares: um pacote incomum ou protegido
    // nunca deve impedir o parser principal de importar os valores da planilha.
  }
  return wb;
}
