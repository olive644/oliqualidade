import { expect, test } from "@playwright/test";

const dashboardId = "e2e-persisted-histogram";

test("normaliza as faixas de um histograma persistido para os valores reais", async ({ page }) => {
  await page.addInitScript(
    ({ id }) => {
      const rows = Array.from({ length: 150 }, (_, index) => ({
        categoria: `Registro ${index + 1}`,
        quantidade: (index % 5) + 1,
      }));
      const dashboard = {
        id,
        name: "Histograma persistido",
        sheets: [
          {
            name: "Dados",
            rows,
            columns: [
              {
                key: "categoria",
                label: "Categoria",
                kind: "category",
                visible: true,
                description: "Identificador do registro",
              },
              {
                key: "quantidade",
                label: "Quantidade",
                kind: "number",
                visible: true,
                description: "Quantidade observada",
              },
            ],
            filters: [],
            automaticWidgetPolicyVersion: 2,
            widgets: [
              {
                id: "histogram-persisted-bin-count-20",
                type: "histogram",
                title: "Distribuição de Quantidade",
                groupKey: "categoria",
                valueKey: "quantidade",
                binCount: 20,
                span: 3,
                size: "md",
              },
            ],
          },
        ],
        activeSheetIndex: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
      };

      localStorage.setItem("oliam-onboarding-seen", "1");
      localStorage.setItem("oliam-dashboards", JSON.stringify([dashboard]));
    },
    { id: dashboardId },
  );

  await page.goto(`/painel/${dashboardId}`);
  await page.waitForLoadState("networkidle");

  const histogram = page.locator("article.oliam-widget").filter({
    has: page.getByRole("heading", { name: "Distribuição de Quantidade" }),
  });
  await expect(histogram).toBeVisible();

  const grouping = histogram.getByRole("combobox", { name: "Agrupamento do histograma" });
  await expect(grouping).toHaveValue("0");
  await expect(grouping.locator("option:checked")).toHaveText("Por valor (5)");
  await expect(histogram.locator(".recharts-bar-rectangle")).toHaveCount(5);

  const chartViewport = histogram.locator(".h-64.overflow-x-auto");
  await expect
    .poll(() => chartViewport.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
});
