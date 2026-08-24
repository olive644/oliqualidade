import { describe, expect, it } from "vitest";
import { classifyStorageKey, formatBytes, measureStorage } from "./storage-usage";

const fakeStorage = (pares: Record<string, string>) =>
  Object.entries(pares).map(([key, value]) => ({ key, bytes: (key.length + value.length) * 2 }));

describe("classifyStorageKey", () => {
  it("separa o trabalho do usuário do cache que o app refaz sozinho", () => {
    expect(classifyStorageKey("oliam-dashboards")).toBe("dashboards");
    expect(classifyStorageKey("oliam-folder-monitor:abc")).toBe("dashboards");
    expect(classifyStorageKey("oliam-geocode-cache")).toBe("geocode");
    expect(classifyStorageKey("oliam-import-metrics")).toBe("metrics");
    expect(classifyStorageKey("oliam-theme")).toBe("preferences");
  });

  it("ignora chaves que não são do aplicativo", () => {
    // Outro site no mesmo navegador não é assunto desta tela, e oferecer
    // apagar dado de terceiro seria perigoso.
    expect(classifyStorageKey("qualquer-outra-coisa")).toBeNull();
  });

  it("reconhece as versões privadas das mesmas chaves", () => {
    expect(classifyStorageKey("oliam-private-dashboards")).toBe("dashboards");
    expect(classifyStorageKey("oliam-private-import-metrics")).toBe("metrics");
  });
});

describe("measureStorage", () => {
  it("agrupa por categoria e ordena do maior para o menor", () => {
    const items = measureStorage(
      fakeStorage({
        "oliam-dashboards": "x".repeat(500),
        "oliam-geocode-cache": "y".repeat(50),
        "oliam-theme": "dark",
        "site-alheio": "z".repeat(9999),
      }),
    );
    expect(items.map((item) => item.kind)).toEqual(["dashboards", "geocode", "preferences"]);
    expect(items[0]!.bytes).toBeGreaterThan(items[1]!.bytes);
  });

  it("marca como destrutivo só o que é trabalho do usuário", () => {
    const items = measureStorage(
      fakeStorage({ "oliam-dashboards": "x", "oliam-geocode-cache": "y" }),
    );
    expect(items.find((i) => i.kind === "dashboards")?.destructive).toBe(true);
    expect(items.find((i) => i.kind === "geocode")?.destructive).toBe(false);
  });
});

describe("formatBytes", () => {
  it("escreve o tamanho na unidade que a pessoa lê", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });
});
