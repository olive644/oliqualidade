import { strFromU8 } from "fflate";
import * as XLSX from "xlsx";
import { isOoxmlArchive, unzipOoxmlArchive, type OoxmlArchive } from "@/lib/ooxml-archive";
import { setWorksheetCellAtAddress, worksheetCellAtAddress } from "@/lib/worksheet-cell";
import { stripXmlMarkup } from "@/lib/xml-text";

export type StructuredTableDiagnostic = {
  name: string;
  range: string | null;
  columns: string[];
  calculatedColumns: string[];
  /**
   * Quantas linhas do fim do intervalo são a linha de totais da tabela do
   * Excel (`totalsRowCount`). É quase sempre 0 ou 1, e é a informação que
   * distingue "R$ 2.060 é o total de Moradia" de "R$ 2.060 é mais uma
   * despesa de Moradia" — sem ela, somar a coluna conta cada bloco duas
   * vezes.
   */
  totalsRowCount: number;
  /** Quantas linhas do começo do intervalo são cabeçalho (`headerRowCount`). */
  headerRowCount: number;
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
  /** Imagens embutidas (fotos/logos coladas na planilha). */
  images: WorkbookImageDiagnostic[];
  /** Formas nativas do Excel (retângulos, caixas de texto etc.) com texto. Conectores sem texto não entram. */
  shapes: WorkbookShapeDiagnostic[];
  /** Gráficos nativos do Excel (não os que o app gera a partir dos dados importados). */
  charts: WorkbookChartDiagnostic[];
  /** Cor de preenchimento sólido por célula, resolvida por RGB direto ou tema do workbook. */
  cellFills: WorkbookCellFillDiagnostic[];
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
  /**
   * `data:` URL pronta para `<img src>`, quando o formato é renderizável por
   * navegador (não EMF/WMF) e o arquivo não excede o limite de tamanho.
   * Ausente não significa erro — a imagem continua inventariada acima.
   */
  dataUrl?: string;
};

export type WorkbookShapeDiagnostic = {
  name: string;
  /** Célula de ancoragem (canto superior esquerdo), ou `null` se não for possível determinar. */
  anchor: string | null;
  /** Texto de todos os parágrafos da forma, unidos por quebra de linha. Vazio quando a forma não tem texto. */
  text: string;
};

const CHART_TYPE_TAGS = [
  "bar",
  "line",
  "pie",
  "pie3D",
  "doughnut",
  "area",
  "scatter",
  "radar",
  "bubble",
  "stock",
  "surface",
  "ofPie",
] as const;

export type WorkbookChartDiagnostic = {
  /** Tipo OOXML bruto (bar, line, pie, scatter etc.), ou "desconhecido" se nenhuma tag reconhecida for encontrada. */
  type: string;
  /** Título do gráfico, quando presente e não vinculado a uma referência de célula. */
  title: string | null;
  /** Célula de ancoragem (canto superior esquerdo), ou `null` se não for possível determinar. */
  anchor: string | null;
};

export type WorkbookCellFillDiagnostic = {
  address: string;
  /** Cor em `#RRGGBB`, resolvida do RGB direto ou do tema do workbook. */
  color: string;
};

export type AdvancedMetadataRangeRemapMode = "contained" | "intersection";
export type AdvancedMetadataRangeRemapper = (
  range: string,
  mode: AdvancedMetadataRangeRemapMode,
) => string | null;

export type WorksheetWithAdvancedMetadata = XLSX.WorkSheet & {
  "!oliAdvanced"?: AdvancedSheetMetadata;
};

const attr = (xml: string, name: string) =>
  xml.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? null;

// Alguns geradores de OOXML (fora do Excel/openpyxl/exceljs) vinculam a
// namespace principal do spreadsheetML (workbook/worksheet/styles) a um
// prefixo explícito (`<x:dataValidation>`) em vez do namespace padrão sem
// prefixo que o Excel sempre usa — os dois são XML igualmente válido pelo
// mesmo schema, só a serialização difere. Toda regra deste arquivo que casa
// um elemento dessa namespace precisa tolerar um prefixo opcional, senão o
// inventário inteiro (hyperlinks, validações, cores, comentários, tabelas)
// fica vazio silenciosamente nesses arquivos, sem nenhum erro. Não se aplica
// às namespaces de desenho/gráfico (`xdr:`/`a:`/`c:`), que já são sempre
// prefixadas por convenção mesmo em arquivos gerados pelo Excel.
const NS = "(?:[A-Za-z_][\\w.-]*:)?";

/**
 * Decodifica entidades XML. Ver o contrato em `xml-text.ts`: o retorno é
 * texto puro, e pode conter `<` e `>` quando o arquivo os continha escapados.
 */
const decodeXml = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

function normalizePart(base: string, target: string): string {
  // Um Target de relacionamento OPC pode ser relativo à pasta da parte de
  // origem (`worksheets/sheet1.xml`) OU absoluto a partir da raiz do pacote
  // (`/xl/worksheets/sheet1.xml`) — os dois são válidos pelo mesmo padrão
  // OPC/OOXML. Combinar um Target absoluto com `base` produzia um caminho
  // inexistente no ZIP (ex: `xl/xl/worksheets/sheet1.xml`), fazendo a parte
  // resolver para XML vazio sem nenhum erro.
  const combined = target.startsWith("/") ? target : `${base}/${target}`;
  const parts = combined.replaceAll("\\", "/").split("/");
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
  const authors = [
    ...xml.matchAll(new RegExp(`<${NS}author(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${NS}author>`, "gi")),
  ].map((match) => decodeXml(stripXmlMarkup(match[1]!)));
  const comments: WorkbookCellComment[] = [];
  for (const match of xml.matchAll(
    new RegExp(`<${NS}comment\\b([^>]*)>([\\s\\S]*?)<\\/${NS}comment>`, "gi"),
  )) {
    const address = attr(match[1]!, "ref");
    if (!address) continue;
    const text = [
      ...match[2]!.matchAll(new RegExp(`<${NS}t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${NS}t>`, "gi")),
    ]
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
  for (const match of worksheetXml.matchAll(new RegExp(`<${NS}hyperlink\\b[^>]*\\/?\\s*>`, "gi"))) {
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
  for (const match of workbookXml.matchAll(
    new RegExp(`<${NS}definedName\\b([^>]*)>([\\s\\S]*?)<\\/${NS}definedName>`, "gi"),
  )) {
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
  for (const match of workbookXml.matchAll(
    new RegExp(`<${NS}externalReference\\b[^>]*\\/?\\s*>`, "gi"),
  )) {
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
    new RegExp(
      `<${NS}dataValidation\\b([^>]*)\\/>|<${NS}dataValidation\\b([^>]*)>([\\s\\S]*?)<\\/${NS}dataValidation>`,
      "gi",
    ),
  )) {
    const attributes = match[1] ?? match[2] ?? "";
    const body = match[3] ?? "";
    const range = attr(attributes, "sqref");
    if (!range) continue;
    const type = attr(attributes, "type") ?? "none";
    const allowBlank = attr(attributes, "allowBlank") === "1";
    const formula1 = body.match(
      new RegExp(`<${NS}formula1>([\\s\\S]*?)<\\/${NS}formula1>`, "i"),
    )?.[1];
    const formula2 = body.match(
      new RegExp(`<${NS}formula2>([\\s\\S]*?)<\\/${NS}formula2>`, "i"),
    )?.[1];
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

// Só os formatos que um <img> de navegador consegue exibir diretamente.
// EMF/WMF (metarquivo do Windows) são detectados e nomeados, mas nunca
// viram dataUrl — não há como renderizá-los sem uma biblioteca nova.
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

// Protege o IndexedDB de imagens gigantes coladas na planilha (fotos em
// resolução de câmera etc.): acima disso, a imagem continua inventariada
// (nome/posição/formato) mas sem prévia visual embutida no painel.
const MAX_IMAGE_DATA_URL_BYTES = 4 * 1024 * 1024;

function bytesToDataUrl(bytes: Uint8Array, mime: string): string | undefined {
  if (bytes.length > MAX_IMAGE_DATA_URL_BYTES) return undefined;
  let binary = "";
  // Em blocos para não estourar o limite de argumentos de
  // String.fromCharCode com imagens maiores.
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function anchorOf(anchorBody: string): string | null {
  const fromBody = anchorBody.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/i)?.[1] ?? "";
  const col = fromBody.match(/<xdr:col>(\d+)<\/xdr:col>/i)?.[1];
  const row = fromBody.match(/<xdr:row>(\d+)<\/xdr:row>/i)?.[1];
  return col !== undefined && row !== undefined
    ? XLSX.utils.encode_cell({ r: Number(row), c: Number(col) })
    : null;
}

function parseImages(
  worksheetXml: string,
  sheetRels: ReturnType<typeof relationships>,
  text: (part: string) => string,
  bytesOf: (part: string) => Uint8Array | undefined,
): WorkbookImageDiagnostic[] {
  const drawingRelId = attr(
    worksheetXml.match(new RegExp(`<${NS}drawing\\b[^>]*\\/?\\s*>`, "i"))?.[0] ?? "",
    "r:id",
  );
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
    const mime = extension && IMAGE_MIME_BY_EXTENSION[extension];
    const mediaBytes = relationship ? bytesOf(relationship.target) : undefined;
    const dataUrl = mediaBytes && mime ? bytesToDataUrl(mediaBytes, mime) : undefined;
    images.push({ name, anchor: anchorOf(body), format, ...(dataUrl ? { dataUrl } : {}) });
  }
  return images;
}

function shapeText(spBody: string): string {
  const txBody = spBody.match(/<xdr:txBody\b[^>]*>([\s\S]*?)<\/xdr:txBody>/i)?.[1] ?? "";
  return [...txBody.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi)]
    .map((paragraph) =>
      [...paragraph[1]!.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi)]
        .map((run) => decodeXml(run[1]!))
        .join(""),
    )
    .join("\n")
    .trim();
}

// Só formas com texto entram no inventário — conectores e formas puramente
// decorativas (`xdr:cxnSp`, retângulos sem `xdr:txBody`) não carregam
// informação própria para o usuário revisar.
function parseShapes(
  worksheetXml: string,
  sheetRels: ReturnType<typeof relationships>,
  text: (part: string) => string,
): WorkbookShapeDiagnostic[] {
  const drawingRelId = attr(
    worksheetXml.match(new RegExp(`<${NS}drawing\\b[^>]*\\/?\\s*>`, "i"))?.[0] ?? "",
    "r:id",
  );
  const drawingRelationship = drawingRelId ? sheetRels.get(drawingRelId) : undefined;
  if (!drawingRelationship) return [];
  const drawingXml = text(drawingRelationship.target);

  const shapes: WorkbookShapeDiagnostic[] = [];
  for (const match of drawingXml.matchAll(
    /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/gi,
  )) {
    const body = match[1]!;
    const spBody = body.match(/<xdr:sp\b[^>]*>([\s\S]*?)<\/xdr:sp>/i)?.[1];
    if (!spBody) continue;
    const shapeTextValue = shapeText(spBody);
    if (!shapeTextValue) continue;
    const name = decodeXml(attr(spBody, "name") ?? "Forma");
    shapes.push({ name, anchor: anchorOf(body), text: shapeTextValue });
  }
  return shapes;
}

function chartType(chartXml: string): string {
  const plotArea = chartXml.match(/<c:plotArea\b[^>]*>([\s\S]*?)<\/c:plotArea>/i)?.[1] ?? chartXml;
  for (const tag of CHART_TYPE_TAGS) {
    if (new RegExp(`<c:${tag}Chart\\b`, "i").test(plotArea)) return tag;
  }
  return "desconhecido";
}

function chartTitle(chartXml: string): string | null {
  // `<c:autoTitleDeleted val="1"/>` ou título vinculado a uma referência de
  // célula (`<c:tx><c:strRef>`) não têm texto literal fixo para mostrar.
  const titleBody = chartXml.match(/<c:title\b[^>]*>([\s\S]*?)<\/c:title>/i)?.[1];
  if (!titleBody || /<c:strRef>/i.test(titleBody)) return null;
  const runs = [...titleBody.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi)].map((run) => decodeXml(run[1]!));
  const joined = runs.join("").trim();
  return joined || null;
}

function parseCharts(
  worksheetXml: string,
  sheetRels: ReturnType<typeof relationships>,
  text: (part: string) => string,
): WorkbookChartDiagnostic[] {
  const drawingRelId = attr(
    worksheetXml.match(new RegExp(`<${NS}drawing\\b[^>]*\\/?\\s*>`, "i"))?.[0] ?? "",
    "r:id",
  );
  const drawingRelationship = drawingRelId ? sheetRels.get(drawingRelId) : undefined;
  if (!drawingRelationship) return [];
  const drawingXml = text(drawingRelationship.target);
  const parts = drawingRelationship.target.split("/");
  const file = parts.pop();
  const dir = parts.join("/");
  if (!file) return [];
  const drawingRels = relationships(text(`${dir}/_rels/${file}.rels`), dir);

  const charts: WorkbookChartDiagnostic[] = [];
  for (const match of drawingXml.matchAll(
    /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/gi,
  )) {
    const body = match[1]!;
    const frameBody = body.match(/<xdr:graphicFrame\b[^>]*>([\s\S]*?)<\/xdr:graphicFrame>/i)?.[1];
    if (!frameBody) continue;
    const chartRef = frameBody.match(/<c:chart\b[^>]*\/?\s*>/i)?.[0];
    const relationshipId = chartRef ? attr(chartRef, "r:id") : null;
    const relationship = relationshipId ? drawingRels.get(relationshipId) : undefined;
    if (!relationship) continue;
    const chartXml = text(relationship.target);
    if (!chartXml) continue;
    charts.push({ type: chartType(chartXml), title: chartTitle(chartXml), anchor: anchorOf(body) });
  }
  return charts;
}

// Ordem do atributo `theme="N"` em styles.xml — NÃO é a ordem de documento
// de <a:clrScheme> (que é dk1, lt1, dk2, lt2, ...). O Excel troca dk1/lt1 e
// dk2/lt2 de posição só para esse índice: 0=lt1, 1=dk1, 2=lt2, 3=dk2,
// 4-9=accent1-6, 10=hlink, 11=folHlink. Indexar com a ordem do documento
// inverteria branco e preto (e os dois tons secundários) sempre que uma
// célula usar `theme="0"` ou `theme="1"`.
const THEME_COLOR_ORDER = [
  "lt1",
  "dk1",
  "lt2",
  "dk2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
] as const;

function parseThemeColors(themeXml: string): (string | undefined)[] {
  const scheme = themeXml.match(/<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/i)?.[1] ?? "";
  return THEME_COLOR_ORDER.map((name) => {
    const body = scheme.match(
      new RegExp(`<a:${name}\\b[^>]*>([\\s\\S]*?)<\\/a:${name}>`, "i"),
    )?.[1];
    if (!body) return undefined;
    const srgb = body.match(/<a:srgbClr\b[^>]*\bval="([0-9a-fA-F]{6})"/i)?.[1];
    const system = body.match(/<a:sysClr\b[^>]*\blastClr="([0-9a-fA-F]{6})"/i)?.[1];
    return (srgb ?? system)?.toUpperCase();
  });
}

function tintColor(rgb: string, tint: number): string {
  const boundedTint = Math.max(-1, Math.min(1, tint));
  const channel = (offset: number) => {
    const value = Number.parseInt(rgb.slice(offset, offset + 2), 16);
    const adjusted =
      boundedTint < 0 ? value * (1 + boundedTint) : value * (1 - boundedTint) + 255 * boundedTint;
    return Math.round(Math.max(0, Math.min(255, adjusted)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  };
  return `${channel(0)}${channel(2)}${channel(4)}`;
}

// Resolve o canal RGB direto e as cores do tema do workbook. A paleta
// indexada legada continua fora porque depende de uma tabela histórica fixa;
// quando ela aparece, a cor fica ausente em vez de ser inferida incorretamente.
function parseFillRgbByFillId(
  stylesXml: string,
  themeColors: (string | undefined)[],
): (string | undefined)[] {
  const fillsBody =
    stylesXml.match(new RegExp(`<${NS}fills\\b[^>]*>([\\s\\S]*?)<\\/${NS}fills>`, "i"))?.[1] ?? "";
  return [...fillsBody.matchAll(new RegExp(`<${NS}fill>([\\s\\S]*?)<\\/${NS}fill>`, "gi"))].map(
    (match) => {
      const pattern =
        match[1]!.match(
          new RegExp(`<${NS}patternFill\\b[^>]*>([\\s\\S]*?)<\\/${NS}patternFill>`, "i"),
        )?.[1] ?? "";
      if (!/patternType="solid"/.test(match[1]!)) return undefined;
      const fgColor = pattern.match(new RegExp(`<${NS}fgColor\\b[^>]*\\/?\\s*>`, "i"))?.[0] ?? "";
      const argb = attr(fgColor, "rgb");
      if (argb && /^[0-9a-fA-F]{8}$/.test(argb)) return `#${argb.slice(2).toUpperCase()}`;
      if (argb && /^[0-9a-fA-F]{6}$/.test(argb)) return `#${argb.toUpperCase()}`;
      const themeIndex = attr(fgColor, "theme");
      const themeColor = themeIndex === null ? undefined : themeColors[Number(themeIndex)];
      if (!themeColor) return undefined;
      const tint = Number(attr(fgColor, "tint") ?? 0);
      return `#${tintColor(themeColor, Number.isFinite(tint) ? tint : 0)}`;
    },
  );
}

function parseFillIdByCellXf(stylesXml: string): number[] {
  const xfsBody =
    stylesXml.match(new RegExp(`<${NS}cellXfs\\b[^>]*>([\\s\\S]*?)<\\/${NS}cellXfs>`, "i"))?.[1] ??
    "";
  return [...xfsBody.matchAll(new RegExp(`<${NS}xf\\b[^>]*\\/?\\s*>`, "gi"))].map((match) =>
    Number(attr(match[0], "fillId") ?? 0),
  );
}

/** Protege contra planilhas com milhares de células coloridas de propósito. */
const MAX_CELL_FILLS_PER_SHEET = 2_000;

function parseCellFills(
  worksheetXml: string,
  colorOf: (styleIndex: number) => string | undefined,
): WorkbookCellFillDiagnostic[] {
  const fills: WorkbookCellFillDiagnostic[] = [];
  for (const match of worksheetXml.matchAll(
    new RegExp(`<${NS}c\\b([^>]*)\\/>|<${NS}c\\b([^>]*)>([\\s\\S]*?)<\\/${NS}c>`, "gi"),
  )) {
    if (fills.length >= MAX_CELL_FILLS_PER_SHEET) break;
    const attributes = match[1] ?? match[2] ?? "";
    const address = attr(attributes, "r");
    const styleIndex = attr(attributes, "s");
    if (!address || styleIndex === null) continue;
    const color = colorOf(Number(styleIndex));
    if (color) fills.push({ address, color });
  }
  return fills;
}

function parseTable(xml: string): StructuredTableDiagnostic {
  const root = xml.match(new RegExp(`<${NS}table\\b[^>]*>`, "i"))?.[0] ?? "";
  const columns: string[] = [];
  const calculatedColumns: string[] = [];
  for (const match of xml.matchAll(
    new RegExp(
      `<${NS}tableColumn\\b([^>]*)\\/>|<${NS}tableColumn\\b([^>]*)>([\\s\\S]*?)<\\/${NS}tableColumn>`,
      "gi",
    ),
  )) {
    const attributes = match[1] ?? match[2] ?? "";
    const body = match[3] ?? "";
    const name = decodeXml(attr(attributes, "name") ?? "Coluna");
    columns.push(name);
    if (new RegExp(`<${NS}calculatedColumnFormula\\b`, "i").test(body))
      calculatedColumns.push(name);
  }
  // O Excel omite `headerRowCount` quando é 1 (o caso normal) e omite
  // `totalsRowCount` quando é 0, então ausente não é o mesmo que zero.
  const countAttribute = (name: string, whenMissing: number) => {
    const raw = attr(root, name);
    if (raw === undefined || raw === null || raw === "") return whenMissing;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : whenMissing;
  };
  return {
    name: decodeXml(attr(root, "displayName") ?? attr(root, "name") ?? "Tabela"),
    range: attr(root, "ref"),
    columns,
    calculatedColumns,
    totalsRowCount: countAttribute("totalsRowCount", 0),
    headerRowCount: countAttribute("headerRowCount", 1),
  };
}

function parsePivot(xml: string): PivotTableDiagnostic {
  const root = xml.match(new RegExp(`<${NS}pivotTableDefinition\\b[^>]*>`, "i"))?.[0] ?? "";
  const location = xml.match(new RegExp(`<${NS}location\\b[^>]*>`, "i"))?.[0] ?? "";
  return {
    name: decodeXml(attr(root, "name") ?? "Tabela dinâmica"),
    range: attr(location, "ref"),
  };
}

/**
 * Filtra e remapeia os metadados avançados com âncora em uma célula (`address`
 * ou `anchor`) quando uma aba é dividida em regiões/seções independentes
 * (`independentRegionWorksheet`/`independentSectionWorksheet` em `import.ts`).
 * `remap` decide se um endereço original pertence à região e devolve o
 * endereço já traduzido pras coordenadas do worksheet fatiado; `null` remove
 * o item.
 *
 * Intervalos só são mantidos quando o chamador também fornece `remapRange`,
 * calculado a partir da geometria real do recorte. Tabelas, pivôs e filtros
 * exigem contenção completa. Validações podem ser recortadas para a interseção
 * porque a mesma regra continua válida nas células preservadas.
 */
export function sliceAdvancedMetadata(
  advanced: AdvancedSheetMetadata,
  remap: (address: string) => string | null,
  remapRange?: AdvancedMetadataRangeRemapper,
): AdvancedSheetMetadata {
  const remapSqref = (sqref: string) => {
    if (!remapRange) return null;
    const mapped = sqref
      .trim()
      .split(/\s+/)
      .flatMap((range) => remapRange(range, "intersection")?.split(/\s+/) ?? []);
    return mapped.length ? mapped.join(" ") : null;
  };
  return {
    structuredTables: advanced.structuredTables.flatMap((table) => {
      const range = table.range ? remapRange?.(table.range, "contained") : null;
      return range ? [{ ...table, range }] : [];
    }),
    pivotTables: advanced.pivotTables.flatMap((pivot) => {
      const range = pivot.range ? remapRange?.(pivot.range, "contained") : null;
      return range ? [{ ...pivot, range }] : [];
    }),
    autoFilterRange: advanced.autoFilterRange
      ? (remapRange?.(advanced.autoFilterRange, "contained") ?? null)
      : null,
    dataValidations: advanced.dataValidations.flatMap((validation) => {
      const range = remapSqref(validation.range);
      return range ? [{ ...validation, range }] : [];
    }),
    comments: advanced.comments.flatMap((comment) => {
      const address = remap(comment.address);
      return address ? [{ ...comment, address }] : [];
    }),
    hyperlinks: advanced.hyperlinks.flatMap((link) => {
      const address = remap(link.address);
      return address ? [{ ...link, address }] : [];
    }),
    // Âncora desconhecida (`anchor: null`, raro — só quando `xdr:from` não pôde
    // ser interpretado) não vira "presente em toda região": sem saber a posição
    // real, duplicar em todas as sub-regiões é pior que não mostrar em nenhuma.
    images: advanced.images.flatMap((image) => {
      if (!image.anchor) return [];
      const anchor = remap(image.anchor);
      return anchor ? [{ ...image, anchor }] : [];
    }),
    shapes: advanced.shapes.flatMap((shape) => {
      if (!shape.anchor) return [];
      const anchor = remap(shape.anchor);
      return anchor ? [{ ...shape, anchor }] : [];
    }),
    charts: advanced.charts.flatMap((chart) => {
      if (!chart.anchor) return [];
      const anchor = remap(chart.anchor);
      return anchor ? [{ ...chart, anchor }] : [];
    }),
    cellFills: advanced.cellFills.flatMap((fill) => {
      const address = remap(fill.address);
      return address ? [{ ...fill, address }] : [];
    }),
    definedNames: advanced.definedNames,
    externalLinks: advanced.externalLinks,
    hasVbaMacros: advanced.hasVbaMacros,
  };
}

export function inspectWorkbookFeatures(data: ArrayBuffer | Uint8Array | OoxmlArchive) {
  const zip = isOoxmlArchive(data) ? data : unzipOoxmlArchive(data);
  const text = (part: string) => (zip[part] ? strFromU8(zip[part]!) : "");
  const bytesOf = (part: string) => zip[part];
  const workbookXml = text("xl/workbook.xml");
  const workbookRels = relationships(text("xl/_rels/workbook.xml.rels"), "xl");
  const result = new Map<string, AdvancedSheetMetadata>();
  const sheetTagRe = () => new RegExp(`<${NS}sheet\\b[^>]*\\/?\\s*>`, "gi");
  const sheetNames = [...workbookXml.matchAll(sheetTagRe())].map((match) =>
    decodeXml(attr(match[0], "name") ?? ""),
  );
  const definedNames = parseDefinedNames(workbookXml, sheetNames);
  const externalLinks = parseExternalLinks(workbookXml, workbookRels, text);
  const hasVbaMacros = Boolean(zip["xl/vbaProject.bin"]);
  const stylesXml = text("xl/styles.xml");
  const themeRelationship = [...workbookRels.values()].find((relationship) =>
    relationship.type.toLowerCase().endsWith("/theme"),
  );
  const themeColors = parseThemeColors(text(themeRelationship?.target ?? "xl/theme/theme1.xml"));
  const fillRgbByFillId = parseFillRgbByFillId(stylesXml, themeColors);
  const fillIdByCellXf = parseFillIdByCellXf(stylesXml);
  const colorOf = (styleIndex: number) => {
    const fillId = fillIdByCellXf[styleIndex];
    return fillId === undefined ? undefined : fillRgbByFillId[fillId];
  };

  for (const sheet of workbookXml.matchAll(sheetTagRe())) {
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
      worksheetXml.match(new RegExp(`<${NS}autoFilter\\b[^>]*\\/?\\s*>`, "i"))?.[0] ?? "",
      "ref",
    );
    const hyperlinks = parseHyperlinks(worksheetXml, sheetRels);
    const dataValidations = parseDataValidations(worksheetXml);
    const images = parseImages(worksheetXml, sheetRels, text, bytesOf);
    const shapes = parseShapes(worksheetXml, sheetRels, text);
    const charts = parseCharts(worksheetXml, sheetRels, text);
    const cellFills = parseCellFills(worksheetXml, colorOf);
    const commentsRelationship = [...sheetRels.values()].find((relationship) =>
      relationship.type.toLowerCase().endsWith("/comments"),
    );
    const comments = commentsRelationship ? parseComments(text(commentsRelationship.target)) : [];

    for (const tablePart of worksheetXml.matchAll(
      new RegExp(`<${NS}tablePart\\b[^>]*r:id="([^"]+)"[^>]*\\/?\\s*>`, "gi"),
    )) {
      const relationship = sheetRels.get(tablePart[1]!);
      if (relationship) structuredTables.push(parseTable(text(relationship.target)));
    }
    for (const pivotPart of worksheetXml.matchAll(
      new RegExp(`<${NS}pivotTableDefinition\\b[^>]*r:id="([^"]+)"[^>]*\\/?\\s*>`, "gi"),
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
      shapes,
      charts,
      cellFills,
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
