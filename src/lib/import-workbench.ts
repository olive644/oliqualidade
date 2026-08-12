import type { Row } from "@/lib/types";
import type { ImportDiagnostics } from "@/lib/import-intelligence";
import type { SourceGrid } from "@/lib/import";

export type SourceSelection = {
  headerRow: number;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

export type ImportSelection = {
  startRow: number;
  endRow: number;
  ignoredColumns: string[];
  source?: SourceSelection;
};

export type ImportProfile = {
  id: string;
  name: string;
  signature: string;
  selection: ImportSelection;
  columns?: { name: string; kind: string }[];
  rowCount?: number;
  filePattern?: string;
  sourceBounds?: { startRow: number; endRow: number; startColumn: number; endColumn: number };
  createdAt: number;
  updatedAt: number;
};

export type ImportProfileMatch = {
  profile: ImportProfile;
  exact: boolean;
  confidence: number;
  selection: ImportSelection;
  changes: {
    renamedColumns: { before: string; after: string }[];
    addedColumns: string[];
    removedColumns: string[];
    reordered: boolean;
  };
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

export function rowsFromSourceGrid(grid: SourceGrid, selection: SourceSelection): Row[] {
  const headerIndex = selection.headerRow - grid.startRow;
  const firstRowIndex = selection.startRow - grid.startRow;
  const lastRowIndex = selection.endRow - grid.startRow;
  const firstColumnIndex = selection.startColumn - grid.startColumn;
  const lastColumnIndex = selection.endColumn - grid.startColumn;
  if (
    headerIndex < 0 ||
    firstRowIndex <= headerIndex ||
    lastRowIndex < firstRowIndex ||
    firstColumnIndex < 0 ||
    lastColumnIndex < firstColumnIndex ||
    lastRowIndex >= grid.rows.length ||
    lastColumnIndex >= (grid.rows[0]?.length ?? 0)
  ) {
    return [];
  }

  const seen = new Map<string, number>();
  const headers = Array.from({ length: lastColumnIndex - firstColumnIndex + 1 }, (_, offset) => {
    const raw = grid.rows[headerIndex]?.[firstColumnIndex + offset];
    const base = String(raw ?? "").trim() || `coluna_${selection.startColumn + offset}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });

  return grid.rows
    .slice(firstRowIndex, lastRowIndex + 1)
    .map((sourceRow) =>
      Object.fromEntries(
        headers.map((header, offset) => [header, sourceRow[firstColumnIndex + offset] ?? null]),
      ),
    )
    .filter((row) => Object.values(row).some((value) => value !== null && value !== ""));
}

export function applyImportSelection(
  rows: Row[],
  selection: ImportSelection,
  sourceGrid?: SourceGrid,
): Row[] {
  const selectedRows =
    selection.source && sourceGrid ? rowsFromSourceGrid(sourceGrid, selection.source) : rows;
  const start = Math.max(0, selection.startRow - 1);
  const end = Math.max(start, Math.min(selectedRows.length, selection.endRow));
  const ignored = new Set(selection.ignoredColumns);
  return selectedRows
    .slice(selection.source ? 0 : start, selection.source ? selectedRows.length : end)
    .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !ignored.has(key))));
}

export function workbookSignature(rows: Row[]): string {
  const keys = Object.keys(rows[0] ?? {}).sort();
  return keys
    .map((key) => `${key}:${typeof rows.find((row) => row[key] != null)?.[key]}`)
    .join("|");
}

const normalizeProfileText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function filePatternForProfile(fileName: string): string {
  return normalizeProfileText(fileName.replace(/\.[^.]+$/, ""))
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const profileColumns = (rows: Row[]) =>
  Object.keys(rows[0] ?? {}).map((name) => ({
    name,
    kind: typeof rows.find((row) => row[name] !== null && row[name] !== undefined)?.[name],
  }));

export function adaptImportProfile(
  profile: ImportProfile,
  rows: Row[],
  fileName: string,
  sourceGrid?: SourceGrid,
): ImportProfile {
  return {
    ...profile,
    signature: workbookSignature(rows),
    columns: profileColumns(rows),
    rowCount: rows.length,
    filePattern: filePatternForProfile(fileName),
    ...(sourceGrid
      ? {
          sourceBounds: {
            startRow: sourceGrid.startRow,
            endRow: sourceGrid.startRow + sourceGrid.rows.length - 1,
            startColumn: sourceGrid.startColumn,
            endColumn: sourceGrid.startColumn + (sourceGrid.rows[0]?.length ?? 1) - 1,
          },
        }
      : {}),
  };
}

const canonicalProfileTokens = (value: string) => {
  const aliases: Record<string, string> = {
    qtd: "quantidade",
    qtde: "quantidade",
    vlr: "valor",
    dt: "data",
    cod: "codigo",
    desc: "descricao",
    un: "unidade",
  };
  return new Set(
    normalizeProfileText(value)
      .split(" ")
      .filter(Boolean)
      .map((token) => aliases[token] ?? token),
  );
};

function profileColumnSimilarity(before: string, after: string): number {
  const left = canonicalProfileTokens(before);
  const right = canonicalProfileTokens(after);
  if (!left.size || !right.size) return 0;
  if ([...left].join(" ") === [...right].join(" ")) return 1;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / Math.max(1, union);
}

function profilePairs(profile: ImportProfile, rows: Row[]) {
  const before = profile.columns ?? [];
  const after = profileColumns(rows);
  const used = new Set<number>();
  const pairs: {
    before: string;
    after: string;
    score: number;
    beforeIndex: number;
    afterIndex: number;
  }[] = [];
  for (let beforeIndex = 0; beforeIndex < before.length; beforeIndex++) {
    const column = before[beforeIndex]!;
    let best: (typeof pairs)[number] | undefined;
    for (let afterIndex = 0; afterIndex < after.length; afterIndex++) {
      if (used.has(afterIndex)) continue;
      const candidate = after[afterIndex]!;
      const nameScore = profileColumnSimilarity(column.name, candidate.name);
      const score = nameScore * 0.8 + (column.kind === candidate.kind ? 0.2 : 0);
      if (score >= 0.55 && (!best || score > best.score))
        best = { before: column.name, after: candidate.name, score, beforeIndex, afterIndex };
    }
    if (best) {
      used.add(best.afterIndex);
      pairs.push(best);
    }
  }
  return { before, after, pairs };
}

export function matchImportProfile(
  profiles: ImportProfile[],
  rows: Row[],
  fileName = "",
  sourceGrid?: SourceGrid,
): ImportProfileMatch | undefined {
  const signature = workbookSignature(rows);
  const exact = profiles.find((profile) => profile.signature === signature);
  const candidates = exact ? [exact] : profiles.filter((profile) => profile.columns?.length);
  let best: ImportProfileMatch | undefined;

  for (const profile of candidates) {
    const columns = profilePairs(profile, rows);
    const isExact = profile.signature === signature;
    const coverage = isExact
      ? 1
      : columns.pairs.length / Math.max(1, columns.before.length, columns.after.length);
    const average = isExact
      ? 1
      : columns.pairs.reduce((sum, pair) => sum + pair.score, 0) /
        Math.max(1, columns.pairs.length);
    const confidence = isExact ? 1 : coverage * 0.65 + average * 0.35;
    const sameFilePattern =
      Boolean(profile.filePattern) && profile.filePattern === filePatternForProfile(fileName);
    if (!isExact && (confidence < 0.78 || (!sameFilePattern && confidence < 0.9))) continue;

    const mapping = new Map(columns.pairs.map((pair) => [pair.before, pair.after]));
    const selection: ImportSelection = {
      ...profile.selection,
      endRow:
        profile.rowCount && profile.selection.endRow >= profile.rowCount
          ? Math.max(1, rows.length)
          : profile.selection.endRow,
      ignoredColumns: profile.selection.ignoredColumns.flatMap((column) => {
        const mapped = mapping.get(column);
        return mapped ? [mapped] : isExact && Object.hasOwn(rows[0] ?? {}, column) ? [column] : [];
      }),
      ...(profile.selection.source
        ? {
            source: {
              ...profile.selection.source,
              ...(profile.sourceBounds &&
              sourceGrid &&
              profile.selection.source.endRow >= profile.sourceBounds.endRow
                ? { endRow: sourceGrid.startRow + sourceGrid.rows.length - 1 }
                : {}),
              ...(profile.sourceBounds &&
              sourceGrid &&
              profile.selection.source.endColumn >= profile.sourceBounds.endColumn
                ? {
                    endColumn: sourceGrid.startColumn + (sourceGrid.rows[0]?.length ?? 1) - 1,
                  }
                : {}),
            },
          }
        : {}),
    };
    const beforeNames = new Set(columns.before.map((column) => column.name));
    const afterNames = new Set(columns.after.map((column) => column.name));
    const match: ImportProfileMatch = {
      profile,
      exact: isExact,
      confidence: Math.round(confidence * 100),
      selection,
      changes: {
        renamedColumns: columns.pairs
          .filter((pair) => normalizeProfileText(pair.before) !== normalizeProfileText(pair.after))
          .map((pair) => ({ before: pair.before, after: pair.after })),
        addedColumns: [...afterNames].filter(
          (name) => !columns.pairs.some((pair) => pair.after === name),
        ),
        removedColumns: [...beforeNames].filter(
          (name) => !columns.pairs.some((pair) => pair.before === name),
        ),
        reordered: columns.pairs.some((pair) => pair.beforeIndex !== pair.afterIndex),
      },
    };
    if (!best || match.confidence > best.confidence) best = match;
    if (isExact) break;
  }
  return best;
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

export function matchingImportProfile(
  rows: Row[],
  fileName = "",
  sourceGrid?: SourceGrid,
): ImportProfileMatch | undefined {
  return matchImportProfile(loadImportProfiles(), rows, fileName, sourceGrid);
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
