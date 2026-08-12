import { describe, expect, it } from "vitest";
import { MAX_WORKBOOK_BYTES, readWorkbookFile } from "./workbook-reader-client";

describe("limite de arquivo", () => {
  it("rejeita arquivo enorme antes de alocar o ArrayBuffer", async () => {
    const file = {
      name: "enorme.xlsx",
      size: MAX_WORKBOOK_BYTES + 1,
      arrayBuffer: () => {
        throw new Error("não deveria ler");
      },
    } as unknown as File;
    await expect(readWorkbookFile(file)).rejects.toThrow("limite de 100 MB");
  });
});
