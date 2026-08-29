/**
 * Leitura do diretório central de um ZIP, sem descompactar nada.
 *
 * Um XLSX é um pacote ZIP, e o fim dele traz um índice de tudo o que existe
 * dentro: nome, tamanho compactado, tamanho expandido e onde cada entrada
 * começa. Ler esse índice custa alguns quilobytes, e é o que permite tanto
 * recusar um pacote perigoso antes de tocar nele quanto abrir uma entrada por
 * vez em vez do pacote inteiro.
 *
 * Este módulo é só o formato, e mora separado por isso: ele não sabe se os
 * bytes vieram de um `Uint8Array` completo ou de um `Blob.slice()`. Quem sabe
 * disso é `validateZipWorkbook`, que valida o pacote já em memória, e
 * `zip-blob-reader.ts`, que lê pelo disco. Antes os dois teriam duas cópias das
 * mesmas regras de segurança, e duas cópias são dois lugares onde o critério
 * pode divergir sem ninguém notar.
 */

/** Assinaturas do formato ZIP, em little endian. */
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** Tamanho fixo de cada estrutura, antes dos campos de tamanho variável. */
const EOCD_FIXED_SIZE = 22;
const CENTRAL_HEADER_FIXED_SIZE = 46;
const LOCAL_HEADER_FIXED_SIZE = 30;

/**
 * Maior cauda em que o registro de fim pode estar.
 *
 * São os 22 bytes fixos do registro mais o comentário do pacote, que o formato
 * limita a 65.535 bytes. Procurar mais para trás que isso seria procurar num
 * lugar onde ele não pode estar.
 */
export const ZIP_TAIL_SEARCH_BYTES = 65_557;

export const MAX_ZIP_ENTRIES = 10_000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
export const MAX_ZIP_ENTRY_BYTES = 512 * 1024 * 1024;
export const MAX_SUSPICIOUS_COMPRESSION_RATIO = 1_000;

/**
 * Só entradas acima deste tamanho entram na checagem de razão de compressão.
 *
 * Um arquivo XML pequeno e muito repetitivo comprime absurdamente bem, e
 * condenar o pacote por isso recusaria planilhas legítimas. O risco de bomba de
 * descompactação começa quando o resultado é grande.
 */
const COMPRESSION_RATIO_FLOOR_BYTES = 50 * 1024 * 1024;

export const ZIP_INCOMPLETE_MESSAGE = "O pacote da planilha está incompleto ou corrompido.";
export const ZIP_TOO_MANY_ENTRIES_MESSAGE = "A planilha contém arquivos internos demais.";
export const ZIP_INVALID_DIRECTORY_MESSAGE =
  "O pacote da planilha possui um diretório interno inválido.";
export const ZIP_INVALID_ENTRY_MESSAGE =
  "O pacote da planilha possui uma entrada interna inválida.";
export const ZIP_ENTRY_TOO_LARGE_MESSAGE =
  "Uma parte interna da planilha é grande demais para leitura segura.";
export const ZIP_SUSPICIOUS_RATIO_MESSAGE =
  "A planilha possui uma taxa de compressão potencialmente insegura.";
export const ZIP_TOO_LARGE_EXPANDED_MESSAGE =
  "A planilha ultrapassa o limite seguro após descompactação.";

export type ZipEntry = {
  name: string;
  /** 0 é armazenado sem compressão, 8 é deflate. Nada mais aparece em OOXML. */
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Onde o cabeçalho local da entrada começa, contado do início do arquivo. */
  localHeaderOffset: number;
};

export type ZipCentralDirectory = {
  entries: ZipEntry[];
  totalUncompressedBytes: number;
};

/** Onde o índice do pacote mora, para quem precisa ler só esse pedaço. */
export type ZipDirectoryLocation = {
  offset: number;
  size: number;
  entryCount: number;
};

/**
 * O índice precisa caber no arquivo que diz contê-lo.
 *
 * Um pacote truncado no meio do envio continua tendo um fim de registro válido
 * apontando para um índice que já não existe. Sem esta conferência, a leitura
 * seguiria sobre bytes que não são o que ele diz que são.
 */
export function assertZipDirectoryFits(location: ZipDirectoryLocation, totalBytes: number): void {
  if (location.offset + location.size > totalBytes) throw new Error(ZIP_INVALID_DIRECTORY_MESSAGE);
}

const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * Localiza o registro de fim dentro da cauda do arquivo.
 *
 * `tailStart` diz de onde a cauda foi recortada, para os deslocamentos
 * devolvidos serem contados do início do arquivo e não do pedaço. A busca é de
 * trás para frente porque o registro fica no fim, e um comentário do pacote
 * pode conter a mesma assinatura por acaso: a última ocorrência é a verdadeira.
 */
export function locateZipDirectory(tail: Uint8Array, tailStart = 0): ZipDirectoryLocation {
  const view = viewOf(tail);
  let eocd = -1;
  for (let offset = tail.length - EOCD_FIXED_SIZE; offset >= 0; offset -= 1)
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      eocd = offset;
      break;
    }
  if (eocd < 0) throw new Error(ZIP_INCOMPLETE_MESSAGE);

  const entryCount = view.getUint16(eocd + 10, true);
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error(ZIP_TOO_MANY_ENTRIES_MESSAGE);

  return {
    offset: view.getUint32(eocd + 16, true),
    size: view.getUint32(eocd + 12, true),
    entryCount,
  };
}

/**
 * Percorre o índice e devolve o que existe dentro do pacote.
 *
 * `directory` são os bytes do índice, e nada além dele: é o pedaço que
 * `locateZipDirectory` apontou. Aplicar aqui os limites de tamanho e de razão
 * de compressão é o que permite recusar uma bomba de descompactação antes de
 * expandir o primeiro byte.
 */
export function readZipCentralDirectory(
  directory: Uint8Array,
  entryCount: number,
): ZipCentralDirectory {
  const view = viewOf(directory);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const entries: ZipEntry[] = [];
  let offset = 0;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + CENTRAL_HEADER_FIXED_SIZE > directory.length ||
      view.getUint32(offset, true) !== CENTRAL_FILE_HEADER
    )
      throw new Error(ZIP_INVALID_ENTRY_MESSAGE);

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw new Error(ZIP_ENTRY_TOO_LARGE_MESSAGE);
    if (
      uncompressedSize > COMPRESSION_RATIO_FLOOR_BYTES &&
      uncompressedSize / Math.max(1, compressedSize) > MAX_SUSPICIOUS_COMPRESSION_RATIO
    )
      throw new Error(ZIP_SUSPICIOUS_RATIO_MESSAGE);

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES)
      throw new Error(ZIP_TOO_LARGE_EXPANDED_MESSAGE);

    const nameStart = offset + CENTRAL_HEADER_FIXED_SIZE;
    entries.push({
      name: decoder.decode(directory.subarray(nameStart, nameStart + nameLength)),
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += CENTRAL_HEADER_FIXED_SIZE + nameLength + extraLength + commentLength;
  }

  return { entries, totalUncompressedBytes };
}

/**
 * Onde os bytes compactados de uma entrada realmente começam.
 *
 * O índice aponta para o cabeçalho local, não para o conteúdo, e o cabeçalho
 * local tem nome e campo extra de tamanho próprio, que **não** precisam
 * coincidir com os do índice. Confiar nos tamanhos do índice aqui é o erro
 * clássico de quem lê ZIP à mão, e produz bytes deslocados em alguns pacotes.
 */
export function locateZipEntryData(
  localHeader: Uint8Array,
  entry: ZipEntry,
): { offset: number; length: number } {
  const view = viewOf(localHeader);
  if (localHeader.length < LOCAL_HEADER_FIXED_SIZE || view.getUint32(0, true) !== LOCAL_FILE_HEADER)
    throw new Error(ZIP_INVALID_ENTRY_MESSAGE);

  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  return {
    offset: entry.localHeaderOffset + LOCAL_HEADER_FIXED_SIZE + nameLength + extraLength,
    length: entry.compressedSize,
  };
}

/**
 * Quantos bytes do cabeçalho local basta ler para saber onde o conteúdo começa.
 *
 * Exatamente a parte fixa. Os tamanhos do nome e do campo extra moram dentro
 * dela, então ler o nome em si seria ler bytes que ninguém vai olhar. Isso
 * importa: são duas leituras por entrada, e a primeira precisa ser barata.
 */
export const ZIP_LOCAL_HEADER_FIXED_BYTES = LOCAL_HEADER_FIXED_SIZE;
