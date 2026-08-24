import { describe, expect, it } from "vitest";
import { parseViewMode } from "./view-mode";

describe("parseViewMode", () => {
  it("reconhece o modo leitura salvo", () => {
    expect(parseViewMode("reading")).toBe("reading");
  });

  it("cai em edição para qualquer coisa inesperada", () => {
    // Sem valor salvo, com valor de uma versão futura ou com lixo no
    // armazenamento, a tela de trabalho é o padrão seguro: esconder as
    // ferramentas de quem está montando o painel seria a falha mais confusa.
    expect(parseViewMode(null)).toBe("editing");
    expect(parseViewMode("editing")).toBe("editing");
    expect(parseViewMode("qualquer-coisa")).toBe("editing");
  });
});
