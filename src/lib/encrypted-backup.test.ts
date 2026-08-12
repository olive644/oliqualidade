import { describe, expect, it } from "vitest";
import {
  decryptDashboardBackup,
  encryptDashboardBackup,
  safeSpreadsheetValue,
} from "./encrypted-backup";
import type { Dashboard } from "./types";

const dashboard: Dashboard = {
  id: "1",
  name: "Teste",
  sheets: [],
  activeSheetIndex: 0,
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
};

describe("backup criptografado", () => {
  it("round-trip com AES-GCM e rejeita senha errada", async () => {
    const backup = await encryptDashboardBackup(dashboard, "uma senha bem forte");
    expect(backup).not.toContain('"name":"Teste"');
    await expect(decryptDashboardBackup(backup, "uma senha bem forte")).resolves.toEqual(dashboard);
    await expect(decryptDashboardBackup(backup, "senha completamente errada")).rejects.toThrow(
      /Senha/,
    );
  });

  it.each(["=SUM(A1:A2)", "+1+1", "-2+3", "@IMPORT", "\tcmd", "\rcmd"])(
    "neutraliza fórmula de planilha %s",
    (value) => expect(safeSpreadsheetValue(value)).toBe(`'${value}`),
  );
});
