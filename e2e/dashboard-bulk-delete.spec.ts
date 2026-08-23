import { expect, test } from "@playwright/test";

test("seleciona todos os painéis e apaga em uma única ação", async ({ page }) => {
  await page.addInitScript(() => {
    const dashboards = ["Vendas", "Qualidade", "Operações"].map((name, index) => ({
      id: `e2e-dashboard-${index}`,
      name,
      sheets: [
        {
          name: "Dados",
          rows: [{ categoria: name, valor: index + 1 }],
          columns: [
            {
              key: "categoria",
              label: "Categoria",
              kind: "category",
              visible: true,
              description: "Categoria",
            },
            {
              key: "valor",
              label: "Valor",
              kind: "number",
              visible: true,
              description: "Valor",
            },
          ],
          filters: [],
          widgets: [],
        },
      ],
      activeSheetIndex: 0,
      createdAt: Date.now() - index,
      updatedAt: Date.now() - index,
      pinned: false,
    }));

    localStorage.setItem("oliam-onboarding-seen", "1");
    localStorage.setItem("oliam-dashboards", JSON.stringify(dashboards));
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Selecionar painéis" }).click();
  await expect(page.getByRole("toolbar", { name: "Ações da seleção de painéis" })).toBeVisible();

  await page.getByRole("button", { name: "Selecionar todos" }).click();
  await expect(page.getByText("3 painéis selecionados")).toBeVisible();

  await page.getByRole("button", { name: "Apagar selecionados" }).click();
  await expect(page.getByRole("heading", { name: "Apagar 3 painéis?" })).toBeVisible();
  await page.getByRole("button", { name: "Apagar 3 painéis" }).click();

  await expect(page.getByText(/importe uma planilha e transforme/i)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("oliam-dashboards") ?? "[]")))
    .toEqual([]);
});
