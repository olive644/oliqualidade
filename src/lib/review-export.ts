import { safeSpreadsheetValue } from "@/lib/encrypted-backup";
import { compareVersions, type VersionDiff } from "@/lib/import-workbench";
import type { AuditEntry } from "@/lib/data-review";
import type { Dashboard, Row, SheetData, Value } from "@/lib/types";

export const REVIEW_INTERPRETER_VERSION = "oli-review-1";

const actionLabel: Record<AuditEntry["action"], string> = {
  "cell-correction": "Correção de célula",
  "exception-resolved": "Exceção resolvida",
  "exception-ignored": "Exceção ignorada",
  "exception-reopened": "Exceção reaberta",
};

const scalar = (value: Value | undefined) =>
  value === null || value === undefined ? "" : typeof value === "boolean" ? String(value) : value;

export type AuditExportRow = Row & {
  Painel: string;
  Aba: string;
  Origem: string;
  Data: string;
  Ação: string;
  Local: string;
  Linha: number | null;
  Coluna: string;
  Antes: Value;
  Depois: Value;
  Motivo: string;
  Usuário: string;
  "Ajuste manual": string;
  "Versão do interpretador": string;
};

export type ComparisonExportRow = Row & {
  Painel: string;
  Aba: string;
  Status: string;
  Método: string;
  Tipo: string;
  Linha: number | null;
  Identidade: string;
  Coluna: string;
  Antes: Value;
  Depois: Value;
  Observação: string;
};

export function auditExportRows(dashboard: Dashboard): AuditExportRow[] {
  return dashboard.sheets.flatMap((sheet) =>
    (sheet.auditTrail ?? []).map((entry) => ({
      Painel: dashboard.name,
      Aba: sheet.name,
      Origem: dashboard.sourceFileName ?? dashboard.name,
      Data: new Date(entry.timestamp).toISOString(),
      Ação: actionLabel[entry.action],
      Local:
        entry.address ??
        [entry.rowIndex ? `linha ${entry.rowIndex}` : "", entry.columnKey ?? ""]
          .filter(Boolean)
          .join(" · "),
      Linha: entry.rowIndex ?? null,
      Coluna: entry.columnKey ?? "",
      Antes: scalar(entry.before),
      Depois: scalar(entry.after),
      Motivo: entry.reason,
      Usuário: entry.actor ?? "Usuário local",
      "Ajuste manual": entry.action === "cell-correction" ? "Sim" : "Não",
      "Versão do interpretador": entry.interpreterVersion ?? REVIEW_INTERPRETER_VERSION,
    })),
  );
}

function structuralComparisonRows(
  dashboard: Dashboard,
  sheet: SheetData,
  diff: VersionDiff,
): ComparisonExportRow[] {
  const base = {
    Painel: dashboard.name,
    Aba: sheet.name,
    Status: diff.status,
    Método: diff.comparisonMethod,
    Linha: null,
    Identidade: "",
    Antes: "" as Value,
    Depois: "" as Value,
  };
  return [
    ...diff.addedColumns.map((column) => ({
      ...base,
      Tipo: "Coluna adicionada",
      Coluna: column,
      Observação: "Presente apenas na versão atual.",
    })),
    ...diff.removedColumns.map((column) => ({
      ...base,
      Tipo: "Coluna removida",
      Coluna: column,
      Observação: "Presente apenas na versão anterior.",
    })),
    ...diff.typeChanges.map((change) => ({
      ...base,
      Tipo: "Tipo alterado",
      Coluna: change.column,
      Antes: change.before,
      Depois: change.after,
      Observação: "O tipo predominante da coluna mudou.",
    })),
  ];
}

export function comparisonExportRows(dashboard: Dashboard): ComparisonExportRow[] {
  return dashboard.sheets.flatMap((sheet) => {
    if (!sheet.previousSnapshot) return [];
    const diff = compareVersions(sheet.previousSnapshot.rows, sheet.rows);
    const base = {
      Painel: dashboard.name,
      Aba: sheet.name,
      Status: diff.status,
      Método: diff.comparisonMethod,
    };
    const summary: ComparisonExportRow = {
      ...base,
      Tipo: "Resumo",
      Linha: null,
      Identidade: "",
      Coluna: "",
      Antes: "",
      Depois: "",
      Observação: `${diff.added} adicionada(s); ${diff.removed} removida(s); ${diff.changed} alterada(s).${diff.reason ? ` ${diff.reason}` : ""}`,
    };
    return [
      summary,
      ...diff.cellChanges.map((change) => ({
        ...base,
        Tipo: "Célula alterada",
        Linha: change.row,
        Identidade: change.identity,
        Coluna: change.column,
        Antes: scalar(change.before),
        Depois: scalar(change.after),
        Observação: "Valor diferente entre as duas versões.",
      })),
      ...structuralComparisonRows(dashboard, sheet, diff),
    ];
  });
}

const csvCell = (value: unknown) => {
  const safe = safeSpreadsheetValue(
    value === null || value === undefined
      ? ""
      : typeof value === "number" || typeof value === "boolean"
        ? value
        : String(value),
  );
  return `"${String(safe).replaceAll('"', '""')}"`;
};

export function rowsToCsv(rows: Row[]): string {
  if (!rows.length) return "\uFEFF";
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `\uFEFF${[
    headers.map(csvCell).join(";"),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(";")),
  ].join("\r\n")}`;
}

export function reviewReportSections(dashboard: Dashboard) {
  return {
    generatedAt: new Date().toISOString(),
    audit: auditExportRows(dashboard),
    comparison: comparisonExportRows(dashboard),
  };
}
