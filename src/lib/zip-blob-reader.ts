import { inflateSync } from "fflate";
import {
  assertZipDirectoryFits,
  locateZipDirectory,
  locateZipEntryData,
  readZipCentralDirectory,
  ZIP_INVALID_ENTRY_MESSAGE,
  ZIP_LOCAL_HEADER_FIXED_BYTES,
  ZIP_TAIL_SEARCH_BYTES,
  type ZipEntry,
} from "@/lib/zip-directory";

/**
 * Acesso a um pacote OOXML entrada por entrada, direto do arquivo.
 *
 * O caminho atual expande o ZIP inteiro com `unzipSync` e guarda todas as
 * entradas num objeto. Medido no baseline, isso custa cerca de uma vez o
 * tamanho do arquivo, e existe ao mesmo tempo que o arquivo em memória e o
 * workbook do SheetJS.
 *
 * Este leitor abre o índice do pacote lendo alguns quilobytes da cauda e, a
 * partir daí, entrega uma entrada por vez, descompactando só ela. O arquivo
 * nunca entra num `ArrayBuffer` e nenhuma entrada que ninguém pediu é expandida.
 *
 * O que isto **não** resolve, e é importante não confundir: o baseline mostra
 * que o ZIP expandido é a cópia menor, e que a que domina é o workbook do
 * SheetJS, cerca de três vezes e meia o arquivo. Enquanto o workbook continuar
 * sendo materializado, este leitor sozinho não muda o pico da importação. Ele é
 * a peça de que o caminho progressivo de OOXML precisa, e não o caminho.
 */

/** Compressão que o formato permite e que aparece em pacotes do Office. */
const STORED = 0;
const DEFLATE = 8;

export type ZipBlobReader = {
  /** O índice do pacote, na ordem em que o arquivo o declara. */
  entries: readonly ZipEntry[];
  /** Soma dos tamanhos expandidos declarados, sem expandir nada. */
  totalUncompressedBytes: number;
  /** Descompacta uma entrada. Devolve `undefined` para nome que não existe. */
  readEntry: (name: string) => Promise<Uint8Array | undefined>;
  /** A mesma entrada já decodificada como texto UTF-8. */
  readEntryText: (name: string) => Promise<string | undefined>;
};

const sliceBytes = async (blob: Blob, start: number, end: number): Promise<Uint8Array> =>
  new Uint8Array(await blob.slice(start, end).arrayBuffer());

/**
 * Abre o pacote lendo só o índice.
 *
 * Duas leituras pequenas: a cauda onde o registro de fim pode estar, e o índice
 * que ele aponta. Num pacote de 60 MiB isso são dezenas de quilobytes, e as
 * mesmas conferências de segurança do caminho atual já valem aqui, antes de
 * qualquer byte ser expandido.
 */
export async function openZipFromBlob(blob: Blob): Promise<ZipBlobReader> {
  const tailStart = Math.max(0, blob.size - ZIP_TAIL_SEARCH_BYTES);
  const location = locateZipDirectory(await sliceBytes(blob, tailStart, blob.size), tailStart);
  assertZipDirectoryFits(location, blob.size);

  // Do início do índice até o fim do arquivo, e não só os bytes que o registro
  // declara: é o mesmo intervalo que `validateZipWorkbook` percorre sobre o
  // pacote inteiro, e o que sobra depois do índice é o próprio registro de fim,
  // que são dezenas de bytes.
  const directory = await sliceBytes(blob, location.offset, blob.size);
  const { entries, totalUncompressedBytes } = readZipCentralDirectory(
    directory,
    location.entryCount,
  );

  const porNome = new Map(entries.map((entry) => [entry.name, entry]));

  const readEntry = async (name: string): Promise<Uint8Array | undefined> => {
    const entry = porNome.get(name);
    if (!entry) return undefined;
    if (entry.compressionMethod !== STORED && entry.compressionMethod !== DEFLATE)
      throw new Error(ZIP_INVALID_ENTRY_MESSAGE);

    // O índice aponta para o cabeçalho local, e o conteúdo começa depois do
    // nome e do campo extra **daquele** cabeçalho, que podem ter tamanhos
    // diferentes dos do índice. Só a parte fixa precisa ser lida: os dois
    // tamanhos moram dentro dela.
    const header = await sliceBytes(
      blob,
      entry.localHeaderOffset,
      Math.min(blob.size, entry.localHeaderOffset + ZIP_LOCAL_HEADER_FIXED_BYTES),
    );
    const data = locateZipEntryData(header, entry);
    if (data.offset + data.length > blob.size) throw new Error(ZIP_INVALID_ENTRY_MESSAGE);

    const compressed = await sliceBytes(blob, data.offset, data.offset + data.length);
    if (entry.compressionMethod === STORED) return compressed;
    // O tamanho expandido é declarado e já passou pelos limites de segurança,
    // então informá-lo evita o crescimento por tentativa do descompactador.
    return inflateSync(compressed, { out: new Uint8Array(entry.uncompressedSize) });
  };

  return {
    entries,
    totalUncompressedBytes,
    readEntry,
    readEntryText: async (name) => {
      const bytes = await readEntry(name);
      return bytes && new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    },
  };
}
