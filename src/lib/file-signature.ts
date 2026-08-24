/**
 * Reconhece o formato real de um arquivo pelos primeiros bytes.
 *
 * Até aqui a importação confiava na extensão. Isso falha nos dois sentidos, e
 * os dois acontecem com arquivo real:
 *
 * - um `.xlsx` que na verdade é um `.xls` antigo renomeado, ou um PDF salvo
 *   com o nome errado, estourava dentro do parser com mensagem obscura;
 * - sistemas corporativos exportam tabela HTML com nome `.xls`, e planilhas
 *   salvas como CSV recebem `.xlsx` — arquivos que o leitor **consegue** ler,
 *   desde que saiba o que são.
 *
 * Por isso a função não é um porteiro que recusa pela extensão: ela diz o que
 * o arquivo é de fato, para a leitura usar o formato certo e para a recusa
 * acontecer só quando o conteúdo não é planilha nenhuma.
 */
export type FileContainer = "zip" | "ole2" | "text" | "unknown";

export type FileSignature = {
  container: FileContainer;
  /** Formato reconhecido que não é planilha, quando dá para nomear. */
  foreignFormat?: string;
};

const STARTS_WITH = (bytes: Uint8Array, prefix: number[]): boolean =>
  prefix.every((byte, index) => bytes[index] === byte);

/** Formatos que não são planilha mas chegam renomeados com frequência. */
const FOREIGN_SIGNATURES: { prefix: number[]; label: string }[] = [
  { prefix: [0x25, 0x50, 0x44, 0x46], label: "PDF" },
  { prefix: [0x89, 0x50, 0x4e, 0x47], label: "imagem PNG" },
  { prefix: [0xff, 0xd8, 0xff], label: "imagem JPEG" },
  { prefix: [0x47, 0x49, 0x46, 0x38], label: "imagem GIF" },
  { prefix: [0x52, 0x61, 0x72, 0x21], label: "arquivo RAR" },
  { prefix: [0x37, 0x7a, 0xbc, 0xaf], label: "arquivo 7z" },
  { prefix: [0x1f, 0x8b], label: "arquivo GZIP" },
  { prefix: [0x00, 0x01, 0x00, 0x00], label: "fonte TrueType" },
];

/** ZIP: `PK\x03\x04` no caso normal, mais as variações de vazio e dividido. */
const ZIP_PREFIXES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

/** OLE2/CFB: formato dos arquivos do Office anteriores ao XML. */
const OLE2_PREFIX = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function detectFileSignature(bytes: Uint8Array): FileSignature {
  if (bytes.length === 0) return { container: "unknown" };
  if (ZIP_PREFIXES.some((prefix) => STARTS_WITH(bytes, prefix))) return { container: "zip" };
  if (STARTS_WITH(bytes, OLE2_PREFIX)) return { container: "ole2" };

  for (const { prefix, label } of FOREIGN_SIGNATURES)
    if (STARTS_WITH(bytes, prefix)) return { container: "unknown", foreignFormat: label };

  return looksLikeText(bytes) ? { container: "text" } : { container: "unknown" };
}

/**
 * Decide se o conteúdo é texto olhando uma amostra do começo.
 *
 * Byte zero e densidade alta de bytes de controle são o que separa texto de
 * binário na prática. A amostra evita percorrer um arquivo de 50 MB só para
 * responder isso, e o limite de 5% tolera o caractere de controle solto que
 * aparece em exportação de sistema legado.
 */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13;
    if (byte < 32 && !isAllowedControl) control++;
  }
  return control / sample.length < 0.05;
}

const FOREIGN_PREFIX = "Este arquivo é um ";
const UNRECOGNIZED_MESSAGE =
  "Não foi possível reconhecer este arquivo como planilha. Ele pode estar corrompido ou ser de um formato não suportado.";

const foreignFormatMessage = (label: string) =>
  `${FOREIGN_PREFIX}${label}, não uma planilha. Confira se o arquivo enviado é o correto.`;

/**
 * Reconhece uma recusa por conteúdo a partir da mensagem.
 *
 * A leitura acontece em worker, e o que atravessa essa fronteira é só o texto
 * do erro — tipo e propriedades se perdem no caminho. Por isso a identificação
 * é pelo texto, e mora aqui, ao lado de quem o escreve. A tela precisa disso
 * porque a mensagem genérica de falha de leitura ("use um formato válido")
 * substituiria justamente a explicação útil: que o arquivo é um PDF.
 */
export function isWorkbookContentRejection(message: string): boolean {
  return message.startsWith(FOREIGN_PREFIX) || message === UNRECOGNIZED_MESSAGE;
}

export type WorkbookContentCheck =
  | { ok: true; container: Exclude<FileContainer, "unknown">; renamed: boolean }
  | { ok: false; message: string };

const ZIP_EXTENSIONS = /\.(xlsx|xlsm|xlsb|xltx|xltm|ods|numbers)$/i;
const OLE2_EXTENSIONS = /\.(xls|xlt)$/i;

/**
 * Confere o conteúdo contra a extensão e devolve o que a leitura deve usar.
 *
 * Recusa só o que não é planilha de jeito nenhum. Divergência entre extensão
 * e conteúdo não é motivo de recusa: é informação para ler do jeito certo, e
 * `renamed` existe para a revisão da importação poder avisar.
 */
export function checkWorkbookContent(bytes: Uint8Array, fileName: string): WorkbookContentCheck {
  const signature = detectFileSignature(bytes);

  if (signature.foreignFormat)
    return { ok: false, message: foreignFormatMessage(signature.foreignFormat) };
  if (signature.container === "unknown") return { ok: false, message: UNRECOGNIZED_MESSAGE };

  const expectsZip = ZIP_EXTENSIONS.test(fileName);
  const expectsOle2 = OLE2_EXTENSIONS.test(fileName);
  const renamed =
    (expectsZip && signature.container !== "zip") ||
    (expectsOle2 && signature.container !== "ole2");

  return { ok: true, container: signature.container, renamed };
}
