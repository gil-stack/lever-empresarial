import { expect, test } from "@playwright/test";

import { arrecife, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Aprobaciones (antes Pendientes) se refresca cuando un pendiente se resuelve en
 * su módulo: Personas, Política, Proveedores y Flujo de caja revalidan la ruta de
 * Aprobaciones, y al volver con un clic en el lateral el pendiente ya no está (o
 * aparece el aviso nuevo). Arrecife E2E es una empresa recién dada de alta que
 * solo usa este spec.
 */

const en = (ruta: string) => `/c/${arrecife()}${ruta}`;

function hoy(): string {
  return process.env.E2E_TODAY ?? new Date().toISOString().slice(0, 10);
}

test("Aprobaciones se refresca al volver por el lateral tras una acción en Personas, Política, Proveedores y Flujo", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.marina);
  const renglon = (titulo: string | RegExp) =>
    page.locator(".aprobaciones-renglones li").filter({ has: page.getByRole("heading", { name: titulo }) });
  const cuenta = async () => Number((await page.locator(".aprobaciones-vistas a").first().innerText()).match(/· (\d+)/)?.[1] ?? "NaN");
  async function volver() {
    await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: /^Aprobaciones/ }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${arrecife()}/consola/aprobaciones$`));
  }

  await page.goto(en("/consola/aprobaciones"));
  for (const titulo of ["Crea la primera área", "Crea la primera categoría", "Registra el primer proveedor"]) {
    await expect(renglon(titulo)).toBeVisible();
  }
  const inicial = await cuenta();

  // Personas: la primera área, desde el enlace del renglón. Su lugar lo toma el siguiente paso.
  await renglon("Crea la primera área").getByRole("link", { name: "Crear área" }).click();
  await expect(page).toHaveURL(/\/consola\/personas\/areas$/);
  await page.getByLabel("Área", { exact: true }).fill("Ventas");
  await page.getByLabel("Presupuesto mensual").fill("1000");
  await page.getByRole("button", { name: "Crear área" }).click();
  await expect(page.getByText("El área quedó creada con su presupuesto.")).toBeVisible();
  await volver();
  await expect(renglon("Crea la primera área")).toHaveCount(0);
  await expect(renglon("Da de alta al primer colaborador")).toBeVisible();
  expect(await cuenta()).toBe(inicial);

  // Política: la primera categoría. Sin tope escrito, deja el pendiente de topes en su lugar.
  await renglon("Crea la primera categoría").getByRole("link", { name: "Configurar política" }).click();
  await expect(page).toHaveURL(/\/consola\/politica$/);
  const categorias = page.locator("section").filter({ has: page.getByRole("heading", { name: "Categorías", exact: true }) });
  await categorias.getByLabel("Nombre", { exact: true }).fill("Viáticos");
  await categorias.getByRole("button", { name: "Agregar categoría" }).click();
  await expect(categorias.getByRole("heading", { name: "Viáticos" })).toBeVisible();
  await volver();
  await expect(renglon("Crea la primera categoría")).toHaveCount(0);
  await expect(renglon(/sin tope escrito/)).toBeVisible();
  expect(await cuenta()).toBe(inicial);

  // Proveedores: el primero, con su constancia en el emulador de Blob.
  await renglon("Registra el primer proveedor").getByRole("link", { name: "Configurar proveedores" }).click();
  await expect(page).toHaveURL(/\/consola\/proveedores$/);
  await page.getByRole("navigation", { name: "Espacios de proveedores" }).getByRole("link", { name: /^Proveedores/ }).click();
  await page.getByRole("link", { name: "Alta de proveedor" }).click();
  await expect(page).toHaveURL(/\/consola\/proveedores\/nuevo-proveedor$/);
  await page.getByLabel("RFC", { exact: true }).fill("EEE050505EA1");
  await page.getByLabel("Razón social", { exact: true }).fill("Embarques del Golfo");
  await page.getByLabel("CLABE", { exact: true }).fill("002180701150123452");
  await page.locator("#constancia").setInputFiles("tests/e2e/fixtures/soporte-prueba.pdf");
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page.getByText("Quedó asentado", { exact: true })).toBeVisible();
  await volver();
  await expect(renglon("Registra el primer proveedor")).toHaveCount(0);
  expect(await cuenta()).toBe(inicial - 1);

  // Flujo de caja: una obligación que rebasa el presupuesto del área enciende su aviso.
  await page.getByRole("navigation", { name: "Secciones" }).getByRole("link", { name: "Calendario", exact: true }).click();
  await expect(page).toHaveURL(/\/consola\/calendario$/);
  const obligacion = page.locator('form[data-formulario="obligacion"]');
  await obligacion.locator('input[name="concepto"]').fill("Renta de bodega");
  await obligacion.locator('input[name="monto"]').fill("1500.00");
  await obligacion.locator('select[name="frecuencia"]').selectOption("mensual");
  await obligacion.locator('input[name="proximaFecha"]').fill(hoy());
  await obligacion.locator('select[name="areaId"]').selectOption({ label: "Ventas" });
  await obligacion.getByRole("button", { name: "Registrar la obligación" }).click();
  await expect(obligacion.locator(".alerta-asentado")).toBeVisible();
  await volver();
  await expect(renglon("El presupuesto del área Ventas está excedido")).toBeVisible();
  expect(await cuenta()).toBe(inicial);
  expect(errores).toEqual([]);
});
