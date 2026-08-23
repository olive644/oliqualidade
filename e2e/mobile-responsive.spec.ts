import { expect, test } from "@playwright/test";

test.describe("iPhone responsive shell", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });

  test("reaches a dashboard without overflow and keeps touch actions accessible", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Oli.Qualidade" }).first()).toBeVisible();

    const landingOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(landingOverflow).toBe(false);

    await page.getByRole("button", { name: /ver demonstração/i }).click();

    await expect(page.getByText("Confirme como cada coluna deve ser lida")).toBeVisible();
    await page.getByRole("checkbox", { name: /cabeçalho/i }).check();
    await page.getByRole("checkbox", { name: /intervalo de linhas/i }).check();
    await page.getByRole("checkbox", { name: /tipos das colunas/i }).check();
    await page.getByRole("button", { name: /gerar relatório/i }).click();

    await expect(page.locator(".oliam-app-shell")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".oliam-dashboard-topbar")).toBeVisible();

    const dashboardOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(dashboardOverflow).toBe(false);

    await page.getByRole("button", { name: "Mostrar visão geral" }).click();
    const insightDialog = page.getByRole("dialog", { name: "Visão geral da análise" });
    await expect(insightDialog).toBeVisible();
    await expect(insightDialog.getByText("Visão geral", { exact: true })).toBeVisible();
    await insightDialog.getByRole("button", { name: "Fechar visão geral" }).click();
    await expect(insightDialog).toBeHidden();

    const tooSmallActions = await page
      .locator(".oliam-dashboard-topbar button:visible")
      .evaluateAll(
        (buttons) =>
          buttons
            .map((button) => button.getBoundingClientRect())
            .filter((box) => box.width < 44 || box.height < 44).length,
      );
    expect(tooSmallActions).toBe(0);
  });
});
