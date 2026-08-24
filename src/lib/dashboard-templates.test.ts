import { describe, expect, it } from "vitest";
import { applyTemplateOrder, detectTemplate } from "./dashboard-templates";
import type { WidgetType } from "@/lib/types";

const rec = (widgetType: WidgetType, kind = "visualization") => ({ widgetType, kind });

describe("detectTemplate", () => {
  it("reconhece uma base de vendas", () => {
    expect(detectTemplate(["Data", "Produto", "Faturamento", "Vendedor"])?.template.id).toBe(
      "vendas",
    );
  });

  it("reconhece uma base de qualidade", () => {
    expect(detectTemplate(["Data", "Lote", "Resultado", "Limite superior"])?.template.id).toBe(
      "qualidade",
    );
  });

  it("não sugere nada com uma única coincidência", () => {
    // Uma coluna "Produto" numa planilha de estoque não faz dela uma base de
    // vendas; propor por uma coincidência seria pedir confiança num sorteio.
    expect(detectTemplate(["Produto", "Endereço", "Telefone"])).toBeNull();
  });

  it("não sugere nada em caso de empate", () => {
    expect(detectTemplate(["Faturamento", "Cliente", "Resultado", "Lote"])).toBeNull();
  });

  it("não sugere nada para colunas sem vocabulário conhecido", () => {
    expect(detectTemplate(["Coluna 1", "Coluna 2", "Coluna 3"])).toBeNull();
  });
});

describe("applyTemplateOrder", () => {
  it("põe na frente o que a finalidade lê primeiro", () => {
    const ordenado = applyTemplateOrder(
      [rec("pie"), rec("histogram"), rec("bar"), rec("control-chart")],
      "qualidade",
    );
    expect(ordenado.map((r) => r.widgetType)).toEqual(["control-chart", "histogram", "bar", "pie"]);
  });

  it("mantém o que o modelo não menciona, no fim e na ordem original", () => {
    // Descartar seria esconder uma leitura válida só porque o modelo não a
    // cita.
    const ordenado = applyTemplateOrder([rec("map"), rec("table"), rec("ranking")], "vendas");
    expect(ordenado.map((r) => r.widgetType)).toEqual(["ranking", "map", "table"]);
  });

  it("não tira os indicadores do topo nem a tabela do fim", () => {
    // A finalidade escolhe qual gráfico vem antes; ela não tem o direito de
    // desmontar a estrutura do painel. A primeira versão desta função
    // ordenava a lista inteira e mandava os indicadores para o fim.
    const painel = [rec("metric", "kpi"), rec("pie"), rec("histogram"), rec("table", "table")];
    const ordenado = applyTemplateOrder(painel, "qualidade");
    expect(ordenado.map((r) => r.widgetType)).toEqual(["metric", "histogram", "pie", "table"]);
  });

  it("devolve a lista intacta para um modelo desconhecido", () => {
    const original = [rec("bar"), rec("pie")];
    expect(applyTemplateOrder(original, "inexistente" as never).map((r) => r.widgetType)).toEqual([
      "bar",
      "pie",
    ]);
  });
});
