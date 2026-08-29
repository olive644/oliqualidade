import { expect, test, type Page } from "@playwright/test";

const dashboardId = "e2e-recharts-visual-regression";

const rows = [
  { date: "2025-01-01", category: "Norte", amount: 120, target: 100, score: 18, team: "Ativo" },
  { date: "2025-02-01", category: "Sul", amount: -35, target: 105, score: 8, team: "Ativo" },
  {
    date: "2025-03-01",
    category: "Centro-Oeste com rótulo longo",
    amount: 0,
    target: 110,
    score: 13,
    team: "Ativo",
  },
  { date: "2025-04-01", category: "Leste", amount: 215.75, target: 115, score: 25, team: "Ativo" },
  { date: "2025-05-01", category: "Norte", amount: 88.5, target: 120, score: 14, team: "Ativo" },
  { date: "2025-06-01", category: "Sudeste", amount: 160, target: 125, score: 21, team: "Ativo" },
  { date: "2025-07-01", category: "Nordeste", amount: null, target: 130, score: 9, team: "Ativo" },
  { date: "2025-08-01", category: "Oeste", amount: 310, target: 135, score: 30, team: "Ativo" },
  { date: "2025-09-01", category: "Sul", amount: 72, target: 140, score: 12, team: "Ativo" },
  { date: "2025-10-01", category: "Norte", amount: 190, target: 145, score: 24, team: "Ativo" },
  { date: "2025-11-01", category: "Litoral", amount: 135, target: 150, score: 17, team: "Ativo" },
  { date: "2025-12-01", category: "Interior", amount: 240, target: 155, score: 27, team: "Ativo" },
  ...Array.from({ length: 12 }, (_, index) => ({
    date: `2026-${String(index + 1).padStart(2, "0")}-01`,
    category: ["Norte", "Sul", "Centro", "Leste"][index % 4],
    amount: 96 + index * 17.25,
    target: 160 + index * 5,
    score: 11 + index,
    team: "Ativo",
  })),
  {
    date: "2025-12-01",
    category: "Fora do filtro",
    amount: 999,
    target: 999,
    score: 99,
    team: "Inativo",
  },
];

async function openChartDashboard(page: Page, theme: "light" | "dark" = "light") {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
  await page.addInitScript(
    ({ id, fixtureRows, selectedTheme }) => {
      const dashboard = {
        id,
        name: "Regressão visual dos gráficos",
        sheets: [
          {
            name: "Série completa",
            rows: fixtureRows,
            columns: [
              { key: "date", label: "Data", kind: "date", visible: true, description: "Período" },
              {
                key: "category",
                label: "Região",
                kind: "category",
                visible: true,
                description: "Categoria",
              },
              {
                key: "amount",
                label: "Resultado",
                kind: "currency",
                visible: true,
                description: "Valor observado",
              },
              {
                key: "target",
                label: "Meta",
                kind: "currency",
                visible: true,
                description: "Referência",
              },
              {
                key: "score",
                label: "Índice",
                kind: "number",
                visible: true,
                description: "Segunda medida",
              },
              {
                key: "team",
                label: "Situação",
                kind: "category",
                visible: true,
                description: "Filtro",
              },
            ],
            filters: [{ key: "team", value: "Ativo", min: "", max: "" }],
            automaticWidgetPolicyVersion: 2,
            widgets: [
              {
                id: "metric",
                type: "metric-trend",
                metricKey: "amount",
                groupKey: "date",
                op: "sum",
                span: 1,
                size: "sm",
              },
              {
                id: "bar",
                type: "bar",
                title: "Barras com negativos e zero",
                groupKey: "category",
                valueKey: "amount",
                dataMode: "aggregate",
                op: "sum",
                span: 2,
                size: "md",
              },
              {
                id: "pie",
                type: "pie",
                title: "Pizza com seleção persistente",
                groupKey: "category",
                valueKey: "amount",
                dataMode: "aggregate",
                op: "sum",
                span: 1,
                size: "md",
              },
              {
                id: "radar",
                type: "radar",
                title: "Radar por região",
                groupKey: "category",
                valueKey: "score",
                op: "sum",
                topN: 6,
                span: 2,
                size: "md",
              },
              {
                id: "area",
                type: "area",
                title: "Área com resultado, meta e desvios",
                groupKey: "date",
                valueKey: "amount",
                areaReference: "goal",
                areaGoalKey: "target",
                dataMode: "aggregate",
                op: "sum",
                span: 3,
                size: "md",
              },
              {
                id: "histogram",
                type: "histogram",
                title: "Histograma de resultados",
                valueKey: "amount",
                binCount: 6,
                span: 1,
                size: "md",
              },
              {
                id: "pareto",
                type: "pareto",
                title: "Pareto por região",
                groupKey: "category",
                // Não é `amount`: essa coluna tem negativos de propósito, para
                // exercitar a barra, e o Pareto recusa contribuição negativa
                // porque ela distorce o acumulado. Com `amount` o widget mostra
                // o aviso em vez de desenhar, e a espera pelo gráfico nunca
                // termina.
                valueKey: "score",
                op: "sum",
                span: 2,
                size: "md",
              },
              {
                id: "scatter",
                type: "scatter",
                title: "Resultado por índice",
                valueKey: "amount",
                valueKey2: "score",
                span: 2,
                size: "md",
              },
              {
                id: "control",
                type: "control-chart",
                title: "Carta de controle",
                span: 1,
                size: "md",
              },
            ],
          },
        ],
        activeSheetIndex: 0,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        pinned: false,
      };

      localStorage.setItem("oliam-onboarding-seen", "1");
      localStorage.setItem("oliam-theme", selectedTheme);
      localStorage.setItem("oliam-dashboards", JSON.stringify([dashboard]));
    },
    { id: dashboardId, fixtureRows: rows, selectedTheme: theme },
  );
  await page.goto(`/painel/${dashboardId}`);
  await expect(page.locator(".oliam-widget-grid")).toBeVisible();
  // `.oliam-widget` usa `content-visibility: auto`, então o navegador pula a
  // subárvore do widget que está fora da viewport, e o `svg` do gráfico não
  // existe. O próprio projeto já trata disso na exportação, com
  // `.oliam-export-mode .oliam-widget { content-visibility: visible }`, e aqui
  // vale pela mesma razão: uma captura da galeria inteira precisa da galeria
  // inteira desenhada.
  await page.addStyleTag({
    content:
      ".oliam-widget{content-visibility:visible!important;contain-intrinsic-size:none!important}",
  });
  for (const widgetId of [
    "metric",
    "bar",
    "pie",
    "radar",
    "area",
    "histogram",
    "pareto",
    "scatter",
    // A carta de controle não entra nesta lista: `refreshAutomaticWidgets`
    // regenera os tipos operacionais a cada carregamento, com id novo, então o
    // `control` do fixture nunca chega à tela com esse nome. Conferi-la por id
    // seria esperar por algo que o carregamento garante não existir, e não há
    // atributo de tipo no cartão para procurá-la de outro jeito. Ela continua
    // aparecendo na captura da galeria, que é onde a regressão visual dela é
    // vista.
  ]) {
    await expect(
      page.locator(`[data-widget-id="${widgetId}"] svg.recharts-surface`).first(),
    ).toBeVisible();
  }
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  });
  await page.evaluate(() => document.fonts.ready);
}

test.describe("regressão visual Recharts 3", () => {
  test.use({ viewport: { width: 1440, height: 3600 }, deviceScaleFactor: 1 });

  for (const theme of ["light", "dark"] as const) {
    test(`galeria completa no tema ${theme}`, async ({ page }) => {
      await openChartDashboard(page, theme);
      await expect(page.locator(".oliam-widget-grid")).toHaveScreenshot(
        `recharts-gallery-${theme}.png`,
        { animations: "disabled", maxDiffPixelRatio: 0.001 },
      );
    });
  }

  test("tooltip da barra e seleção da pizza", async ({ page }) => {
    await openChartDashboard(page);

    const bar = page.locator('[data-widget-id="bar"]');
    await bar.locator(".oliam-chart-bar-cell:visible").first().hover();
    await expect(bar.locator(".recharts-tooltip-wrapper")).toBeVisible();
    await expect(bar).toHaveScreenshot("recharts-bar-tooltip.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.001,
    });

    const pie = page.locator('[data-widget-id="pie"]');
    await pie.locator(".recharts-sector").nth(1).click();
    await expect(pie.locator(".oliam-chart-pie-active-slice")).toHaveCount(1);
    await expect(pie).toHaveScreenshot("recharts-pie-selected.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.001,
    });
  });

  // O radar tem painel próprio, e não é organização: clicar numa fatia da pizza
  // **filtra o painel inteiro**. Depois do filtro sobra uma categoria, o radar
  // passa a dizer que precisa de ao menos três para ser desenhado, e não há mais
  // ponto para clicar. Clicar no radar filtra do mesmo jeito, então nenhuma
  // ordem entre os dois resolve: cada seleção precisa de um painel limpo.
  test("seleção do radar", async ({ page }) => {
    await openChartDashboard(page);

    const radar = page.locator('[data-widget-id="radar"]');
    // O clique vai no grupo, e não no ponto: `.oliam-chart-radar-dot` é o
    // círculo desenhado, tem `pointer-events: none` e nunca recebe evento. Quem
    // é clicável é o `<g role="button">` em volta, que carrega o rótulo
    // acessível e um círculo transparente maior como área de toque.
    await radar
      .getByRole("button", { name: /^Inspecionar / })
      .nth(1)
      .click();
    await expect(radar).toHaveScreenshot("recharts-radar-selected.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.001,
    });
  });
});

for (const viewport of [
  { name: "320", width: 320, height: 844 },
  { name: "360", width: 360, height: 800 },
  { name: "390", width: 390, height: 844 },
  { name: "414", width: 414, height: 896 },
  { name: "768", width: 768, height: 1024 },
  { name: "landscape", width: 844, height: 390 },
] as const) {
  test.describe(`área responsiva em ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      screen: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: viewport.width < 768,
    });

    test("mantém os ticks extremos dentro do SVG", async ({ page }) => {
      await openChartDashboard(page);
      const area = page.locator('[data-widget-id="area"]');
      await area.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          area.evaluate((widget) => {
            const svg = widget.querySelector("svg.recharts-surface")?.getBoundingClientRect();
            const ticks = [...widget.querySelectorAll(".recharts-xAxis-tick-labels text")].map(
              (tick) => tick.getBoundingClientRect(),
            );
            if (!svg || ticks.length < 2) return false;
            return ticks[0]!.left >= svg.left && ticks.at(-1)!.right <= svg.right;
          }),
        )
        .toBe(true);

      // Caber dentro do SVG não é a mesma coisa que ser legível: dois rótulos
      // podem estar os dois dentro da área e escritos um por cima do outro. Era
      // exatamente esse o estado gravado nas imagens de referência, com
      // "2025-01-01" e "2025-02-01" sobrepostos em 320 px, e o teste dos
      // extremos passando o tempo todo.
      const sobreposicoes = await area.evaluate((widget) => {
        const rotulos = [...widget.querySelectorAll(".recharts-xAxis-tick-labels text")]
          .map((tick) => ({ caixa: tick.getBoundingClientRect(), texto: tick.textContent ?? "" }))
          .filter((rotulo) => rotulo.caixa.width > 0)
          .sort((a, b) => a.caixa.left - b.caixa.left);
        const colididos: string[] = [];
        for (let i = 1; i < rotulos.length; i += 1) {
          const anterior = rotulos[i - 1]!;
          const atual = rotulos[i]!;
          // Dois pixels de folga mínima: encostar já é ilegível.
          if (atual.caixa.left < anterior.caixa.right + 2)
            // O texto entra na mensagem porque é ele que diz o que consertar:
            // sem isso a falha é um par de coordenadas que não explica nada.
            colididos.push(
              `"${anterior.texto}" invade "${atual.texto}" em ${Math.round(anterior.caixa.right - atual.caixa.left)}px`,
            );
        }
        return colididos;
      });
      expect(sobreposicoes, `rótulos do eixo sobrepostos em ${viewport.name}`).toEqual([]);
      await expect(area).toHaveScreenshot(`recharts-area-${viewport.name}.png`, {
        animations: "disabled",
        maxDiffPixelRatio: 0.001,
      });
    });
  });
}

/**
 * O mascote mora fixo no canto inferior direito, e em telas estreitas isso cai
 * exatamente em cima do rodapé do card: nas imagens de referência ele cobria a
 * linha "Horizontal: Data · Vertical: Soma de Resultado" do gráfico de área.
 *
 * A garantia é geométrica, e não de classe CSS: o que importa é ele parar de
 * ocupar o mesmo espaço do rodapé, não qual atributo mudou. Afirmar o atributo
 * passaria mesmo que o recolhimento não movesse nada na tela.
 */
test.describe("o mascote sai da frente do gráfico no celular", () => {
  test.use({
    viewport: { width: 320, height: 844 },
    screen: { width: 320, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });

  test("recolhe ao tocar no gráfico e volta ao tocar fora", async ({ page }) => {
    await openChartDashboard(page);
    const area = page.locator('[data-widget-id="area"]');
    await area.scrollIntoViewIfNeeded();
    const mascote = page.locator(".oli-mascot-group");
    await expect(mascote).toBeVisible();

    const antes = await mascote.boundingBox();
    await area.locator(".recharts-wrapper").first().tap();
    // A largura ocupada precisa encolher de verdade. Sem número, "recolheu"
    // seria só a presença de um atributo.
    await expect
      .poll(async () => {
        const agora = await mascote.boundingBox();
        return agora && antes ? Math.round(agora.width) < Math.round(antes.width) : false;
      })
      .toBe(true);

    // E volta: o assistente não pode ficar recolhido depois que a pessoa saiu
    // do gráfico, senão a correção troca um problema por outro.
    await page
      .locator(".oliam-dashboard-content")
      .first()
      .tap({ position: { x: 5, y: 5 } });
    await expect
      .poll(async () => {
        const agora = await mascote.boundingBox();
        return agora && antes ? Math.round(agora.width) === Math.round(antes.width) : false;
      })
      .toBe(true);
  });
});
