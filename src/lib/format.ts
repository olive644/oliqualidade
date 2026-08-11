import type { Column, ConditionalFormatRule, Kind, Row, Value } from "@/lib/types";
import { numericKinds } from "@/lib/types";

export const palette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// Decide currency/percentage/number a partir só do NOME da coluna. Usada tanto
// quando há um valor numérico de amostra quanto quando a coluna está 100% vazia
// (nesse segundo caso não há valor pra checar, só o nome).
function numericKindFromName(low: string): Kind {
  return low.includes("receita") ||
    low.includes("custo") ||
    low.includes("valor") ||
    low.includes("preço") ||
    low.includes("preco") ||
    low.includes("faturamento") ||
    low.includes("desconto") ||
    low.includes("salário") ||
    low.includes("salario") ||
    // "r$" cobre qualquer coluna que já traga a moeda no próprio nome
    // (ex: "Total (R$)", "Desconto (R$)"), mesmo quando a palavra em si
    // (total, desconto) não é exclusiva de dinheiro.
    low.includes("r$")
    ? "currency"
    : low.includes("margem") || low.includes("taxa")
      ? "percentage"
      : "number";
}

function inferOne(key: string, rows: Row[]): Column {
  const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== "");
  const v = vals[0];
  const low = key.toLowerCase();
  const identifierName =
    /(^|[\s_-])(id|c[oó]digo|cod|n[º°o]\.?|n[uú]mero|sku|protocolo)([\s_.-]|\d|$)/i.test(low);
  const numericTextRatio = vals.length
    ? vals.filter(
        (value) =>
          typeof value === "number" ||
          (typeof value === "string" && /^[-+]?\d+(?:[.,]\d+)?$/.test(value.trim())),
      ).length / vals.length
    : 0;
  let kind: Kind = "text";
  if (low.includes("data") || (typeof v === "string" && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)))
    kind = "date";
  else if (identifierName) kind = new Set(vals).size < 12 ? "category" : "text";
  else if (typeof v === "number" || numericTextRatio >= 0.9) kind = numericKindFromName(low);
  else if (vals.length === 0)
    // Coluna sem nenhum valor de amostra (100% nula/vazia): não há motivo pra
    // tratar como texto/categoria por padrão. Aplica a mesma checagem de nome
    // usada quando há valor numérico, caindo em "number" se o nome não indicar
    // moeda/percentual.
    kind = numericKindFromName(low);
  else if (new Set(vals).size < 12) kind = "category";
  return {
    key,
    label: key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
    kind,
    visible: true,
    description: "",
  };
}

export function infer(rows: Row[]): Column[] {
  return Object.keys(rows[0] ?? {}).map((key) => inferOne(key, rows));
}

/**
 * Igual a infer(), mas só para um subconjunto de colunas (usado ao combinar
 * planilhas, quando as colunas já existentes não devem ser reinferidas).
 */
export function inferColumns(rows: Row[], keys: string[]): Column[] {
  return keys.map((key) => inferOne(key, rows));
}

export function fmt(v: Value, k: Kind) {
  if (v === null || v === "") return null;
  if (k === "currency")
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));
  if (k === "percentage")
    return new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1 }).format(
      Number(v),
    );
  if (k === "number")
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(v));
  return String(v);
}

export function hue(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % palette.length;
  return palette[h];
}

/**
 * Tenta ler uma data em formato brasileiro (dd/mm/aaaa) ou ISO (aaaa-mm-dd).
 * Retorna timestamp em ms, ou null se não reconhecida.
 */
export function parseDateValue(v: Value): number | null {
  if (v === null || v === "") return null;
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br?.[1] && br[2] && br[3]) {
    const [, d, m, y] = br;
    const year = y.length === 2 ? Number(y) + 2000 : Number(y);
    const t = new Date(year, Number(m) - 1, Number(d)).getTime();
    return Number.isNaN(t) ? null : t;
  }
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso?.[1] && iso[2] && iso[3]) {
    const [, y, m, d] = iso;
    const t = new Date(Number(y), Number(m) - 1, Number(d)).getTime();
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export function sortChronologically<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (parseDateValue(a.name) ?? Number.MAX_SAFE_INTEGER) -
      (parseDateValue(b.name) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * Avalia uma fórmula simples de coluna calculada (ex: "preco * quantidade",
 * "receita - custo") usando apenas os operadores + - * / ( ) e nomes de
 * colunas existentes. Não usa eval/Function com o texto do usuário direto:
 * a fórmula é validada por regex antes de virar uma expressão executável
 * sobre valores já extraídos.
 */
const FORMULA_TOKEN = /[A-Za-zÀ-ÿ_][\wÀ-ÿ]*|\d+(\.\d+)?|[+\-*/(),.]|\s+/g;

export function formulaColumnRefs(formula: string, availableKeys: string[]): string[] {
  const tokens = formula.match(FORMULA_TOKEN) ?? [];
  const refs: string[] = [];
  for (const t of tokens) {
    const trimmed = t.trim();
    if (trimmed && /^[A-Za-zÀ-ÿ_][\wÀ-ÿ]*$/.test(trimmed) && availableKeys.includes(trimmed)) {
      if (!refs.includes(trimmed)) refs.push(trimmed);
    }
  }
  return refs;
}

export function validateFormula(formula: string, availableKeys: string[]): string | null {
  if (!formula.trim()) return "Informe uma fórmula.";
  const allowed = /^[\sA-Za-zÀ-ÿ0-9_+\-*/().,]+$/;
  if (!allowed.test(formula)) return "A fórmula contém caracteres não permitidos.";
  const refs = formulaColumnRefs(formula, availableKeys);
  const unknown = (formula.match(/[A-Za-zÀ-ÿ_][\wÀ-ÿ]*/g) ?? []).filter(
    (name) => !availableKeys.includes(name),
  );
  if (unknown.length) return `Coluna desconhecida: ${unknown[0]}`;
  if (!refs.length) return "A fórmula precisa referenciar ao menos uma coluna.";
  return null;
}

export function evalFormula(formula: string, row: Row, availableKeys: string[]): number | null {
  try {
    const refs = formulaColumnRefs(formula, availableKeys);
    let expr = formula;
    for (const key of refs) {
      const val = Number(row[key]);
      expr = expr.replace(
        new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
        Number.isFinite(val) ? `(${val})` : "(0)",
      );
    }
    if (!/^[\s0-9+\-*/().]+$/.test(expr)) return null;

    const result = Function(`"use strict"; return (${expr});`)();
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

/**
 * Aplica colunas calculadas a cada linha, recalculando ao vivo.
 */
export function withCalculatedColumns(rows: Row[], columns: Column[]): Row[] {
  const calculated = columns.filter((c) => c.formula);
  if (!calculated.length) return rows;
  const baseKeys = columns.map((c) => c.key);
  return rows.map((row) => {
    const next = { ...row };
    for (const c of calculated) {
      next[c.key] = c.formula ? evalFormula(c.formula, next, baseKeys) : null;
    }
    return next;
  });
}

/**
 * Resolve o estilo visual (cor de texto e/ou fundo) para um valor numérico
 * de acordo com as regras de formatação condicional da coluna. A primeira
 * regra de limite que casar vence; regras de escala (heatmap) misturam a
 * cor mínima e máxima proporcionalmente ao valor dentro do intervalo.
 */
export function conditionalStyle(
  value: Value,
  kind: Kind,
  rules: ConditionalFormatRule[] | undefined,
): { color?: string; background?: string } | null {
  if (!rules?.length || !numericKinds.includes(kind)) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;

  for (const rule of rules) {
    if (rule.type === "threshold") {
      if (rule.operator === undefined || rule.value === undefined) continue;
      const hit =
        rule.operator === "lt"
          ? num < rule.value
          : rule.operator === "lte"
            ? num <= rule.value
            : rule.operator === "gt"
              ? num > rule.value
              : num >= rule.value;
      if (!hit) continue;
      const color = rule.color || "var(--destructive)";
      return rule.background
        ? { background: `color-mix(in oklch, ${color} 18%, transparent)`, color }
        : { color };
    }
    if (rule.type === "scale") {
      if (rule.min === undefined || rule.max === undefined || rule.max === rule.min) continue;
      const ratio = Math.min(1, Math.max(0, (num - rule.min) / (rule.max - rule.min)));
      const from = rule.minColor || "var(--chart-1)";
      const to = rule.maxColor || "var(--chart-4)";
      return { background: `color-mix(in oklch, ${to} ${ratio * 100}%, ${from})` };
    }
  }
  return null;
}
