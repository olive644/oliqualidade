import { describe, expect, it } from "vitest";
import { leadingNumberOf, ordinalRanks } from "./ordinal-categories";

const order = (names: string[]) => {
  const ranks = ordinalRanks(names);
  return ranks ? [...names].sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0)) : null;
};

describe("ordinalRanks", () => {
  it("reconhece meses por extenso fora de ordem", () => {
    expect(order(["Março", "Janeiro", "Fevereiro"])).toEqual(["Janeiro", "Fevereiro", "Março"]);
  });

  it("reconhece meses abreviados, com e sem acento", () => {
    expect(order(["Dez", "Jan", "Mar"])).toEqual(["Jan", "Mar", "Dez"]);
  });

  it("reconhece dias da semana", () => {
    expect(order(["Sexta", "Segunda", "Quarta"])).toEqual(["Segunda", "Quarta", "Sexta"]);
  });

  it("reconhece turnos", () => {
    expect(order(["Noite", "Manhã", "Tarde"])).toEqual(["Manhã", "Tarde", "Noite"]);
  });

  it("reconhece trimestres escritos de formas diferentes", () => {
    expect(order(["3º Trimestre", "1º Trimestre", "2º Trimestre"])).toEqual([
      "1º Trimestre",
      "2º Trimestre",
      "3º Trimestre",
    ]);
  });

  it("reconhece escala de satisfação", () => {
    expect(order(["Ótimo", "Péssimo", "Regular", "Bom"])).toEqual([
      "Péssimo",
      "Regular",
      "Bom",
      "Ótimo",
    ]);
  });

  it("reconhece escala de concordância", () => {
    expect(order(["Concordo", "Discordo totalmente", "Neutro"])).toEqual([
      "Discordo totalmente",
      "Neutro",
      "Concordo",
    ]);
  });

  it("ordena faixas de valor pelo início da faixa, não pelo texto", () => {
    // Alfabeticamente "10 a 20" viria antes de "5 a 10"; a faixa precisa da
    // ordem numérica.
    expect(order(["10 a 20", "5 a 10", "20 a 50"])).toEqual(["5 a 10", "10 a 20", "20 a 50"]);
  });

  it("coloca a faixa sem piso no começo da escala", () => {
    expect(order(["10 a 20", "Até 10", "20 a 50"])).toEqual(["Até 10", "10 a 20", "20 a 50"]);
  });

  it("ordena etapas numeradas pela numeração", () => {
    expect(order(["3. Expedição", "1. Recebimento", "2. Inspeção"])).toEqual([
      "1. Recebimento",
      "2. Inspeção",
      "3. Expedição",
    ]);
  });

  it("não inventa sequência para categorias comuns", () => {
    expect(ordinalRanks(["Linha A", "Linha B", "Linha C"])).toBeNull();
    expect(ordinalRanks(["São Paulo", "Bahia", "Ceará"])).toBeNull();
  });

  it("não reconhece sequência com menos de três categorias", () => {
    // Duas categorias não formam progressão visível, e aceitar duas
    // aumentaria o risco de trocar a ordem de um ranking de dois itens.
    expect(ordinalRanks(["Janeiro", "Fevereiro"])).toBeNull();
  });

  it("não reconhece escala quando uma categoria fica de fora", () => {
    expect(ordinalRanks(["Janeiro", "Fevereiro", "Março", "Total"])).toBeNull();
  });

  it("não reconhece escala quando duas categorias caem no mesmo degrau", () => {
    // "Média" e "Moderado" são o mesmo degrau de intensidade: sem ordem
    // única entre elas, não há sequência a preservar.
    expect(ordinalRanks(["Baixo", "Média", "Moderado"])).toBeNull();
  });
});

describe("leadingNumberOf", () => {
  it("lê número com separador de milhar e vírgula decimal brasileiros", () => {
    expect(leadingNumberOf("R$ 1.500,50 a R$ 2.000,00")).toBeCloseTo(1500.5, 10);
  });

  it("devolve null quando não há número", () => {
    expect(leadingNumberOf("Linha A")).toBeNull();
  });
});
