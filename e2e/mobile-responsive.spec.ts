import { expect, test } from "@playwright/test";

test.describe("iPhone responsive shell", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });

  test("keeps the home screen inside the viewport with touch-sized actions", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".oliam-home-shell")).toBeVisible();
    await expect(page.locator(".oliam-topbar")).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);

    const tooSmallActions = await page.locator(".oliam-topbar button:visible").evaluateAll((buttons) =>
      buttons
        .map((button) => button.getBoundingClientRect())
        .filter((box) => box.width < 44 || box.height < 44).length,
    );
    expect(tooSmallActions).toBe(0);
  });
});
