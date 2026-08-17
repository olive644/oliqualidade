export type SanitizationSummary = {
  sheets: number;
  cells: number;
  sheetsRenamed: number;
  stringsSanitized: number;
  numbersSanitized: number;
  datesSanitized: number;
  formulasSanitized: number;
  hyperlinksRemoved: number;
  commentsRemoved: number;
};

export function sanitizeWorkbookBytes(
  input: Uint8Array,
  options: { salt: string; workbookId?: string; bookType?: "xlsx" | "xlsm" },
): { bytes: Buffer; summary: SanitizationSummary };

export function sha256(input: Uint8Array): string;
export function privateSourceId(input: Uint8Array, salt: string): string;
