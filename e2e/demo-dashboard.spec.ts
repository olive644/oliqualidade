import { expect, test } from "@playwright/test";

/**
 * Primeiro teste E2E do projeto: fluxo "dados de demonstração" completo,
 * do carregamento inicial até um painel real renderizado com widgets.
 * Não depende de upload de arquivo (sem diálogo nativo), então serve como
 * um caminho estável para verificar que o app sobe e navega de ponta a
 * ponta num navegador real — algo que a verificação manual via preview do
 * Vercel (ver CURRENT_STATE_AUDIT.md) não substitui para regressão contínua.
 */
test("carrega dados de demonstração e chega a um painel com widgets", async ({ page }) => {
  await page.goto("/");
  // A hidratação do SSR (TanStack Start) ainda não terminou logo após o load
  // event: um clique disparado antes dela é silenciosamente perdido (o HTML
  // já está na tela, mas o onClick do React ainda não foi conectado).
  // Confirmado ao vivo: sem esta espera, o primeiro clique não navega e só o
  // segundo funciona — não é flakiness de CI, é uma corrida real.
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { name: "Oli.Qualidade" }).first()).toBeVisible();

  await page.getByRole("button", { name: /ver demonstração/i }).click();

  await expect(page.getByText("Confirme como cada coluna deve ser lida")).toBeVisible();

  await page.getByRole("button", { name: /gerar relatório/i }).click();

  await expect(page.getByRole("button", { name: /adicionar widget|widget/i }).first()).toBeVisible({
    timeout: 15_000,
  });
});
