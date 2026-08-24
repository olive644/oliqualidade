import { describe, expect, it } from "vitest";
import { CURRENT_UPDATE_ID, PRODUCT_UPDATES, hasUnreadProductUpdate } from "./product-updates";

describe("product updates", () => {
  it("mantém o identificador atual ligado à entrada mais recente", () => {
    expect(CURRENT_UPDATE_ID).toBe(PRODUCT_UPDATES.at(0)?.id);
    expect(new Set(PRODUCT_UPDATES.map((update) => update.id)).size).toBe(PRODUCT_UPDATES.length);
  });

  it("mantém o histórico pronto para leitura", () => {
    for (const update of PRODUCT_UPDATES) {
      expect(update.title).not.toHaveLength(0);
      expect(update.summary).not.toHaveLength(0);
      expect(update.highlights.length).toBeGreaterThan(0);
    }
  });

  it("considera lida somente a versão mais recente", () => {
    expect(hasUnreadProductUpdate(null)).toBe(true);
    expect(hasUnreadProductUpdate("versao-anterior")).toBe(true);
    expect(hasUnreadProductUpdate(CURRENT_UPDATE_ID)).toBe(false);
  });
});
