import type { Dashboard } from "@/lib/types";

export const DASH_KEY = "oliam-dashboards";
export const THEME_KEY = "oliam-theme";
export const ONBOARDING_KEY = "oliam-onboarding-seen";
export const TERM_HINTS_KEY = "oliam-term-hints-seen";

const DB_NAME = "oliam";
const DB_VERSION = 1;
const STORE = "kv";

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

// Migração silenciosa e única: painéis salvos antes da mudança para
// IndexedDB continuam disponíveis, movidos automaticamente na primeira
// leitura. O localStorage antigo só é limpo depois que a gravação no
// IndexedDB é confirmada, para nunca arriscar perder dados no meio do
// caminho.
async function migrateFromLocalStorage(db: IDBDatabase): Promise<Dashboard[]> {
  try {
    const raw = localStorage.getItem(DASH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Dashboard[];
    if (!Array.isArray(parsed) || !parsed.length) return [];
    const ok = await idbSet(db, DASH_KEY, parsed);
    if (ok) localStorage.removeItem(DASH_KEY);
    return parsed;
  } catch {
    return [];
  }
}

export async function loadDashboards(): Promise<Dashboard[]> {
  const db = await openDb();
  if (!db) {
    // Sem suporte a IndexedDB no navegador: mantém o comportamento antigo.
    try {
      const raw = localStorage.getItem(DASH_KEY);
      return raw ? (JSON.parse(raw) as Dashboard[]) : [];
    } catch {
      return [];
    }
  }
  const existing = await idbGet<Dashboard[]>(db, DASH_KEY);
  if (existing) return existing;
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
