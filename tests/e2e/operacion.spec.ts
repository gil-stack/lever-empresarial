import { expect, test, type Page } from "@playwright/test";

import { CLAVE, codigoDeSemilla, codigoTotp, consultar, contar, dobleClic, idDe, sesionDe, vigilarConsola } from "./apoyo";
import { BRISA, CIMA, CORREOS, DUNA, FARO } from "./siembra";

/**
 * Operación SOFIPO: entrada con segundo factor, alta de un prospecto con la
 * activación decidida por otra persona (Originación pide, Aprobación decide y
 * el candado de la 0028 exige expediente aprobado y riesgo vigente), la
 * recuperación del segundo factor de
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
  // Entrar puede cerrar sesiones viejas de la misma persona: se cuentan las que nacen en esta prueba.
  const desde = (await consultar<{ desde: string }>("select now()::text as desde"))[0]!.desde;
  const sesiones = () => contar("select 1 from sessions where user_id = $1 and superficie = 'sofipo' and creada_en >= $2::timestamptz", [op1, desde]);
  const antes = await sesiones();
  expect(antes).toBe(0);

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

test("prospecto → pedir activación → el candado exige expediente; con todo en regla la decide otra persona con factor reciente", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const [op1, op2] = [await idDe(CORREOS.op1), await idDe(CORREOS.op2)];
  const empresas = () => contar("select 1 from companies where rfc = $1", [PROSPECTO.rfc]);
  expect(await empresas()).toBe(0);

  // Originación registra el prospecto y pide su activación.
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.goto("/operacion/clientes");
  await page.getByLabel("Razón social").fill(PROSPECTO.razonSocial);
  await page.getByLabel("RFC").fill(PROSPECTO.rfc);
  await page.getByLabel("Código postal").fill("64000");
  const alta = await dobleClic(page.getByRole("button", { name: "Registrar prospecto" }), { esperar: /\/operacion\/clientes\/[0-9a-f-]{36}\?aviso=prospecto_registrado/ });
  expect(alta.envios).toBe(1);
  expect(await empresas()).toBe(1);
  const [empresa] = await consultar<{ id: string; estado: string; originada_por: string }>(
    "select id, estado, originada_por from companies where rfc = $1",
    [PROSPECTO.rfc],
  );
  expect(empresa).toMatchObject({ estado: "prospecto", originada_por: op1 });
  await expect(page.getByText("Prospecto registrado. Ya puedes solicitar su activación.")).toBeVisible();

  const solicitudes = () => contar("select 1 from company_activation_requests where company_id = $1", [empresa!.id]);
  const pedir = await dobleClic(page.getByRole("button", { name: "Solicitar activación" }), { esperar: /aviso=activacion_solicitada/ });
  expect(pedir.envios).toBe(1);
  expect(await solicitudes()).toBe(1);
  await expect(page.getByText("Activación solicitada. La decide otra persona en Aprobaciones.")).toBeVisible();

  // Quien la pidió la ve, pero sin botones.
  const decision = (p: Page, razonSocial: string) => p.locator("li.decision").filter({ hasText: `Activación · ${razonSocial}` });
  await page.goto("/operacion/aprobaciones");
  await expect(decision(page, PROSPECTO.razonSocial).getByText("La pediste tú: decide otra persona.")).toBeVisible();
  await expect(decision(page, PROSPECTO.razonSocial).getByRole("button", { name: "Aprobar" })).toHaveCount(0);

  // Aprobación la decide, pero sin expediente aprobado la base no deja activar (candado de la 0028).
  await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
  await page.goto("/operacion/aprobaciones");
  await decision(page, PROSPECTO.razonSocial).getByRole("button", { name: "Aprobar" }).click();
  await page.waitForURL(/aviso=activacion_sin_expediente_aprobado/);
  await expect(page.getByText("La base no deja activar: falta un expediente aprobado en su versión vigente.")).toBeVisible();
  const [sinExpediente] = await consultar<{ estado: string; solicitud: string }>(
    `select c.estado, r.estado as solicitud from companies c
     join company_activation_requests r on r.company_id = c.id where c.id = $1`,
    [empresa!.id],
  );
  expect(sinExpediente).toEqual({ estado: "en_alta", solicitud: "pendiente" });

  // Faro E2E (sembrada con expediente aprobado y riesgo vigente; la activación la pidió op1).
  // Con el factor de hace 31 minutos, Aprobación no decide y la base no cambia.
  const [faro] = await consultar<{ id: string; estado: string }>("select id, estado from companies where rfc = $1", [FARO.rfc]);
  expect(faro!.estado).toBe("en_alta");
  await sesionDe(context, CORREOS.op2, { superficie: "sofipo", factorHaceMinutos: 31 });
  await page.goto("/operacion/aprobaciones");
  await decision(page, FARO.razonSocial).getByRole("button", { name: "Aprobar" }).click();
  await expect(page.getByText("Para decidir, tu segundo factor debe ser de los últimos 30 minutos. Sal y vuelve a entrar.")).toBeVisible();
  const [pendiente] = await consultar<{ estado: string }>("select estado from companies where id = $1", [faro!.id]);
  expect(pendiente!.estado).toBe("en_alta");

  // Con factor reciente, un doble clic decide una sola vez.
  await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
  await page.goto("/operacion/aprobaciones");
  const aprobar = await dobleClic(decision(page, FARO.razonSocial).getByRole("button", { name: "Aprobar" }), { esperar: /aviso=decision_registrada/ });
  expect(aprobar.envios).toBe(1);
  const [decidida] = await consultar<{ estado: string; requested_by: string; decided_by: string; empresa: string }>(
    `select r.estado, r.requested_by, r.decided_by, c.estado as empresa from company_activation_requests r
     join companies c on c.id = r.company_id where r.company_id = $1`,
    [faro!.id],
  );
  expect(decidida).toEqual({ estado: "aprobada", requested_by: op1, decided_by: op2, empresa: "activa" });
  expect(await contar("select 1 from audit_log where accion = 'activacion_aprobada' and company_id = $1", [faro!.id])).toBe(1);
  expect(await contar("select 1 from company_state_history where company_id = $1 and estado_nuevo = 'activa'", [faro!.id])).toBe(1);
  expect(errores).toEqual([]);
});

test("un caso abierto de Cumplimiento no se le nombra a Aprobación ni a Originación", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const estados = async () => (await consultar<{ rfc: string; estado: string }>(
    "select rfc, estado from companies where rfc in ($1, $2) order by rfc", [BRISA.rfc, CIMA.rfc],
  )).map((fila) => fila.estado);
  expect(await estados()).toEqual(["en_alta", "suspendida"]);
  const sinLista = async () => {
    const aviso = page.locator("#aviso-operacion");
    await expect(aviso).toBeVisible();
    await expect(aviso).not.toContainText(/lista/i);
    await expect(aviso).not.toContainText(/bloquead/i);
    return aviso;
  };

  // Aprobación intenta activar a Brisa: la base no deja y el aviso no nombra la lista.
  await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
  await page.goto("/operacion/aprobaciones");
  await page.locator("li.decision").filter({ hasText: `Activación · ${BRISA.razonSocial}` }).getByRole("button", { name: "Aprobar" }).click();
  await page.waitForURL(/aviso=activacion_con_coincidencia_lpb/);
  await expect(await sinLista()).toContainText("Cumplimiento tiene un caso abierto de esta empresa: no se puede activar hasta que lo resuelva.");

  // Originación pide reactivar a Cima: tampoco se nombra la lista y no queda solicitud.
  const [cima] = await consultar<{ id: string }>("select id from companies where rfc = $1", [CIMA.rfc]);
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await page.goto(`/operacion/clientes/${cima!.id}`);
  await page.locator("#motivo-suspension").fill("La empresa pidió revisar su caso.");
  await page.getByRole("button", { name: "Pedir reactivación" }).click();
  await page.waitForURL(/aviso=reactivacion_con_coincidencia_lpb/);
  await expect(await sinLista()).toContainText("Cumplimiento tiene un caso abierto de esta empresa: no se puede reactivar hasta que lo resuelva.");
  expect(await contar("select 1 from company_suspensions where company_id = $1 and tipo = 'reactivacion'", [cima!.id])).toBe(0);
  expect(await estados()).toEqual(["en_alta", "suspendida"]);
  expect(errores).toEqual([]);
});

test("el grado de riesgo no le dice a Originación ni a Aprobación que hay una coincidencia; a Cumplimiento sí", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const [brisa] = await consultar<{ id: string }>("select id from companies where rfc = $1", [BRISA.rfc]);
  const riesgo = page.locator("section", { has: page.locator("#riesgo-titulo") });
  const factor = (etiqueta: string) => riesgo.locator("dl > div", { has: page.locator("dt", { hasText: etiqueta }) }).locator("dd");
  for (const correo of [CORREOS.op1, CORREOS.op2]) {
    await sesionDe(context, correo, { superficie: "sofipo" });
    await page.goto(`/operacion/clientes/${brisa!.id}/expediente`);
    await expect(riesgo).toContainText("Grado alto");
    await expect(factor("Revisión de Cumplimiento")).toHaveText("Lo ve Cumplimiento");
    await expect(riesgo).not.toContainText(/lista|exacta|puntaje/i);
    await expect(page.locator("#coincidencias-titulo")).toHaveText("Revisión de Cumplimiento");
  }
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  await page.goto(`/operacion/clientes/${brisa!.id}/expediente`);
  await expect(factor("Coincidencias en listas")).toHaveText("exacta · 3 puntos");
  await expect(riesgo).toContainText("Puntaje");
  await expect(page.locator("#coincidencias-titulo")).toHaveText("Coincidencias con listas");
  expect(errores).toEqual([]);
});

test("tras un rechazo del socio extranjero el formulario vuelve en «Extranjera» con el campo marcado; la moral extranjera entra sin RFC", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const [duna] = await consultar<{ id: string }>("select id from companies where rfc = $1", [DUNA.rfc]);
  const expediente = `/operacion/clientes/${duna!.id}/expediente`;
  const socios = () => contar("select 1 from kyb_accionistas where company_id = $1", [duna!.id]);
  const capturar = async (tipo: "fisica" | "moral", documento: string) => {
    await page.goto(expediente);
    await page.locator("#acc-tipo").selectOption(tipo);
    await page.locator("#acc-nacionalidad").selectOption("extranjera");
    await page.locator("#acc-nombre").fill(tipo === "fisica" ? "John Smith Taylor" : "Delaware Holdings LLC");
    await page.locator("#acc-pais").selectOption("US");
    await page.locator("#acc-documento").fill(documento);
    if (tipo === "fisica") await page.locator("#acc-nacimiento").fill("1980-05-01");
    await page.locator("#acc-capital").fill("40");
    await page.locator("#acc-votos").fill("40");
    await page.getByRole("button", { name: "Agregar accionista" }).click();
  };
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  for (const tipo of ["fisica", "moral"] as const) {
    await capturar(tipo, "A1");
    await page.waitForURL(tipo === "moral" ? /aviso=dato_invalido_documentoExtranjero.*tipo=moral/ : /aviso=dato_invalido_documentoExtranjero/);
    await expect(page.locator("#aviso-operacion")).toContainText("de 4 a 20 letras y números");
    await expect(page.locator("#acc-tipo")).toHaveValue(tipo);
    await expect(page.locator("#acc-nacionalidad")).toHaveValue("extranjera");
    const campo = page.locator("#acc-documento");
    await expect(campo).toHaveAttribute("aria-invalid", "true");
    await expect(campo).toHaveAttribute("aria-describedby", "acc-documento-pista aviso-operacion");
    await expect(page.locator('label[for="acc-documento"]')).toHaveText(
      tipo === "fisica" ? "Número de pasaporte o identificación oficial" : "Número de identificación fiscal o de registro en su país",
    );
    expect(await socios()).toBe(0);
  }
  await capturar("moral", "12-3456789");
  await page.waitForURL(/aviso=expediente_accionista_agregado/);
  expect(await consultar("select rfc, pais, documento_extranjero, nacionalidad from kyb_accionistas where company_id = $1", [duna!.id])).toEqual([
    { rfc: null, pais: "US", documento_extranjero: "123456789", nacionalidad: "Estados Unidos" },
  ]);
  await expect(page.locator("#accionistas-titulo").locator("..")).toContainText("Estados Unidos · registro 123456789");
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

test("la descarga del expediente llega aislada (sandbox) y la pantalla del expediente conserva la política general", async ({ page, context }) => {
  const [faro] = await consultar<{ id: string }>("select id from companies where rfc = $1", [FARO.rfc]);
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  // Un documento que no es de la empresa: 404 sin evento, pero la política de next.config ya aplica a la ruta.
  const descargas = () => contar("select 1 from audit_log where company_id = $1 and accion = 'expediente_documento_descargado'", [faro!.id]);
  const antes = await descargas();
  const descarga = await page.request.get(`/operacion/clientes/${faro!.id}/expediente/documento/${crypto.randomUUID()}`);
  expect(descarga.status()).toBe(404);
  expect(descarga.headers()["content-security-policy"]).toBe("sandbox; default-src 'none'; frame-ancestors 'none'");
  expect(await descargas()).toBe(antes);
  const pantalla = await page.request.get(`/operacion/clientes/${faro!.id}/expediente`);
  expect(pantalla.status()).toBe(200);
  expect(pantalla.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
});
