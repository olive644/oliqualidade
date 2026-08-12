import * as XLSX from "xlsx";
import { worksheetCellAtAddress } from "@/lib/worksheet-cell";

/**
 * Avaliador de fórmulas propositalmente limitado: existe só para recuperar
 * o valor de uma célula com fórmula que não tem resultado guardado no
 * arquivo — comum em planilhas .xlsx geradas por script (ex.: openpyxl),
 * que escrevem a fórmula mas nunca chegam a calculá-la, ao contrário do
 * Excel/Google Sheets, que sempre guardam o último resultado calculado
 * junto com a fórmula. O SheetJS (biblioteca usada pra ler o arquivo) só lê
 * valores, nunca calcula fórmulas — sem isso aqui, essas células ficam
 * simplesmente vazias no import, mesmo a fórmula sendo trivial
 * (ex.: "=J5*K5").
 *
 * Suporta apenas:
 * - Referência a uma única célula da MESMA aba (ex.: "O5", "$O$5") —
 *   recursivamente, se essa célula também for uma fórmula sem valor
 *   guardado.
 * - Operadores aritméticos (+, -, *, /), parênteses, número negativo.
 * - Funções comuns: IF, AND, OR, IFERROR, ROUND, ABS, MIN, MAX, SUM,
 *   AVERAGE, COUNT, SUMIF e COUNTIF. Intervalos continuam restritos à aba
 *   atual e a no máximo 10 mil células.
 *
 * Qualquer coisa fora disso — referência a outra aba ("Vendas!P5"),
 * intervalo fora das funções permitidas, função não suportada (VLOOKUP,
 * XLOOKUP etc.) — faz a
 * avaliação falhar e retornar null, deixando a célula vazia exatamente
 * como antes. Isso é proposital: o objetivo aqui é recuperar fórmulas de
 * cálculo simples entre colunas da mesma linha, não ser um motor de
 * planilha completo.
 */

const CELL_REF = /^\$?[A-Za-z]+\$?[0-9]+$/;
const RANGE_AT_START = /^\$?([A-Za-z]+)\$?([0-9]+):\$?([A-Za-z]+)\$?([0-9]+)/;
const MAX_FORMULA_RANGE_CELLS = 10_000;
const num = (v: number | null | undefined): number | null => v ?? null;
const FUNCTIONS: Record<string, (args: (number | null | undefined)[]) => number | null> = {
  IF: ([condition, whenTrue, whenFalse]) =>
    num(condition) !== null && num(condition) !== 0 ? num(whenTrue) : num(whenFalse),
  AND: (args) =>
    args.length && args.every((value) => num(value) !== null && num(value) !== 0) ? 1 : 0,
  OR: (args) => (args.some((value) => num(value) !== null && num(value) !== 0) ? 1 : 0),
  IFERROR: ([a, b]) => {
    const av = num(a);
    return av !== null && Number.isFinite(av) ? av : num(b);
  },
  ROUND: ([a, n]) => {
    const av = num(a);
    return av === null ? null : Number(av.toFixed(Math.max(0, num(n) ?? 0)));
  },
  ABS: ([a]) => {
    const av = num(a);
    return av === null ? null : Math.abs(av);
  },
  MIN: (args) => {
    const values = args.map(num).filter((value): value is number => value !== null);
    return values.length ? Math.min(...values) : null;
  },
  MAX: (args) => {
    const values = args.map(num).filter((value): value is number => value !== null);
    return values.length ? Math.max(...values) : null;
  },
  SUM: (args) => args.reduce<number>((s, a) => s + (num(a) ?? 0), 0),
  AVERAGE: (args) => {
    const values = args.map(num).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  },
  COUNT: (args) => args.filter((value) => num(value) !== null).length,
};

class Parser {
  private pos = 0;
  constructor(
    private src: string,
    private resolveCell: (addr: string) => number | null,
    private resolveRange: (start: string, end: string) => (number | null)[] | null,
  ) {}

  private skipSpace() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }

  private peek(): string {
    this.skipSpace();
    return this.src[this.pos] ?? "";
  }

  parseExpr(): number | null {
    let value = this.parseTerm();
    for (;;) {
      const op = this.peek();
      if (op !== "+" && op !== "-") break;
      this.pos++;
      const rhs = this.parseTerm();
      if (value === null || rhs === null) value = null;
      else value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  parseComparison(): number | null {
    const left = this.parseExpr();
    this.skipSpace();
    const rest = this.src.slice(this.pos);
    const operator = /^(>=|<=|<>|=|>|<)/.exec(rest)?.[1];
    if (!operator) return left;
    this.pos += operator.length;
    const right = this.parseExpr();
    if (left === null || right === null) return null;
    if (operator === ">=") return left >= right ? 1 : 0;
    if (operator === "<=") return left <= right ? 1 : 0;
    if (operator === "<>") return left !== right ? 1 : 0;
    if (operator === "=") return left === right ? 1 : 0;
    if (operator === ">") return left > right ? 1 : 0;
    return left < right ? 1 : 0;
  }

  private parseTerm(): number | null {
    let value = this.parseFactor();
    for (;;) {
      const op = this.peek();
      if (op !== "*" && op !== "/") break;
      this.pos++;
      const rhs = this.parseFactor();
      if (value === null || rhs === null) value = null;
      else value = op === "*" ? value * rhs : rhs === 0 ? null : value / rhs;
    }
    return value;
  }

  private parseFactor(): number | null {
    const ch = this.peek();
    if (ch === "-") {
      this.pos++;
      const v = this.parseFactor();
      return v === null ? null : -v;
    }
    if (ch === "(") {
      this.pos++;
      const v = this.parseComparison();
      if (this.peek() !== ")") throw new Error("parêntese não fechado");
      this.pos++;
      return v;
    }
    this.skipSpace();
    const rest = this.src.slice(this.pos);
    const numMatch = /^[0-9]+(\.[0-9]+)?/.exec(rest);
    const identMatch = /^[A-Za-z]+[0-9]*/.exec(rest);
    if (identMatch && /^[A-Za-z]+\(/.test(rest)) {
      const name = identMatch[0].toUpperCase();
      this.pos += identMatch[0].length;
      if (this.peek() !== "(") throw new Error("função sem parêntese");
      this.pos++;
      const args: (number | null)[] = [];
      if (this.peek() !== ")") {
        args.push(...this.parseArgument(name));
        while (this.peek() === ",") {
          this.pos++;
          args.push(...this.parseArgument(name));
        }
      }
      if (this.peek() !== ")") throw new Error("parêntese de função não fechado");
      this.pos++;
      const fn = FUNCTIONS[name];
      if (!fn) throw new Error(`função não suportada: ${name}`);
      return fn(args);
    }
    if (identMatch && CELL_REF.test(identMatch[0])) {
      this.pos += identMatch[0].length;
      return this.resolveCell(identMatch[0].replace(/\$/g, "").toUpperCase());
    }
    if (numMatch) {
      this.pos += numMatch[0].length;
      return Number(numMatch[0]);
    }
    throw new Error(`token inesperado em "${rest.slice(0, 12)}"`);
  }

  private parseArgument(functionName: string): (number | null)[] {
    this.skipSpace();
    const match = RANGE_AT_START.exec(this.src.slice(this.pos));
    if (!match) return [this.parseComparison()];
    if (!["SUM", "MIN", "MAX", "AVERAGE", "COUNT"].includes(functionName))
      throw new Error(`intervalo não permitido em ${functionName}`);
    this.pos += match[0].length;
    const values = this.resolveRange(`${match[1]}${match[2]}`, `${match[3]}${match[4]}`);
    if (!values) throw new Error("intervalo inválido ou grande demais");
    return values;
  }

  finished(): boolean {
    this.skipSpace();
    return this.pos >= this.src.length;
  }
}

type ConditionalValue = string | number | boolean | null;

function splitFormulaArguments(value: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (char === '"') {
      if (quoted && value[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && char === "(") depth++;
    else if (!quoted && char === ")") depth--;
    else if (!quoted && depth === 0 && (char === "," || char === ";")) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted || depth !== 0) return null;
  parts.push(value.slice(start).trim());
  return parts;
}

function wildcardPattern(value: string): RegExp {
  const escaped = value
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesCriterion(value: ConditionalValue, criterion: ConditionalValue): boolean {
  if (criterion === null) return value === null || value === "";
  let operator = "=";
  let expected: ConditionalValue = criterion;
  if (typeof criterion === "string") {
    const parsed = /^(>=|<=|<>|=|>|<)(.*)$/.exec(criterion);
    if (parsed) {
      operator = parsed[1]!;
      expected = parsed[2]!.trim();
    }
  }
  const numericExpected =
    typeof expected === "number"
      ? expected
      : typeof expected === "string" && expected !== "" && Number.isFinite(Number(expected))
        ? Number(expected)
        : null;
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value !== "" && Number.isFinite(Number(value))
        ? Number(value)
        : null;
  if (numericExpected !== null && numericValue !== null) {
    if (operator === ">=") return numericValue >= numericExpected;
    if (operator === "<=") return numericValue <= numericExpected;
    if (operator === "<>") return numericValue !== numericExpected;
    if (operator === ">") return numericValue > numericExpected;
    if (operator === "<") return numericValue < numericExpected;
    return numericValue === numericExpected;
  }
  const actualText = String(value ?? "");
  const expectedText = String(expected ?? "");
  const equal = wildcardPattern(expectedText).test(actualText);
  return operator === "<>" ? !equal : operator === "=" ? equal : false;
}

function conditionalAggregate(
  formula: string,
  readRange: (reference: string) => ConditionalValue[] | null,
  readValue: (token: string) => ConditionalValue,
): number | null | undefined {
  const match = /^(SUMIF|COUNTIF)\s*\(([\s\S]*)\)$/i.exec(formula.trim());
  if (!match) return undefined;
  const name = match[1]!.toUpperCase();
  const args = splitFormulaArguments(match[2]!);
  if (!args || (name === "COUNTIF" ? args.length !== 2 : args.length < 2 || args.length > 3))
    return null;
  if (args.some((argument) => argument.includes("!"))) return null;
  const criteriaValues = readRange(args[0]!);
  if (!criteriaValues) return null;
  const criterionToken = args[1]!;
  const criterion = /^"[\s\S]*"$/.test(criterionToken)
    ? criterionToken.slice(1, -1).replace(/""/g, '"')
    : readValue(criterionToken);
  if (criterion === null && criterionToken.trim() !== "") return null;
  if (name === "COUNTIF")
    return criteriaValues.filter((value) => matchesCriterion(value, criterion)).length;
  const sumValues = readRange(args[2] ?? args[0]!);
  if (!sumValues || sumValues.length !== criteriaValues.length) return null;
  return criteriaValues.reduce(
    (sum, value, index) =>
      matchesCriterion(value, criterion) && typeof sumValues[index] === "number"
        ? sum + sumValues[index]
        : sum,
    0,
  );
}

/**
 * Resolve o valor numérico de uma célula, avaliando sua fórmula (recursivo,
 * com proteção contra referência circular) quando ela não tiver um valor
 * já guardado no arquivo. `cache`/`inProgress` são compartilhados entre
 * chamadas na mesma aba para não reavaliar a mesma célula várias vezes e
 * para detectar ciclos (ex.: A1 dependendo de B1 que depende de A1).
 */
export function resolveFormulaCell(
  ws: XLSX.WorkSheet,
  addr: string,
  cache: Map<string, number | null> = new Map(),
  inProgress: Set<string> = new Set(),
): number | null {
  if (cache.has(addr)) return cache.get(addr)!;
  if (inProgress.has(addr)) return null;
  const cell = worksheetCellAtAddress(ws, addr) as
    { v?: unknown; f?: string; t?: string } | undefined;
  if (!cell) return null;
  // t === "z" é uma célula "stub" (o SheetJS só a cria porque lemos com
  // sheetStubs: true, pra enxergar fórmulas sem valor calculado) — o "v"
  // dela é um 0 de preenchimento, não um valor de verdade, mesmo quando é
  // um número. Sem checar "t" aqui, esse 0 falso seria devolvido como se
  // fosse o resultado real da fórmula, sem nunca tentar avaliar nada.
  const hasRealValue = cell.t !== "z" && cell.v !== undefined;
  if (hasRealValue && typeof cell.v === "number") {
    cache.set(addr, cell.v);
    return cell.v;
  }
  if (hasRealValue) {
    // valor já preenchido, mas não numérico (texto, data...): não serve
    // como operando de fórmula aritmética.
    return null;
  }
  if (!cell.f || cell.f.includes("!")) {
    // sem fórmula, ou fórmula fora do escopo suportado (outra aba ou
    // intervalo) — não tentamos.
    return null;
  }
  inProgress.add(addr);
  let value: number | null;
  try {
    const readConditionalRange = (reference: string): ConditionalValue[] | null => {
      if (!/^\$?[A-Za-z]+\$?\d+:\$?[A-Za-z]+\$?\d+$/.test(reference.trim())) return null;
      const range = XLSX.utils.decode_range(reference.replace(/\$/g, ""));
      const size = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
      if (size > MAX_FORMULA_RANGE_CELLS) return null;
      const current = XLSX.utils.decode_cell(addr);
      if (
        current.r >= range.s.r &&
        current.r <= range.e.r &&
        current.c >= range.s.c &&
        current.c <= range.e.c
      )
        return null;
      const values: ConditionalValue[] = [];
      for (let row = range.s.r; row <= range.e.r; row++) {
        for (let column = range.s.c; column <= range.e.c; column++) {
          const address = XLSX.utils.encode_cell({ r: row, c: column });
          const source = worksheetCellAtAddress(ws, address) as
            { v?: unknown; t?: string; f?: string } | undefined;
          if (source?.t !== "z" && ["string", "number", "boolean"].includes(typeof source?.v))
            values.push(source!.v as string | number | boolean);
          else if (source?.f) values.push(resolveFormulaCell(ws, address, cache, inProgress));
          else values.push(null);
        }
      }
      return values;
    };
    const conditional = conditionalAggregate(
      cell.f,
      readConditionalRange,
      (token): ConditionalValue => {
        const trimmed = token.trim();
        if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
        if (!CELL_REF.test(trimmed)) return null;
        const reference = trimmed.replace(/\$/g, "").toUpperCase();
        const source = worksheetCellAtAddress(ws, reference) as
          { v?: unknown; t?: string; f?: string } | undefined;
        if (source?.t !== "z" && ["string", "number", "boolean"].includes(typeof source?.v))
          return source!.v as string | number | boolean;
        return source?.f ? resolveFormulaCell(ws, reference, cache, inProgress) : null;
      },
    );
    if (conditional !== undefined) value = conditional;
    else {
      const parser = new Parser(
        cell.f,
        (ref) => resolveFormulaCell(ws, ref, cache, inProgress),
        (start, end) => {
          const range = XLSX.utils.decode_range(`${start}:${end}`);
          const size = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
          if (size > MAX_FORMULA_RANGE_CELLS) return null;
          const current = XLSX.utils.decode_cell(addr);
          if (
            current.r >= range.s.r &&
            current.r <= range.e.r &&
            current.c >= range.s.c &&
            current.c <= range.e.c
          )
            return null;
          const values: (number | null)[] = [];
          for (let row = range.s.r; row <= range.e.r; row++)
            for (let column = range.s.c; column <= range.e.c; column++)
              values.push(
                resolveFormulaCell(
                  ws,
                  XLSX.utils.encode_cell({ r: row, c: column }),
                  cache,
                  inProgress,
                ),
              );
          return values;
        },
      );
      value = parser.parseComparison();
      if (!parser.finished()) value = null;
    }
  } catch {
    value = null;
  }
  inProgress.delete(addr);
  cache.set(addr, value);
  return value;
}
