import { describe, expect, it } from "vitest";

import { EXPORT_TABLE_PREVIEW_LIMIT, exportTablePreviewRows } from "@/lib/table-export-preview";

describe("exportTablePreviewRows", () => {
  it("preserva todas as linhas de uma tabela pequena", () => {
    const rows = [{ value: "A" }, { value: "B" }];
    expect(exportTablePreviewRows(rows)).toEqual(rows);
  });

  it("limita a prévia sem alterar a base original", () => {
    const rows = Array.from({ length: EXPORT_TABLE_PREVIEW_LIMIT + 4 }, (_, index) => ({ index }));
    expect(exportTablePreviewRows(rows)).toHaveLength(EXPORT_TABLE_PREVIEW_LIMIT);
    expect(rows).toHaveLength(EXPORT_TABLE_PREVIEW_LIMIT + 4);
  });
});
