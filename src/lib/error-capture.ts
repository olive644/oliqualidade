// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

import { AsyncLocalStorage } from "node:async_hooks";

type CapturedErrorSlot = { error: unknown; at: number } | undefined;
type RequestErrorContext = {
  slot: { current: CapturedErrorSlot };
  // Segredos conhecidos desta requisição (chave da API Gemini, segredo de
  // sessão, token de chat configurado). Comparados por igualdade exata contra
  // o texto do log antes de imprimir — mais confiável que um regex genérico
  // de "parece um token", já que sabemos exatamente o valor a procurar.
  secrets: string[];
};

// Antes uma única variável de módulo compartilhada por todas as invocações
// concorrentes de `fetch` no mesmo isolado/worker: sob duas requisições que
// falham ao mesmo tempo, a segunda `record()` sobrescrevia o erro da
// primeira antes dela conseguir `consumeLastCapturedError()`, atribuindo o
// erro errado (ou nenhum) a cada requisição. `AsyncLocalStorage` propaga um
// contexto isolado por cadeia de `await`, então cada requisição só enxerga
// seu próprio slot mesmo com outras rodando em paralelo no mesmo processo.
const requestErrorStore = new AsyncLocalStorage<RequestErrorContext>();

const TTL_MS = 5_000;
const MIN_REDACTED_SECRET_LENGTH = 6;

/**
 * Executa `fn` dentro de um contexto de captura de erro isolado para esta
 * requisição. `secrets` são valores exatos (chaves de API, segredos de
 * sessão) a remover de qualquer log emitido dentro de `fn` — strings com
 * menos de 6 caracteres são ignoradas para não redigir texto comum por
 * engano.
 */
export function runWithErrorCapture<T>(secrets: (string | undefined)[], fn: () => T): T {
  const filteredSecrets = secrets.filter(
    (secret): secret is string => typeof secret === "string" && secret.length > 0,
  );
  return requestErrorStore.run({ slot: { current: undefined }, secrets: filteredSecrets }, fn);
}

function record(error: unknown) {
  const context = requestErrorStore.getStore();
  if (context) context.slot.current = { error, at: Date.now() };
}

function redact(text: string): string {
  const context = requestErrorStore.getStore();
  if (!context?.secrets.length) return text;
  let result = text;
  for (const secret of context.secrets) {
    if (secret.length < MIN_REDACTED_SECRET_LENGTH) continue;
    result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

// h3's HTTPError serializes to {"status":500,"unhandled":true,"message":"HTTPError"} —
// no stack, no cause — so a plain console.error(error) reaches the log pipeline with
// the failure detail stripped. Expand Error-like args into a string that keeps the
// message, stack, and the full cause chain.
const CAUSE_DEPTH_LIMIT = 5;
const DESCRIPTION_LENGTH_LIMIT = 8_000;

export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH_LIMIT && current != null; depth++) {
    if (!(current instanceof Error)) {
      parts.push(typeof current === "string" ? current : safeStringify(current));
      break;
    }
    const label = depth === 0 ? "" : "caused by: ";
    const status = describeStatus(current);
    parts.push(`${label}${current.stack ?? `${current.name}: ${current.message}`}${status}`);
    current = current.cause;
  }
  return redact(parts.join("\n").slice(0, DESCRIPTION_LENGTH_LIMIT));
}

function describeStatus(error: Error): string {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = status ?? statusCode;
  return typeof value === "number" ? ` (status ${value})` : "";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

// Wrap console.error so errors logged by any layer — including h3's internal
// unhandled-error logging, which this file cannot hook directly — are both
// recorded for consumeLastCapturedError and expanded before serialization.
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const expanded = args.map((arg) => {
    if (!isErrorLike(arg)) return typeof arg === "string" ? redact(arg) : arg;
    record(arg);
    return describeError(arg);
  });
  originalConsoleError(...expanded);
};

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  const context = requestErrorStore.getStore();
  const current = context?.slot.current;
  if (!current) return undefined;
  context.slot.current = undefined;
  if (Date.now() - current.at > TTL_MS) return undefined;
  return current.error;
}
