import { describe, expect, it } from "vitest";
import { stripXmlMarkup } from "./xml-text";

describe("stripXmlMarkup", () => {
  it("remove a marcação e mantém o texto", () => {
    expect(stripXmlMarkup("<t>Olá</t>")).toBe("Olá");
    expect(stripXmlMarkup("<r><t>a</t></r><r><t>b</t></r>")).toBe("ab");
  });

  it("não deixa marcação para trás em XML malformado", () => {
    // A remoção repete até estabilizar: uma passada só pode juntar pedaços e
    // formar uma tag nova que a primeira varredura não via.
    const resultado = stripXmlMarkup("<sc<script>ript>");
    expect(resultado).not.toContain("<");
  });

  it("não toca em entidade escapada, que é texto e não marcação", () => {
    // Uma célula com o texto literal "<b>" chega escapada. Remover aqui
    // apagaria justamente o que o usuário escreveu; a decodificação é o passo
    // seguinte, de propósito.
    expect(stripXmlMarkup("&lt;b&gt;negrito&lt;/b&gt;")).toBe("&lt;b&gt;negrito&lt;/b&gt;");
  });

  it("é idempotente", () => {
    const uma = stripXmlMarkup("<t>x</t>");
    expect(stripXmlMarkup(uma)).toBe(uma);
  });
});
