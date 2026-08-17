import { createHash, createHmac } from "node:crypto";

import * as XLSX from "xlsx";

const SAFE_SHEET_PREFIX = "SHEET_";
const INVALID_SALT_MESSAGE = "A chave local de sanitizacao deve ter pelo menos 16 caracteres.";

function digest(salt, value) {
  return createHmac("sha256", salt).update(value).digest("hex");
}

function pseudonym(salt, value) {
  return `TXT_${digest(salt, value).slice(0, 16).toUpperCase()}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeFormula(formula, salt, sheetNames, definedNames) {
  if (formula.includes("[") || /(?:https?|ftp):\/\//i.test(formula)) return "0";
  if (
    definedNames.some((name) =>
      new RegExp(`(^|[^A-Za-z0-9_.])${escapeRegExp(name)}(?=$|[^A-Za-z0-9_.])`).test(formula),
    )
  ) {
    return "0";
  }

  let sanitized = formula.replace(/"(?:[^"]|"")*"/g, (literal) => {
    const content = literal.slice(1, -1).replaceAll('""', '"');
    return `"${pseudonym(salt, content)}"`;
  });

  for (const [original, replacement] of sheetNames) {
    const quoted = `'${original.replaceAll("'", "''")}'!`;
    sanitized = sanitized.replaceAll(quoted, `'${replacement}'!`);
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(original)) {
      sanitized = sanitized.replace(
        new RegExp(`(^|[^A-Za-z0-9_.'])${escapeRegExp(original)}!`, "g"),
        `$1'${replacement}'!`,
      );
    }
  }
  return sanitized;
}

function sanitizedNumber(salt, context, value) {
  if (!Number.isFinite(value)) return 0;
  if (value === 0) return 0;
  const raw = Number.parseInt(digest(salt, context).slice(0, 12), 16);
  const sign = value < 0 ? -1 : 1;
  if (Number.isInteger(value)) return sign * ((raw % 999_983) + 1);
  return sign * (((raw % 99_999_999) + 1) / 100);
}

function sanitizedDate(salt, workbookId, value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(Date.UTC(2030, 0, 1));
  const offset = 365 + (Number.parseInt(digest(salt, workbookId).slice(0, 8), 16) % 3_286);
  return new Date(date.getTime() + offset * 86_400_000);
}

function sanitizeCell(cell, context, salt, workbookId, sheetNames, definedNames, counters) {
  if (cell.l) {
    delete cell.l;
    counters.hyperlinksRemoved += 1;
  }
  if (cell.c) {
    delete cell.c;
    counters.commentsRemoved += 1;
  }
  delete cell.w;
  delete cell.r;
  delete cell.h;

  if (typeof cell.f === "string") {
    const nextFormula = sanitizeFormula(cell.f, salt, sheetNames, definedNames);
    if (nextFormula !== cell.f) counters.formulasSanitized += 1;
    cell.f = nextFormula;
  }

  if (cell.t === "s" || cell.t === "str") {
    const original = String(cell.v ?? "");
    cell.v = original ? pseudonym(salt, original) : "";
    counters.stringsSanitized += 1;
  } else if (cell.t === "d") {
    cell.v = sanitizedDate(salt, workbookId, cell.v);
    counters.datesSanitized += 1;
  } else if (cell.t === "n" && typeof cell.v === "number") {
    cell.v = sanitizedNumber(salt, context, cell.v);
    counters.numbersSanitized += 1;
  }
}

function removeWorkbookMetadata(workbook) {
  workbook.Props = {};
  workbook.Custprops = {};
  delete workbook.vbaraw;
  if (workbook.Workbook) {
    workbook.Workbook.Names = [];
    delete workbook.Workbook.Views;
    if (workbook.Workbook.WBProps) delete workbook.Workbook.WBProps.CodeName;
  }
}

export function sanitizeWorkbookBytes(input, options) {
  const { salt, workbookId = "workbook", bookType = "xlsx" } = options;
  if (typeof salt !== "string" || salt.length < 16) throw new Error(INVALID_SALT_MESSAGE);
  if (bookType !== "xlsx" && bookType !== "xlsm") {
    throw new Error(`bookType de saida nao suportado pelo SheetJS instalado: ${bookType}`);
  }

  const workbook = XLSX.read(input, {
    type: "buffer",
    cellDates: true,
    cellStyles: true,
    bookVBA: false,
  });
  const originalSheetNames = [...workbook.SheetNames];
  const definedNames = (workbook.Workbook?.Names ?? [])
    .map((entry) => entry.Name)
    .filter((name) => typeof name === "string" && name.length > 0);
  const sheetNames = new Map(
    originalSheetNames.map((name, index) => [
      name,
      `${SAFE_SHEET_PREFIX}${String(index + 1).padStart(3, "0")}`,
    ]),
  );
  const counters = {
    sheetsRenamed: originalSheetNames.length,
    stringsSanitized: 0,
    numbersSanitized: 0,
    datesSanitized: 0,
    formulasSanitized: 0,
    hyperlinksRemoved: 0,
    commentsRemoved: 0,
  };
  let cells = 0;

  for (const originalName of originalSheetNames) {
    const worksheet = workbook.Sheets[originalName];
    if (!worksheet) continue;
    for (const [address, cell] of Object.entries(worksheet)) {
      if (address.startsWith("!")) continue;
      cells += 1;
      sanitizeCell(
        cell,
        `${workbookId}:${originalName}:${address}:${String(cell.v ?? "")}`,
        salt,
        workbookId,
        sheetNames,
        definedNames,
        counters,
      );
    }
  }

  const renamedSheets = {};
  for (const originalName of originalSheetNames) {
    const replacement = sheetNames.get(originalName);
    if (replacement && workbook.Sheets[originalName]) {
      renamedSheets[replacement] = workbook.Sheets[originalName];
    }
  }
  workbook.SheetNames = originalSheetNames.map((name) => sheetNames.get(name));
  workbook.Sheets = renamedSheets;
  if (workbook.Workbook?.Sheets) {
    workbook.Workbook.Sheets = workbook.Workbook.Sheets.map((metadata, index) => {
      const sanitized = { ...metadata, name: workbook.SheetNames[index] };
      delete sanitized.CodeName;
      return sanitized;
    });
  }
  removeWorkbookMetadata(workbook);

  const output = XLSX.write(workbook, {
    type: "buffer",
    bookType,
    cellStyles: true,
    compression: true,
  });
  return {
    bytes: Buffer.from(output),
    summary: {
      sheets: workbook.SheetNames.length,
      cells,
      ...counters,
    },
  };
}

export function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function privateSourceId(input, salt) {
  if (typeof salt !== "string" || salt.length < 16) throw new Error(INVALID_SALT_MESSAGE);
  return `real-${createHmac("sha256", salt).update(input).digest("hex").slice(0, 12)}`;
}
