import { expect, test } from "@playwright/test";

import { consultar, contar, dobleClic, sesionDe, vigilarConsola } from "./apoyo";
import { ANCLA, CORREOS } from "./siembra";

/**
 * Alta de clientes como recorrido: desde Clientes, «Dar de alta cliente» abre el paso 1 con los seis pasos al lado; el
 * prospecto nace con su primer administrador anotado y la ficha muestra el alta paso a paso. En una empresa activa, si
 * el correo de la invitación no sale, la ficha da el enlace para copiarlo y ese enlace abre la invitación.
 */

test.describe.configure({ mode: "serial" });

const NUEVA = { razonSocial: "Puerto Ancho E2E", rfc: "PUE200505AB1" } as const;

test("alta guiada: del botón de Clientes al prospecto con su administrador anotado y el avance en la ficha", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.goto("/operacion/clientes");
  await expect(page.getByLabel("Resumen de la cartera")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Avance del alta" })).toBeVisible();
  await page.getByRole("link", { name: "Dar de alta cliente" }).first().click();
  await expect(page).toHaveURL(/\/operacion\/clientes\/nuevo$/);
  await expect(page.getByRole("heading", { name: "Cómo es el alta" })).toBeVisible();
  await expect(page.locator(".alta-pasos-guia > li")).toHaveCount(6);

  await page.getByLabel("Razón social").fill(NUEVA.razonSocial);
  await page.getByLabel("RFC").fill(NUEVA.rfc);
  await page.getByLabel("Código postal").fill("64000");
  // Solo uno de los dos datos del administrador: el servidor lo rechaza y vuelve todo lo capturado.
  await page.getByLabel("Nombre del administrador").fill("Inés Robles");
  await page.getByRole("button", { name: "Registrar prospecto" }).click();
  await expect(page.locator("#aviso-prospecto")).toContainText("correo del administrador");
  await expect(page.getByLabel("RFC")).toHaveValue(NUEVA.rfc);
  expect(await contar("select 1 from companies where rfc = $1", [NUEVA.rfc])).toBe(0);

  await page.getByLabel("Correo del administrador").fill("Ines@Puerto-Ancho.MX");
  const alta = await dobleClic(page.getByRole("button", { name: "Registrar prospecto" }), {
    esperar: /\/operacion\/clientes\/[0-9a-f-]{36}\?aviso=prospecto_registrado/,
  });
  expect(alta.envios).toBe(1);
  const [empresa] = await consultar<{ estado: string; contacto_nombre: string; contacto_correo: string }>(
    "select estado, contacto_nombre, contacto_correo from companies where rfc = $1",
    [NUEVA.rfc],
  );
  expect(empresa).toEqual({ estado: "prospecto", contacto_nombre: "Inés Robles", contacto_correo: "ines@puerto-ancho.mx" });

  const pasos = page.getByRole("region", { name: /Alta paso a paso · 1 de 6/ });
  await expect(pasos).toBeVisible();
  await expect(pasos.locator('[aria-current="step"]')).toContainText("Expediente");
  await expect(page.getByText("Inés Robles · ines@puerto-ancho.mx")).toBeVisible();
  await page.goto("/operacion/clientes");
  await expect(page.getByRole("row", { name: new RegExp(NUEVA.razonSocial) })).toContainText("Expediente");
  expect(errores).toEqual([]);
});

test("si el correo de la invitación no sale, la ficha da el enlace para copiarlo y el enlace abre la invitación", async ({ page, context, browser }) => {
  const errores = vigilarConsola(page);
  const [ancla] = await consultar<{ id: string }>("select id from companies where rfc = $1", [ANCLA.rfc]);
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.goto(`/operacion/clientes/${ancla!.id}`);
  await expect(page.getByRole("region", { name: /Alta paso a paso · 5 de 6/ })).toBeVisible();
  await page.getByLabel("Nombre", { exact: true }).fill("Tomás Ancla");
  await page.getByLabel("Correo", { exact: true }).fill("tomas@rebota-e2e.mx");
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  const enlace = page.getByLabel("Enlace de la invitación", { exact: true });
  await expect(enlace).toBeVisible();
  await expect(page.locator("#aviso-invitacion")).toContainText("el correo no salió");
  // El enlace no va en la dirección.
  expect(page.url()).not.toContain("invitacion/");
  const valor = await enlace.inputValue();
  expect(valor).toMatch(/\/invitacion\/[A-Za-z0-9_-]{43}$/);
  expect(await contar("select 1 from invitation_deliveries where company_id = $1 and estado = 'fallida'", [ancla!.id])).toBe(1);
  await expect(page.getByRole("button", { name: "Reenviar invitación" })).toBeVisible();

  const otra = await browser.newContext();
  try {
    const invitado = await otra.newPage();
    await invitado.goto(new URL(valor).pathname);
    await expect(invitado.getByRole("heading", { name: "Te invitaron a Ancla E2E." })).toBeVisible();
    await expect(invitado.getByText("tomas@rebota-e2e.mx", { exact: false })).toBeVisible();
  } finally {
    await otra.close();
  }
  expect(errores).toEqual([]);
});
