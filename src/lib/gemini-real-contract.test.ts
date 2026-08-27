import { describe, expect, it } from "vitest";
import { handleGeminiChat } from "@/lib/gemini-server";
import type { GeminiDashboardInput } from "@/lib/gemini-security";

/**
 * Smoke test contra a API real do Gemini.
 *
 * Mock nenhum confirma sozinho o contrato do provedor: ele confirma o que foi
 * escrito no mock. Este arquivo fecha essa lacuna atravessando o caminho de
 * verdade, do proxy até a rede, e verificando as duas únicas coisas que o
 * produto depende do contrato: chegou pelo menos um trecho de texto, e a
 * geração terminou de forma reconhecida.
 *
 * Ele é desligado por padrão. Exige duas variáveis ao mesmo tempo,
 * `OLI_GEMINI_SMOKE=1` e `GEMINI_API_KEY`, para que ninguém gaste cota paga
 * sem ter pedido, e para que a verificação principal (`npm test`) continue
 * determinística e sem rede. Sem as duas, o teste é pulado, nunca falha, o que
 * também é o comportamento correto em bifurcação do repositório sem segredo.
 *
 * Como rodar, com a chave já exportada no ambiente:
 *
 *     OLI_GEMINI_SMOKE=1 npm run test:gemini-smoke
 *
 * O custo é uma pergunta de uma linha com resposta de uma palavra. A resposta
 * nunca é impressa: o que sai no terminal é a contagem de trechos e o tamanho
 * total, para o caso não ser diagnosticado às cegas.
 */

const chave = process.env["GEMINI_API_KEY"] ?? "";
const habilitado = process.env["OLI_GEMINI_SMOKE"] === "1" && chave.length > 0;

const dashboard: GeminiDashboardInput = {
  name: "Conferência",
  sheetName: "Números",
  columns: [{ key: "Valor", label: "Valor", kind: "number", visible: true, description: "" }],
  rows: [{ Valor: 2 }, { Valor: 2 }],
};

describe.skipIf(!habilitado)("contrato real da Interactions API", () => {
  it("entrega pelo menos um trecho de texto e uma finalização válida", async () => {
    const response = await handleGeminiChat(
      new Request("http://localhost/api/gemini/chat", {
        method: "POST",
        headers: { origin: "http://localhost", "x-forwarded-for": "smoke-real" },
        body: JSON.stringify({
          // Pergunta curta e determinística de propósito: o que se mede aqui
          // é o formato do fluxo, não a qualidade da análise.
          message: "Responda apenas com a soma da coluna Valor, sem explicar.",
          dashboard,
        }),
      }),
      { GEMINI_API_KEY: chave },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let bruto = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bruto += decoder.decode(chunk.value, { stream: true });
    }

    const deltas = bruto.split("event: delta").length - 1;
    const concluiu = bruto.includes("event: done");
    // Só números no terminal. O texto da resposta não é impresso em lugar
    // nenhum, nem em falha.
    console.info(
      `smoke do Gemini: ${deltas} trechos, ${bruto.length} bytes de protocolo, concluiu=${concluiu}`,
    );

    expect(deltas).toBeGreaterThan(0);
    expect(concluiu).toBe(true);
    expect(bruto).not.toContain("event: error");
  }, 60_000);
});
