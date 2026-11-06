import { defineConfig } from "@playwright/test";

// Una sola configuración para todos los recorridos. Sin rutas de una máquina:
// el puerto, el origen y el navegador vienen del entorno, y sin CHROME_PATH se
// usa el Chromium que instala Playwright. tests/e2e/global-setup.ts crea un
// Postgres desechable desde E2E_ADMIN_URL, siembra Personas y Pagos a
// proveedores y levanta `next start` en E2E_PUERTO (3109 por omisión).
const puerto = process.env.E2E_PUERTO ?? "3109";
const origen = process.env.E2E_BASE_URL ?? `http://localhost:${puerto}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: "./test-results/e2e",
  reporter: "list",
  use: {
    baseURL: origen,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    ...(process.env.CHROME_PATH ? { launchOptions: { executablePath: process.env.CHROME_PATH } } : {}),
  },
});
