import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology } from "topojson-specification";
import { conditionalColor, fmt } from "@/lib/format";
import {
  loadGeocodeCache,
  saveGeocodeCache,
  type GeocodeCache,
  type GeoPoint,
} from "@/lib/storage";
import { geocodeMissing } from "@/lib/geocode";
import type { Column } from "@/lib/types";
import { cn } from "@/lib/utils";
import { OliLoader } from "@/components/oliam/oli-loader";
import { isCoarsePointer } from "./widget-support";

// Proporção 2:1 da projeção equirretangular: o mundo inteiro cabe sem corte,
// que é o ponto de um mapa chapado — nada fica escondido do outro lado, como
// acontecia no globo.
const MAP_WIDTH = 720;
const MAP_HEIGHT = 360;
const MIN_BUBBLE = 4;
const MAX_BUBBLE = 20;

/**
 * Projeção equirretangular: longitude vira x e latitude vira y, ambas
 * lineares. É a projeção mais simples que existe e a única adequada aqui —
 * qualquer projeção "melhor" (Mercator, Robinson) distorceria as posições
 * sem oferecer nada em troca, já que este mapa é pano de fundo para bolhas,
 * não uma ferramenta de navegação.
 */
function project(lng: number, lat: number): [number, number] {
  return [((lng + 180) / 360) * MAP_WIDTH, ((90 - lat) / 180) * MAP_HEIGHT];
}

/** Converte os anéis de um polígono GeoJSON num `d` de <path>. */
function ringsToPath(rings: number[][][]): string {
  let path = "";
  for (const ring of rings) {
    ring.forEach(([lng, lat], index) => {
      const [x, y] = project(lng ?? 0, lat ?? 0);
      path += `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    path += "Z";
  }
  return path;
}

type ResolvedPlace = {
  name: string;
  total: number;
  point: GeoPoint;
  x: number;
  y: number;
  radius: number;
  color: string;
  share: number;
};

/**
 * Corpo do widget de mapa: geocodifica os nomes de local do agrupamento
 * (mesmo cache e serviço de sempre) e desenha uma bolha por local sobre um
 * mapa-múndi chapado, com o tamanho e a cor proporcionais ao valor agregado,
 * ao lado de um ranking dos maiores.
 *
 * Substituiu um globo 3D. O globo era bonito e ruim de ler: metade dos
 * locais ficava sempre do lado escondido, exigindo arrastar para conferir
 * qualquer coisa, e comparar dois pontos distantes era impossível sem girar
 * de um lado para o outro. Num mapa plano o conjunto inteiro aparece de uma
 * vez, que é o que um painel precisa.
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
  const [cache, setCache] = useState<GeocodeCache>({});
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const namesKey = grouped.map((g) => g.name).join("|");

  // O contorno dos países são 108 KB de topologia que só interessam a quem
  // abriu um mapa: entram por import dinâmico, fora do pacote principal.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const topology = (await import("world-atlas/countries-110m.json")).default as unknown;
      if (!alive) return;
      const collection = feature(
        topology as Topology,
        (topology as Topology).objects["countries"]!,
      ) as unknown as FeatureCollection<Geometry>;
      const paths: string[] = [];
      for (const item of collection.features) {
        if (item.geometry.type === "Polygon") {
          paths.push(ringsToPath(item.geometry.coordinates as number[][][]));
        } else if (item.geometry.type === "MultiPolygon") {
          for (const polygon of item.geometry.coordinates as number[][][][]) {
            paths.push(ringsToPath(polygon));
          }
        }
      }
      setCountries(paths);
    })();
    return () => {
      alive = false;
    };
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

  const places = useMemo<ResolvedPlace[]>(() => {
    const resolved = grouped
      .map((g) => ({ ...g, point: cache[g.name] }))
      .filter((g): g is typeof g & { point: GeoPoint } => !!g.point);
    const max = resolved.reduce((m, g) => Math.max(m, Math.abs(g.total)), 0) || 1;
    const sum = resolved.reduce((s, g) => s + g.total, 0);
    return (
      resolved
        .map((g) => {
          const [x, y] = project(g.point.lng, g.point.lat);
          return {
            name: g.name,
            total: g.total,
            point: g.point,
            x,
            y,
            radius: MIN_BUBBLE + (Math.abs(g.total) / max) * (MAX_BUBBLE - MIN_BUBBLE),
            color:
              conditionalColor(g.total, valueColumn.kind, valueColumn.conditionalFormat) ??
              "var(--primary)",
            share: sum > 0 ? g.total / sum : 0,
          };
        })
        // Maiores por baixo: bolhas pequenas sobre grandes continuam clicáveis,
        // e o inverso esconderia os menores por completo.
        .sort((a, b) => b.radius - a.radius)
    );
  }, [grouped, cache, valueColumn]);

  const ranking = useMemo(
    () => [...places].sort((a, b) => b.total - a.total).slice(0, 6),
    [places],
  );
  const active = hovered ?? selected;
  const activePlace = places.find((place) => place.name === active) ?? null;

  const resolvedCount = grouped.filter((g) => cache[g.name]).length;
  const notFoundCount = grouped.filter((g) => g.name in cache && cache[g.name] === null).length;
  const pending = grouped.length - resolvedCount - notFoundCount;
  const allUnresolved = !pending && grouped.length > 0 && resolvedCount === 0;

  const choose = (name: string) => {
    // Mesmo contrato dos outros widgets: no toque o primeiro contato apenas
    // seleciona, e o filtro sai do botão do painel de detalhe.
    if (isCoarsePointer()) {
      setSelected((current) => (current === name ? null : name));
      return;
    }
    onSelect(name);
  };

  return (
    <>
      <div className="flex flex-col gap-3 p-3 lg:flex-row">
        <div className="relative min-w-0 flex-[2]">
          <svg
            viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
            className="h-full w-full rounded-xl bg-muted/20"
            role="img"
            aria-label={`Mapa com ${places.length} local(is)`}
          >
            <g>
              {countries.map((path, index) => (
                <path
                  key={index}
                  d={path}
                  className="fill-muted-foreground/15 stroke-muted-foreground/25"
                  strokeWidth={0.4}
                />
              ))}
            </g>
            <g>
              {places.map((place, index) => {
                const isActive = active === place.name;
                return (
                  <circle
                    key={place.name}
                    cx={place.x}
                    cy={place.y}
                    r={place.radius}
                    fill={place.color}
                    fillOpacity={isActive ? 0.85 : 0.5}
                    stroke={place.color}
                    strokeWidth={isActive ? 2 : 1}
                    className="oliam-map-bubble cursor-pointer transition-[fill-opacity,stroke-width]"
                    style={
                      { "--oliam-bubble-delay": `${Math.min(index, 12) * 45}ms` } as CSSProperties
                    }
                    onMouseEnter={() => !isCoarsePointer() && setHovered(place.name)}
                    onMouseLeave={() => !isCoarsePointer() && setHovered(null)}
                    onClick={() => choose(place.name)}
                  >
                    <title>{`${place.name}: ${fmt(place.total, valueColumn.kind) ?? "–"}`}</title>
                  </circle>
                );
              })}
            </g>
          </svg>
          {pending > 0 && (
            <div className="oliam-map-loading" role="status">
              <OliLoader compact />
              <span>Localizando {pending}…</span>
            </div>
          )}
        </div>
        {ranking.length > 0 && (
          // O ranking ao lado responde "quem são os maiores" sem obrigar a
          // caçar a bolha maior no mapa, e dá um alvo de toque de tamanho
          // decente para locais que no mapa têm poucos pixels.
          <ul className="flex min-w-0 flex-1 flex-col gap-0.5 lg:max-w-56">
            {ranking.map((place, index) => (
              <li key={place.name}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                    active === place.name ? "bg-muted" : "hover:bg-muted/50",
                  )}
                  onMouseEnter={() => !isCoarsePointer() && setHovered(place.name)}
                  onMouseLeave={() => !isCoarsePointer() && setHovered(null)}
                  onClick={() => choose(place.name)}
                >
                  <span className="w-3 shrink-0 font-mono text-[10px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: place.color }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{place.name}</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {place.share.toLocaleString("pt-BR", {
                      style: "percent",
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {activePlace && (
        <div className="oliam-panel-enter flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/10 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{activePlace.name}</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
              {fmt(activePlace.total, valueColumn.kind) ?? "–"}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {activePlace.share.toLocaleString("pt-BR", {
                  style: "percent",
                  maximumFractionDigits: 1,
                })}{" "}
                do total
              </span>
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
            onClick={() => {
              onSelect(activePlace.name);
              setSelected(null);
            }}
          >
            Filtrar por este local
          </button>
        </div>
      )}
      {allUnresolved && (
        <p className="border-t bg-destructive/10 px-4 py-2 text-[11px] text-destructive">
          Nenhum dos {grouped.length} valores dessa coluna foi reconhecido como local (cidade,
          estado ou país) pelo OpenStreetMap. Troque a coluna de agrupamento acima por uma que tenha
          nome de local de verdade.
        </p>
      )}
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        Localização aproximada a partir do nome do local, via OpenStreetMap Nominatim. O tamanho de
        cada bolha indica o valor agregado.
        {pending > 0 && ` Localizando ${pending} de ${grouped.length}…`}
        {notFoundCount > 0 &&
          !allUnresolved &&
          ` ${notFoundCount} local(is) não encontrado(s) e sem bolha no mapa.`}
      </p>
      <p className="sr-only">
        Tabela alternativa ao mapa: {grouped.map((g) => `${g.name}, ${g.total}`).join("; ")}.
      </p>
    </>
  );
}
