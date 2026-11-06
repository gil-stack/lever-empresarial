import { defineConfig } from "@playwright/test";

// Sin rutas de una máquina: el puerto, el origen y el navegador vienen del
// entorno. Sin CHROME_PATH se usa el Chromium que instala Playwright.
const puerto = process.env.E2E_PUERTO ?? "3109";
const origen = process.env.E2E_BASE_URL ?? `http://localhost:${puerto}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 12_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: origen,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    ...(process.env.CHROME_PATH ? { launchOptions: { executablePath: process.env.CHROME_PATH } } : {}),
  },
  webServer: {
    command: `npm run dev -- --port ${puerto}`,
    url: `${origen}/salud`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
