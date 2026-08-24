import { expect, test } from "@playwright/test";

test("avisa sobre uma versão nova e preserva a leitura no navegador", async ({ page }) => {
  await page.goto("/");

  const unreadButton = page.getByRole("button", { name: "Novidades disponíveis" });
  await expect(unreadButton).toBeVisible();
  await expect(page.getByTestId("update-unread-indicator")).toHaveClass(/opacity-100/);

  await unreadButton.click();
  const dialog = page.getByRole("dialog", { name: "Atualizações do OliQualidade" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("v0.4.0-beta.2").first()).toBeVisible();
  await expect(
    dialog.getByText("Correções de estabilidade em datas, cores, fórmulas e leitura automática"),
  ).toBeVisible();
  await expect(dialog.getByText("Investigação guiada para entender o resultado")).toBeVisible();
  await expect(dialog.getByText("Gráfico de área com leitura mais clara")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("button", { name: "Ver atualizações" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Ver atualizações" })).toBeVisible();
  await expect(page.getByTestId("update-unread-indicator")).toHaveClass(/opacity-0/);
});
