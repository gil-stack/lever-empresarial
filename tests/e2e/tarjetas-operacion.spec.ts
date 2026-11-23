import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { CLAVE, codigoTotp } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * La sección Tarjetas de Operación contra el procesador falso: el buscador y los filtros por estado y empresa se
 * resuelven en el servidor, cada renglón abre el detalle en una ventana centrada (solo lectura) que se cierra sin
 * perder la búsqueda, y ninguna pantalla nombra al proveedor ni muestra un número de tarjeta completo.
 */
const EVIDENCIA = process.env.E2E_CAPTURAS ?? "test-results/tarjetas-operacion";

async function captura(page: Page, nombre: string, completa = true): Promise<void> {
  if (process.env.E2E_SIN_CAPTURAS) return;
  mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: `${EVIDENCIA}/${nombre}.png`, fullPage: completa });
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

test("Tarjetas: busca y filtra en el servidor, y cada tarjeta abre su detalle en una ventana sin nombrar al proveedor", async ({ page }) => {
  await entrarAOperacion(page, CORREOS.op1);
  await page.goto("/operacion/tarjetas");
  const lista = page.getByRole("region", { name: "Tabla de tarjetas", exact: true });
  await expect(lista).toBeVisible();
  await expect(page.getByRole("list", { name: "Resumen del inventario" })).toBeVisible();
  await sinProveedorNiNumeros(page);
  await captura(page, "1440-lista");

  // El buscador encuentra una tarjeta por sus últimos 4 dígitos.
  const primera = lista.getByRole("link", { name: /Ver la tarjeta terminada en/ }).first();
  const terminacion = (await primera.getAttribute("aria-label"))!.slice(-4);
  await page.getByRole("searchbox", { name: "Buscar" }).fill(terminacion);
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.waitForURL(new RegExp(`q=${terminacion}`));
  for (const celda of await lista.locator('td[data-rotulo="Tarjeta"] .operacion-mono').allInnerTexts()) expect(celda).toContain(terminacion);

  // Una búsqueda sin resultados lo dice y ofrece limpiar.
  await page.goto("/operacion/tarjetas?q=Ninguna%20empresa%20con%20este%20nombre");
  await expect(page.getByText("No hay tarjetas con esta búsqueda")).toBeVisible();
  await page.getByRole("link", { name: "Limpiar filtros" }).click();
  await page.waitForURL(/\/operacion\/tarjetas$/);

  // Un estado filtra la lista y queda marcado.
  const estados = page.getByRole("navigation", { name: "Filtrar por estado" });
  await estados.getByRole("link", { name: /^Disponibles/ }).click();
  await page.waitForURL(/estado=disponibles/);
  await expect(estados.getByRole("link", { name: /^Disponibles/ })).toHaveAttribute("aria-current", "page");
  for (const celda of await lista.locator('td[data-rotulo="Estado"]').allInnerTexts()) expect(celda).toBe("Disponible");

  // La empresa elegida filtra la lista.
  await page.goto("/operacion/tarjetas");
  const selector = page.getByLabel("Empresa");
  const opcion = selector.locator("option").nth(2);
  const valor = (await opcion.getAttribute("value"))!;
  const nombre = (await opcion.innerText()).replace(/ · [0-9,]+$/, "").trim();
  await selector.selectOption(valor);
  await page.waitForURL(/empresa=/);
  for (const celda of await lista.locator('td[data-rotulo="Empresa"]').allInnerTexts()) expect(celda).toBe(nombre);
  await captura(page, "1440-por-empresa");

  // Un renglón abre la ventana del detalle encima de la lista.
  const tarjeta = lista.getByRole("link", { name: /Ver la tarjeta terminada en/ }).first();
  const final = (await tarjeta.getAttribute("aria-label"))!.slice(-4);
  await tarjeta.click();
  await page.waitForURL(/tarjeta=[0-9]+/);
  const ventana = page.getByRole("dialog", { name: `Tarjeta •••• ${final}` });
  await expect(ventana).toBeVisible();
  await expect(ventana.getByRole("heading", { name: /^Movimientos/ })).toBeVisible();
  await expect(ventana.getByRole("heading", { name: /^Lo que hizo Lever con la tarjeta/ })).toBeVisible();
  await expect(ventana.getByRole("button")).toHaveCount(1);
  await sinProveedorNiNumeros(page);
  await captura(page, "1440-detalle", false);

  // Cerrar regresa a la misma lista filtrada.
  await ventana.getByRole("button", { name: "Cerrar" }).click();
  await expect(ventana).toBeHidden();
  await page.waitForURL((url) => !url.searchParams.has("tarjeta") && url.searchParams.has("empresa"));

  // En el teléfono la ventana se ve completa.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operacion/tarjetas");
  await captura(page, "390-lista");
  await lista.getByRole("link", { name: /Ver la tarjeta terminada en/ }).nth(1).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await captura(page, "390-detalle", false);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // La dirección vieja del detalle lleva a la ventana; una tarjeta que no existe lo dice.
  await page.goto("/operacion/tarjetas/999999");
  await page.waitForURL(/tarjeta=999999/);
  await expect(page.getByRole("dialog", { name: "Tarjeta no encontrada" })).toBeVisible();
  expect((await page.goto("/operacion/tarjetas/abc"))?.status()).toBe(404);
});
