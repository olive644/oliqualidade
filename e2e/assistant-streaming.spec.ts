import { expect, test, type Page } from "@playwright/test";

/**
 * Verificação da conversa do assistente num navegador de verdade, nas larguras
 * reais de aparelho e nos dois temas.
 *
 * O provedor é substituído no próprio navegador, e não por `page.route`, porque
 * `route.fulfill` entrega o corpo inteiro de uma vez: com ele não existe o
 * estado que interessa aqui, que é o da resposta chegando. O substituto abaixo
 * devolve um `ReadableStream` controlado pelo teste, o que permite observar o
 * texto aparecendo, o botão de parar e o estado de resposta interrompida sem
 * gastar um único token da API paga.
 */

const LARGURAS = [320, 360, 390, 414, 768] as const;

const STUB = `
  window.__oliStream = { send: null, close: null };
  const originalFetch = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.includes("/api/gemini/chat")) return originalFetch(input, init);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        window.__oliStream.send = (payload) => controller.enqueue(encoder.encode(payload));
        window.__oliStream.close = () => {
          try {
            controller.close();
          } catch {}
        };
        init?.signal?.addEventListener("abort", () => {
          try {
            controller.error(new DOMException("aborted", "AbortError"));
          } catch {}
        });
      },
    });
    return Promise.resolve(
      new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    );
  };
`;
const delta = (text: string) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`;

async function irAoPainel(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /ver demonstração/i }).click();
  await expect(page.getByText("Confirme como cada coluna deve ser lida")).toBeVisible();
  await page.getByRole("checkbox", { name: /cabeçalho/i }).check();
  await page.getByRole("checkbox", { name: /intervalo de linhas/i }).check();
  await page.getByRole("checkbox", { name: /tipos das colunas/i }).check();
  await page.getByRole("button", { name: /gerar relatório/i }).click();
  await expect(page.locator(".oliam-app-shell")).toBeVisible({ timeout: 30_000 });
}

async function perguntar(page: Page, pergunta = "Qual é o total?") {
  // O cartão de boas-vindas nasce por cima do mascote nas telas estreitas e
  // engole o clique. Fechá-lo é o que a pessoa faria.
  const boasVindas = page.getByRole("button", { name: "Fechar boas-vindas" });
  if (await boasVindas.isVisible().catch(() => false)) await boasVindas.click();
  // O mascote tem animação própria e o Playwright espera um elemento parar de
  // se mexer antes de clicar. O alvo aqui é a conversa, não a animação dele,
  // então a espera é pela visibilidade e o clique é forçado.
  const mascote = page.getByRole("button", { name: "Conversar com Oli" });
  await expect(mascote).toBeVisible({ timeout: 30_000 });
  await mascote.click({ force: true });
  await page.getByLabel("Mensagem para o assistente").fill(pergunta);
  await page.getByRole("button", { name: "Enviar mensagem" }).click();
}

for (const width of LARGURAS) {
  test.describe(`conversa do assistente em ${width}px`, () => {
    test.use({
      viewport: { width, height: 844 },
      screen: { width, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      // O mascote respira o tempo todo, e o Playwright espera um elemento
      // parar de se mexer antes de clicar. Pedir menos movimento é o que a
      // folha de estilo já sabe atender, e de quebra exercita esse caminho.
      reducedMotion: "reduce",
    });

    test("mostra o texto chegando, oferece parar e não transborda", async ({ page }) => {
      test.setTimeout(120_000);
      await page.addInitScript(STUB);
      await irAoPainel(page);
      await perguntar(page);

      const parar = page.getByRole("button", { name: /Parar resposta/ });
      await expect(parar).toBeVisible();

      const alvo = await parar.boundingBox();
      expect(alvo, `alvo de toque do botão de parar em ${width}px`).not.toBeNull();
      expect(alvo!.height, `altura do alvo em ${width}px`).toBeGreaterThanOrEqual(44);
      expect(alvo!.width, `largura do alvo em ${width}px`).toBeGreaterThanOrEqual(44);

      await page.evaluate(
        (payload) => window.__oliStream.send(payload),
        delta("Somando a coluna de valores da visão atual. "),
      );
      await expect(page.locator('[data-status="gerando"]')).toContainText("Somando a coluna");

      const transbordo = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(transbordo, `transbordo horizontal com o assistente aberto em ${width}px`).toBe(false);

      await parar.click();
      await expect(page.locator('[data-status="interrompida"]')).toBeVisible();
      await expect(page.locator('[data-status="interrompida"]')).toContainText("Somando a coluna");
      await expect(page.getByText("Resposta interrompida.")).toBeVisible();

      // A conversa volta a aceitar pergunta logo depois da interrupção.
      await page.getByLabel("Mensagem para o assistente").fill("E o maior valor?");
      await expect(page.getByRole("button", { name: "Enviar mensagem" })).toBeEnabled();
    });
  });
}

test.describe("conversa do assistente no computador", () => {
  test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });

  test("alcança o botão de parar pelo teclado e legenda o estado", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(STUB);
    await irAoPainel(page);
    await perguntar(page);

    const parar = page.getByRole("button", { name: /Parar resposta/ });
    await expect(parar).toBeVisible();

    // Foco por teclado e acionamento por Enter: nada aqui depende de ponteiro.
    await parar.focus();
    await expect(parar).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-status="interrompida"]')).toBeVisible();

    // Depois da interrupção, o caminho de tentar de novo fica disponível.
    await expect(page.getByRole("button", { name: /Tentar novamente/ })).toBeVisible();
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`mantém a linha de estado legível no tema ${colorScheme}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.addInitScript(STUB);
      await irAoPainel(page);
      await perguntar(page);

      const cores = await page.locator(".oli-chat-stop").evaluate((node) => {
        const estilo = getComputedStyle(node);
        return {
          cor: estilo.color,
          fundo: estilo.backgroundColor,
          alturaMinima: estilo.minHeight,
        };
      });

      expect(cores.alturaMinima).toBe("44px");
      expect(cores.cor, "o texto do botão não pode sumir no próprio fundo").not.toBe(cores.fundo);
      expect(cores.fundo).not.toBe("rgba(0, 0, 0, 0)");
    });
  }
});

declare global {
  interface Window {
    __oliStream: { send: (payload: string) => void; close: () => void };
  }
}
