import { expect, test, type Page } from "@playwright/test";

import { CLAVE, codigoTotp, consultar } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Configurar alertas automáticas desde Operación → Alertas: la Administración apaga «Comisión por autorizar», se la
 * asigna a otra persona del personal y la deja como estaba. El cambio queda en la bitácora. La suite corre con un solo
 * worker; la prueba devuelve la configuración a la de siempre para no mover a otros recorridos.
 */
async function entrarAOperacion(page: Page, correo: string): Promise<void> {
  await page.goto("/operacion/entrar");
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/operacion\/continuar/);
  await page.getByLabel("Código de la app autenticadora").fill(await codigoTotp(correo));
  await page.getByRole("button", { name: "Entrar con el código" }).click();
  await page.waitForURL(/\/operacion$/);
}

test("la Administración apaga y reasigna una alerta automática desde Alertas, y la deja como estaba", async ({ page }) => {
  const [otra] = await consultar<{ nombre: string }>("select nombre from users where correo = $1", [CORREOS.op2]);
  await entrarAOperacion(page, CORREOS.op1);
  await page.goto("/operacion/alertas");
  const seccion = page.getByRole("region", { name: "Configurar alertas automáticas" });
  await expect(seccion).toBeVisible();
  const comision = seccion.getByRole("listitem").filter({ hasText: "Comisión por autorizar" });
  await expect(comision.locator(".operacion-fila").getByText("Prendida", { exact: true })).toBeVisible();
  await expect(comision.getByText("Responsable: Quien hizo el trámite")).toBeVisible();

  await comision.getByLabel("Estado").selectOption("no");
  await comision.getByLabel("Asignar a").selectOption({ label: otra.nombre });
  await comision.getByRole("button", { name: "Guardar configuración" }).click();
  await page.waitForURL(/aviso=alerta_configurada/);
  await expect(page.getByText("Configuración de la alerta guardada.")).toBeVisible();
  const despues = page.getByRole("region", { name: "Configurar alertas automáticas" }).getByRole("listitem").filter({ hasText: "Comisión por autorizar" });
  await expect(despues.locator(".operacion-fila").getByText("Apagada", { exact: true })).toBeVisible();
  await expect(despues.getByText(`Responsable: ${otra.nombre}`)).toBeVisible();
  await expect(despues.getByLabel("Estado")).toHaveValue("no");
  if (!process.env.E2E_SIN_CAPTURAS) {
    await page.getByRole("region", { name: "Configurar alertas automáticas" }).screenshot({ path: "test-results/e2e/alertas-configuracion-1440.png" });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload();
    await page.getByRole("region", { name: "Configurar alertas automáticas" }).screenshot({ path: "test-results/e2e/alertas-configuracion-390.png" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
  }
  const eventos = await consultar<{ n: number }>("select count(*)::int as n from audit_log where accion = 'alerta_configurada'");
  expect(eventos[0].n).toBeGreaterThanOrEqual(1);

  await despues.getByLabel("Estado").selectOption("si");
  await despues.getByLabel("Asignar a").selectOption("");
  await despues.getByRole("button", { name: "Guardar configuración" }).click();
  await page.waitForURL(/aviso=alerta_configurada/);
  const restaurada = page.getByRole("region", { name: "Configurar alertas automáticas" }).getByRole("listitem").filter({ hasText: "Comisión por autorizar" });
  await expect(restaurada.locator(".operacion-fila").getByText("Prendida", { exact: true })).toBeVisible();
  await expect(restaurada.getByText("Responsable: Quien hizo el trámite")).toBeVisible();
});
