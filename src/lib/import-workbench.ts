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
  added: number;
  removed: number;
  changed: number;
  addedColumns: string[];
  removedColumns: string[];
  typeChanges: { column: string; before: string; after: string }[];
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

export function compareVersions(previous: Row[], next: Row[]): VersionDiff {
  const beforeColumns = Object.keys(previous[0] ?? {});
  const afterColumns = Object.keys(next[0] ?? {});
  const beforeSet = new Set(beforeColumns);
  const afterSet = new Set(afterColumns);
  const fingerprint = (row: Row) => JSON.stringify(row);
  const beforeRows = new Map(previous.map((row) => [fingerprint(row), row]));
  const afterRows = new Map(next.map((row) => [fingerprint(row), row]));
  const added = [...afterRows.keys()].filter((key) => !beforeRows.has(key)).length;
  const removed = [...beforeRows.keys()].filter((key) => !afterRows.has(key)).length;
  const shared = beforeColumns.filter((column) => afterSet.has(column));
  const typeChanges = shared.flatMap((column) => {
    const before = valueKind(previous.find((row) => row[column] != null)?.[column]);
    const after = valueKind(next.find((row) => row[column] != null)?.[column]);
    return before !== after ? [{ column, before, after }] : [];
  });
  return {
    added,
    removed,
    changed: Math.min(added, removed),
    addedColumns: afterColumns.filter((column) => !beforeSet.has(column)),
    removedColumns: beforeColumns.filter((column) => !afterSet.has(column)),
    typeChanges,
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
