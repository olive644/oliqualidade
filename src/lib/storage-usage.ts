import {
  DASH_KEY,
  GEOCODE_KEY,
  IMPORT_METRICS_KEY,
  ONBOARDING_KEY,
  PRIVACY_MODE_KEY,
  TERM_HINTS_KEY,
  THEME_KEY,
} from "@/lib/storage";

export type StoredItemKind =
  "dashboards" | "history" | "geocode" | "metrics" | "preferences" | "other";

export type StoredItem = {
  kind: StoredItemKind;
  label: string;
  description: string;
  bytes: number;
  keys: string[];
  /** Apagar apaga trabalho do usuário, não só cache. */
  destructive: boolean;
};

export type StorageUsage = {
  items: StoredItem[];
  totalBytes: number;
  /** Cota informada pelo navegador, quando ele informa. */
  quotaBytes: number | null;
  usageBytes: number | null;
};

const PREFERENCE_KEYS = [THEME_KEY, ONBOARDING_KEY, TERM_HINTS_KEY, PRIVACY_MODE_KEY];

/**
 * Classifica uma chave do armazenamento local em uma categoria legível.
 *
 * O agrupamento é o que torna a tela útil: uma lista crua de chaves como
 * "oliam-geocode-cache" e "oliam-folder-monitor:abc123" não diz a ninguém o
 * que pode ser apagado sem perder trabalho. O que importa é a diferença entre
 * "seus painéis" e "cache que o app refaz sozinho".
 */
export function classifyStorageKey(key: string): StoredItemKind | null {
  if (!key.startsWith("oliam-")) return null;
  if (key === DASH_KEY || key.includes("dashboards") || key.startsWith("oliam-folder-monitor:"))
    return "dashboards";
  if (key.startsWith("oliam-history:")) return "history";
  if (key === GEOCODE_KEY) return "geocode";
  if (key.includes("import-metrics") || key === IMPORT_METRICS_KEY) return "metrics";
  if (PREFERENCE_KEYS.includes(key)) return "preferences";
  return "other";
}

const ITEM_META: Record<StoredItemKind, Omit<StoredItem, "bytes" | "keys">> = {
  dashboards: {
    kind: "dashboards",
    label: "Painéis e planilhas importadas",
    description: "Seus dados e a montagem dos painéis. Apagar aqui é perder o trabalho.",
    destructive: true,
  },
  history: {
    kind: "history",
    label: "Histórico de versões dos painéis",
    description:
      "Como cada painel estava montado ao longo do tempo. Não guarda as linhas da planilha.",
    destructive: false,
  },
  geocode: {
    kind: "geocode",
    label: "Cache de localizações do mapa",
    description: "Coordenadas já consultadas, guardadas para não repetir a consulta.",
    destructive: false,
  },
  metrics: {
    kind: "metrics",
    label: "Histórico de desempenho das importações",
    description: "Tempos de leitura das últimas importações, usados nos diagnósticos.",
    destructive: false,
  },
  preferences: {
    kind: "preferences",
    label: "Preferências",
    description: "Tema, modo privado e avisos já lidos.",
    destructive: false,
  },
  other: {
    kind: "other",
    label: "Outros dados do aplicativo",
    description: "Chaves do OliQualidade que não se encaixam nas categorias acima.",
    destructive: false,
  },
};

export function measureStorage(entries: { key: string; bytes: number }[]): StoredItem[] {
  const bytesByKind = new Map<StoredItemKind, { bytes: number; keys: string[] }>();
  for (const entry of entries) {
    const kind = classifyStorageKey(entry.key);
    if (!kind) continue;
    const current = bytesByKind.get(kind) ?? { bytes: 0, keys: [] };
    current.bytes += entry.bytes;
    current.keys.push(entry.key);
    bytesByKind.set(kind, current);
  }
  return [...bytesByKind.entries()]
    .map(([kind, { bytes, keys }]) => ({ ...ITEM_META[kind], bytes, keys }))
    .sort((a, b) => b.bytes - a.bytes);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}
