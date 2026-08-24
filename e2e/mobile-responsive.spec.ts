import { expect, test } from "@playwright/test";

/**
 * Larguras de tela que representam o parque real de aparelhos:
 *
 * - 320px: o iPhone SE de primeira geração, o piso do que ainda aparece;
 * - 360px: a largura mais comum do Android intermediário;
 * - 390px: o iPhone moderno;
 * - 414px: o iPhone Plus/Max;
 * - 768px: o tablet em retrato, onde o layout de celular termina e o de
 *   computador começa — a fronteira é justamente onde as regras se cruzam.
 *
 * O teste original cobria só 390px, e quebra de layout não costuma aparecer
 * na largura em que foi desenhada: aparece no extremo estreito, onde falta
 * espaço, e na fronteira, onde duas regras disputam.
 */
const LARGURAS = [320, 360, 390, 414, 768];

for (const width of LARGURAS) {
  test.describe(`shell responsivo em ${width}px`, () => {
    test.use({
      viewport: { width, height: 844 },
      screen: { width, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    });

    test("chega ao painel sem transbordo e com alvos de toque acessíveis", async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      await expect(page.getByRole("heading", { name: "Oli.Qualidade" }).first()).toBeVisible();
      const transbordoInicial = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(transbordoInicial, `transbordo horizontal na tela inicial em ${width}px`).toBe(false);

      await page.getByRole("button", { name: /ver demonstração/i }).click();
      await expect(page.getByText("Confirme como cada coluna deve ser lida")).toBeVisible();
      await page.getByRole("checkbox", { name: /cabeçalho/i }).check();
      await page.getByRole("checkbox", { name: /intervalo de linhas/i }).check();
      await page.getByRole("checkbox", { name: /tipos das colunas/i }).check();
      await page.getByRole("button", { name: /gerar relatório/i }).click();

      await expect(page.locator(".oliam-app-shell")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".oliam-dashboard-topbar")).toBeVisible();
      await page.waitForTimeout(1500);

      const transbordoPainel = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(transbordoPainel, `transbordo horizontal no painel em ${width}px`).toBe(false);

      const alvosPequenos = await page
        .locator(".oliam-dashboard-topbar button:visible")
        .evaluateAll(
          (buttons) =>
            buttons
              .map((button) => button.getBoundingClientRect())
              .filter((box) => box.width < 44 || box.height < 44).length,
        );
      expect(alvosPequenos, `alvos de toque abaixo de 44px em ${width}px`).toBe(0);

      // A barra inferior existe até 700px e some a partir daí, onde a barra de
      // ferramentas já cabe inteira na tela.
      const barra = await page.evaluate(() => {
        const nav = document.querySelector(".oliam-mobile-nav");
        return nav ? getComputedStyle(nav).display : "ausente";
      });
      expect(barra === "none" || barra === "ausente", `barra inferior em ${width}px`).toBe(
        width > 700,
      );
    });
  });
}
