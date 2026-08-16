import { defineConfig, devices } from "@playwright/test";

/**
 * Primeira configuração de E2E do projeto. Fica de fora do CI obrigatório
 * por enquanto (roda só sob demanda via `npm run test:e2e` ou workflow
 * manual) — ver seção correspondente do CURRENT_STATE_AUDIT.md.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.OLI_E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.OLI_E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --host",
        url: "http://127.0.0.1:3000",
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
        env: { OLI_SESSION_SECRET: "e2e-local-session-secret-not-a-real-credential" },
      },
});
