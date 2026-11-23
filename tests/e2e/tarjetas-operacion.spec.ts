import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { CLAVE, codigoTotp } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * La sección Tarjetas de Operación contra el procesador falso: la tabla por empresa filtra el tablero, cada tarjeta
 * abre su detalle (resumen y movimientos, solo lectura) y ninguna pantalla nombra al proveedor ni muestra un número
 * de tarjeta completo.
 */
const EVIDENCIA = process.env.E2E_CAPTURAS ?? "test-results/tarjetas-operacion";

async function captura(page: Page, nombre: string): Promise<void> {
  if (process.env.E2E_SIN_CAPTURAS) return;
  mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: `${EVIDENCIA}/${nombre}.png`, fullPage: true });
}

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

async function sinProveedorNiNumeros(page: Page): Promise<void> {
  const html = await page.content();
  expect(html).not.toMatch(/Efevoo/i);
  expect(await page.locator("main").innerText()).not.toMatch(/\d(?:[ -]?\d){12,}/);
}

test("Tarjetas: por empresa filtra el tablero y cada tarjeta abre su detalle sin nombrar al proveedor", async ({ page }) => {
  await entrarAOperacion(page, CORREOS.op1);
  await page.goto("/operacion/tarjetas");
  const empresas = page.getByRole("region", { name: "Tabla de tarjetas por empresa" });
  await expect(empresas).toBeVisible();
  await sinProveedorNiNumeros(page);
  await captura(page, "1440-tablero");

  // La primera empresa (la que más tarjetas tiene) filtra el tablero y la lista.
  const primera = empresas.getByRole("row").nth(1).getByRole("link").first();
  const nombre = (await primera.innerText()).trim();
  await primera.click();
  await page.waitForURL(/empresa=/);
  await expect(page.getByText(`Tarjetas de ${nombre}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Quitar el filtro de empresa" })).toBeVisible();
  const lista = page.getByRole("region", { name: "Tabla de tarjetas", exact: true });
  for (const celda of await lista.locator('td[data-rotulo="Empresa"]').allInnerTexts()) expect(celda).toContain(nombre);
  await captura(page, "1440-por-empresa");

  // Una tarjeta abre su detalle.
  const tarjeta = lista.getByRole("link", { name: /Ver la tarjeta terminada en/ }).first();
  const terminacion = (await tarjeta.getAttribute("aria-label"))!.slice(-4);
  await tarjeta.click();
  await page.waitForURL(/\/operacion\/tarjetas\/[0-9]+$/);
  await expect(page.getByRole("heading", { name: "Tarjeta", exact: true })).toBeVisible();
  await expect(page.locator("main")).toContainText(`•••• ${terminacion}`);
  await expect(page.getByRole("heading", { name: /^Movimientos/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Lo que hizo Lever con la tarjeta/ })).toBeVisible();
  await expect(page.locator("main").getByRole("button")).toHaveCount(0);
  await sinProveedorNiNumeros(page);
  await captura(page, "1440-detalle");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("main")).toContainText(`•••• ${terminacion}`);
  await captura(page, "390-detalle");

  // Una tarjeta que no existe es 404.
  const ajena = await page.goto("/operacion/tarjetas/999999");
  expect(ajena?.status()).toBe(404);
});
