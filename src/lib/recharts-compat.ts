import type { TooltipValueType } from "recharts";
import { fmt } from "@/lib/format";
import type { Kind } from "@/lib/types";

export function chartAnimationEnabled(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  if (document.querySelector(".oliam-export-mode")) return false;
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

/**
 * O centro de um rótulo de gráfico, a partir do viewBox que o Recharts entrega.
 *
 * Existe porque a versão 3 mudou o que chega aqui sem avisar. O `<Label>` de uma
 * pizza recebia um viewBox **polar**, com `cx` e `cy`; agora recebe um
 * **cartesiano**, com `x`, `y`, `width` e `height`. Código que exigia `cx`
 * devolvia `null` em toda renderização, e o número do meio da rosca desapareceu
 * sem nenhum erro — a ausência foi inclusive gravada nas imagens de referência
 * como se fosse o resultado esperado.
 *
 * As duas formas continuam aceitas: a polar porque é a que a documentação
 * promete, e a cartesiana porque é a que chega de fato. Devolve `null` quando
 * nenhuma das duas dá um par de coordenadas finito, para o SVG nunca receber
 * `NaN`.
 */
export function chartLabelCenter(viewBox: unknown): { cx: number; cy: number } | null {
  if (typeof viewBox !== "object" || viewBox === null) return null;
  const box = viewBox as Record<string, unknown>;
  const polar = { cx: box["cx"], cy: box["cy"] };
  if (typeof polar.cx === "number" && typeof polar.cy === "number")
    return Number.isFinite(polar.cx) && Number.isFinite(polar.cy)
      ? { cx: polar.cx, cy: polar.cy }
      : null;
  const { x, y, width, height } = box;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  )
    return null;
  const cx = x + width / 2;
  const cy = y + height / 2;
  return Number.isFinite(cx) && Number.isFinite(cy) ? { cx, cy } : null;
}
