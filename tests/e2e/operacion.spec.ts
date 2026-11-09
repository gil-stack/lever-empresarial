import { randomUUID } from "node:crypto";

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

  // serv-N18: «Revisar 😀» son 9 caracteres (10 unidades UTF-16: el navegador lo deja pasar). El servidor lo
  // rechaza y el diálogo sigue abierto con lo escrito, el aviso ligado al campo y el foco en él; corregido, rechaza.
  await page.goto("/operacion/aprobaciones");
  await decision(page, PROSPECTO.razonSocial).getByRole("button", { name: "Rechazar" }).click();
  const dialogo = page.getByRole("dialog", { name: "Rechazar" });
  const motivo = dialogo.getByLabel("Motivo (de 10 a 500 caracteres)");
  await motivo.fill("Revisar 😀");
  await dialogo.getByRole("button", { name: "Rechazar" }).click();
  await expect(dialogo.getByText("El motivo lleva al menos 10 caracteres")).toBeVisible();
  await expect(motivo).toHaveValue("Revisar 😀");
  await expect(motivo).toHaveAttribute("aria-invalid", "true");
  await expect(dialogo.locator(`[id="${await motivo.getAttribute("aria-describedby")}"]`)).toContainText("al menos 10 caracteres");
  await expect(motivo).toBeFocused();
  expect(new URL(page.url()).search).toBe("");
  expect(await solicitudes()).toBe(1);
  expect((await consultar<{ estado: string }>("select estado from company_activation_requests where company_id = $1", [empresa!.id]))[0]?.estado).toBe("pendiente");
  await motivo.fill("Falta el expediente aprobado de la empresa");
  await dialogo.getByRole("button", { name: "Rechazar" }).click();
  await page.waitForURL(/aviso=decision_registrada/);
  expect((await consultar<{ estado: string }>("select estado from company_activation_requests where company_id = $1", [empresa!.id]))[0]?.estado).toBe("rechazada");

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
    // serv-N9: solo el grado y la fecha de revisión; ningún factor (todos en cero delatarían la lista).
    await expect(riesgo).toContainText("Grado alto");
    await expect(riesgo).toContainText(/Revisar antes del|Revisión vencida/);
    await expect(riesgo.locator("dl")).toHaveCount(0);
    await expect(riesgo).toContainText("El desglose de la calificación lo ven Cumplimiento y Auditoría.");
    await expect(riesgo).not.toContainText(/lista|exacta|puntaje|punto|actividad|zona|antigüedad/i);
    await expect(page.locator("#coincidencias-titulo")).toHaveText("Revisión de Cumplimiento");
    // Tampoco viajan en la respuesta RSC que lleva la página.
    expect(await page.content()).not.toMatch(/antiguedad_meses|volumen_mensual|coincidencias\\?"|exacta|puntaje/i);
  }
  await sesionDe(context, CORREOS.op3, { superficie: "sofipo" });
  await page.goto(`/operacion/clientes/${brisa!.id}/expediente`);
  await expect(factor("Coincidencias en listas")).toHaveText("exacta · 3 puntos");
  await expect(riesgo).toContainText("Puntaje");
  await expect(page.locator("#coincidencias-titulo")).toHaveText("Coincidencias con listas");
  expect(errores).toEqual([]);
});

test("tras un rechazo del socio extranjero el formulario vuelve con todo lo capturado y el campo marcado; la moral extranjera entra sin RFC", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const [duna] = await consultar<{ id: string }>("select id from companies where rfc = $1", [DUNA.rfc]);
  const expediente = `/operacion/clientes/${duna!.id}/expediente`;
  const socios = () => contar("select 1 from kyb_accionistas where company_id = $1", [duna!.id]);
  type Otros = { rfc?: string; capital?: string; nombre?: string };
  const nombreDe = (tipo: "fisica" | "moral", otros: Otros) => otros.nombre ?? (tipo === "fisica" ? "John Smith Taylor" : "Delaware Holdings LLC");
  const capturar = async (tipo: "fisica" | "moral", documento: string, otros: Otros = {}) => {
    await page.goto(expediente);
    await page.locator("#acc-tipo").selectOption(tipo);
    await page.locator("#acc-nacionalidad").selectOption("extranjera");
    await page.locator("#acc-nombre").fill(nombreDe(tipo, otros));
    if (otros.rfc) await page.locator("#acc-rfc").fill(otros.rfc);
    await page.locator("#acc-pais").selectOption("US");
    await page.locator("#acc-documento").fill(documento);
    if (tipo === "fisica") await page.locator("#acc-nacimiento").fill("1980-05-01");
    await page.locator("#acc-capital").fill(otros.capital ?? "40");
    await page.locator("#acc-votos").fill("40");
    await page.getByRole("button", { name: "Agregar accionista" }).click();
  };
  // serv-N15: vuelve sin recargar, con todo lo capturado, y ningún dato del socio pasa por la dirección.
  const sigueCapturado = async (tipo: "fisica" | "moral", documento: string, otros: Otros = {}) => {
    await expect(page.locator("#acc-tipo")).toHaveValue(tipo);
    await expect(page.locator("#acc-nacionalidad")).toHaveValue("extranjera");
    await expect(page.locator("#acc-pais")).toHaveValue("US");
    await expect(page.locator("#acc-documento")).toHaveValue(documento);
    if (tipo === "fisica") await expect(page.locator("#acc-nacimiento")).toHaveValue("1980-05-01");
    await expect(page.locator("#acc-nombre")).toHaveValue(nombreDe(tipo, otros));
    await expect(page.locator("#acc-rfc")).toHaveValue(otros.rfc ?? "");
    await expect(page.locator("#acc-capital")).toHaveValue(otros.capital ?? "40");
    await expect(page.locator("#acc-votos")).toHaveValue("40");
    expect(new URL(page.url()).search).toBe("");
    expect(await socios()).toBe(0);
  };
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  for (const tipo of ["fisica", "moral"] as const) {
    await capturar(tipo, "A1");
    await expect(page.locator("#aviso-accionista")).toContainText("de 4 a 20 letras y números");
    const campo = page.locator("#acc-documento");
    await expect(campo).toHaveAttribute("aria-invalid", "true");
    await expect(campo).toHaveAttribute("aria-describedby", "acc-documento-pista aviso-accionista");
    await expect(campo).toBeFocused();
    await expect(page.locator('label[for="acc-documento"]')).toHaveText(
      tipo === "fisica" ? "Número de pasaporte o identificación oficial" : "Número de identificación fiscal o de registro en su país",
    );
    await sigueCapturado(tipo, "A1");
  }
  // serv-N15: los seis rechazos de la revisión (RFC «XX», nombre en blanco y capital «abc», en física y en
  // moral extranjera) vuelven con país, documento, fecha, nombre y porcentajes.
  for (const tipo of ["fisica", "moral"] as const) {
    for (const [otros, campo] of [
      [{ rfc: "XX" }, "#acc-rfc"],
      [{ nombre: "   " }, "#acc-nombre"],
      [{ capital: "abc" }, "#acc-capital"],
    ] as const) {
      await capturar(tipo, "12-3456789", otros);
      await expect(page.locator("#aviso-accionista")).toBeVisible();
      await expect(page.locator(campo)).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator(campo)).toHaveAttribute("aria-describedby", "aviso-accionista");
      await expect(page.locator(campo)).toBeFocused();
      await sigueCapturado(tipo, "12-3456789", otros);
    }
  }
  // El último rechazo (capital «abc» de la moral) se corrige en el mismo formulario y entra.
  await page.locator("#acc-capital").fill("40");
  await page.getByRole("button", { name: "Agregar accionista" }).click();
  await page.waitForURL(/aviso=expediente_accionista_agregado/);
  expect(await consultar("select rfc, pais, documento_extranjero, nacionalidad from kyb_accionistas where company_id = $1", [duna!.id])).toEqual([
    { rfc: null, pais: "US", documento_extranjero: "123456789", nacionalidad: "Estados Unidos" },
  ]);
  await expect(page.locator("#accionistas-titulo").locator("..")).toContainText("Estados Unidos · registro 123456789");
  await expect(page.locator("#aviso-accionista")).toHaveCount(0);
  await expect(page.locator("#acc-nombre")).toHaveValue("");
  expect(errores).toEqual([]);
});

// Una identidad con un carácter invisible (lo que deja copiar y pegar) se ve bien en pantalla: el aviso dice qué pasó,
// marca el campo y le da el foco. Un nombre mal formado sin invisibles conserva el aviso de formato. El formulario
// de representante, como el de socio, vuelve con lo capturado y sin datos personales en la dirección (P3).
test("un nombre con un carácter invisible da su propio aviso; el formulario de representante conserva lo capturado", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const [duna] = await consultar<{ id: string }>("select id from companies where rfc = $1", [DUNA.rfc]);
  const expediente = `/operacion/clientes/${duna!.id}/expediente`;
  const socios = () => contar("select 1 from kyb_accionistas where company_id = $1", [duna!.id]);
  const representantes = () => contar("select 1 from kyb_representantes where company_id = $1", [duna!.id]);
  const INVISIBLE = "El nombre trae un carácter invisible, algo común al copiar y pegar. Escríbelo de nuevo a mano.";
  const FORMATO = "Revisa el campo marcado: el dato no tiene el formato esperado.";
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  const [sociosAntes, representantesAntes] = [await socios(), await representantes()];

  // Socio persona física mexicana con «Juan\u0085Pérez López».
  await page.goto(expediente);
  for (const [nombre, aviso] of [["Juan\u0085Pérez López", INVISIBLE], ["Ana\u200bRuiz Sol", INVISIBLE], ["   ", FORMATO]] as const) {
    await page.locator("#acc-tipo").selectOption("fisica");
    await page.locator("#acc-nombre").fill(nombre);
    await page.locator("#acc-curp").fill("GORL750505MDFMZR04");
    await page.locator("#acc-capital").fill("10");
    await page.locator("#acc-votos").fill("10");
    await page.getByRole("button", { name: "Agregar accionista" }).click();
    await expect(page.locator("#aviso-accionista")).toHaveText(aviso);
    await expect(page.locator("#acc-nombre")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#acc-nombre")).toHaveAttribute("aria-describedby", "aviso-accionista");
    await expect(page.locator("#acc-nombre")).toBeFocused();
    await expect(page.locator("#acc-nombre")).toHaveValue(nombre);
    await expect(page.locator("#acc-curp")).toHaveValue("GORL750505MDFMZR04");
    expect(new URL(page.url()).search).toBe("");
  }
  expect(await socios()).toBe(sociosAntes);

  // Representante: el mismo aviso, y vuelve con todo lo capturado (antes recargaba la página y lo perdía).
  const capturado = { rfc: "RUSP800101AB1", curp: "RUSP800101HDFZLD09", cargo: "apoderado", pep: "no", designadoPor: "Asamblea del 3 de marzo" };
  await page.locator("#rep-nombre").fill("Pedro\u00adRuiz Sol");
  await page.locator("#rep-rfc").fill(capturado.rfc);
  await page.locator("#rep-curp").fill(capturado.curp);
  await page.locator("#rep-cargo").selectOption(capturado.cargo);
  await page.locator("#rep-pep").selectOption(capturado.pep);
  await page.locator("#rep-designado").fill(capturado.designadoPor);
  await page.locator('input[name="esAdministrador"]').check();
  const sigueCapturado = async (nombre: string, curp = capturado.curp) => {
    await expect(page.locator("#rep-nombre")).toHaveValue(nombre);
    await expect(page.locator("#rep-rfc")).toHaveValue(capturado.rfc);
    await expect(page.locator("#rep-curp")).toHaveValue(curp);
    await expect(page.locator("#rep-cargo")).toHaveValue(capturado.cargo);
    await expect(page.locator("#rep-pep")).toHaveValue(capturado.pep);
    await expect(page.locator("#rep-designado")).toHaveValue(capturado.designadoPor);
    await expect(page.locator('input[name="esAdministrador"]')).toBeChecked();
    expect(new URL(page.url()).search).toBe("");
    expect(await representantes()).toBe(representantesAntes);
  };
  await page.getByRole("button", { name: "Agregar representante" }).click();
  await expect(page.locator("#aviso-representante")).toHaveText(INVISIBLE);
  await expect(page.locator("#rep-nombre")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#rep-nombre")).toHaveAttribute("aria-describedby", "aviso-representante");
  await expect(page.locator("#rep-nombre")).toBeFocused();
  await sigueCapturado("Pedro\u00adRuiz Sol");

  // Se corrige el nombre y falla la CURP: el aviso de formato marca la CURP y todo lo demás sigue ahí.
  await page.locator("#rep-nombre").fill("Pedro Ruiz Sol");
  await page.locator("#rep-curp").fill("XX");
  await page.getByRole("button", { name: "Agregar representante" }).click();
  await expect(page.locator("#aviso-representante")).toHaveText(FORMATO);
  await expect(page.locator("#rep-curp")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#rep-curp")).toBeFocused();
  await expect(page.locator("#rep-nombre")).not.toHaveAttribute("aria-invalid", "true");
  await sigueCapturado("Pedro Ruiz Sol", "XX");

  // Corregido en el mismo formulario, entra una sola vez.
  await page.locator("#rep-curp").fill(capturado.curp);
  await page.getByRole("button", { name: "Agregar representante" }).click();
  await page.waitForURL(/aviso=expediente_representante_agregado/);
  expect(await representantes()).toBe(representantesAntes + 1);
  expect(await consultar("select nombre, rfc, curp, cargo, es_administrador, designado_por from kyb_representantes where company_id = $1 and nombre = $2", [duna!.id, "Pedro Ruiz Sol"])).toEqual([
    { nombre: "Pedro Ruiz Sol", rfc: capturado.rfc, curp: capturado.curp, cargo: "apoderado", es_administrador: true, designado_por: capturado.designadoPor },
  ]);
  await expect(page.locator("#rep-nombre")).toHaveValue("");
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

// base-N27: con varias solicitudes pendientes, el error de una marca y enfoca solo su tarjeta. Antes la página marcaba
// el campo en todas, y con el foco del aviso las tres notas pedían el foco.
test("con tres recuperaciones pendientes, el rechazo sin nota marca y enfoca solo la nota de esa tarjeta", async ({ page, context }) => {
  const errores = vigilarConsola(page);
  const personas = [CORREOS.diego, CORREOS.sol, CORREOS.ernesto];
  const ids: string[] = [];
  for (const correo of personas) {
    const id = randomUUID();
    // La solicitud y su evento en una sola sentencia: la base exige el rastro en la misma transacción.
    await consultar(
      `with r as (
         insert into auth_recuperaciones (id, user_id, solicitada_en, motivo) values ($1, $2, now(), 'Cambié de teléfono y perdí la app.')
         returning id, user_id
       )
       insert into audit_log (id, operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, ocurrido_en)
       select gen_random_uuid(), (select id from operators order by alta_en limit 1), null, 'miembro', r.user_id, 'cliente',
         'recuperacion_solicitada', 'auth_recuperaciones', r.id, now()
       from r`,
      [id, await idDe(correo)],
    );
    ids.push(id);
  }
  await sesionDe(context, CORREOS.op2, { superficie: "sofipo" });
  await page.goto("/operacion/recuperaciones");
  const tarjeta = (correo: string) => page.locator("li.decision").filter({ hasText: correo });
  const nota = (indice: number) => page.locator(`[id="nota-${ids[indice]}"]`);
  for (const correo of personas) await expect(tarjeta(correo)).toBeVisible();

  await tarjeta(CORREOS.sol).getByRole("button", { name: "Rechazar" }).click();
  await page.waitForURL(/aviso=motivo_invalido/);
  expect(new URL(page.url()).searchParams.get("en")).toBe(ids[1]);
  await expect(nota(1)).toHaveAttribute("aria-invalid", "true");
  await expect(nota(1)).toHaveAttribute("aria-describedby", "aviso-operacion");
  await expect(nota(1)).toBeFocused();
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(1);
  for (const indice of [0, 2]) await expect(nota(indice)).not.toHaveAttribute("aria-invalid", "true");

  // Con su nota, cada una se rechaza; ninguna queda abierta para las demás pruebas.
  for (const [indice, correo] of personas.entries()) {
    await nota(indice).fill("No se pudo confirmar la identidad por videollamada.");
    await tarjeta(correo).getByRole("button", { name: "Rechazar" }).click();
    await expect(tarjeta(correo)).toHaveCount(0);
  }
  expect(await contar("select 1 from auth_recuperaciones where id = any($1::uuid[]) and estado = 'rechazada'", [ids])).toBe(3);
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
