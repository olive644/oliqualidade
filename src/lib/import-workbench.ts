import type { Row } from "@/lib/types";
import type { ImportDiagnostics } from "@/lib/import-intelligence";

export type ImportSelection = {
  startRow: number;
  endRow: number;
  ignoredColumns: string[];
};

export type ImportProfile = {
  id: string;
  name: string;
  signature: string;
  selection: ImportSelection;
  createdAt: number;
  updatedAt: number;
};

export type VersionDiff = {
  status: "ok" | "warning" | "incompatible";
  reason?: string;
  added: number;
  removed: number;
  changed: number;
  addedColumns: string[];
  removedColumns: string[];
  typeChanges: { column: string; before: string; after: string }[];
  invalidColumns: string[];
  comparisonMethod: "key" | "position" | "shared-values" | "none";
};

export type SheetHealth = {
  compatibility: number;
  structuralConfidence: number;
  dataQuality: number;
  completeness: number;
  duplicateRows: number;
  brokenFormulas: number;
  anomalies: number;
  recommendations: string[];
};

const PROFILE_KEY = "oliqualidade:import-profiles:v1";

export function defaultSelection(rows: Row[]): ImportSelection {
  return { startRow: 1, endRow: Math.max(1, rows.length), ignoredColumns: [] };
}

export function applyImportSelection(rows: Row[], selection: ImportSelection): Row[] {
  const start = Math.max(0, selection.startRow - 1);
  const end = Math.max(start, Math.min(rows.length, selection.endRow));
  const ignored = new Set(selection.ignoredColumns);
  return rows
    .slice(start, end)
    .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !ignored.has(key))));
}

export function workbookSignature(rows: Row[]): string {
  const keys = Object.keys(rows[0] ?? {}).sort();
  return keys
    .map((key) => `${key}:${typeof rows.find((row) => row[key] != null)?.[key]}`)
    .join("|");
}

export function loadImportProfiles(): ImportProfile[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveImportProfile(profile: ImportProfile): void {
  if (typeof localStorage === "undefined") return;
  const profiles = loadImportProfiles();
  const index = profiles.findIndex((item) => item.id === profile.id);
  if (index >= 0) profiles[index] = profile;
  else profiles.unshift(profile);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles.slice(0, 50)));
}

export function matchingImportProfile(rows: Row[]): ImportProfile | undefined {
  const signature = workbookSignature(rows);
  return loadImportProfiles().find((profile) => profile.signature === signature);
}

const valueKind = (value: unknown) =>
  value == null || value === "" ? "empty" : Array.isArray(value) ? "array" : typeof value;

const normalizedColumn = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const invalidColumn = (value: string) =>
  !normalizedColumn(value) ||
  /^(?:nan(?: nan)*|invalid date|undefined|null|#n a)$/i.test(normalizedColumn(value));

const normalizedValue = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value).trim().toLocaleLowerCase("pt-BR");
};

type ColumnPair = { before: string; after: string; label: string };

function stableIdentity(pairs: ColumnPair[], previous: Row[], next: Row[]) {
  const candidates = pairs.filter(({ label }) =>
    /(^|\s)(id|codigo|cod|protocolo|matricula|data|date|numero|n)(\s|$)/i.test(
      normalizedColumn(label),
    ),
  );
  const ordered = [...candidates, ...pairs.filter((pair) => !candidates.includes(pair))];
  for (const pair of ordered) {
    const before = previous.map((row) => normalizedValue(row[pair.before])).filter(Boolean);
    const after = next.map((row) => normalizedValue(row[pair.after])).filter(Boolean);
    const coverage = Math.min(
      before.length / Math.max(1, previous.length),
      after.length / Math.max(1, next.length),
    );
    const uniqueness = Math.min(
      new Set(before).size / Math.max(1, before.length),
      new Set(after).size / Math.max(1, after.length),
    );
    if (coverage >= 0.9 && uniqueness >= 0.95) return [pair];
  }
  // Relatórios frequentemente precisam de duas colunas para identificar
  // uma linha (por exemplo Data + Ponto de coleta).
  for (let first = 0; first < Math.min(pairs.length, 8); first++) {
    for (let second = first + 1; second < Math.min(pairs.length, 8); second++) {
      const selected = [pairs[first]!, pairs[second]!];
      const keys = (rows: Row[], side: "before" | "after") =>
        rows.map((row) => selected.map((pair) => normalizedValue(row[pair[side]])).join("¦"));
      const before = keys(previous, "before");
      const after = keys(next, "after");
      if (
        new Set(before).size / Math.max(1, before.length) >= 0.95 &&
        new Set(after).size / Math.max(1, after.length) >= 0.95
      )
        return selected;
    }
  }
  return [];
}

const rowKey = (row: Row, pairs: ColumnPair[], side: "before" | "after") =>
  pairs.map((pair) => normalizedValue(row[pair[side]])).join("¦");

const rowsDiffer = (before: Row, after: Row, pairs: ColumnPair[]) =>
  pairs.some((pair) => normalizedValue(before[pair.before]) !== normalizedValue(after[pair.after]));

export function compareVersions(previous: Row[], next: Row[]): VersionDiff {
  const beforeColumns = Object.keys(previous[0] ?? {});
  const afterColumns = Object.keys(next[0] ?? {});
  const invalidColumns = [...beforeColumns, ...afterColumns].filter(invalidColumn);
  const validBefore = beforeColumns.filter((column) => !invalidColumn(column));
  const validAfter = afterColumns.filter((column) => !invalidColumn(column));
  const afterByNormalized = new Map(validAfter.map((column) => [normalizedColumn(column), column]));
  const pairs = validBefore.flatMap((column) => {
    const after = afterByNormalized.get(normalizedColumn(column));
    return after ? [{ before: column, after, label: column }] : [];
  });
  const pairedBefore = new Set(pairs.map((pair) => pair.before));
  const pairedAfter = new Set(pairs.map((pair) => pair.after));
  const addedColumns = validAfter.filter((column) => !pairedAfter.has(column));
  const removedColumns = validBefore.filter((column) => !pairedBefore.has(column));
  const overlap = pairs.length / Math.max(1, validBefore.length, validAfter.length);
  if (!pairs.length || overlap < 0.5) {
    return {
      status: "incompatible",
      reason: "Os cabeçalhos mudaram demais para comparar as linhas com segurança.",
      added: 0,
      removed: 0,
      changed: 0,
      addedColumns,
      removedColumns,
      typeChanges: [],
      invalidColumns,
      comparisonMethod: "none",
    };
  }
  const typeChanges = pairs.flatMap((pair) => {
    const before = valueKind(previous.find((row) => row[pair.before] != null)?.[pair.before]);
    const after = valueKind(next.find((row) => row[pair.after] != null)?.[pair.after]);
    return before !== after ? [{ column: pair.label, before, after }] : [];
  });
  const identity = stableIdentity(pairs, previous, next);
  let added = 0;
  let removed = 0;
  let changed = 0;
  let comparisonMethod: VersionDiff["comparisonMethod"];
  if (identity.length) {
    comparisonMethod = "key";
    const beforeRows = new Map(previous.map((row) => [rowKey(row, identity, "before"), row]));
    const afterRows = new Map(next.map((row) => [rowKey(row, identity, "after"), row]));
    added = [...afterRows.keys()].filter((key) => !beforeRows.has(key)).length;
    removed = [...beforeRows.keys()].filter((key) => !afterRows.has(key)).length;
    changed = [...afterRows].filter(
      ([key, row]) => beforeRows.has(key) && rowsDiffer(beforeRows.get(key)!, row, pairs),
    ).length;
  } else if (previous.length === next.length) {
    comparisonMethod = "position";
    changed = next.filter((row, index) => rowsDiffer(previous[index]!, row, pairs)).length;
  } else {
    comparisonMethod = "shared-values";
    const fingerprint = (row: Row, side: "before" | "after") => rowKey(row, pairs, side);
    const beforeCounts = new Map<string, number>();
    const afterCounts = new Map<string, number>();
    for (const row of previous) {
      const key = fingerprint(row, "before");
      beforeCounts.set(key, (beforeCounts.get(key) ?? 0) + 1);
    }
    for (const row of next) {
      const key = fingerprint(row, "after");
      afterCounts.set(key, (afterCounts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of afterCounts)
      added += Math.max(0, count - (beforeCounts.get(key) ?? 0));
    for (const [key, count] of beforeCounts)
      removed += Math.max(0, count - (afterCounts.get(key) ?? 0));
  }
  return {
    status: invalidColumns.length || overlap < 0.8 ? "warning" : "ok",
    ...(invalidColumns.length
      ? {
          reason:
            "Um cabeçalho inválido foi ignorado; confirme a estrutura antes de confiar na comparação.",
        }
      : overlap < 0.8
        ? {
            reason:
              "Algumas colunas mudaram; a comparação usou apenas as colunas reconhecidas nas duas versões.",
          }
        : {}),
    added,
    removed,
    changed,
    addedColumns,
    removedColumns,
    typeChanges,
    invalidColumns,
    comparisonMethod,
  };
}

export function buildSheetHealth(diagnostics: ImportDiagnostics): SheetHealth {
  const filled = diagnostics.columns.reduce((sum, column) => sum + column.filled, 0);
  const possible = Math.max(1, diagnostics.rowCount * diagnostics.columnCount);
  const brokenFormulas = diagnostics.formulaDiagnostics.filter(
    (formula) => !formula.supported,
  ).length;
  const anomalies = diagnostics.advancedQuality?.totalAnomalies ?? 0;
  const recommendations = [
    diagnostics.duplicateRows
      ? `Remover ou revisar ${diagnostics.duplicateRows} linha(s) duplicada(s).`
      : "",
    brokenFormulas
      ? `Recalcular ${brokenFormulas} fórmula(s) não suportada(s) no arquivo original.`
      : "",
    diagnostics.header.confidence < 0.7 ? "Confirmar manualmente a linha do cabeçalho." : "",
    diagnostics.tableRegions.length > 1
      ? "Escolher manualmente a região que deve ser importada."
      : "",
    anomalies ? `Revisar ${anomalies} possível(is) anomalia(s) estatística(s).` : "",
    ...diagnostics.suggestedNormalization.map((item) => `Aplicar: ${item}.`),
  ].filter(Boolean);
  return {
    compatibility: diagnostics.confidence,
    structuralConfidence: Math.round(diagnostics.header.confidence * 100),
    dataQuality: diagnostics.qualityScore,
    completeness: Math.round((filled / possible) * 100),
    duplicateRows: diagnostics.duplicateRows,
    brokenFormulas,
    anomalies,
    recommendations,
  };
}
