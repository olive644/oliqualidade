import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
};

describe("modo privado", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("indexedDB", undefined);
  });

  it("salva painéis somente na sessão quando ativado", async () => {
    const { DASH_KEY, isPrivateMode, loadDashboards, saveDashboards, setPrivateMode } =
      await import("./storage");
    setPrivateMode(true);
    expect(isPrivateMode()).toBe(true);
    const dashboard = {
      id: "private",
      name: "Privado",
      sheets: [],
      activeSheetIndex: 0,
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
    };
    await saveDashboards([dashboard]);
    expect(localStorage.getItem(DASH_KEY)).toBeNull();
    expect((await loadDashboards())[0]?.id).toBe("private");
  });
});
