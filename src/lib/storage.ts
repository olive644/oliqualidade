import { migrateDashboards } from "@/lib/dashboard";
import type { Dashboard } from "@/lib/types";
import type {
  FileFingerprint,
  FolderMonitorView,
  LocalDirectoryHandle,
} from "@/lib/folder-monitor";
import type { ImportMetricEntry } from "@/lib/import-metrics";

export const DASH_KEY = "oliam-dashboards";
export const THEME_KEY = "oliam-theme";
export const ONBOARDING_KEY = "oliam-onboarding-seen";
export const TERM_HINTS_KEY = "oliam-term-hints-seen";
export const PRIVACY_MODE_KEY = "oliam-private-mode";
const PRIVATE_DASH_KEY = "oliam-private-dashboards";
const PRIVATE_IMPORT_METRICS_KEY = "oliam-private-import-metrics";

export function isPrivateMode(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(PRIVACY_MODE_KEY) === "1";
}

export function setPrivateMode(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (enabled) localStorage.setItem(PRIVACY_MODE_KEY, "1");
  else {
    localStorage.removeItem(PRIVACY_MODE_KEY);
    sessionStorage.removeItem(PRIVATE_DASH_KEY);
    sessionStorage.removeItem(PRIVATE_IMPORT_METRICS_KEY);
  }
}

const DB_NAME = "oliam";
const DB_VERSION = 1;
const STORE = "kv";
const FOLDER_MONITOR_PREFIX = "oliam-folder-monitor:";

// IndexedDB costuma liberar bem mais espaço por origem que o localStorage
// (frequentemente uma fração do disco, contra ~5-10MB do localStorage), mas
// ainda avisamos com folga antes de qualquer limite prático.
const SOFT_LIMIT_BYTES = 50 * 1024 * 1024;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

function idbSet(db: IDBDatabase, key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export type StoredFolderMonitor = {
  directory: LocalDirectoryHandle;
  fileName: string;
  snapshot: FolderMonitorView;
  // Opcional para ler registros criados antes desta versão. Sem ele, a
  // restauração força uma sincronização e passa a gravá-lo novamente.
  fingerprint?: FileFingerprint;
};

export async function loadFolderMonitor(
  dashboardId: string,
): Promise<StoredFolderMonitor | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return idbGet<StoredFolderMonitor>(db, `${FOLDER_MONITOR_PREFIX}${dashboardId}`);
}

export async function saveFolderMonitor(
  dashboardId: string,
  monitor: StoredFolderMonitor,
): Promise<void> {
  const db = await openDb();
  if (db) await idbSet(db, `${FOLDER_MONITOR_PREFIX}${dashboardId}`, monitor);
}

export async function removeFolderMonitor(dashboardId: string): Promise<void> {
  const db = await openDb();
  if (db) await idbDelete(db, `${FOLDER_MONITOR_PREFIX}${dashboardId}`);
}

// Migração silenciosa e única: painéis salvos antes da mudança para
// IndexedDB continuam disponíveis, movidos automaticamente na primeira
// leitura. O localStorage antigo só é limpo depois que a gravação no
// IndexedDB é confirmada, para nunca arriscar perder dados no meio do
// caminho.
async function migrateFromLocalStorage(db: IDBDatabase): Promise<Dashboard[]> {
  try {
    const raw = localStorage.getItem(DASH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed) || !parsed.length) return [];
    const migrated = migrateDashboards(parsed);
    const ok = await idbSet(db, DASH_KEY, migrated);
    if (ok) localStorage.removeItem(DASH_KEY);
    return migrated;
  } catch {
    return [];
  }
}

export async function loadDashboards(): Promise<Dashboard[]> {
  if (isPrivateMode()) {
    try {
      return migrateDashboards(
        JSON.parse(sessionStorage.getItem(PRIVATE_DASH_KEY) ?? "[]") as unknown[],
      );
    } catch {
      return [];
    }
  }
  const db = await openDb();
  if (!db) {
    // Sem suporte a IndexedDB no navegador: mantém o comportamento antigo.
    try {
      const raw = localStorage.getItem(DASH_KEY);
      return raw ? migrateDashboards(JSON.parse(raw) as unknown[]) : [];
    } catch {
      return [];
    }
  }
  const existing = await idbGet<unknown[]>(db, DASH_KEY);
  if (existing) return migrateDashboards(existing);
  return migrateFromLocalStorage(db);
}

export type SaveResult = { ok: true; usageRatio: number } | { ok: false; reason: string };

export function estimateBytes(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return JSON.stringify(value).length * 2;
  }
}

export async function saveDashboards(list: Dashboard[]): Promise<SaveResult> {
  const bytes = estimateBytes(list);
  if (bytes > SOFT_LIMIT_BYTES) {
    return {
      ok: false,
      reason:
        "Seus painéis estão perto do limite de armazenamento do navegador. Remova painéis antigos ou exporte os dados antes de continuar.",
    };
  }
  if (isPrivateMode()) {
    try {
      sessionStorage.setItem(PRIVATE_DASH_KEY, JSON.stringify(list));
      return { ok: true, usageRatio: bytes / SOFT_LIMIT_BYTES };
    } catch {
      return { ok: false, reason: "Não foi possível manter os dados nesta sessão privada." };
    }
  }
  const db = await openDb();
  if (!db) {
    try {
      localStorage.setItem(DASH_KEY, JSON.stringify(list));
      return { ok: true, usageRatio: bytes / SOFT_LIMIT_BYTES };
    } catch {
      return {
        ok: false,
        reason:
          "Não foi possível salvar localmente. O armazenamento do navegador pode estar cheio.",
      };
    }
  }
  const ok = await idbSet(db, DASH_KEY, list);
  if (!ok) {
    return {
      ok: false,
      reason: "Não foi possível salvar localmente. O armazenamento do navegador pode estar cheio.",
    };
  }
  return { ok: true, usageRatio: bytes / SOFT_LIMIT_BYTES };
}

export const GEOCODE_KEY = "oliam-geocode-cache";
export type GeoPoint = { lat: number; lng: number };
// null indica que o lugar já foi consultado e não foi encontrado, para não
// tentar geocodificar de novo a cada carregamento do widget de mapa.
export type GeocodeCache = Record<string, GeoPoint | null>;

/**
 * Cache de geocodificação (nome de lugar -> coordenadas), compartilhado entre
 * todos os painéis. Evita repetir consultas ao serviço de geocodificação
 * para o mesmo nome de cidade/estado/país em widgets de mapa diferentes.
 */
export async function loadGeocodeCache(): Promise<GeocodeCache> {
  const db = await openDb();
  if (!db) {
    try {
      const raw = localStorage.getItem(GEOCODE_KEY);
      return raw ? (JSON.parse(raw) as GeocodeCache) : {};
    } catch {
      return {};
    }
  }
  const existing = await idbGet<GeocodeCache>(db, GEOCODE_KEY);
  return existing ?? {};
}

export async function saveGeocodeCache(cache: GeocodeCache): Promise<void> {
  const db = await openDb();
  if (!db) {
    try {
      localStorage.setItem(GEOCODE_KEY, JSON.stringify(cache));
    } catch {
      // Cache é só uma otimização; falhar em salvar não é crítico.
    }
    return;
  }
  await idbSet(db, GEOCODE_KEY, cache);
}

export const IMPORT_METRICS_KEY = "oliam-import-metrics";

/**
 * Métricas por importação (tempo por leitor, fallback, bytes, divergências
 * do WASM) para diagnosticar se o candidato Rust/WASM está ajudando ou só
 * custando mais caro — nunca contém dado de célula/linha da planilha, ver
 * `import-metrics.ts`. Em modo privado, fica só em `sessionStorage` e some
 * ao fechar a aba, como os painéis privados.
 */
export async function loadImportMetrics(): Promise<ImportMetricEntry[]> {
  if (isPrivateMode()) {
    try {
      return JSON.parse(
        sessionStorage.getItem(PRIVATE_IMPORT_METRICS_KEY) ?? "[]",
      ) as ImportMetricEntry[];
    } catch {
      return [];
    }
  }
  const db = await openDb();
  if (!db) {
    try {
      const raw = localStorage.getItem(IMPORT_METRICS_KEY);
      return raw ? (JSON.parse(raw) as ImportMetricEntry[]) : [];
    } catch {
      return [];
    }
  }
  const existing = await idbGet<ImportMetricEntry[]>(db, IMPORT_METRICS_KEY);
  return existing ?? [];
}

export async function saveImportMetrics(entries: ImportMetricEntry[]): Promise<void> {
  if (isPrivateMode()) {
    try {
      sessionStorage.setItem(PRIVATE_IMPORT_METRICS_KEY, JSON.stringify(entries));
    } catch {
      // Métricas são só diagnóstico; falhar em salvar não é crítico.
    }
    return;
  }
  const db = await openDb();
  if (!db) {
    try {
      localStorage.setItem(IMPORT_METRICS_KEY, JSON.stringify(entries));
    } catch {
      // Métricas são só diagnóstico; falhar em salvar não é crítico.
    }
    return;
  }
  await idbSet(db, IMPORT_METRICS_KEY, entries);
}

export async function clearImportMetrics(): Promise<void> {
  sessionStorage.removeItem(PRIVATE_IMPORT_METRICS_KEY);
  try {
    localStorage.removeItem(IMPORT_METRICS_KEY);
  } catch {
    // Sem localStorage disponível; nada a limpar aí.
  }
  const db = await openDb();
  if (db) await idbDelete(db, IMPORT_METRICS_KEY);
}

export type StoredEntry = { key: string; bytes: number };

/**
 * Lista o que está guardado, com o tamanho de cada registro.
 *
 * Existe para a central de privacidade poder dizer números em vez de
 * promessas. Percorre o IndexedDB, que é onde os painéis realmente moram, e
 * complementa com as poucas chaves de preferência que ficam no
 * `localStorage` — uma tela que medisse só o `localStorage` mostraria alguns
 * bytes de tema e daria a impressão de que a planilha importada não está
 * guardada em lugar nenhum.
 */
export async function listStoredEntries(): Promise<StoredEntry[]> {
  const entries: StoredEntry[] = [];
  const db = await openDb();
  if (db) {
    const chaves = await new Promise<string[]>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAllKeys();
        req.onsuccess = () => resolve(req.result.map(String));
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    for (const key of chaves) {
      const value = await idbGet<unknown>(db, key);
      entries.push({ key, bytes: estimateBytes(value ?? null) });
    }
  }
  if (typeof localStorage !== "undefined") {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key) continue;
      entries.push({ key, bytes: (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2 });
    }
  }
  return entries;
}

/** Apaga um registro nos dois lugares onde ele pode estar. */
export async function removeStoredKey(key: string): Promise<void> {
  const db = await openDb();
  if (db) await idbDelete(db, key);
  if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
}
