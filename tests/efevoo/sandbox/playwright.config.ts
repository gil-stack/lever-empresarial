import { defineConfig } from "@playwright/test";

import base from "../../../playwright.config";

/**
 * Validación con clics contra el sandbox REAL de Efevoo (nunca en el CI): la misma siembra y el mismo `next start` de la
 * e2e, pero con E2E_EFEVOO_REAL=1 y las EFEVOO_* del sandbox en el entorno. Fuera de tests/e2e para no contar en el
 * reparto de las 8 partes. Se corre con:
 *   set -a; . ~/.config/lever/efevoo-sandbox.env; set +a
 *   EFEVOO_URL=https://test-intgapi.efevoopay.com EFEVOO_AMBIENTE=sandbox E2E_EFEVOO_REAL=1 E2E_ADMIN_URL=… \
 *     npx playwright test -c tests/efevoo/sandbox/playwright.config.ts
 */
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "**/*.sandbox.ts",
  globalSetup: "../../e2e/global-setup.ts",
  globalTeardown: "../../e2e/global-teardown.ts",
  outputDir: "../../../test-results/efevoo-sandbox",
});
