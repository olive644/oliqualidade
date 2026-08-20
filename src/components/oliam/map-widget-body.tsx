import { useCallback, useEffect, useRef, useState } from "react";
import createGlobe, { type Globe } from "cobe";
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

const AUTO_ROTATE_SPEED = 0.0018;
const MIN_MARKER_SIZE = 0.035;
const MAX_MARKER_SIZE = 0.12;
// Raio de acerto mínimo em pixels de tela pra clicar/passar o mouse num
// marcador pequeno — sem isso, marcadores de valor baixo (raio de globo
// minúsculo) ficam quase impossíveis de acertar com precisão.
const MIN_HIT_RADIUS_PX = 12;

/** Converte lat/lng (graus) no vetor unitário 3D usado internamente pela
 * cobe para posicionar marcadores na esfera (extraído do código-fonte da
 * lib — a API pública não expõe essa conversão). */
function markerVector(lat: number, lng: number): [number, number, number] {
  const r = (lat * Math.PI) / 180;
  const a = (lng * Math.PI) / 180 - Math.PI;
  const o = Math.cos(r);
  return [-o * Math.sin(a), Math.sin(r), o * Math.cos(a)];
}

/** Aplica a mesma rotação (phi/theta) que a cobe aplica ao globo internamente
 * e projeta pra coordenadas de tela, pra permitir clique/hover precisos
 * sobre marcadores — a lib não expõe isso, então é recalculado aqui a
 * partir da matriz de rotação encontrada no shader da cobe. */
function projectMarker(
  lat: number,
  lng: number,
  phi: number,
  theta: number,
  canvasSize: number,
): { x: number; y: number; visible: boolean } {
  const [vx, vy, vz] = markerVector(lat, lng);
  const c = Math.cos(phi);
  const e = Math.sin(phi);
  const d = Math.cos(theta);
  const f = Math.sin(theta);
  const sx = d * vx + f * vz;
  const sy = f * e * vx + c * vy - d * e * vz;
  const sz = -f * c * vx + e * vy + d * c * vz;
  const radius = canvasSize / 2;
  return {
    x: canvasSize / 2 + sx * radius,
    y: canvasSize / 2 - sy * radius,
    visible: sz < -0.02,
  };
}

/** Converte uma cor CSS (var(--primary), #hex, etc.) pra RGB 0–1, formato
 * exigido pelo campo `color` de marcador da cobe. Resolvido via um elemento
 * de sonda (mesma técnica já usada no mapa Leaflet anterior), porque nem
 * toda cor CSS chega pronta como rgb() literal. */
function resolveMarkerColor(probe: HTMLElement, css: string): [number, number, number] {
  probe.style.color = css;
  const computed = getComputedStyle(probe).color;
  const match = computed.match(/(\d+(?:\.\d+)?)/g);
  if (!match || match.length < 3) return [0.35, 0.35, 0.9];
  const [r, g, b] = match.map(Number);
  return [(r ?? 0) / 255, (g ?? 0) / 255, (b ?? 0) / 255];
}

type ResolvedMarker = {
  name: string;
  total: number;
  point: GeoPoint;
  size: number;
  color: [number, number, number];
};

/**
 * Corpo do widget de mapa: geocodifica os nomes de local do agrupamento
 * (mesmo cache/serviço compartilhado de antes) e desenha um marcador por
 * local resolvido num globo 3D (cobe), com tamanho e cor proporcionais ao
 * valor agregado. Como a cobe não expõe hit-testing de marcador, a posição
 * de cada um na tela é recalculada a cada frame (ver projectMarker) pra
 * viabilizar clique-pra-filtrar e tooltip — mesmo comportamento que o mapa
 * anterior tinha com o Leaflet.
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<Globe | null>(null);
  const markersRef = useRef<ResolvedMarker[]>([]);
  const anglesRef = useRef({ phi: 0, theta: 0.28 });
  const pointerRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [cache, setCache] = useState<GeocodeCache>({});
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<{
    name: string;
    total: number;
    x: number;
    y: number;
  } | null>(null);
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

  // Recalcula os marcadores resolvidos (posição, tamanho e cor) sempre que
  // os dados, o cache de geocodificação ou o tema mudam, e envia pra cobe.
  useEffect(() => {
    const resolved = grouped
      .map((g) => ({ ...g, point: cache[g.name] }))
      .filter((g): g is typeof g & { point: GeoPoint } => !!g.point);
    const max = resolved.reduce((m, g) => Math.max(m, Math.abs(g.total)), 0) || 1;
    const primaryColor =
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#0ea5e9";
    const probe = document.createElement("span");
    probe.hidden = true;
    document.body.appendChild(probe);
    markersRef.current = resolved.map((g) => {
      const formattedColor = conditionalColor(
        g.total,
        valueColumn.kind,
        valueColumn.conditionalFormat,
      );
      return {
        name: g.name,
        total: g.total,
        point: g.point,
        size: MIN_MARKER_SIZE + (Math.abs(g.total) / max) * (MAX_MARKER_SIZE - MIN_MARKER_SIZE),
        color: resolveMarkerColor(probe, formattedColor ?? primaryColor),
      };
    });
    probe.remove();
    globeRef.current?.update({
      markers: markersRef.current.map((m) => ({
        location: [m.point.lat, m.point.lng],
        size: m.size,
        color: m.color,
      })),
    });
  }, [grouped, cache, valueColumn]);

  const findMarkerAt = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const size = rect.width;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const { phi, theta } = anglesRef.current;
    let closest: { marker: ResolvedMarker; dist: number; x: number; y: number } | null = null;
    for (const marker of markersRef.current) {
      const proj = projectMarker(marker.point.lat, marker.point.lng, phi, theta, size);
      if (!proj.visible) continue;
      const dist = Math.hypot(proj.x - px, proj.y - py);
      const hitRadius = Math.max(MIN_HIT_RADIUS_PX, marker.size * size * 0.6);
      if (dist <= hitRadius && (!closest || dist < closest.dist)) {
        closest = { marker, dist, x: proj.x, y: proj.y };
      }
    }
    return closest;
  }, []);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let animationId = 0;
    const baseColor: [number, number, number] = isDark ? [0.16, 0.17, 0.2] : [0.98, 0.98, 0.99];
    const glowColor: [number, number, number] = isDark ? [0.22, 0.24, 0.3] : [0.92, 0.92, 0.95];

    function frame() {
      if (!pointerRef.current) anglesRef.current.phi += AUTO_ROTATE_SPEED;
      globeRef.current?.update({ phi: anglesRef.current.phi, theta: anglesRef.current.theta });
      animationId = requestAnimationFrame(frame);
    }

    function init() {
      const width = canvas.offsetWidth;
      if (width === 0 || globeRef.current) return;
      globeRef.current = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        width,
        height: width,
        phi: anglesRef.current.phi,
        theta: anglesRef.current.theta,
        dark: isDark ? 1 : 0,
        diffuse: 1.4,
        mapSamples: 14000,
        mapBrightness: isDark ? 4 : 6,
        baseColor,
        markerColor: [0.35, 0.35, 0.9],
        glowColor,
        markerElevation: 0.02,
        markers: markersRef.current.map((m) => ({
          location: [m.point.lat, m.point.lng],
          size: m.size,
          color: m.color,
        })),
        opacity: 0.9,
      });
      frame();
      setTimeout(() => canvas && (canvas.style.opacity = "1"));
    }

    if (canvas.offsetWidth > 0) {
      init();
    } else {
      const ro = new ResizeObserver((entries) => {
        if ((entries[0]?.contentRect.width ?? 0) > 0) {
          ro.disconnect();
          init();
        }
      });
      ro.observe(canvas);
    }

    return () => {
      cancelAnimationFrame(animationId);
      globeRef.current?.destroy();
      globeRef.current = null;
    };
  }, [isDark]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerRef.current = { x: e.clientX, y: e.clientY, moved: false };
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = pointerRef.current;
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
        anglesRef.current = {
          phi: anglesRef.current.phi + dx / 300,
          theta: Math.max(-1.2, Math.min(1.2, anglesRef.current.theta + dy / 800)),
        };
        pointerRef.current = { x: e.clientX, y: e.clientY, moved: drag.moved };
        setHovered(null);
        return;
      }
      const hit = findMarkerAt(e.clientX, e.clientY);
      if (canvasRef.current) canvasRef.current.style.cursor = hit ? "pointer" : "grab";
      setHovered(
        hit ? { name: hit.marker.name, total: hit.marker.total, x: hit.x, y: hit.y } : null,
      );
    };
    const handleUp = (e: PointerEvent) => {
      const drag = pointerRef.current;
      pointerRef.current = null;
      if (canvasRef.current) canvasRef.current.style.cursor = "grab";
      if (drag && !drag.moved) {
        const hit = findMarkerAt(e.clientX, e.clientY);
        if (hit) onSelect(hit.marker.name);
      }
    };
    window.addEventListener("pointermove", handleMove, { passive: true });
    window.addEventListener("pointerup", handleUp, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [findMarkerAt, onSelect]);

  const resolvedCount = grouped.filter((g) => cache[g.name]).length;
  const notFoundCount = grouped.filter((g) => g.name in cache && cache[g.name] === null).length;
  const pending = grouped.length - resolvedCount - notFoundCount;
  const allUnresolved = !pending && grouped.length > 0 && resolvedCount === 0;
  const pct =
    hovered && markersRef.current.length
      ? (hovered.total / (markersRef.current.reduce((s, m) => s + m.total, 0) || 1)) * 100
      : 0;

  return (
    <>
      <div ref={containerRef} className="relative flex justify-center bg-muted/10 py-3">
        <div className="relative aspect-square w-56 max-w-full">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            className="size-full touch-none"
            style={{ cursor: "grab", opacity: 0, transition: "opacity 0.8s ease" }}
          />
          {hovered && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: hovered.x, top: hovered.y - 8 }}
            >
              <p className="font-semibold text-popover-foreground">{hovered.name}</p>
              <p className="text-muted-foreground">
                {fmt(hovered.total, valueColumn.kind) ?? "–"} ({pct.toFixed(1)}%)
              </p>
            </div>
          )}
        </div>
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
        cada marcador indica o valor agregado; clique para filtrar, arraste para girar o globo.
        {pending > 0 && ` Localizando ${pending} de ${grouped.length}…`}
        {notFoundCount > 0 &&
          !allUnresolved &&
          ` ${notFoundCount} local(is) não encontrado(s) e sem marcador no globo.`}
      </p>
      <p className="sr-only">
        Tabela alternativa ao globo: {grouped.map((g) => `${g.name}, ${g.total}`).join("; ")}.
      </p>
    </>
  );
}
