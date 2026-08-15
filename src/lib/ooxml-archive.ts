import { unzipSync } from "fflate";

export type OoxmlArchive = Record<string, Uint8Array>;

export function unzipOoxmlArchive(input: ArrayBuffer | Uint8Array): OoxmlArchive {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return unzipSync(bytes) as OoxmlArchive;
}

export function isOoxmlArchive(
  value: ArrayBuffer | Uint8Array | OoxmlArchive,
): value is OoxmlArchive {
  return !(value instanceof Uint8Array) && !(value instanceof ArrayBuffer);
}
