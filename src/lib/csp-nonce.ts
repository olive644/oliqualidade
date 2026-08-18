import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

// Server-only. Nunca importar este módulo estaticamente de um arquivo que
// também é empacotado pro navegador (ex: router.tsx) — use import()
// dinâmico atrás de um guard `import.meta.env.SSR`, senão o bundler tenta
// resolver node:async_hooks/node:crypto pro cliente.
const nonceStore = new AsyncLocalStorage<string>();

export function generateNonce(): string {
  return randomBytes(16).toString("base64");
}

export function runWithNonce<T>(nonce: string, fn: () => T): T {
  return nonceStore.run(nonce, fn);
}

export function currentNonce(): string | undefined {
  return nonceStore.getStore();
}
