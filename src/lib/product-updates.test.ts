import { describe, expect, it } from "vitest";
import {
  APP_VERSION,
  APP_VERSION_LABEL,
  CURRENT_UPDATE_ID,
  PRODUCT_UPDATES,
  hasUnreadProductUpdate,
} from "./product-updates";

describe("product updates", () => {
  it("mantém a leitura e os registros ligados à versão atual", () => {
    expect(CURRENT_UPDATE_ID).toBe(APP_VERSION);
    expect(APP_VERSION_LABEL).toBe(`v${APP_VERSION}`);
    expect(PRODUCT_UPDATES.every((update) => update.version === APP_VERSION)).toBe(true);
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
    expect(hasUnreadProductUpdate(APP_VERSION)).toBe(false);
  });
});
