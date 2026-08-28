import type { TooltipValueType } from "recharts";
import { fmt } from "@/lib/format";
import type { Kind } from "@/lib/types";

export function chartAnimationEnabled(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Normaliza coordenadas entregues por ticks e shapes do Recharts 3.
 * Strings numéricas são aceitas; valores vazios, infinitos ou inválidos
 * falham explicitamente para que o SVG não receba NaN.
 */
export function finiteChartCoordinate(value: string | number | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Formata o ValueType completo do Recharts 3 sem transformar ausência ou
 * valores inválidos em zero. Arrays preservam todos os extremos recebidos.
 */
export function formatChartTooltipValue(
  value: TooltipValueType | undefined,
  kind: Kind,
  unavailable = "Valor indisponível",
): string {
  if (value === undefined) return unavailable;
  if (typeof value !== "string" && typeof value !== "number") {
    if (value.length === 0) return unavailable;
    return value.map((item) => fmt(item, kind) ?? String(item)).join(" – ");
  }
  if (typeof value === "number" && !Number.isFinite(value)) return unavailable;
  return fmt(value, kind) ?? String(value);
}

export function numericChartTooltipValue(value: TooltipValueType | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function chartTooltipName(name: string | number | undefined, fallback: string): string {
  return name === undefined ? fallback : String(name);
}

export function sourceRowFromChartPayload(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null || !("sourceRow" in payload)) {
    return undefined;
  }
  const sourceRow = payload.sourceRow;
  return typeof sourceRow === "number" && Number.isInteger(sourceRow) && sourceRow > 0
    ? sourceRow
    : undefined;
}

export function seriesPointFromChartPayload(
  payload: unknown,
): { name: string; total: number } | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("name" in payload) ||
    !("total" in payload) ||
    typeof payload.name !== "string" ||
    typeof payload.total !== "number" ||
    !Number.isFinite(payload.total)
  ) {
    return null;
  }
  return { name: payload.name, total: payload.total };
}

export function numericLabelValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
