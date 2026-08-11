import type { GeoPoint } from "@/lib/storage";
import { NOT_INFORMED } from "@/lib/data-pipeline";

/**
 * Geocodificação de nomes de lugar (cidade, estado ou país em texto) usando
 * o serviço público Nominatim do OpenStreetMap, para o widget de mapa. Não
 * exige chave de API, mas a política de uso do serviço pede no máximo uma
 * consulta por segundo e a atribuição "© OpenStreetMap contributors" (já
 * incluída automaticamente pelo Leaflet no rodapé do mapa).
 *
 * As consultas são sempre sequenciais (nunca em paralelo) por causa desse
 * limite, e cada nome só é consultado uma vez por sessão do navegador graças
 * ao cache em lib/storage.ts.
 */
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL_MS = 1100;
let lastRequestAt = 0;

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export async function geocodePlace(name: string): Promise<GeoPoint | null> {
  const query = name.trim();
  if (!query || query === NOT_INFORMED) return null;
  await throttle();
  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const results = (await res.json()) as { lat: string; lon: string }[];
    const first = results[0];
    if (!first) return null;
    const lat = Number(first.lat),
      lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Geocodifica uma lista de nomes, pulando os que já estão no cache, uma
 * consulta de cada vez, chamando onEach a cada nome resolvido para permitir
 * atualização progressiva da tela em vez de esperar tudo terminar.
 */
export async function geocodeMissing(
  names: string[],
  cache: Record<string, GeoPoint | null>,
  onEach: (name: string, point: GeoPoint | null) => void,
): Promise<void> {
  const missing = [...new Set(names)].filter((n) => !(n in cache));
  for (const name of missing) {
    const point = await geocodePlace(name);
    onEach(name, point);
  }
}
