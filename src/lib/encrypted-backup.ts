import type { Dashboard, Row, Value } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ITERATIONS = 310_000;

type EncryptedEnvelope = {
  format: "oli-backup";
  version: 1;
  algorithm: "AES-GCM";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const cryptoBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

async function keyFromPassword(password: string, salt: Uint8Array, iterations: number) {
  if (password.length < 12) throw new Error("Use uma senha com pelo menos 12 caracteres.");
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: cryptoBytes(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptDashboardBackup(dashboard: Dashboard, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromPassword(password, salt, ITERATIONS);
  const plaintext = encoder.encode(
    JSON.stringify({ exportedAt: new Date().toISOString(), dashboard }),
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: cryptoBytes(iv) },
      key,
      cryptoBytes(plaintext),
    ),
  );
  const envelope: EncryptedEnvelope = {
    format: "oli-backup",
    version: 1,
    algorithm: "AES-GCM",
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
  return JSON.stringify(envelope);
}

export async function decryptDashboardBackup(
  content: string,
  password: string,
): Promise<Dashboard> {
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(content) as EncryptedEnvelope;
  } catch {
    throw new Error("Backup inválido.");
  }
  if (
    envelope.format !== "oli-backup" ||
    envelope.version !== 1 ||
    envelope.algorithm !== "AES-GCM" ||
    envelope.iterations < 100_000 ||
    envelope.iterations > 1_000_000
  )
    throw new Error("Formato de backup não reconhecido.");
  try {
    const salt = fromBase64(envelope.salt);
    const iv = fromBase64(envelope.iv);
    if (salt.byteLength !== 16 || iv.byteLength !== 12) throw new Error();
    const key = await keyFromPassword(password, salt, envelope.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: cryptoBytes(iv) },
      key,
      cryptoBytes(fromBase64(envelope.ciphertext)),
    );
    const parsed = JSON.parse(decoder.decode(plaintext)) as { dashboard?: Dashboard };
    if (!parsed.dashboard?.id || !Array.isArray(parsed.dashboard.sheets)) throw new Error();
    return parsed.dashboard;
  } catch {
    throw new Error("Senha incorreta ou backup danificado.");
  }
}

// Evita que valores iniciados por fórmula sejam tratados como comandos ao
// abrir um arquivo exportado em Excel. O apóstrofo força texto literal.
export function safeSpreadsheetValue(value: Value): Value {
  return typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function safeRowsForSpreadsheet(rows: Row[]): Row[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, safeSpreadsheetValue(value)]),
    ),
  );
}
