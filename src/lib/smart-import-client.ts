import {
  smartImportFingerprint,
  type SmartImportAnalysis,
  type SmartImportInput,
} from "@/lib/smart-import";
import { postWithHumanCheck } from "@/lib/human-check-client";

const CACHE_PREFIX = "oliqualidade:smart-import:v1:";
const CACHE_MS = 7 * 24 * 60 * 60 * 1_000;

type CacheEntry = { expiresAt: number; analysis: SmartImportAnalysis };

function readCache(fingerprint: string): SmartImportAnalysis | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${fingerprint}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CacheEntry;
    if (cached.expiresAt <= Date.now()) {
      localStorage.removeItem(`${CACHE_PREFIX}${fingerprint}`);
      return null;
    }
    return cached.analysis;
  } catch {
    return null;
  }
}

function writeCache(fingerprint: string, analysis: SmartImportAnalysis) {
  try {
    localStorage.setItem(
      `${CACHE_PREFIX}${fingerprint}`,
      JSON.stringify({ expiresAt: Date.now() + CACHE_MS, analysis } satisfies CacheEntry),
    );
  } catch {
    // Navegação privada ou armazenamento cheio não pode impedir a análise.
  }
}

export async function analyzeImportWithAi(
  input: SmartImportInput,
  options: { force?: boolean } = {},
): Promise<{ analysis: SmartImportAnalysis; cached: boolean }> {
  const fingerprint = smartImportFingerprint(input);
  if (!options.force) {
    const cached = readCache(fingerprint);
    if (cached) return { analysis: cached, cached: true };
  }
  const { response, raw } = await postWithHumanCheck("/api/gemini/import-analysis", {
    import: input,
  });
  let result: { analysis?: SmartImportAnalysis; error?: string; cached?: boolean } = {};
  try {
    result = JSON.parse(raw) as typeof result;
  } catch {
    // Proxy/plataforma podem devolver HTML ou resposta vazia numa falha.
  }
  if (!response.ok || !result.analysis)
    throw new Error(
      result.error ??
        "A análise inteligente está indisponível. A importação normal continua funcionando.",
    );
  writeCache(fingerprint, result.analysis);
  return { analysis: result.analysis, cached: Boolean(result.cached) };
}

export function markSmartImportAutoAnalysis(fingerprint: string): boolean {
  const key = `${CACHE_PREFIX}auto:${fingerprint}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
  } catch {
    // Sem sessionStorage, evita impedir a funcionalidade manual.
  }
  return true;
}
