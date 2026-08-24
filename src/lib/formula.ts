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
 * - Referência a uma célula ou intervalo da mesma aba (ex.: "O5", "$O$5")
 *   ou de outra aba do mesmo arquivo (ex.: "Vendas!F5", "'Aba 2'!F5:F304",
 *   quando o workbook é passado — ver parâmetro `workbook` de
 *   `resolveFormulaCell`) — recursivamente, se essa célula também for uma
 *   fórmula sem valor guardado.
 * - Operadores aritméticos (+, -, *, /), parênteses, número negativo.
 * - Funções comuns: IF, AND, OR, IFERROR, ROUND, ABS, MIN, MAX, SUM,
 *   AVERAGE, COUNT, SUMIF e COUNTIF. Intervalos são limitados a no máximo
 *   10 mil células, na aba atual ou em outra aba do mesmo workbook.
 *
 * Qualquer coisa fora disso — referência a uma aba que não existe no
 * workbook, workbook não informado, intervalo fora das funções permitidas,
 * função não suportada (VLOOKUP, XLOOKUP etc.) — faz a avaliação falhar e
 * retornar null, deixando a célula vazia exatamente como antes. Isso é
 * proposital: o objetivo aqui é recuperar fórmulas de cálculo comuns entre
 * planilhas de verdade, não ser um motor de planilha completo (sem
 * referência circular entre abas diferentes, sem nomes definidos, sem
 * fórmulas de matriz).
 */

// Nome de aba sem aspas simples no Excel não tem espaço, ':', '!', ',' nem
// parênteses — os mesmos caracteres que delimitam o resto de uma fórmula.
// Com espaço ou caractere especial, o Excel sempre envolve em aspas simples
// ('Aba 2'!A1); aspas duplicadas ('') dentro do nome (aspa simples literal
// no nome da aba) não são suportadas, caso raro o bastante para ignorar.
const SHEET_NAME_SRC = `(?:'[^']+'|[^'!:,()\\s]+)`;
const SHEET_PREFIX_SRC = `${SHEET_NAME_SRC}!`;
const CELL_REF = new RegExp(`^(?:${SHEET_PREFIX_SRC})?\\$?[A-Za-z]+\\$?[0-9]+$`);
const REF_WITH_SHEET_AT_START = new RegExp(`^${SHEET_PREFIX_SRC}\\$?[A-Za-z]+\\$?[0-9]+`);
const RANGE_AT_START = new RegExp(
  `^(${SHEET_PREFIX_SRC})?\\$?([A-Za-z]+)\\$?([0-9]+):\\$?([A-Za-z]+)\\$?([0-9]+)`,
);
const MAX_FORMULA_RANGE_CELLS = 10_000;

/**
 * Separa o prefixo de aba (se houver) de uma referência normalizada em
 * maiúsculas — preservando a capitalização do NOME da aba como está escrito
 * na fórmula, porque `wb.Sheets[nome]` é sensível a maiúsculas/minúsculas e
 * acentos; só a parte da célula (depois do "!") é normalizada.
 */
function splitSheetPrefix(raw: string): { sheetName: string | null; localRef: string } {
  const match = new RegExp(`^(${SHEET_PREFIX_SRC})`).exec(raw);
  if (!match) return { sheetName: null, localRef: raw.replace(/\$/g, "").toUpperCase() };
  const prefix = match[1]!;
  const sheetName = prefix.slice(0, -1).replace(/^'|'$/g, "");
  const localRef = raw.slice(prefix.length).replace(/\$/g, "").toUpperCase();
  return { sheetName, localRef };
}
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
  // Data de hoje no serial do Excel (dias desde 30/12/1899). Sem hora, como
  // no Excel, para que "TODAY() - vencimento" dê um número inteiro de dias.
  TODAY: () => excelSerialToday(),
  NOW: () => excelSerialToday() + nowFractionOfDay(),
};

/** Dias desde 30/12/1899, a época que o Excel usa para datas. */
export function excelSerialToday(now: Date = new Date()): number {
  const utcMidnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round(utcMidnight / 86_400_000) + 25_569;
}

/**
 * Serial do Excel para uma data lida do arquivo. Usa os componentes UTC
 * porque o SheetJS entrega o dia civil da planilha nesse fuso; ler em hora
 * local deslocaria a data em um dia a oeste de Greenwich.
 */
function excelSerialFromDate(date: Date): number {
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round(utcMidnight / 86_400_000) + 25_569;
}

function nowFractionOfDay(now: Date = new Date()): number {
  return (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86_400;
}

/**
 * Fórmulas cujo resultado depende da data em que foram calculadas.
 *
 * O Excel guarda o último valor calculado junto com a fórmula, e para quase
 * tudo esse valor é confiável — é o que o app usa. Para estas, não é: o
 * número gravado responde "quantos dias faltavam **no dia em que a planilha
 * foi salva**". Um cronograma de calibração salvo em 2023 traz "-556 dias
 * restantes" e o app mostraria isso como se fosse hoje.
 */
export function isVolatileFormula(formula: string): boolean {
  return /\b(?:TODAY|NOW)\s*\(/i.test(formula);
}

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
    // Referência com prefixo de aba ("Vendas!A1", "'Aba 2'!$A$1") tem que
    // ser testada ANTES do identificador simples: o nome da função (IF,
    // SUM...) e a referência local (A1) usam o mesmo formato de letras
    // seguidas de dígitos, mas só a referência com aba tem "!" no meio.
    const refWithSheetMatch = REF_WITH_SHEET_AT_START.exec(rest);
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
    if (refWithSheetMatch) {
      this.pos += refWithSheetMatch[0].length;
      return this.resolveCell(refWithSheetMatch[0]);
    }
    if (identMatch && CELL_REF.test(identMatch[0])) {
      this.pos += identMatch[0].length;
      return this.resolveCell(identMatch[0]);
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
    const prefix = match[1] ?? "";
    const values = this.resolveRange(
      `${prefix}${match[2]}${match[3]}`,
      `${prefix}${match[4]}${match[5]}`,
    );
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
  return criteriaValues.reduce<number>((sum, value, index) => {
    const summand = sumValues[index];
    return matchesCriterion(value, criterion) && typeof summand === "number" ? sum + summand : sum;
  }, 0);
}

/**
 * COUNTA conta células não vazias (texto, número ou booleano — qualquer
 * coisa que não seja em branco), diferente de COUNT, que só conta
 * numéricas. Comum em resumos que contam "quantos pedidos" a partir de uma
 * coluna de texto (ex.: "=COUNTA(Vendas!A5:A304)" contando os IDs de
 * venda). Reaproveita `readRange`/`readValue` de `conditionalAggregate`
 * porque eles já preservam texto/número/booleano em vez de descartar tudo
 * que não é número (o que o Parser genérico faz, sendo voltado só a
 * aritmética).
 */
function evaluateCounta(
  formula: string,
  readRange: (reference: string) => ConditionalValue[] | null,
  readValue: (token: string) => ConditionalValue,
): number | null | undefined {
  const match = /^COUNTA\s*\(([\s\S]*)\)$/i.exec(formula.trim());
  if (!match) return undefined;
  const args = splitFormulaArguments(match[1]!);
  if (!args || !args.length) return null;
  let total = 0;
  for (const arg of args) {
    if (arg.includes(":")) {
      const values = readRange(arg);
      if (!values) return null;
      total += values.filter((value) => value !== null && value !== "").length;
    } else {
      const value = readValue(arg);
      if (value !== null && value !== "") total += 1;
    }
  }
  return total;
}

/** Localiza a aba de um workbook por nome, tolerando diferença de maiúsculas/minúsculas. */
function findSheet(workbook: XLSX.WorkBook, sheetName: string): XLSX.WorkSheet | undefined {
  if (workbook.Sheets[sheetName]) return workbook.Sheets[sheetName];
  const match = workbook.SheetNames.find((name) => name.toLowerCase() === sheetName.toLowerCase());
  return match ? workbook.Sheets[match] : undefined;
}

type SheetTarget = { ws: XLSX.WorkSheet; name: string | null };

/**
 * Resolve para qual worksheet uma referência aponta: `null` de aba significa
 * "a mesma de onde a fórmula está" (`currentWs`); um nome de aba só resolve
 * quando `workbook` foi informado E a aba existe nele — senão a referência
 * fica fora do escopo suportado (mesmo comportamento de antes de existir
 * suporte a fórmulas entre abas).
 */
function resolveSheetTarget(
  sheetName: string | null,
  currentWs: XLSX.WorkSheet,
  currentSheetName: string | null,
  workbook: XLSX.WorkBook | undefined,
): SheetTarget | null {
  if (sheetName === null) return { ws: currentWs, name: currentSheetName };
  if (!workbook) return null;
  const target = findSheet(workbook, sheetName);
  return target ? { ws: target, name: sheetName } : null;
}

function formulaCacheKey(sheetName: string | null, addr: string): string {
  // `sheetName === null` (nenhum workbook informado, ou referência local
  // dentro da própria fórmula sem prefixo) preserva a chave exatamente como
  // antes de existir suporte a múltiplas abas — os testes que chamam
  // `resolveFormulaCell` sem workbook continuam com o mesmo comportamento
  // de cache/detecção de ciclo de sempre.
  return sheetName === null ? addr : `${sheetName} ${addr}`;
}

/**
 * Resolve o valor numérico de uma célula, avaliando sua fórmula (recursivo,
 * com proteção contra referência circular) quando ela não tiver um valor
 * já guardado no arquivo. `cache`/`inProgress` são compartilhados entre
 * chamadas — inclusive entre abas diferentes do mesmo workbook — para não
 * reavaliar a mesma célula várias vezes e para detectar ciclos (ex.: A1
 * dependendo de B1 que depende de A1; ou de uma célula de outra aba que
 * depende de volta desta).
 */
export function resolveFormulaCell(
  ws: XLSX.WorkSheet,
  addr: string,
  cache: Map<string, number | null> = new Map(),
  inProgress: Set<string> = new Set(),
  // Recalcula mesmo havendo valor guardado no arquivo. Só faz sentido para
  // fórmulas voláteis (ver isVolatileFormula), onde o valor gravado responde
  // a uma data que já passou; para as demais o cache do Excel é a fonte mais
  // confiável, porque foi ele quem calculou.
  ignoreCachedValue = false,
  // Workbook completo — permite resolver fórmulas que referenciam outra aba
  // (ex.: "=SUMIF(Vendas!F:F,A9,Vendas!Q:Q)"). Sem ele, essas referências
  // continuam fora do escopo suportado, como sempre foram.
  workbook?: XLSX.WorkBook,
): number | null {
  return resolveInSheet(ws, null, addr, cache, inProgress, ignoreCachedValue, workbook);
}

function resolveInSheet(
  ws: XLSX.WorkSheet,
  sheetName: string | null,
  addr: string,
  cache: Map<string, number | null>,
  inProgress: Set<string>,
  ignoreCachedValue: boolean,
  workbook: XLSX.WorkBook | undefined,
): number | null {
  const key = formulaCacheKey(sheetName, addr);
  if (!ignoreCachedValue && cache.has(key)) return cache.get(key)!;
  if (inProgress.has(key)) return null;
  const cell = worksheetCellAtAddress(ws, addr) as
    { v?: unknown; f?: string; t?: string } | undefined;
  if (!cell) return null;
  // t === "z" é uma célula "stub" (o SheetJS só a cria porque lemos com
  // sheetStubs: true, pra enxergar fórmulas sem valor calculado) — o "v"
  // dela é um 0 de preenchimento, não um valor de verdade, mesmo quando é
  // um número. Sem checar "t" aqui, esse 0 falso seria devolvido como se
  // fosse o resultado real da fórmula, sem nunca tentar avaliar nada.
  const hasRealValue = !ignoreCachedValue && cell.t !== "z" && cell.v !== undefined;
  if (hasRealValue && typeof cell.v === "number") {
    cache.set(key, cell.v);
    return cell.v;
  }
  // Uma data é um número no Excel (dias desde 30/12/1899) e participa de
  // conta como qualquer outro: é assim que "TODAY() - vencimento" devolve
  // dias. O SheetJS entrega essas células como `Date` quando o arquivo é
  // lido com `cellDates`, e tratá-las como "não numérico" fazia toda
  // fórmula de prazo falhar — justamente o caso mais comum.
  if (hasRealValue && cell.v instanceof Date) {
    const serial = excelSerialFromDate(cell.v);
    cache.set(key, serial);
    return serial;
  }
  if (hasRealValue) {
    // valor já preenchido, mas não numérico (texto...): não serve como
    // operando de fórmula aritmética.
    return null;
  }
  if (!cell.f) return null; // sem fórmula — não há nada pra avaliar.
  inProgress.add(key);
  let value: number | null;
  try {
    const readConditionalRange = (reference: string): ConditionalValue[] | null => {
      const { sheetName: refSheet, localRef } = splitSheetPrefix(reference.trim());
      if (!/^[A-Za-z]+\d+:[A-Za-z]+\d+$/.test(localRef)) return null;
      const target = resolveSheetTarget(refSheet, ws, sheetName, workbook);
      if (!target) return null;
      const range = XLSX.utils.decode_range(localRef);
      const size = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
      if (size > MAX_FORMULA_RANGE_CELLS) return null;
      if (target.ws === ws) {
        const current = XLSX.utils.decode_cell(addr);
        if (
          current.r >= range.s.r &&
          current.r <= range.e.r &&
          current.c >= range.s.c &&
          current.c <= range.e.c
        )
          return null;
      }
      const values: ConditionalValue[] = [];
      for (let row = range.s.r; row <= range.e.r; row++) {
        for (let column = range.s.c; column <= range.e.c; column++) {
          const address = XLSX.utils.encode_cell({ r: row, c: column });
          const source = worksheetCellAtAddress(target.ws, address) as
            { v?: unknown; t?: string; f?: string } | undefined;
          if (source?.t !== "z" && ["string", "number", "boolean"].includes(typeof source?.v))
            values.push(source!.v as string | number | boolean);
          else if (source?.f)
            values.push(
              resolveInSheet(target.ws, target.name, address, cache, inProgress, false, workbook),
            );
          else values.push(null);
        }
      }
      return values;
    };
    const readToken = (token: string): ConditionalValue => {
      const trimmed = token.trim();
      if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
      if (!CELL_REF.test(trimmed)) return null;
      const { sheetName: refSheet, localRef } = splitSheetPrefix(trimmed);
      const target = resolveSheetTarget(refSheet, ws, sheetName, workbook);
      if (!target) return null;
      const source = worksheetCellAtAddress(target.ws, localRef) as
        { v?: unknown; t?: string; f?: string } | undefined;
      if (source?.t !== "z" && ["string", "number", "boolean"].includes(typeof source?.v))
        return source!.v as string | number | boolean;
      return source?.f
        ? resolveInSheet(target.ws, target.name, localRef, cache, inProgress, false, workbook)
        : null;
    };
    const conditional = conditionalAggregate(cell.f, readConditionalRange, readToken);
    const counta = evaluateCounta(cell.f, readConditionalRange, readToken);
    if (conditional !== undefined) value = conditional;
    else if (counta !== undefined) value = counta;
    else {
      const parser = new Parser(
        cell.f,
        (raw) => {
          const { sheetName: refSheet, localRef } = splitSheetPrefix(raw);
          const target = resolveSheetTarget(refSheet, ws, sheetName, workbook);
          if (!target) return null;
          return resolveInSheet(
            target.ws,
            target.name,
            localRef,
            cache,
            inProgress,
            false,
            workbook,
          );
        },
        (start, end) => {
          const { sheetName: refSheet, localRef: startLocal } = splitSheetPrefix(start);
          const { localRef: endLocal } = splitSheetPrefix(end);
          const target = resolveSheetTarget(refSheet, ws, sheetName, workbook);
          if (!target) return null;
          const range = XLSX.utils.decode_range(`${startLocal}:${endLocal}`);
          const size = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
          if (size > MAX_FORMULA_RANGE_CELLS) return null;
          if (target.ws === ws) {
            const current = XLSX.utils.decode_cell(addr);
            if (
              current.r >= range.s.r &&
              current.r <= range.e.r &&
              current.c >= range.s.c &&
              current.c <= range.e.c
            )
              return null;
          }
          const values: (number | null)[] = [];
          for (let row = range.s.r; row <= range.e.r; row++)
            for (let column = range.s.c; column <= range.e.c; column++)
              values.push(
                resolveInSheet(
                  target.ws,
                  target.name,
                  XLSX.utils.encode_cell({ r: row, c: column }),
                  cache,
                  inProgress,
                  false,
                  workbook,
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
  inProgress.delete(key);
  cache.set(key, value);
  return value;
}
