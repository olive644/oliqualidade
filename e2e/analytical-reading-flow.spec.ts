import { expect, test } from "@playwright/test";

const dashboardId = "e2e-analytical-reading-flow";

test.describe("fluxo de leitura analítica", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });

  test("explica a comparação da área e organiza as perguntas no celular", async ({ page }) => {
    await page.addInitScript(
      ({ id }) => {
        const dashboard = {
          id,
          name: "Leitura analítica",
          sheets: [
            {
              name: "Resultados",
              rows: [
                { data: "2026-01-01", resultado: 80, meta: 90, equipe: "Norte" },
                { data: "2026-02-01", resultado: 105, meta: 95, equipe: "Norte" },
                { data: "2026-03-01", resultado: 88, meta: 100, equipe: "Norte" },
                { data: "2026-01-01", resultado: 70, meta: 90, equipe: "Sul" },
              ],
              columns: [
                { key: "data", label: "Data", kind: "date", visible: true },
                { key: "resultado", label: "Resultado", kind: "number", visible: true },
                { key: "meta", label: "Meta", kind: "number", visible: true },
                { key: "equipe", label: "Equipe", kind: "category", visible: true },
              ],
              filters: [{ key: "equipe", value: "Norte", min: "", max: "" }],
              automaticWidgetPolicyVersion: 2,
              widgets: [
                {
                  id: "metric-resultado",
                  type: "metric",
                  metricKey: "resultado",
                  op: "sum",
                  span: 1,
                  size: "sm",
                },
                {
                  id: "metric-meta",
                  type: "metric",
                  metricKey: "meta",
                  op: "sum",
                  span: 1,
                  size: "sm",
                },
                {
                  id: "area-resultados",
                  type: "area",
                  title: "Evolução de Resultado",
                  groupKey: "data",
                  valueKey: "resultado",
                  areaReference: "goal",
                  areaGoalKey: "meta",
                  dataMode: "aggregate",
                  op: "sum",
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

    const area = page.locator("article.oliam-widget").filter({
      has: page.getByRole("heading", { name: "Evolução de Resultado (área)" }),
    });
    await expect(area).toBeVisible();
    await expect(area.getByText("Resultado observado", { exact: true })).toBeVisible();
    await expect(area.getByText("Acima da referência", { exact: true })).toBeVisible();
    await expect(area.getByText("Abaixo da referência", { exact: true })).toBeVisible();
    await expect(area.locator('.recharts-line-curve[stroke="#22d3ee"]')).toBeVisible();
    await expect(
      area.locator('.recharts-area-curve[stroke="var(--secondary-accent)"]'),
    ).toBeVisible();
    await expect(area.locator('.recharts-area-curve[stroke="#d59b32"]')).toBeVisible();
    await area
      .getByRole("button", { name: "Mostrar configuração de Evolução de Resultado (área)" })
      .click();
    await expect(area.getByRole("combobox", { name: "Referência do gráfico de área" })).toHaveValue(
      "goal",
    );
    await expect
      .poll(() =>
        area.evaluate((widget) => {
          const svg = widget.querySelector("svg.recharts-surface")?.getBoundingClientRect();
          const ticks = [...widget.querySelectorAll(".recharts-xAxis text")].map((tick) =>
            tick.getBoundingClientRect(),
          );
          if (!svg || ticks.length < 2) return false;
          return ticks[0]!.left >= svg.left && ticks.at(-1)!.right <= svg.right;
        }),
      )
      .toBe(true);
    await expect(area.getByLabel("Origem e cálculo desta visualização")).toContainText(
      "Filtros ativos: 1",
    );

    await page.getByRole("button", { name: "Mostrar visão geral" }).click();
    const insightDialog = page.getByRole("dialog", { name: "Visão geral da análise" });
    await expect(insightDialog.getByText("Roteiro de análise", { exact: true })).toBeVisible();
    await expect(insightDialog.getByText("Respondida", { exact: true }).first()).toBeVisible();
    await expect(insightDialog.getByRole("button", { name: "Ver gráfico" }).first()).toBeVisible();
    await expect(
      insightDialog.getByRole("button", { name: "Criar gráfico" }).first(),
    ).toBeVisible();
  });
});
