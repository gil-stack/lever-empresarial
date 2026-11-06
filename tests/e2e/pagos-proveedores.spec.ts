import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const EMPRESA = "33333333-3333-4333-8333-333333333333";
const BASE = `/c/${EMPRESA}/consola/proveedores`;
const GIL = "a".repeat(43);
const ROSA = "b".repeat(43);
const ORIGEN = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PUERTO ?? "3109"}`;
// Las capturas de esta suite no pisan la evidencia del PR.
const EVIDENCIA = process.env.E2E_CAPTURAS ?? "test-results/pagos-proveedores";

test.beforeAll(() => mkdirSync(EVIDENCIA, { recursive: true }));

async function entrar(page: Page, token = GIL) {
  await page.context().clearCookies();
  // `next start` corre en producción: la cookie de sesión lleva el prefijo __Host- (Secure, Path=/, sin Domain).
  // Con `url` http Playwright quita `secure` y Chromium rechaza el prefijo; con domain + path queda host-only.
  await page.context().addCookies([
    { name: "__Host-sesion", value: token, domain: new URL(ORIGEN).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
  ]);
}

async function captura(page: Page, nombre: string) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({ path: `${EVIDENCIA}/${nombre}.png`, fullPage: true });
}

/** El tema se elige en Apariencia (menú de la cuenta); luego se vuelve a la misma pantalla. */
async function elegirTema(page: Page, tema: "Claro" | "Oscuro") {
  const regreso = page.url();
  await page.locator(".cuenta .menu-desplegable-boton").click();
  await page.getByRole("menuitem", { name: "Apariencia", exact: true }).click();
  await page.locator(".temas").getByRole("button", { name: tema, exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-tema", tema.toLowerCase());
  await page.goto(regreso);
}

function fecha(dias: number): string {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

test("la mesa se ve completa en claro, oscuro y móvil", async ({ page }) => {
  await entrar(page);
  await page.goto(BASE);
  await elegirTema(page, "Claro");
  await expect(page.getByRole("heading", { name: "Pagos a proveedores", exact: true })).toBeVisible();
  await expect(page.getByText("Servicios Norte Integrales", { exact: true })).toBeVisible();
  await captura(page, "01-mesa-claro");

  await page.getByRole("link", { name: "Abrir pago de Servicios Norte Integrales" }).click();
  await expect(page.getByRole("complementary", { name: "Detalle del pago" })).toBeVisible();
  await expect(page.getByText("N-204", { exact: true }).last()).toBeVisible();
  await captura(page, "02-detalle-pago-claro");

  await elegirTema(page, "Oscuro");
  await expect(page.locator("html")).toHaveAttribute("data-tema", "oscuro");
  await expect(page.getByRole("complementary", { name: "Detalle del pago" })).toBeVisible();
  await captura(page, "03-detalle-pago-oscuro");
  await elegirTema(page, "Claro");
  await expect(page.locator("html")).toHaveAttribute("data-tema", "claro");

  await page.locator(".proveedores-tabs").getByRole("link", { name: "Proveedores 3", exact: true }).click();
  await page.getByRole("link", { name: "Abrir expediente de Proveedor Uno, S.A. de C.V." }).click();
  await expect(page.getByRole("complementary", { name: "Expediente del proveedor" })).toBeVisible();
  await captura(page, "04-expediente-proveedor");

  await page.getByRole("link", { name: "Agenda", exact: true }).click();
  await expect(page.getByText("Agenda ordenada por fecha prevista")).toBeVisible();
  await captura(page, "05-agenda");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  await captura(page, "06-mesa-movil");
  const desborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(desborda).toBe(false);
});

test("alta, factura, excepción, descarga y autorización con otra persona", async ({ page }) => {
  await entrar(page);
  await page.goto(`${BASE}/nuevo-proveedor`);
  const rfc = `DDD040404DA${Math.floor(Math.random() * 9) + 1}`;
  await page.getByLabel("RFC", { exact: true }).fill(rfc);
  await page.getByLabel("Razón social", { exact: true }).fill("Diseño Delta Operaciones");
  await page.getByLabel("Nombre comercial").fill("Delta");
  await page.getByLabel("Correo de contacto").fill("facturas@delta.mx");
  await page.getByLabel("CLABE", { exact: true }).fill("002180701150123452");
  await page.locator("#constancia").setInputFiles("tests/e2e/fixtures/soporte-prueba.pdf");
  await page.locator("#contrato").setInputFiles("tests/e2e/fixtures/soporte-prueba.pdf");
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page.getByText("Quedó asentado", { exact: true })).toBeVisible();
  await captura(page, "07-alta-proveedor");

  await page.goto(`${BASE}/nuevo`);
  await page.getByLabel("Proveedor", { exact: true }).selectOption({ label: "Proveedor Uno, S.A. de C.V. · AAA010101AAA" });
  await page.locator("#xml").setInputFiles("tests/e2e/fixtures/factura-prueba.xml");
  await expect(page.getByText("123e4567-e89b-42d3-a456-426614174998".toUpperCase())).toBeVisible();
  await page.locator("#pdf").setInputFiles("tests/e2e/fixtures/soporte-prueba.pdf");
  await page.getByLabel("Vencimiento", { exact: true }).fill(fecha(20));
  await page.getByLabel("Fecha prevista de pago").fill(fecha(5));
  await captura(page, "08-nuevo-pago-cfdi");
  await page.getByRole("button", { name: "Revisar y solicitar" }).click();
  await expect(page.getByText("El pago quedó enviado a autorización. Todavía no se mueve dinero.")).toBeVisible();
  const detalleCfdi = await page.getByRole("link", { name: "Ver el detalle del pago" }).getAttribute("href");
  expect(detalleCfdi).toBeTruthy();

  await page.goto(detalleCfdi!);
  const documentoPdf = page.locator(".detalle-documentos a").filter({ hasText: "soporte-prueba.pdf" }).last();
  const hrefPdf = await documentoPdf.getAttribute("href");
  expect(hrefPdf).toBeTruthy();
  const respuesta = await page.request.get(hrefPdf!);
  expect(respuesta.status()).toBe(200);
  expect((await respuesta.body()).subarray(0, 5).toString()).toBe("%PDF-");
  // La regla general de next.config no debe quitarle a la descarga su sandbox.
  expect(respuesta.headers()["content-security-policy"]).toBe("sandbox; default-src 'none'; frame-ancestors 'none'");
  expect(respuesta.headers()["content-disposition"]).toMatch(/^attachment;/);

  await page.goto(`${BASE}/nuevo`);
  await page.getByLabel("Proveedor", { exact: true }).selectOption({ label: "Diseño Delta Operaciones · " + rfc });
  await page.getByRole("button", { name: /Excepción Motivo/ }).click();
  await page.locator("#pdf").setInputFiles("tests/e2e/fixtures/soporte-prueba.pdf");
  await page.getByLabel("Importe MXN").fill("456.78");
  await page.getByLabel("Referencia", { exact: true }).fill("Servicio Delta noviembre");
  await page.getByLabel("Fecha de la obligación").fill(fecha(-2));
  await page.getByLabel("Vencimiento", { exact: true }).fill(fecha(25));
  await page.getByLabel("Fecha prevista de pago").fill(fecha(6));
  await page.getByLabel("Por qué no hay factura").fill("Trabajo excepcional aprobado por dirección general");
  await captura(page, "09-nuevo-pago-excepcion");
  await page.getByRole("button", { name: "Revisar y solicitar" }).click();
  await expect(page.getByText("El pago quedó enviado a autorización. Todavía no se mueve dinero.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revisar y solicitar" })).toBeDisabled();
  const detalleExcepcion = await page.getByRole("link", { name: "Ver el detalle del pago" }).getAttribute("href");
  expect(detalleExcepcion).toBeTruthy();

  await entrar(page, ROSA);
  await page.goto(detalleExcepcion!);
  await page.getByRole("button", { name: "Autorizar para pagar" }).click();
  await expect(page.locator(".detalle-cabeza").getByText("Listo para pagar", { exact: true })).toBeVisible();
  await captura(page, "10-autorizacion-segunda-persona");
});

test("alta sin contrato y lectura del XML sin errores en la consola", async ({ page }) => {
  // El campo de contrato vacío llega como un archivo de 0 bytes; no es un PDF vacío.
  const errores: string[] = [];
  page.on("console", (mensaje) => {
    if (mensaje.type() === "error") errores.push(mensaje.text());
  });
  await entrar(page);
  await page.goto(`${BASE}/nuevo-proveedor`);
  // Un RFC ya dado de alta falla en el servidor; los datos y la constancia se conservan.
  await page.getByLabel("RFC", { exact: true }).fill("AAA010101AAA");
  await page.getByLabel("Razón social", { exact: true }).fill("Fletes Sin Contrato");
  await page.getByLabel("Nombre comercial").fill("Fletes");
  await page.getByLabel("CLABE", { exact: true }).fill("002180701150123452");
  await page.locator("#constancia").setInputFiles("tests/e2e/fixtures/soporte-prueba.pdf");
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page.getByText("Ese RFC ya es un proveedor. No entra otra vez.").first()).toBeVisible();
  await expect(page.getByLabel("Nombre comercial")).toHaveValue("Fletes");
  expect(await page.locator("#constancia").evaluate((campo: HTMLInputElement) => campo.files?.length ?? 0)).toBe(1);
  await page.getByLabel("RFC", { exact: true }).fill(`FFF060606FA${Math.floor(Math.random() * 9) + 1}`);
  await page.getByLabel("Razón social", { exact: true }).fill("Fletes Sin Contrato");
  await page.getByLabel("CLABE", { exact: true }).fill("002180701150123452");
  await page.locator("#constancia").setInputFiles("tests/e2e/fixtures/soporte-prueba.pdf");
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page.getByText("Quedó asentado", { exact: true })).toBeVisible();

  await page.goto(`${BASE}/nuevo`);
  await page.getByLabel("Proveedor", { exact: true }).selectOption({ label: "Proveedor Uno, S.A. de C.V. · AAA010101AAA" });
  await page.locator("#xml").setInputFiles("tests/e2e/fixtures/factura-prueba.xml");
  await expect(page.getByText("123e4567-e89b-42d3-a456-426614174998".toUpperCase())).toBeVisible();
  expect(errores).toEqual([]);
});

test("una corrección que falla conserva el importe y la evidencia elegidos", async ({ page }) => {
  // React vacía los campos de un form action al terminar, aun con error: el
  // importe corregido regresaba en silencio al original.
  await entrar(page);
  await page.goto(`${BASE}/nuevo?pago=88888888-8888-4888-8888-888888888883`);
  await page.getByLabel("Importe MXN").fill("9450.00");
  await page.getByRole("button", { name: "Guardar y solicitar" }).click();
  await expect(page.getByText("Si cambias el importe de una excepción, adjunta evidencia nueva en PDF que lo respalde.")).toBeVisible();
  await expect(page.getByLabel("Importe MXN")).toHaveValue("9450.00");
  await page.locator("#pdf").setInputFiles("tests/e2e/fixtures/soporte-prueba.pdf");
  await page.getByRole("button", { name: "Guardar y solicitar" }).click();
  await page.waitForURL(/consola\/proveedores\?pago=88888888-8888-4888-8888-888888888883/);
  await expect(page.locator(".detalle-cabeza")).toContainText("$9,450.00");
  await expect(page.locator(".historial-diferencia")).toContainText("$8,900.00");
});

test("limita archivos combinados y no ofrece cambiar CLABE a un liberador", async ({ page }) => {
  await entrar(page, ROSA);
  await page.goto(`${BASE}?vista=proveedores&proveedor=44444444-4444-4444-8444-444444444441`);
  await expect(page.getByRole("complementary", { name: "Expediente del proveedor" })).toBeVisible();
  await expect(page.getByText("Cambiar CLABE", { exact: true })).toHaveCount(0);

  await entrar(page);
  await page.goto(`${BASE}/nuevo-proveedor`);
  await page.getByLabel("RFC", { exact: true }).fill("EEE050505EA5");
  await page.getByLabel("Razón social", { exact: true }).fill("Archivos Grandes");
  await page.getByLabel("CLABE", { exact: true }).fill("002180701150123452");
  const grande = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(4_500_000)]);
  await page.locator("#constancia").setInputFiles({ name: "constancia-grande.pdf", mimeType: "application/pdf", buffer: grande });
  await page.locator("#contrato").setInputFiles({ name: "contrato-grande.pdf", mimeType: "application/pdf", buffer: grande });
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page.locator("#contrato-error")).toHaveText("La constancia y el contrato juntos no pueden superar 8 MB.");
});

test("rechazo, corrección y cancelación conservan el historial", async ({ page }) => {
  await entrar(page, ROSA);
  const pendiente = `${BASE}?pago=88888888-8888-4888-8888-888888888882`;
  await page.goto(pendiente);
  await expect(page.getByText("CLABE destino", { exact: true })).toBeVisible();
  await page.getByLabel("Motivo al rechazar").fill("La fecha no coincide con el contrato");
  await page.getByRole("button", { name: "Rechazar", exact: true }).click();
  await expect(page.locator(".detalle-cabeza").getByText("Rechazado", { exact: true })).toBeVisible();
  await expect(page.getByText("La fecha no coincide con el contrato", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Corregir y volver a solicitar" })).toHaveCount(0);

  await entrar(page);
  await page.goto(pendiente);
  await page.getByRole("link", { name: "Corregir y volver a solicitar" }).click();
  await page.getByLabel("Fecha prevista de pago").fill(fecha(8));
  await page.getByRole("button", { name: "Guardar y solicitar" }).click();
  await expect(page.locator(".detalle-cabeza").getByText("Por autorizar", { exact: true })).toBeVisible();
  await captura(page, "11-correccion-reenviada");

  await page.goto(pendiente);
  await page.getByText("Cancelar mi solicitud").click();
  await page.getByLabel("Motivo de cancelación").fill("Se reprograma con el proveedor");
  await page.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect(page.locator(".detalle-cabeza").getByText("Cancelado", { exact: true })).toBeVisible();
  await captura(page, "12-cancelacion-con-historial");
});
