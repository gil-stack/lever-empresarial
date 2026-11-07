import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

import { consultar, contar, dobleClic } from "./apoyo";

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
  if (process.env.E2E_SIN_CAPTURAS) return;
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({ path: `${EVIDENCIA}/${nombre}.png`, fullPage: true });
}

/** El tema se elige en Apariencia (menú de la cuenta); luego se vuelve a la misma pantalla. */
async function elegirTema(page: Page, tema: "Claro" | "Oscuro") {
  const regreso = page.url();
  // El detalle abre como diálogo modal: se cierra antes de usar el menú de la cuenta y la URL lo vuelve a abrir.
  const dialogo = page.getByRole("dialog");
  if (await dialogo.isVisible()) await dialogo.getByRole("button", { name: "Cerrar" }).click();
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
  await expect(page.getByRole("heading", { name: "Facturas y obligaciones", exact: true })).toBeVisible();
  await expect(page.getByText("Servicios Norte Integrales", { exact: true })).toBeVisible();
  await captura(page, "01-mesa-claro");

  await page.getByRole("link", { name: "Abrir pago de Servicios Norte Integrales" }).click();
  await expect(page.getByRole("dialog", { name: "Servicios Norte Integrales" })).toBeVisible();
  await expect(page.getByText("N-204", { exact: true }).last()).toBeVisible();
  await captura(page, "02-detalle-pago-claro");

  await elegirTema(page, "Oscuro");
  await expect(page.locator("html")).toHaveAttribute("data-tema", "oscuro");
  await expect(page.getByRole("dialog", { name: "Servicios Norte Integrales" })).toBeVisible();
  await captura(page, "03-detalle-pago-oscuro");
  await elegirTema(page, "Claro");
  await expect(page.locator("html")).toHaveAttribute("data-tema", "claro");

  await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).click();
  await page.locator(".mesa-vistas").getByRole("link", { name: "Proveedores · 3", exact: true }).click();
  await page.getByRole("link", { name: "Abrir expediente de Proveedor Uno, S.A. de C.V." }).click();
  await expect(page.getByRole("dialog", { name: "Proveedor Uno, S.A. de C.V." })).toBeVisible();
  await captura(page, "04-expediente-proveedor");

  await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).click();
  await page.locator(".mesa-vistas").getByRole("link", { name: "Agenda", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agenda de pagos", exact: true })).toBeVisible();
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
  // Doble clic real: un solo envío, un proveedor, una CLABE y un evento de alta.
  const alta = await dobleClic(page.getByRole("button", { name: "Dar de alta" }));
  expect(alta.envios).toBe(1);
  await expect(page.getByText("Quedó asentado", { exact: true })).toBeVisible();
  expect(await contar("select 1 from suppliers where company_id = $1 and rfc = $2", [EMPRESA, rfc])).toBe(1);
  expect(await contar("select 1 from supplier_clabes c join suppliers s on s.id = c.supplier_id where s.rfc = $1", [rfc])).toBe(1);
  expect(await contar("select 1 from audit_log a join suppliers s on s.id = a.identificador where a.accion = 'alta_proveedor' and s.rfc = $1", [rfc])).toBe(1);
  await captura(page, "07-alta-proveedor");

  await page.goto(`${BASE}/nuevo`);
  await page.getByLabel("Proveedor", { exact: true }).selectOption({ label: "Proveedor Uno, S.A. de C.V. · AAA010101AAA" });
  await page.locator("#xml").setInputFiles("tests/e2e/fixtures/factura-prueba.xml");
  await expect(page.getByText("123e4567-e89b-42d3-a456-426614174998".toUpperCase())).toBeVisible();
  await page.locator("#pdf").setInputFiles("tests/e2e/fixtures/soporte-prueba.pdf");
  await page.getByLabel("Vencimiento", { exact: true }).fill(fecha(20));
  await page.getByLabel("Fecha prevista de pago").fill(fecha(5));
  await captura(page, "08-nuevo-pago-cfdi");
  const UUID_CFDI = "123e4567-e89b-42d3-a456-426614174998";
  const solicitudCfdi = await dobleClic(page.getByRole("button", { name: "Revisar y solicitar" }));
  expect(solicitudCfdi.envios).toBe(1);
  await expect(page.getByText("El pago quedó en autorización. Otra persona lo revisa.")).toBeVisible();
  expect(await contar("select 1 from supplier_payables where company_id = $1 and upper(cfdi_uuid) = upper($2)", [EMPRESA, UUID_CFDI])).toBe(1);
  expect(await contar(
    "select 1 from supplier_payment_requests r join supplier_payables p on p.id = r.payable_id where upper(p.cfdi_uuid) = upper($1)",
    [UUID_CFDI],
  )).toBe(1);
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
  const solicitudExcepcion = await dobleClic(page.getByRole("button", { name: "Revisar y solicitar" }));
  expect(solicitudExcepcion.envios).toBe(1);
  await expect(page.getByText("El pago quedó en autorización. Otra persona lo revisa.")).toBeVisible();
  const deDelta = "select r.id, r.estado, r.solicitado_por, r.resuelto_por from supplier_payment_requests r join supplier_payables p on p.id = r.payable_id join suppliers s on s.id = p.supplier_id where s.rfc = $1";
  expect(await contar(deDelta, [rfc])).toBe(1);
  await expect(page.getByRole("button", { name: "Revisar y solicitar" })).toBeDisabled();
  const detalleExcepcion = await page.getByRole("link", { name: "Ver el detalle del pago" }).getAttribute("href");
  expect(detalleExcepcion).toBeTruthy();

  await entrar(page, ROSA);
  await page.goto(detalleExcepcion!);
  const autorizar = await dobleClic(page.getByRole("button", { name: "Autorizar para pagar" }));
  expect(autorizar.envios).toBe(1);
  await expect(page.locator(".detalle-cabeza").getByText("Listo para pagar", { exact: true })).toBeVisible();
  const [autorizada] = await consultar<{ id: string; estado: string; solicitado_por: string; resuelto_por: string | null }>(deDelta, [rfc]);
  expect(autorizada!.estado).toBe("listo_para_pagar");
  expect(autorizada!.resuelto_por).toBeTruthy();
  expect(autorizada!.resuelto_por).not.toBe(autorizada!.solicitado_por);
  expect(await contar("select 1 from supplier_payment_request_history where request_id = $1 and estado_nuevo = 'listo_para_pagar'", [autorizada!.id])).toBe(1);
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
  await expect(page.getByRole("dialog", { name: "Proveedor Uno, S.A. de C.V." })).toBeVisible();
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
