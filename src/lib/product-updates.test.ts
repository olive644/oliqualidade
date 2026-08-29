import { describe, expect, it } from "vitest";
import {
  APP_VERSION,
  APP_VERSION_LABEL,
  CURRENT_UPDATE_ID,
  hasUnreadProductUpdate,
} from "./product-updates";
import { PRODUCT_UPDATES } from "./product-updates-entries";

describe("product updates", () => {
  it("mantém a leitura ligada à versão atual", () => {
    expect(CURRENT_UPDATE_ID).toBe(APP_VERSION);
    expect(APP_VERSION_LABEL).toBe(`v${APP_VERSION}`);
    expect(new Set(PRODUCT_UPDATES.map((update) => update.id)).size).toBe(PRODUCT_UPDATES.length);
  });

  it("cada registro guarda a versão em que saiu, e não a versão de hoje", () => {
    // A garantia anterior era o contrário disto: exigia que **toda** entrada
    // tivesse `APP_VERSION`. Com ela, o histórico inteiro se renomeava a cada
    // release, e o sino dizia que uma correção de agosto saiu na versão de
    // hoje. O teste que deveria proteger o registro era o que o apagava.
    for (const update of PRODUCT_UPDATES)
      expect(update.version).toMatch(/^\d+\.\d+\.\d+-beta\.\d+$/);
    expect(new Set(PRODUCT_UPDATES.map((update) => update.version)).size).toBeGreaterThan(1);
  });

  it("a entrada mais nova é a da versão atual, senão o sino não acende", () => {
    // `CURRENT_UPDATE_ID` é `APP_VERSION`, e é ele que decide se há novidade
    // não lida. Uma release sem entrada própria acende o sino para mostrar o
    // que já estava lá.
    expect(PRODUCT_UPDATES[0]?.version).toBe(APP_VERSION);
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
