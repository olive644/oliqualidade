import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { conditionalColor, fmt } from "@/lib/format";
import {
  loadGeocodeCache,
  saveGeocodeCache,
  type GeocodeCache,
  type GeoPoint,
} from "@/lib/storage";
import { geocodeMissing } from "@/lib/geocode";
import type { Column } from "@/lib/types";
import { OliLoader } from "@/components/oliam/oli-loader";

// Tiles CARTO (grátis, sem chave de API, atribuição exigida só em texto) nos
// estilos "Positron" (claro) e "Dark Matter" (escuro) — bem mais discretos
// em cinza/azul do que os tiles coloridos padrão do OpenStreetMap, e casam
// com o tema claro/escuro do próprio site em vez de destoar dele. Trocar
// pra um provedor com estilo 100% customizável (Mapbox/MapTiler, cores
// exatas da paleta do site) exigiria criar conta e chave de API — não dá
// pra fazer isso pelo usuário sem as credenciais dele.
const MAP_TILE_URL = {
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const MAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Corpo do widget de mapa: geocodifica os nomes de local do agrupamento
 * (usando o cache compartilhado em lib/storage.ts e lib/geocode.ts) e
 * desenha um marcador por local resolvido num mapa Leaflet com tiles do
 * OpenStreetMap, com raio proporcional ao valor agregado. O Leaflet só é
 * carregado no navegador (import dinâmico dentro do efeito), nunca durante
 * a renderização no servidor.
 */
export default function MapWidgetBody({
  grouped,
  valueColumn,
  onSelect,
}: {
  grouped: { name: string; total: number }[];
  valueColumn: Column;
  onSelect: (name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const tileLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const [cache, setCache] = useState<GeocodeCache>({});
  const [ready, setReady] = useState(false);
  // Segue o mesmo tema (claro/escuro) do resto do site: o toggle de tema
  // alterna a classe "dark" em <html> (ver useTheme), então observar essa
  // classe aqui evita ter que passar o tema por várias camadas de props só
  // pra chegar nesse widget.
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const namesKey = grouped.map((g) => g.name).join("|");

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(el.classList.contains("dark")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    loadGeocodeCache().then((c) => {
      if (alive) {
        setCache(c);
        setReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const names = namesKey ? namesKey.split("|") : [];
    void (async () => {
      const updates: GeocodeCache = {};
      await geocodeMissing(names, cache, (name, point) => {
        updates[name] = point;
      });
      if (!alive || !Object.keys(updates).length) return;
      setCache((prev) => {
        const next = { ...prev, ...updates };
        void saveGeocodeCache(next);
        return next;
      });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, namesKey]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let alive = true;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const mod = await import("leaflet");
      const L = (mod.default ?? mod) as typeof import("leaflet");
      if (!alive || !containerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current).setView([-14, -51], 3);
      }
      const map = mapRef.current;
      if (!tileLayerRef.current) {
        tileLayerRef.current = L.tileLayer(MAP_TILE_URL[isDark ? "dark" : "light"], {
          attribution: MAP_ATTRIBUTION,
          maxZoom: 20,
        }).addTo(map);
      } else {
        tileLayerRef.current.setUrl(MAP_TILE_URL[isDark ? "dark" : "light"]);
      }
      layerRef.current?.remove();
      const layer = L.layerGroup();
      const resolved = grouped
        .map((g) => ({ ...g, point: cache[g.name] }))
        .filter((g): g is typeof g & { point: GeoPoint } => !!g.point);
      const max = resolved.reduce((m, g) => Math.max(m, Math.abs(g.total)), 0) || 1;
      const sum = resolved.reduce((s, g) => s + g.total, 0);
      // Resolvido aqui (não como string "var(--primary)" fixa) porque o
      // Leaflet grava isso como atributo SVG (stroke/fill) via JS, e nem
      // todo navegador/webview resolve custom property CSS num atributo de
      // presentation attribute setado assim — resolver o valor de verdade
      // é mais confiável. Refeito a cada troca de tema (isDark é dependência
      // deste efeito) pra continuar acompanhando claro/escuro.
      const primaryColor =
        getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() ||
        "#0ea5e9";
      const colorProbe = document.createElement("span");
      colorProbe.hidden = true;
      document.body.appendChild(colorProbe);
      resolved.forEach((g) => {
        const radius = 7 + (Math.abs(g.total) / max) * 20;
        const pct = sum > 0 ? (g.total / sum) * 100 : 0;
        const formattedColor = conditionalColor(
          g.total,
          valueColumn.kind,
          valueColumn.conditionalFormat,
        );
        colorProbe.style.color = formattedColor ?? primaryColor;
        const markerColor = getComputedStyle(colorProbe).color || primaryColor;
        const marker = L.circleMarker([g.point.lat, g.point.lng], {
          radius,
          color: markerColor,
          fillColor: markerColor,
          fillOpacity: 0.45,
          weight: 2,
        });
        const popup = document.createElement("div");
        popup.className = "text-xs";
        const strong = document.createElement("strong");
        strong.textContent = g.name;
        popup.appendChild(strong);
        popup.appendChild(document.createElement("br"));
        popup.appendChild(
          document.createTextNode(`${fmt(g.total, valueColumn.kind) ?? "–"} (${pct.toFixed(1)}%)`),
        );
        marker.bindPopup(popup);
        marker.on("click", () => onSelect(g.name));
        marker.addTo(layer);
      });
      colorProbe.remove();
      layer.addTo(map);
      layerRef.current = layer;
      resizeTimer = setTimeout(() => {
        if (alive && mapRef.current === map) map.invalidateSize();
      }, 50);
      if (resolved.length) {
        const bounds = L.latLngBounds(resolved.map((g) => [g.point.lat, g.point.lng]));
        map.fitBounds(bounds.pad(0.3), { maxZoom: 6 });
      }
    })();
    return () => {
      alive = false;
      clearTimeout(resizeTimer);
    };
  }, [grouped, cache, onSelect, valueColumn, isDark]);

  const resolvedCount = grouped.filter((g) => cache[g.name]).length;
  const notFoundCount = grouped.filter((g) => g.name in cache && cache[g.name] === null).length;
  const pending = grouped.length - resolvedCount - notFoundCount;
  // Quando nenhum nome vira marcador, o mapa fica só com os tiles de fundo
  // e nenhum ponto — sem esse aviso maior, a única pista era um texto
  // pequeno no rodapé, fácil de não notar (parece "o mapa não funciona",
  // quando na prática é a coluna escolhida que não tem nome de local de
  // verdade, ex: nome de vendedor em vez de cidade).
  const allUnresolved = !pending && grouped.length > 0 && resolvedCount === 0;

  return (
    <>
      <div className="relative">
        <div ref={containerRef} className="h-64 w-full" />
        {pending > 0 && (
          <div className="oliam-map-loading" role="status">
            <OliLoader compact />
            <span>Localizando {pending}…</span>
          </div>
        )}
      </div>
      {allUnresolved && (
        <p className="border-t bg-destructive/10 px-4 py-2 text-[11px] text-destructive">
          Nenhum dos {grouped.length} valores dessa coluna foi reconhecido como local (cidade,
          estado ou país) pelo OpenStreetMap. Troque a coluna de agrupamento acima por uma que tenha
          nome de local de verdade.
        </p>
      )}
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        Localização aproximada a partir do nome do local, via OpenStreetMap Nominatim. O tamanho de
        cada ponto indica o valor agregado.
        {pending > 0 && ` Localizando ${pending} de ${grouped.length}…`}
        {notFoundCount > 0 &&
          !allUnresolved &&
          ` ${notFoundCount} local(is) não encontrado(s) e sem marcador no mapa.`}
      </p>
      <p className="sr-only">
        Tabela alternativa ao mapa: {grouped.map((g) => `${g.name}, ${g.total}`).join("; ")}.
      </p>
    </>
  );
}
