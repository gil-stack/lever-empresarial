import { expect, test, type Page } from "@playwright/test";

import { CLAVE, codigoDeSemilla, codigoTotp, consultar, contar, dobleClic, idDe, sesionDe, vigilarConsola } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * Operación SOFIPO: entrada con segundo factor, alta de un prospecto con la
 * activación decidida por otra persona, la recuperación del segundo factor de
 * una clienta (pedida desde /entrar, aprobada en Recuperaciones tras «Confirma
 * que eres tú» y cerrada con un factor nuevo) y la publicación del precio, que
 * exige un factor de los últimos 30 minutos. Cada envío con doble clic real y
 * conteo en la base.
 */

test.describe.configure({ mode: "serial" });

const PROSPECTO = { razonSocial: "Puerto Nuevo E2E", rfc: "PNE200101AB3" };

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

async function salirDeOperacion(page: Page): Promise<void> {
  await page.locator(".cuenta .menu-desplegable-boton").click();
  await page.getByRole("menuitem", { name: "Salir" }).click();
  await page.waitForURL(/\/operacion\/entrar/);
}

test("entrada SOFIPO: contraseña y código; un código malo no abre y el doble clic abre una sola sesión", async ({ page }) => {
  const errores = vigilarConsola(page);
  const op1 = await idDe(CORREOS.op1);
  const sesiones = () => contar("select 1 from sessions where user_id = $1 and superficie = 'sofipo'", [op1]);
  const antes = await sesiones();

  await page.goto("/operacion/entrar");
  await page.getByLabel("Correo").fill(CORREOS.op1);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  const contrasena = await dobleClic(page.getByRole("button", { name: "Continuar" }), { esperar: /\/operacion\/continuar/ });
  expect(contrasena.envios).toBe(1);

  await page.getByLabel("Código de la app autenticadora").fill("000000");
  await page.getByRole("button", { name: "Entrar con el código" }).click();
  await expect(page.locator("#factor-error")).toBeVisible();
  expect(await sesiones()).toBe(antes);

  await page.getByLabel("Código de la app autenticadora").fill(await codigoTotp(CORREOS.op1));
  const codigo = await dobleClic(page.getByRole("button", { name: "Entrar con el código" }), { esperar: /\/operacion$/ });
  expect(codigo.envios).toBe(1);
  expect(await sesiones()).toBe(antes + 1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errores).toEqual([]);
});

test("prospecto → pedir activación → la decide otra persona con factor reciente", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const [op1, op2] = [await idDe(CORREOS.op1), await idDe(CORREOS.op2)];
  const empresas = () => contar("select 1 from companies where rfc = $1", [PROSPECTO.rfc]);
  expect(await empresas()).toBe(0);

  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.goto("/operacion/clientes");
  await page.getByLabel("Razón social").fill(PROSPECTO.razonSocial);
  await page.getByLabel("RFC").fill(PROSPECTO.rfc);
  await page.getByLabel("Código postal").fill("64000");
  const alta = await dobleClic(page.getByRole("button", { name: "Registrar prospecto" }), { esperar: /\/operacion\/clientes\/[0-9a-f-]{36}\?aviso=prospecto_registrado/ });
  expect(alta.envios).toBe(1);
  expect(await empresas()).toBe(1);
  const [empresa] = await consultar<{ id: string; estado: string }>("select id, estado from companies where rfc = $1", [PROSPECTO.rfc]);
  expect(empresa!.estado).toBe("prospecto");
  await expect(page.getByText("Prospecto registrado. Ya puedes solicitar su activación.")).toBeVisible();

  const solicitudes = () => contar("select 1 from company_activation_requests where company_id = $1", [empresa!.id]);
  const pedir = await dobleClic(page.getByRole("button", { name: "Solicitar activación" }), { esperar: /aviso=activacion_solicitada/ });
  expect(pedir.envios).toBe(1);
  expect(await solicitudes()).toBe(1);
  await expect(page.getByText("Activación solicitada. La decide otra persona en Aprobaciones.")).toBeVisible();

  // Quien la pidió la ve, pero sin botones.
  const decision = (p: Page) => p.locator("li.decision").filter({ hasText: `Activación · ${PROSPECTO.razonSocial}` });
  await page.goto("/operacion/aprobaciones");
  await expect(decision(page).getByText("La pediste tú: decide otra persona.")).toBeVisible();
  await expect(decision(page).getByRole("button", { name: "Aprobar" })).toHaveCount(0);

  // Otra persona con el factor de hace 31 minutos: no decide y la base no cambia.
  await sesionDe(context, CORREOS.op2, { superficie: "sofipo", factorHaceMinutos: 31 });
  await page.goto("/operacion/aprobaciones");
  await decision(page).getByRole("button", { name: "Aprobar" }).click();
  await expect(page.getByText("Para decidir, tu segundo factor debe ser de los últimos 30 minutos. Sal y vuelve a entrar.")).toBeVisible();
  const [pendiente] = await consultar<{ estado: string }>("select estado from companies where id = $1", [empresa!.id]);
  expect(pendiente!.estado).toBe("en_alta");

  // Con factor reciente, un doble clic decide una sola vez.
  await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
  await page.goto("/operacion/aprobaciones");
  const aprobar = await dobleClic(decision(page).getByRole("button", { name: "Aprobar" }), { esperar: /aviso=decision_registrada/ });
  expect(aprobar.envios).toBe(1);
  const [decidida] = await consultar<{ estado: string; decided_by: string; empresa: string }>(
    `select r.estado, r.decided_by, c.estado as empresa from company_activation_requests r
     join companies c on c.id = r.company_id where r.company_id = $1`,
    [empresa!.id],
  );
  expect(decidida).toEqual({ estado: "aprobada", decided_by: op2, empresa: "activa" });
  expect(decidida!.decided_by).not.toBe(op1);
  expect(await contar("select 1 from audit_log where accion = 'activacion_aprobada' and company_id = $1", [empresa!.id])).toBe(1);
  expect(await contar("select 1 from company_state_history where company_id = $1 and estado_nuevo = 'activa'", [empresa!.id])).toBe(1);
  expect(errores).toEqual([]);
});

test("«Perdí el segundo factor»: Recuperaciones pide «Confirma que eres tú», otra persona aprueba y la clienta registra un factor nuevo", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const paula = await idDe(CORREOS.perdida);
  const op2 = await idDe(CORREOS.op2);
  const recuperaciones = () => contar("select 1 from auth_recuperaciones where user_id = $1", [paula]);
  const [totpViejo] = await consultar<{ id: string }>(
    "select id from auth_totp where user_id = $1 and confirmado_en is not null and revocado_en is null",
    [paula],
  );
  expect(totpViejo).toBeTruthy();
  expect(await recuperaciones()).toBe(0);

  // La clienta entra con su contraseña y, sin código, pide ayuda.
  await page.goto("/entrar");
  await page.getByLabel("Correo").fill(CORREOS.perdida);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/entrar\/continuar/);
  await page.getByRole("button", { name: "Perdí el segundo factor" }).click();
  await page.getByLabel("Qué pasó").fill("Perdí el teléfono con la app autenticadora.");
  const pedir = await dobleClic(page.getByRole("button", { name: "Pedir recuperación" }), { esperar: /\/entrar\?aviso=recuperacion/ });
  expect(pedir.envios).toBe(1);
  await expect(page.getByText("Tu solicitud quedó en revisión.")).toBeVisible();
  expect(await recuperaciones()).toBe(1);

  // En Operación, con el factor de hace 6 minutos, primero «Confirma que eres tú» (vale cinco).
  await context.clearCookies();
  await sesionDe(context, CORREOS.op2, { superficie: "sofipo", factorHaceMinutos: 6 });
  await page.goto("/operacion/recuperaciones");
  const solicitud = page.locator("li.decision").filter({ hasText: CORREOS.perdida });
  await expect(page.getByRole("heading", { name: "Confirma que eres tú" })).toBeVisible();
  await solicitud.getByLabel("Cómo verificaste la identidad").selectOption("videollamada");
  await solicitud.getByRole("button", { name: "Aprobar" }).click();
  await expect(page.getByText("Confirma que eres tú con tu segundo factor antes de decidir. Vale cinco minutos.")).toBeVisible();
  const [sinDecidir] = await consultar<{ estado: string }>("select estado from auth_recuperaciones where user_id = $1", [paula]);
  expect(sinDecidir!.estado).toBe("solicitada");

  await page.locator("#confirmar-codigo").fill(await codigoTotp(CORREOS.op2));
  await page.getByRole("button", { name: "Confirmar con el código" }).click();
  await expect(page.getByRole("heading", { name: "Confirma que eres tú" })).toHaveCount(0);
  await solicitud.getByLabel("Cómo verificaste la identidad").selectOption("videollamada");
  const aprobar = await dobleClic(solicitud.getByRole("button", { name: "Aprobar" }), { esperar: /aviso=decision_registrada/ });
  expect(aprobar.envios).toBe(1);
  const [aprobada] = await consultar<{ estado: string; resuelta_por: string; verificacion: string }>(
    "select estado, resuelta_por, verificacion from auth_recuperaciones where user_id = $1",
    [paula],
  );
  expect(aprobada).toEqual({ estado: "aprobada", resuelta_por: op2, verificacion: "videollamada" });

  // La clienta vuelve a entrar y registra un factor nuevo; el viejo deja de servir.
  await context.clearCookies();
  await page.goto("/entrar");
  await page.getByLabel("Correo").fill(CORREOS.perdida);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/entrar\/continuar/);
  await expect(page.getByRole("heading", { name: "Registra un factor nuevo." })).toBeVisible();
  const semilla = (await page.locator(".arco-semilla").innerText()).trim();
  await page.getByLabel("Código que muestra la app").fill(codigoDeSemilla(semilla));
  const confirmar = await dobleClic(page.getByRole("button", { name: "Confirmar el código" }));
  expect(confirmar.envios).toBe(1);
  await page.getByRole("checkbox", { name: "Ya los guardé en un lugar seguro" }).check();
  await page.getByRole("button", { name: "Entrar al portal" }).click();
  await expect(page.getByRole("navigation", { name: "Secciones" })).toBeVisible();
  expect(await contar("select 1 from auth_totp where id = $1 and revocado_en is not null", [totpViejo!.id])).toBe(1);
  expect(await contar("select 1 from auth_totp where user_id = $1 and confirmado_en is not null and revocado_en is null", [paula])).toBe(1);
  expect(await contar("select 1 from auth_recuperaciones where user_id = $1 and cumplida_en is not null", [paula])).toBe(1);
  expect(errores).toEqual([]);
});

test("publicar el precio exige factor de los últimos 30 minutos; tras volver a entrar, doble clic publica una vez", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const precio = async () => (await consultar<{ centavos: string | null }>("select suscripcion_centavos::text as centavos from platform_pricing where singleton"))[0]?.centavos ?? null;
  const publicaciones = () => contar("select 1 from audit_log where accion = 'publicar_precio'");
  expect(await precio()).toBeNull();
  const antes = await publicaciones();

  await sesionDe(context, CORREOS.op1, { superficie: "sofipo", factorHaceMinutos: 31 });
  await page.goto("/operacion/precios");
  await page.getByLabel("Suscripción mensual, en pesos").fill("1499.00");
  await page.getByRole("button", { name: "Publicar el monto" }).click();
  await expect(page.getByText("Publicar exige un segundo factor verificado en los últimos 30 minutos. Sal y vuelve a entrar por la puerta de operación.")).toBeVisible();
  expect(await precio()).toBeNull();
  expect(await publicaciones()).toBe(antes);

  await salirDeOperacion(page);
  await entrarAOperacion(page, CORREOS.op1);
  await page.goto("/operacion/precios");
  await page.getByLabel("Suscripción mensual, en pesos").fill("1499.00");
  const publicar = await dobleClic(page.getByRole("button", { name: "Publicar el monto" }), { esperar: /\/operacion\/precios$/ });
  expect(publicar.envios).toBe(1);
  await expect(page.getByLabel("Suscripción mensual, en pesos")).toHaveCount(0);
  await expect(page.getByText("1,499.00").first()).toBeVisible();
  expect(await precio()).toBe("149900");
  expect(await publicaciones()).toBe(antes + 1);
  expect(errores).toEqual([]);
});
