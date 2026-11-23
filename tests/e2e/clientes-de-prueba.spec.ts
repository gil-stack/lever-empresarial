import { expect, test } from "@playwright/test";

import { consultar, contar, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Alta rápida de un cliente de prueba (0050): desde Clientes, «Cliente de prueba» abre una sola pantalla; el cliente
 * nace activo y marcado, con su administrador invitado (el enlace se copia porque el correo no sale) y dado de alta en
 * tarjetas en el ambiente de pruebas (el procesador falso de las pruebas). El correo de @rebota-e2e.mx no sale, como hoy en producción. La marca se ve en la lista, en la ficha y en
 * el portal del cliente; archivarlo lo saca de la lista y su gente ya no entra.
 */

test.describe.configure({ mode: "serial" });

const PRUEBA = { razonSocial: "Prueba Rápida E2E", nombre: "Paola Prueba", correo: "paola@rebota-e2e.mx" } as const;

test("alta rápida: un cliente de prueba activo, con su invitación para copiar y dado de alta en tarjetas", async ({ page, context, browser }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.goto("/operacion/clientes");
  await page.getByRole("link", { name: "Cliente de prueba" }).click();
  await expect(page).toHaveURL(/\/operacion\/clientes\/prueba$/);
  await expect(page.getByRole("heading", { name: "Alta rápida de un cliente de prueba" })).toBeVisible();

  // El correo de alguien del personal no sirve: no entra al portal de clientes.
  await page.getByLabel("Nombre de la empresa de prueba").fill(PRUEBA.razonSocial);
  await page.getByLabel("Nombre del administrador").fill(PRUEBA.nombre);
  await page.getByLabel("Correo del administrador").fill(CORREOS.op2);
  await page.getByRole("button", { name: "Crear cliente de prueba" }).click();
  await expect(page.locator("#aviso-alta-rapida")).toContainText("personal de Operación");
  await expect(page.getByLabel("Nombre de la empresa de prueba")).toHaveValue(PRUEBA.razonSocial);
  expect(await contar("select 1 from companies where razon_social = $1", [PRUEBA.razonSocial])).toBe(0);

  await page.getByLabel("Correo del administrador").fill(PRUEBA.correo);
  await page.getByRole("button", { name: "Crear cliente de prueba" }).click();
  const resultado = page.getByRole("region", { name: `${PRUEBA.razonSocial} ya está activa` });
  await expect(resultado).toBeVisible();
  await expect(resultado).toContainText("Dada de alta en tarjetas");
  const enlace = page.getByLabel("Enlace de la invitación", { exact: true });
  const valor = await enlace.inputValue();
  expect(valor).toMatch(/\/invitacion\/[A-Za-z0-9_-]{43}$/);
  expect(page.url()).not.toContain("invitacion/");

  const [empresa] = await consultar<{ id: string; estado: string; de_prueba: boolean; vinculada: boolean }>(
    `select c.id, c.estado, c.de_prueba, exists (select 1 from efevoo_clientes e where e.company_id = c.id) as vinculada
     from companies c where c.razon_social = $1`,
    [PRUEBA.razonSocial],
  );
  expect(empresa).toMatchObject({ estado: "activa", de_prueba: true, vinculada: true });
  expect(await contar("select 1 from audit_log where company_id = $1 and accion = 'cliente_prueba_creado'", [empresa!.id])).toBe(1);

  // El enlace abre la invitación.
  const otra = await browser.newContext();
  try {
    const invitado = await otra.newPage();
    await invitado.goto(new URL(valor).pathname);
    await expect(invitado.getByRole("heading", { name: `Te invitaron a ${PRUEBA.razonSocial}.` })).toBeVisible();
  } finally {
    await otra.close();
  }

  // La marca en la lista y en la ficha, con las tarjetas listas para el dinero de prueba.
  await page.goto("/operacion/clientes");
  const fila = page.getByRole("row", { name: new RegExp(PRUEBA.razonSocial) });
  await expect(fila).toContainText("Prueba");
  await expect(fila).toContainText("Alta rápida de prueba");
  await fila.getByRole("link", { name: PRUEBA.razonSocial }).click();
  await expect(page.locator(".operacion-ficha-cabeza")).toContainText("Cliente de prueba");
  await expect(page.getByRole("heading", { name: "Dinero de prueba" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/efevoo/i);
  expect(errores).toEqual([]);
});

test("su gente ve la marca en el portal; al archivarlo sale de Clientes y ya no entra", async ({ page, context, browser }) => {
  const errores = vigilarConsola(page);
  const [empresa] = await consultar<{ id: string }>("select id from companies where razon_social = $1", [PRUEBA.razonSocial]);
  const [paola] = await consultar<{ id: string }>("select id from users where correo = $1", [PRUEBA.correo]);
  // Como si ya hubiera aceptado la invitación.
  await consultar("update memberships set estado = 'activa' where user_id = $1 and company_id = $2", [paola!.id, empresa!.id]);
  await consultar("update users set password_hash = (select password_hash from users where correo = $2) where id = $1", [paola!.id, CORREOS.op3]);
  const portal = await browser.newContext();
  try {
    await sesionDe(portal, PRUEBA.correo);
    const cliente = await portal.newPage();
    await cliente.goto(`/c/${empresa!.id}/consola`);
    await expect(cliente.getByText(`${PRUEBA.razonSocial} es un cliente de prueba.`)).toBeVisible();

    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    await page.goto(`/operacion/clientes/${empresa!.id}`);
    await page.getByLabel("Su gente ya no podrá entrar a esta empresa").check();
    await page.getByRole("button", { name: "Archivar cliente de prueba" }).click();
    await expect(page).toHaveURL(/\/operacion\/clientes\?aviso=cliente_prueba_archivado$/);
    await expect(page.getByRole("row", { name: new RegExp(PRUEBA.razonSocial) })).toHaveCount(0);

    await cliente.goto(`/c/${empresa!.id}/consola`);
    await expect(cliente.getByText(`${PRUEBA.razonSocial} es un cliente de prueba.`)).toHaveCount(0);
  } finally {
    await portal.close();
  }
  expect(errores).toEqual([]);
});
