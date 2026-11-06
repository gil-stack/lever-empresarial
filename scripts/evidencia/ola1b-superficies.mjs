// Recorrido de la Ola 1B «superficies»: Operación SOFIPO, entrada, invitación,
// recuperar contraseña, «Perdí el segundo factor», teléfono, landing, /precios, 404
// y las plantillas de correo. Playwright headless propio (no el navegador del MCP)
// contra `next start` y un Postgres local desechable.
//
//   BASE=http://localhost:4808 \
//   DUENO_URL=postgres://postgres@127.0.0.1:5543/plataforma \
//   ESTADO=/ruta/fuera/del/repo/ola1b.json \
//   [FASES=flujos,capturas,correos] node scripts/evidencia/ola1b-superficies.mjs
//
// Todo pasa por clics. La base se toca como dueña solo para: fijar el token de una
// invitación o de un enlace de recuperación (en local el correo no sale), envejecer el
// segundo factor de una sesión (para ver «Confirma que eres tú» sin esperar 5 minutos),
// sembrar dos categorías de la política para el teléfono y contar filas que prueban
// que un doble clic dejó una sola operación. Rechaza un DUENO_URL que no sea local.

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE ?? "http://localhost:4808";
const DUENO = process.env.DUENO_URL ?? "";
const ESTADO = process.env.ESTADO ?? "";
const SALIDA = process.env.SALIDA ?? "docs/evidencia/ola1b-superficies";
const FASES = (process.env.FASES ?? "flujos,publicas,capturas,correos").split(",");
const CLAVE = "clave-segura-12";
const CLAVE_NUEVA = "clave-nueva-2026";
const TEMAS = ["oscuro", "claro", "lever"];
const TOPE_CAPTURA = 8000;
const ANCHOS = [1440, 390];

if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) {
  throw new Error("DUENO_URL tiene que apuntar a un Postgres local desechable (127.0.0.1 o localhost).");
}
if (!ESTADO || ESTADO.includes("/docs/") || ESTADO.startsWith("docs/")) {
  throw new Error("ESTADO tiene que ser un archivo fuera del repositorio: guarda semillas TOTP y sesiones.");
}

const requerir = createRequire(import.meta.url);
const { chromium } = requerir("playwright");
const sharp = requerir("sharp");
const { PNG } = requerir("pngjs");
mkdirSync(`${SALIDA}/capturas`, { recursive: true });

const estado = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, "utf8")) : { semillas: {}, pasos: {}, claves: {}, sesiones: {} };
const guardar = () => writeFileSync(ESTADO, JSON.stringify(estado));

const comprobaciones = [];
function anotar(texto) {
  console.log(`OK ${texto}`);
  comprobaciones.push(texto);
}
function exigir(condicion, texto) {
  if (!condicion) throw new Error(`FALLO ${texto}`);
  anotar(texto);
}

function sql(consulta) {
  return execFileSync("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8" }).trim();
}
const contar = (consulta) => Number(sql(consulta));
const idDe = (correo) => sql(`select id from users where correo = '${correo}'`);
const sha256 = (texto) => createHash("sha256").update(texto).digest("hex");
const tokenNuevo = () => randomBytes(32).toString("base64url");

// ---------- TOTP: el código de un paso de 30 s que esa persona no haya usado ----------

function totp(semilla, paso) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of semilla.replace(/\s+/g, "").toUpperCase()) bits += alfabeto.indexOf(c).toString(2).padStart(5, "0");
  const llave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(paso));
  const h = createHmac("sha1", llave).update(mensaje).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

async function codigoFresco(correo) {
  const semilla = estado.semillas[correo];
  if (!semilla) throw new Error(`sin semilla para ${correo}`);
  for (;;) {
    const paso = Math.floor(Date.now() / 30_000);
    const restante = 30_000 - (Date.now() % 30_000);
    if (paso > (estado.pasos[correo] ?? -1) && restante > 4_000) {
      estado.pasos[correo] = paso;
      guardar();
      return totp(semilla, paso);
    }
    await new Promise((r) => setTimeout(r, restante + 300));
  }
}

// ---------- Navegador ----------

const navegador = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const erroresDeConsola = [];

async function contexto({ tema = "oscuro", ancho = 1440, sesion } = {}) {
  const ctx = await navegador.newContext({
    viewport: { width: ancho, height: ancho < 600 ? 844 : 900 },
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    ...(sesion && estado.sesiones[sesion] ? { storageState: estado.sesiones[sesion] } : {}),
  });
  await ctx.addCookies([{ name: "tema", value: tema, url: BASE }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => erroresDeConsola.push(`${page.url()} pageerror ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // La 404 responde 404 a propósito: el navegador lo anota como recurso fallido.
    if (/status of 404/.test(m.text()) && /esta-no-existe|no-existe/.test(page.url())) return;
    erroresDeConsola.push(`${page.url()} ${m.text().slice(0, 240)}`);
  });
  return { ctx, page };
}

async function captura(page, nombre, { completa = true } = {}) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  await page.waitForTimeout(400);
  const ruta = `${SALIDA}/capturas/${nombre}.webp`;
  // La semilla, el QR y los códigos de respaldo son secretos aunque la base sea desechable: se tapan.
  const secretos = page.locator(".arco-semilla, .arco-qr, .arco-codigos");
  // Chrome no captura más de 16 384 px reales: una página más alta (la bitácora en 390) se corta a 8 000 px.
  const alto = completa ? await page.evaluate(() => document.documentElement.scrollHeight) : 0;
  const recorte = alto > TOPE_CAPTURA ? { clip: { x: 0, y: 0, width: page.viewportSize().width, height: TOPE_CAPTURA } } : {};
  await sharp(await page.screenshot({ fullPage: completa, ...recorte, mask: [secretos], maskColor: "#7a7a7a" }))
    .webp({ quality: 78 })
    .toFile(ruta);
  anotar(`captura ${nombre}.webp${recorte.clip ? ` (primeros ${TOPE_CAPTURA} de ${alto} px)` : ""}`);
}

/** Captura la página en los 3 temas y los 2 anchos, recargándola (solo para pantallas que se pueden recargar). */
async function capturarEnTodo(page, nombre) {
  if (process.env.RAPIDO) return captura(page, `${nombre}-oscuro-1440`);
  const original = page.viewportSize();
  for (const tema of TEMAS) {
    await page.context().addCookies([{ name: "tema", value: tema, url: BASE }]);
    await page.reload({ waitUntil: "networkidle" });
    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: ancho < 600 ? 844 : 900 });
      await captura(page, `${nombre}-${tema}-${ancho}`);
    }
  }
  await page.context().addCookies([{ name: "tema", value: "oscuro", url: BASE }]);
  await page.setViewportSize(original);
  await page.reload({ waitUntil: "networkidle" });
}

async function listo(page) {
  await page.waitForLoadState("networkidle");
}

/** Doble clic real: dos clics seguidos sobre el mismo botón, como una persona impaciente. */
async function dobleClic(boton) {
  // UN_CLIC solo sirve para ensayar el resto del recorrido; la evidencia se corre sin él.
  if (process.env.UN_CLIC) return boton.click();
  await boton.dblclick({ delay: 40 });
}

async function guardarSesion(nombre, ctx) {
  estado.sesiones[nombre] = await ctx.storageState();
  guardar();
}

// ---------- Pasos compartidos ----------

async function inscribirTotp(page, correo, { operacion }) {
  const semilla = (await page.locator(".arco-semilla").innerText()).trim();
  estado.semillas[correo] = semilla;
  delete estado.pasos[correo];
  guardar();
  await page.getByLabel("Código que muestra la app").fill(await codigoFresco(correo));
  await page.getByRole("button", { name: "Confirmar el código" }).click();
  await page.getByRole("heading", { name: /códigos de respaldo/i }).waitFor();
  if (operacion) {
    await page.getByRole("button", { name: "Abrir operación" }).click();
  } else {
    await page.getByText("Ya los guardé en un lugar seguro").click();
    await page.getByRole("button", { name: "Entrar al portal" }).click();
  }
}

async function entrarCliente(page, correo, clave) {
  await page.goto(`${BASE}/entrar`);
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(clave);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/entrar\/continuar/);
  await listo(page);
}

async function entrarOperacion(page, correo) {
  await page.goto(`${BASE}/operacion/entrar`);
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.waitForURL(/\/operacion\/continuar/);
  await page.getByLabel("Código de la app autenticadora").fill(await codigoFresco(correo));
  await page.getByRole("button", { name: "Entrar con el código" }).click();
  await page.waitForURL(/\/operacion(\?|$)/);
  await listo(page);
}

/** Simula que el segundo factor de la sesión se probó hace `minutos`, como en seguridad-cuentas.mjs. */
function envejecerFactor(correo, minutos) {
  sql(`begin; set local session_replication_role = replica;
       update sessions set segundo_factor_en = now() - interval '${minutos} minutes' where user_id = '${idDe(correo)}'; commit;`);
}

/** Una sección de Operación, desde el lateral. */
async function irA(page, seccion) {
  await page.getByRole("navigation", { name: "Operación" }).getByRole("link", { name: seccion, exact: true }).click();
}

/** El menú de la persona en la barra superior (el botón lleva las iniciales y el nombre). */
async function abrirMenuDeCuenta(page) {
  await page.locator(".menu-desplegable.cuenta .menu-desplegable-boton").click();
}

/** Si la confirmación de 5 minutos venció, «Confirma que eres tú» aparece otra vez y se confirma con el código. */
async function confirmarSiLoPide(page, correo) {
  const confirma = page.getByRole("region", { name: "Confirma que eres tú" });
  if ((await confirma.count()) === 0) return false;
  await confirma.getByLabel("Código de la app autenticadora").fill(await codigoFresco(correo));
  await confirma.getByRole("button", { name: "Confirmar con el código" }).click();
  await confirma.waitFor({ state: "detached", timeout: 15_000 });
  await listo(page);
  return true;
}

/**
 * La ficha de Laura en Personas, para ver Topes y Factura con datos. Se siembra como dueña con su
 * evento de bitácora, igual que tests/e2e/personas.spec.ts: el alta por pantalla es de la consola.
 */
function sembrarFicha(companyId, correo, nombre) {
  const usuario = idDe(correo);
  const [centro, ficha] = [randomUUID(), randomUUID()];
  const evento = (accion, entidad, id) =>
    `insert into audit_log (id, operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
     values (gen_random_uuid(), (select operator_id from companies where id = '${companyId}'), '${companyId}', 'miembro', '${usuario}', 'cliente', '${accion}', '${entidad}', '${id}');`;
  sql(`begin;
       insert into cost_centers (id, company_id, nombre) values ('${centro}', '${companyId}', 'Dirección');
       ${evento("alta_centro_costo", "cost_centers", centro)}
       insert into employees (id, company_id, user_id, cost_center_id, nombre, alta_en, clabe_digito_valido)
         values ('${ficha}', '${companyId}', '${usuario}', '${centro}', '${nombre}', current_date, false);
       ${evento("alta_persona", "employees", ficha)}
       insert into policies (company_id) values ('${companyId}') on conflict do nothing;
       insert into policy_categories (company_id, nombre, tope_centavos)
         values ('${companyId}', 'Viáticos', 500000), ('${companyId}', 'Combustible', null);
       commit;`);
}

function fijarTokenDeInvitacion(correo) {
  const token = tokenNuevo();
  // El trigger de un solo uso no deja tocar la invitación; como dueña y sin triggers, solo se cambia el hash.
  sql(`begin; set local session_replication_role = replica;
       update invitations set token_hash = '${sha256(token)}'
       where id = (select id from invitations where user_id = '${idDe(correo)}' and usada_en is null and revocada_en is null
                   order by emitida_en desc limit 1); commit;`);
  return token;
}

async function aceptarInvitacion(page, correo, nombre) {
  const token = fijarTokenDeInvitacion(correo);
  await page.goto(`${BASE}/invitacion/${token}`);
  await listo(page);
  await capturarEnTodo(page, `${nombre}-invitacion`);
  await page.getByLabel("Contraseña nueva").fill(CLAVE);
  await page.getByLabel("Repite la contraseña").fill(CLAVE);
  await dobleClic(page.getByRole("button", { name: "Aceptar la invitación" }));
  await page.waitForURL(/\/continuar/);
  await listo(page);
  exigir(
    contar(`select count(*) from invitations where user_id = '${idDe(correo)}' and usada_en is not null`) === 1,
    `${correo}: doble clic en «Aceptar la invitación» deja una sola invitación usada`,
  );
  estado.claves[correo] = CLAVE;
  guardar();
}

// ==================================================================================
// FLUJOS
// ==================================================================================

const OP = "op@lever.test";
const OP2 = "op2@lever.test";
const LAURA = "laura@altamar.test";
const RFC_ALTAMAR = "ALO180312AB1";
const RFC_RECHAZO = "PRR200101AA1";

async function flujos() {
  // (3) Invitación del personal hasta crear la cuenta y abrir Operación.
  for (const [correo, nombre] of [[OP, "30-op"], [OP2, "31-op2"]]) {
    const { ctx, page } = await contexto();
    await aceptarInvitacion(page, correo, nombre);
    await capturarEnTodo(page, `${nombre}-alta-factor`);
    await inscribirTotp(page, correo, { operacion: true });
    await page.waitForURL(/\/operacion(\?|$)/);
    await listo(page);
    exigir((await page.locator("h1").count()) === 1 && (await page.locator("h1").innerText()) === "Resumen", `${correo} abre Operación en Resumen con un solo h1`);
    await guardarSesion(correo, ctx);
    await ctx.close();
  }

  // (1) Operación: entrada SOFIPO con segundo factor, clientes, aprobaciones, alertas, comisiones, bitácora.
  const { ctx: ctxOp, page: op } = await contexto();
  await op.goto(`${BASE}/operacion/entrar`);
  await listo(op);
  await capturarEnTodo(op, "10-operacion-entrar");
  await op.getByLabel("Correo").fill(OP);
  await op.getByLabel("Contraseña", { exact: true }).fill("no-es-la-clave");
  await op.getByRole("button", { name: "Continuar" }).click();
  await op.locator("#entrar-error").waitFor();
  exigir((await op.getByLabel("Correo").getAttribute("aria-describedby")) === "entrar-error", "Operación: el error de contraseña queda ligado al campo (aria-describedby)");
  exigir((await op.getByLabel("Correo").inputValue()) === OP, "Operación: tras el error el correo sigue escrito");
  await captura(op, "11-operacion-entrar-error-oscuro-1440");
  await op.getByLabel("Correo").fill(OP);
  await op.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await op.getByRole("button", { name: "Continuar" }).click();
  await op.waitForURL(/\/operacion\/continuar/);
  await listo(op);
  await capturarEnTodo(op, "12-operacion-segundo-factor");
  await op.getByLabel("Código de la app autenticadora").fill(await codigoFresco(OP));
  await dobleClic(op.getByRole("button", { name: "Entrar con el código" }));
  await op.waitForURL(/\/operacion(\?|$)/);
  await listo(op);
  anotar("op entra a Operación con contraseña y código TOTP");
  await guardarSesion(OP, ctxOp);

  // Clientes: registrar prospecto con doble clic.
  await irA(op, "Clientes");
  await op.waitForURL(/\/operacion\/clientes$/);
  await listo(op);
  await op.getByLabel("Razón social").fill("Altamar Logística");
  await op.getByLabel("RFC").fill(RFC_ALTAMAR);
  await op.getByLabel("Código postal").fill("06600");
  await dobleClic(op.getByRole("button", { name: "Registrar prospecto" }));
  await op.waitForURL(/\/operacion\/clientes\/[0-9a-f-]{36}/);
  await listo(op);
  const altamarId = op.url().match(/clientes\/([0-9a-f-]{36})/)[1];
  estado.altamarId = altamarId;
  guardar();
  exigir(contar(`select count(*) from companies where rfc = '${RFC_ALTAMAR}'`) === 1, "doble clic en «Registrar prospecto» deja una sola empresa");
  await dobleClic(op.getByRole("button", { name: "Solicitar activación" }));
  await op.getByText("Activación solicitada").waitFor();
  exigir(contar(`select count(*) from company_activation_requests where company_id = '${altamarId}'`) === 1, "doble clic en «Solicitar activación» deja una sola solicitud");

  // Un segundo prospecto, para rechazar su activación con motivo.
  await op.goto(`${BASE}/operacion/clientes`);
  await op.getByLabel("Razón social").fill("Prospecto Rechazado");
  await op.getByLabel("RFC").fill(RFC_RECHAZO);
  await op.getByLabel("Código postal").fill("64000");
  await op.getByRole("button", { name: "Registrar prospecto" }).click();
  await op.waitForURL(/\/operacion\/clientes\/[0-9a-f-]{36}/);
  await op.getByRole("button", { name: "Solicitar activación" }).click();
  await op.getByText("Activación solicitada").waitFor();
  await op.goto(`${BASE}/operacion/aprobaciones`);
  await listo(op);
  exigir((await op.getByText("La pediste tú: decide otra persona.").count()) === 2, "quien pidió la activación la ve sin botones");

  // op2 decide: aprueba Altamar (doble clic) y rechaza el otro con motivo en el diálogo.
  const { ctx: ctxOp2, page: op2 } = await contexto({ sesion: OP2 });
  await op2.goto(`${BASE}/operacion/aprobaciones`);
  await listo(op2);
  await capturarEnTodo(op2, "13-operacion-aprobaciones");
  const filaAltamar = op2.getByRole("listitem", { name: "Activación · Altamar Logística" });
  await dobleClic(filaAltamar.getByRole("button", { name: "Aprobar" }));
  await op2.getByText("Decisión registrada").waitFor();
  exigir(sql(`select estado from companies where id = '${altamarId}'`) === "activa", "op2 aprueba la activación: Altamar queda activa");
  exigir(contar(`select count(*) from company_state_history where company_id = '${altamarId}' and estado_nuevo = 'activa'`) === 1, "doble clic en «Aprobar» deja una sola transición a activa");
  await op2.getByRole("listitem", { name: "Activación · Prospecto Rechazado" }).getByRole("button", { name: "Rechazar" }).click();
  const dialogo = op2.getByRole("dialog", { name: "Rechazar" });
  await dialogo.waitFor();
  await captura(op2, "14-operacion-rechazar-dialogo-oscuro-1440", { completa: false });
  await dialogo.getByLabel("Motivo").fill("Documentación incompleta del prospecto.");
  await dobleClic(dialogo.getByRole("button", { name: "Rechazar" }));
  await op2.getByText("Decisión registrada").waitFor();
  exigir(
    contar(`select count(*) from company_activation_requests r join companies c on c.id = r.company_id where c.rfc = '${RFC_RECHAZO}' and r.estado = 'rechazada'`) === 1,
    "op2 rechaza con motivo desde el diálogo: una sola solicitud rechazada",
  );

  // Invitación del primer administrador de Altamar (doble clic).
  await op.goto(`${BASE}/operacion/clientes/${altamarId}`);
  await listo(op);
  await op.getByLabel("Nombre").fill("Laura Méndez");
  await op.getByLabel("Correo").fill(LAURA);
  await dobleClic(op.getByRole("button", { name: "Enviar invitación" }));
  await op.waitForURL(/aviso=invitacion_/);
  await listo(op);
  exigir(contar(`select count(*) from invitations where user_id = '${idDe(LAURA)}'`) === 1, "doble clic en «Enviar invitación» emite una sola invitación");
  await capturarEnTodo(op, "15-operacion-ficha-cliente");

  // Alertas: crear (doble clic), reasignar y cerrar con motivo.
  await irA(op, "Alertas");
  await op.waitForURL(/\/operacion\/alertas/);
  await listo(op);
  await op.getByLabel("Empresa").selectOption({ label: "Altamar Logística" });
  await op.getByLabel("Título").fill("Documentos por completar");
  await op.getByLabel("Detalle").fill("Falta el comprobante de domicilio de Altamar.");
  await dobleClic(op.getByRole("button", { name: "Crear alerta" }));
  await op.getByText("Alerta creada").waitFor();
  exigir(contar(`select count(*) from operational_alerts where company_id = '${altamarId}' and titulo = 'Documentos por completar'`) === 1, "doble clic en «Crear alerta» deja una sola alerta");
  const opId2 = idDe(OP2);
  await op.getByLabel("Reasignar").selectOption(opId2);
  await op.getByRole("button", { name: "Guardar responsable" }).click();
  await op.getByText("Responsable actualizado").waitFor();
  exigir(contar(`select count(*) from operational_alerts where titulo = 'Documentos por completar' and responsable_id = '${opId2}'`) === 1, "«Guardar responsable» reasigna la alerta a op2");
  await capturarEnTodo(op, "16-operacion-alertas");
  await op.getByLabel("Motivo de cierre").fill("Comprobante recibido por correo.");
  await dobleClic(op.getByRole("button", { name: "Cerrar alerta" }));
  await op.getByText("Alerta cerrada").waitFor();
  exigir(contar(`select count(*) from operational_alerts where titulo = 'Documentos por completar' and estado = 'cerrada'`) === 1, "«Cerrar alerta» con motivo la cierra una vez");

  // Comisiones: proponer (doble clic), op2 aprueba una y rechaza otra.
  const manana = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const pasado = new Date(Date.now() + 40 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  await irA(op, "Comisiones");
  await op.waitForURL(/\/operacion\/comisiones/);
  await listo(op);
  await op.getByLabel("Valor entero").fill("abc");
  await op.getByLabel("Valor entero").fill("250");
  await op.getByLabel("Vigente desde").fill(manana);
  await dobleClic(op.getByRole("button", { name: "Pedir autorización" }));
  await op.getByText("Versión propuesta").waitFor();
  exigir(contar(`select count(*) from company_commissions where company_id = '${altamarId}'`) === 1, "doble clic en «Pedir autorización» deja una sola versión");
  await op.getByLabel("Tipo").selectOption("spei");
  await op.getByLabel("Valor entero").fill("1500");
  await op.getByLabel("Vigente desde").fill(pasado);
  await op.getByRole("button", { name: "Pedir autorización" }).click();
  await op.getByText("Versión propuesta").waitFor();
  await op2.goto(`${BASE}/operacion/aprobaciones`);
  await listo(op2);
  const comisiones = op2.getByRole("listitem", { name: "Comisión · Altamar Logística" });
  await dobleClic(comisiones.first().getByRole("button", { name: "Aprobar" }));
  await op2.getByText("Decisión registrada").waitFor();
  await op2.getByRole("listitem", { name: "Comisión · Altamar Logística" }).getByRole("button", { name: "Rechazar" }).click();
  await op2.getByRole("dialog", { name: "Rechazar" }).getByLabel("Motivo").fill("La tarifa SPEI se revisa el próximo mes.");
  await op2.getByRole("dialog", { name: "Rechazar" }).getByRole("button", { name: "Rechazar" }).click();
  await op2.getByText("Decisión registrada").waitFor();
  exigir(
    contar(`select count(*) from company_commissions where company_id = '${altamarId}' and estado = 'vigente'`) === 1 &&
      contar(`select count(*) from company_commissions where company_id = '${altamarId}' and estado = 'rechazada'`) === 1,
    "op2 aprueba una comisión (queda vigente) y rechaza la otra con motivo",
  );
  await guardarSesion(OP2, ctxOp2);
  await ctxOp2.close();
  await op.goto(`${BASE}/operacion/comisiones`);
  await listo(op);
  await capturarEnTodo(op, "17-operacion-comisiones");
  await irA(op, "Bitácora");
  await op.waitForURL(/\/operacion\/bitacora/);
  await listo(op);
  exigir((await op.locator(".tabla tbody tr").count()) > 5, "la Bitácora lista los eventos de este recorrido");

  // Menú de la persona: Mi perfil y seguridad, y regreso a Operación. Tema desde el lateral.
  await abrirMenuDeCuenta(op);
  await op.getByRole("menuitem", { name: "Mi perfil y seguridad" }).click();
  await op.waitForURL(/\/entrar\/seguridad/);
  await listo(op);
  await op.getByRole("link", { name: /Volver a Operación/ }).click();
  await op.waitForURL(/\/operacion(\?|$)/);
  await op.locator(".operacion-lateral-pie").getByRole("radio", { name: "Claro" }).check();
  exigir((await op.locator("html").getAttribute("data-tema")) === "claro", "el selector de tema del lateral cambia Operación a Claro");
  await op.locator(".operacion-lateral-pie").getByRole("radio", { name: "Oscuro" }).check();
  anotar("Mi perfil y seguridad abre /entrar/seguridad y «Volver a Operación» regresa");

  // Precios desde la navegación de Operación: publicar el monto (doble clic).
  await op.goto(`${BASE}/precios`);
  await op.waitForURL(/\/operacion\/precios$/);
  anotar("/precios con sesión SOFIPO lleva a Precios dentro de Operación");
  await op.getByRole("navigation", { name: "Operación" }).getByRole("link", { name: "Resumen" }).click();
  await op.waitForURL(/\/operacion$/);
  await op.getByRole("navigation", { name: "Operación" }).getByRole("link", { name: "Precios" }).click();
  await op.waitForURL(/\/operacion\/precios$/);
  await listo(op);
  exigir((await op.getByRole("link", { name: "Precios", exact: true }).getAttribute("aria-current")) === "page", "Precios queda marcado en la navegación de Operación");
  await capturarEnTodo(op, "18-precios-sofipo");
  await op.getByLabel("Suscripción mensual, en pesos").fill("1499.00");
  await dobleClic(op.getByRole("button", { name: "Publicar el monto" }));
  await op.getByRole("button", { name: "Publicar el monto" }).waitFor({ state: "detached" });
  await listo(op);
  await captura(op, "19-precios-publicado-oscuro-1440");
  exigir(sql("select suscripcion_centavos from platform_pricing") === "149900", "op publica la suscripción: 149900 centavos");
  exigir(contar("select count(*) from audit_log where accion = 'publicar_precio'") === 1, "doble clic en «Publicar el monto» deja un solo evento en la bitácora");
  await guardarSesion(OP, ctxOp);

  // (3) Invitación del cliente hasta crear la cuenta; (2) entrada con contraseña y TOTP.
  const { ctx: ctxL, page: laura } = await contexto();
  await aceptarInvitacion(laura, LAURA, "32-laura");
  await capturarEnTodo(laura, "33-laura-alta-factor");
  await inscribirTotp(laura, LAURA, { operacion: false });
  await laura.waitForURL(/\/consola|\/empresas/);
  anotar("Laura acepta la invitación, registra su app autenticadora y entra al portal");
  await ctxL.close();

  const { ctx: ctxL2, page: l2 } = await contexto();
  await l2.goto(`${BASE}/entrar`);
  await listo(l2);
  await capturarEnTodo(l2, "20-entrar");
  await l2.getByLabel("Correo").fill(LAURA);
  await l2.getByLabel("Contraseña", { exact: true }).fill("no-es-la-clave");
  await l2.getByRole("button", { name: "Continuar" }).click();
  await l2.locator("#entrar-error").waitFor();
  exigir((await l2.getByLabel("Correo").getAttribute("aria-invalid")) === "true", "Entrar: el error marca los campos con aria-invalid y aria-describedby");
  exigir((await l2.getByLabel("Correo").inputValue()) === LAURA, "Entrar: tras el error el correo sigue escrito");
  await captura(l2, "21-entrar-error-oscuro-1440");
  const entradasAntes = contar(`select count(*) from auth_entradas where user_id = '${idDe(LAURA)}'`);
  await l2.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await dobleClic(l2.getByRole("button", { name: "Continuar" }));
  await l2.waitForURL(/\/entrar\/continuar/);
  await listo(l2);
  exigir(contar(`select count(*) from auth_entradas where user_id = '${idDe(LAURA)}'`) === entradasAntes + 1, "doble clic en «Continuar» abre una sola entrada");
  await capturarEnTodo(l2, "22-entrar-segundo-factor");
  await l2.getByLabel("Código de la app autenticadora").fill(await codigoFresco(LAURA));
  await dobleClic(l2.getByRole("button", { name: "Entrar con el código" }));
  await l2.waitForURL(/\/consola|\/empresas/);
  await listo(l2);
  anotar("Laura entra con contraseña y código TOTP");
  await guardarSesion(LAURA, ctxL2);

  // (6) Teléfono: inicio sin ficha en Personas; luego con ficha, topes y datos para factura.
  await l2.goto(`${BASE}/telefono`);
  await listo(l2);
  exigir((await l2.getByText("Todavía no tienes ficha en Personas.").count()) === 1, "Teléfono sin ficha: lo dice y a quién pedirla");
  await captura(l2, "35-telefono-sin-ficha-oscuro-1440");
  sembrarFicha(altamarId, LAURA, "Laura Méndez");
  await l2.reload({ waitUntil: "networkidle" });
  exigir((await l2.locator("h1").count()) === 1, "Teléfono: un solo h1 en Inicio");
  await l2.getByRole("link", { name: "Ver topes" }).click();
  await l2.waitForURL(/\/telefono\/topes/);
  await listo(l2);
  exigir((await l2.getByText("Viáticos").count()) === 1 && (await l2.getByText("Sin tope escrito").count()) === 1, "Topes muestra la categoría con tope y la que no tiene");
  await l2.getByRole("navigation", { name: "Teléfono" }).getByRole("link", { name: "Factura" }).click();
  await l2.waitForURL(/\/telefono\/facturacion/);
  await listo(l2);
  exigir((await l2.getByText(RFC_ALTAMAR).count()) === 1, "Pedir factura muestra el RFC de la empresa y su QR");
  await l2.getByRole("navigation", { name: "Teléfono" }).getByRole("link", { name: "Inicio" }).click();
  await l2.waitForURL(/\/telefono$/);
  await l2.getByRole("link", { name: "Pedir factura" }).click();
  await l2.waitForURL(/\/telefono\/facturacion/);
  anotar("Teléfono: la barra de abajo y los accesos de Inicio llevan a Topes y Factura");
  await l2.goto(`${BASE}/precios`);
  await listo(l2);
  exigir((await l2.getByRole("button", { name: "Publicar el monto" }).count()) === 0, "/precios con sesión de cliente no ofrece publicar");
  await ctxL2.close();

  // (4) Recuperar contraseña: enlace, contraseña nueva y entrada con ella.
  const { ctx: ctxR, page: rec } = await contexto();
  await rec.goto(`${BASE}/recuperar`);
  await listo(rec);
  await capturarEnTodo(rec, "40-recuperar");
  const resetsAntes = contar(`select count(*) from password_resets where user_id = '${idDe(LAURA)}'`);
  await rec.getByLabel("Correo").fill(LAURA);
  await dobleClic(rec.getByRole("button", { name: "Enviar el enlace" }));
  await rec.getByText("Revisa tu correo").waitFor();
  await new Promise((r) => setTimeout(r, 1500));
  exigir(contar(`select count(*) from password_resets where user_id = '${idDe(LAURA)}'`) === resetsAntes + 1, "doble clic en «Enviar el enlace» crea un solo enlace");
  await captura(rec, "41-recuperar-enviado-oscuro-1440");
  // Un correo sin cuenta responde lo mismo y no crea nada.
  const totalAntes = contar("select count(*) from password_resets");
  await rec.reload({ waitUntil: "networkidle" });
  await rec.getByLabel("Correo").fill("nadie@altamar.test");
  await dobleClic(rec.getByRole("button", { name: "Enviar el enlace" }));
  await rec.getByText("Revisa tu correo").waitFor();
  await new Promise((r) => setTimeout(r, 1500));
  exigir(contar("select count(*) from password_resets") === totalAntes, "un correo sin cuenta recibe la misma respuesta y no crea enlace");
  const tokenReset = tokenNuevo();
  // En local el correo no sale y el servidor anula el enlace que no se entregó. Se simula la entrega:
  // el enlace más reciente vuelve a estar vigente con un token conocido.
  sql(`begin; set local session_replication_role = replica;
       update password_resets set token_hash = '${sha256(tokenReset)}', anulado_en = null
       where id = (select id from password_resets where user_id = '${idDe(LAURA)}' and usado_en is null
                   order by creado_en desc limit 1); commit;`);
  await rec.goto(`${BASE}/recuperar/${tokenReset}`);
  await listo(rec);
  await capturarEnTodo(rec, "42-recuperar-nueva");
  await rec.getByLabel("Contraseña nueva").fill(CLAVE_NUEVA);
  await rec.getByLabel("Repite la contraseña").fill(CLAVE_NUEVA);
  await dobleClic(rec.getByRole("button", { name: "Guardar la contraseña" }));
  await rec.getByText("La contraseña quedó guardada").waitFor();
  exigir(contar(`select count(*) from audit_log where accion = 'contrasena_restablecida' and actor_id = '${idDe(LAURA)}'`) === 1, "doble clic en «Guardar la contraseña» la restablece una sola vez");
  estado.claves[LAURA] = CLAVE_NUEVA;
  guardar();
  await captura(rec, "43-recuperar-guardada-oscuro-1440");
  await rec.getByRole("link", { name: "Entrar", exact: true }).click();
  await rec.waitForURL(/\/entrar/);
  await rec.goto(`${BASE}/recuperar/${tokenReset}`);
  await listo(rec);
  exigir((await rec.getByRole("heading", { name: "El enlace ya no sirve." }).count()) === 1, "el enlace usado ya no sirve");
  await capturarEnTodo(rec, "44-recuperar-enlace-usado");
  await rec.getByRole("link", { name: "Pedir otro enlace" }).click();
  await rec.waitForURL(/\/recuperar$/);
  await entrarCliente(rec, LAURA, CLAVE_NUEVA);
  await rec.getByLabel("Código de la app autenticadora").fill(await codigoFresco(LAURA));
  await rec.getByRole("button", { name: "Entrar con el código" }).click();
  await rec.waitForURL(/\/consola|\/empresas/);
  anotar("Laura entra con la contraseña nueva y su segundo factor de siempre");
  await ctxR.close();

  // (5) «Perdí el segundo factor»: pedir, confirmar en Operación y aprobar; luego registrar uno nuevo.
  const { ctx: ctxP, page: perdi } = await contexto();
  await entrarCliente(perdi, LAURA, CLAVE_NUEVA);
  await perdi.getByRole("button", { name: "Perdí el segundo factor" }).click();
  await perdi.getByLabel("Qué pasó").waitFor();
  for (const ancho of ANCHOS) {
    await perdi.setViewportSize({ width: ancho, height: ancho < 600 ? 844 : 900 });
    await captura(perdi, `50-perdi-factor-oscuro-${ancho}`);
  }
  await perdi.getByLabel("Qué pasó").fill("Cambié de teléfono y no pasé la app.");
  await dobleClic(perdi.getByRole("button", { name: "Pedir recuperación" }));
  await perdi.waitForURL(/aviso=recuperacion/);
  await listo(perdi);
  exigir(contar(`select count(*) from auth_recuperaciones where user_id = '${idDe(LAURA)}'`) === 1, "doble clic en «Pedir recuperación» deja una sola solicitud");
  await capturarEnTodo(perdi, "51-perdi-factor-en-revision");
  await ctxP.close();

  envejecerFactor(OP, 6);
  await op.goto(`${BASE}/operacion/recuperaciones`);
  await listo(op);
  const confirma = op.getByRole("region", { name: "Confirma que eres tú" });
  exigir((await confirma.count()) === 1, "con el factor de hace 6 minutos, Recuperaciones pide «Confirma que eres tú»");
  await capturarEnTodo(op, "52-recuperaciones-confirma");
  await confirma.getByLabel("Código de la app autenticadora").fill(await codigoFresco(OP));
  await confirma.getByRole("button", { name: "Confirmar con el código" }).click();
  await confirma.waitFor({ state: "detached", timeout: 15_000 });
  await capturarEnTodo(op, "53-recuperaciones-solicitud");
  const filaLaura = op.getByRole("listitem", { name: "Recuperación · Laura Méndez" });
  await filaLaura.getByLabel("Cómo verificaste la identidad").selectOption("videollamada");
  await dobleClic(filaLaura.getByRole("button", { name: "Aprobar" }));
  await op.getByText("Decisión registrada").waitFor();
  exigir(sql(`select estado from auth_recuperaciones where user_id = '${idDe(LAURA)}'`) === "aprobada", "op aprueba la recuperación tras confirmar que es él");
  exigir(contar(`select count(*) from audit_log where accion = 'recuperacion_aprobada' and actor_id = '${idDe(OP)}'`) === 1, "doble clic en «Aprobar» deja una sola aprobación en la bitácora");

  const { ctx: ctxN, page: nuevo } = await contexto();
  await entrarCliente(nuevo, LAURA, CLAVE_NUEVA);
  const ofreceRegistrar = (await nuevo.getByRole("heading", { name: "Registra cómo vas a entrar." }).count()) === 1;
  if (!ofreceRegistrar && process.env.UN_CLIC) {
    // Solo en ensayo: anota la falla y sigue con el resto del recorrido.
    console.log("PENDIENTE con la recuperación aprobada la entrada no ofrece registrar un factor nuevo");
    await nuevo.getByLabel("Código de la app autenticadora").fill(await codigoFresco(LAURA));
    await nuevo.getByRole("button", { name: "Entrar con el código" }).click();
  } else {
    exigir(ofreceRegistrar, "con la recuperación aprobada, la entrada ofrece registrar un factor nuevo");
    await capturarEnTodo(nuevo, "54-perdi-factor-registrar-nuevo");
    await inscribirTotp(nuevo, LAURA, { operacion: false });
  }
  await nuevo.waitForURL(/\/consola|\/empresas/);
  anotar("Laura entra después de la recuperación");
  await guardarSesion(LAURA, ctxN);

  // Rechazar una recuperación con nota (el otro botón de la fila). En ensayo, con la falla de arriba,
  // la recuperación aprobada sigue abierta y no deja pedir otra: se salta.
  if (ofreceRegistrar) {
  await nuevo.context().clearCookies();
  await entrarCliente(nuevo, LAURA, CLAVE_NUEVA);
  await nuevo.getByRole("button", { name: "Perdí el segundo factor" }).click();
  await nuevo.getByLabel("Qué pasó").fill("Prueba de rechazo.");
  await nuevo.getByRole("button", { name: "Pedir recuperación" }).click();
  await nuevo.waitForURL(/aviso=recuperacion/);
  await ctxN.close();
  await op.goto(`${BASE}/operacion/recuperaciones`);
  await listo(op);
  await confirmarSiLoPide(op, OP);
  const otra = op.getByRole("listitem", { name: "Recuperación · Laura Méndez" });
  await otra.getByLabel("Nota (obligatoria para rechazar)").fill("No se pudo confirmar la identidad por videollamada.");
  await otra.getByRole("button", { name: "Rechazar" }).click();
  await op.getByText("Decisión registrada").waitFor();
  exigir(contar(`select count(*) from auth_recuperaciones where user_id = '${idDe(LAURA)}' and estado = 'rechazada'`) === 1, "op rechaza la segunda solicitud con nota");
  } else {
    await ctxN.close();
  }
  await guardarSesion(OP, ctxOp);

  // Salir de Operación desde el menú de la persona.
  await abrirMenuDeCuenta(op);
  await op.getByRole("menuitem", { name: "Salir" }).click();
  await op.waitForURL(/\/operacion\/entrar/);
  anotar("«Salir» del menú de la persona cierra la sesión de Operación");
  await ctxOp.close();

}

// (8) Landing, 404 e invitación inexistente: no dependen de la base.
async function publicas() {
  const { ctx: ctxA, page: anon } = await contexto();
  await anon.goto(`${BASE}/`);
  await listo(anon);
  exigir((await anon.locator("h1").count()) === 1, "Landing: un solo h1");
  for (const enlace of await anon.locator("header nav a[href^='#']").all()) {
    const destino = await enlace.getAttribute("href");
    await enlace.click();
    exigir(new URL(anon.url()).hash === destino, `Landing: el menú lleva a ${destino}`);
  }
  // La primera viene abierta: cada clic alterna la suya.
  const preguntas = anon.locator("details");
  const abiertasAntes = await preguntas.evaluateAll((todas) => todas.map((d) => d.open));
  for (const pregunta of await anon.locator("details summary").all()) await pregunta.click();
  const abiertasDespues = await preguntas.evaluateAll((todas) => todas.map((d) => d.open));
  exigir(abiertasDespues.every((abierta, i) => abierta !== abiertasAntes[i]), `Landing: cada una de las ${abiertasAntes.length} preguntas frecuentes abre y cierra con un clic`);
  await anon.locator("header").getByRole("link", { name: "Entrar" }).click();
  await anon.waitForURL(/\/entrar/);
  await anon.goto(`${BASE}/esta-no-existe`);
  await listo(anon);
  exigir((await anon.getByRole("heading", { name: "No encontramos esta página." }).count()) === 1, "404 con su título");
  await capturarEnTodo(anon, "60-404");
  await anon.getByRole("link", { name: "Ir al inicio" }).click();
  await anon.waitForURL(`${BASE}/`);
  await anon.goto(`${BASE}/esta-no-existe`);
  await anon.getByRole("link", { name: "Entrar a mi cuenta" }).click();
  await anon.waitForURL(/\/entrar/);
  anotar("404: «Ir al inicio» y «Entrar a mi cuenta» llevan a su destino");
  await anon.goto(`${BASE}/invitacion/${tokenNuevo()}`);
  await listo(anon);
  exigir((await anon.getByRole("heading", { name: "Este enlace no es una invitación." }).count()) === 1 && (await anon.locator(".arco-kicker").count()) === 1, "invitación inexistente: un solo rótulo y su título");
  await capturarEnTodo(anon, "34-invitacion-inexistente");
  await anon.getByRole("link", { name: "Entrar" }).last().click();
  await anon.waitForURL(/\/entrar/);
  await ctxA.close();
}

// ==================================================================================
// CAPTURAS: cada pantalla en 3 temas × 2 anchos, consola limpia y contraste AA
// ==================================================================================

const lineal = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
const contrasteDe = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mezcla = (frente, fondo, a) => frente.map((v, i) => v * a + fondo[i] * (1 - a));

/** El método del #50: color calculado de cada texto contra los píxeles reales de su fondo, con el texto oculto. */
/** Contraste de toda la página: se mide pantalla por pantalla bajando hasta el final (tope de 10 pantallas). */
async function medirContraste(page, ruta) {
  const total = { medidos: 0, minimo: Infinity, fallas: [] };
  const alto = await page.evaluate(() => document.documentElement.scrollHeight);
  const vista = page.viewportSize().height;
  for (let y = 0, n = 0; y < alto && n < 10; y += vista, n += 1) {
    await page.evaluate((destino) => window.scrollTo(0, destino), y);
    await page.waitForTimeout(150);
    const parcial = await medirPantalla(page, ruta);
    total.medidos += parcial.medidos;
    total.minimo = Math.min(total.minimo, parcial.minimo);
    total.fallas.push(...parcial.fallas);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return total;
}

async function medirPantalla(page, ruta) {
  const textos = await page.evaluate(() => {
    const salida = [];
    const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const vistos = new Set();
    while (recorrido.nextNode()) {
      const nodo = recorrido.currentNode;
      if (!nodo.textContent.trim()) continue;
      const el = nodo.parentElement;
      if (!el || vistos.has(el)) continue;
      vistos.add(el);
      if (el.closest("[aria-hidden=true], .logotipo, .solo-lector, script, style, noscript, option, [disabled], .saltar, svg, dialog:not([open])")) continue;
      const estilo = getComputedStyle(el);
      if (estilo.visibility === "hidden" || Number(estilo.opacity) === 0) continue;
      // La respuesta de un <details> cerrado conserva caja pero no se pinta.
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const rango = document.createRange();
      rango.selectNodeContents(nodo);
      const r = rango.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      // Un texto tapado (bajo la barra fija al bajar) no se ve: no se mide contra lo que lo tapa.
      const encima = document.elementFromPoint(Math.min(innerWidth - 1, r.x + r.width / 2), Math.min(innerHeight - 1, Math.max(0, r.y + r.height / 2)));
      if (encima && !el.contains(encima) && !encima.contains(el)) continue;
      let opacidad = 1;
      for (let a = el; a; a = a.parentElement) opacidad *= Number(getComputedStyle(a).opacity);
      const n = estilo.color.match(/[\d.]+/g).map(Number);
      const color = estilo.color.startsWith("color(") ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : [n[0], n[1], n[2], n[3] ?? 1];
      salida.push({ texto: nodo.textContent.trim().slice(0, 40), color, opacidad, tamano: parseFloat(estilo.fontSize), peso: Number(estilo.fontWeight), caja: { x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.width, h: r.height } });
    }
    return salida;
  });
  const oculto = await page.addStyleTag({ content: "html body *, html body *::before, html body *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } svg text { fill: transparent !important; }" });
  await page.waitForTimeout(250);
  const png = PNG.sync.read(await page.screenshot());
  await oculto.evaluate((n) => n.remove());
  const fallas = [];
  let minimo = Infinity;
  for (const t of textos) {
    const alfa = t.color[3] * t.opacidad;
    let peor = Infinity;
    let fondoPeor = null;
    const { x, y, w, h } = t.caja;
    for (let i = 0; i <= 6; i += 1) {
      for (let j = 0; j <= 4; j += 1) {
        const px = Math.min(png.width - 1, Math.round(x + (w * i) / 6));
        const py = Math.min(png.height - 1, Math.round(y + (h * j) / 4));
        const k = (py * png.width + px) * 4;
        const fondo = [png.data[k], png.data[k + 1], png.data[k + 2]];
        const c = contrasteDe(mezcla(t.color.slice(0, 3), fondo, alfa), fondo);
        if (c < peor) {
          peor = c;
          fondoPeor = fondo;
        }
      }
    }
    const umbral = t.tamano >= 24 || (t.tamano >= 18.66 && t.peso >= 600) ? 3 : 4.5;
    minimo = Math.min(minimo, peor);
    if (peor < umbral) fallas.push({ ruta, texto: t.texto, color: hex(t.color), fondo: hex(fondoPeor), contraste: Number(peor.toFixed(2)), umbral });
  }
  return { medidos: textos.length, minimo, fallas };
}

/** La accesibilidad básica de cada pantalla: un h1, campos con etiqueta. */
async function revisarPantalla(page, ruta) {
  const h1 = await page.locator("h1").count();
  const sinEtiqueta = await page.evaluate(() =>
    [...document.querySelectorAll("input:not([type=hidden]), select, textarea")]
      .filter((campo) => !campo.labels?.length && !campo.getAttribute("aria-label") && !campo.getAttribute("aria-labelledby"))
      .map((campo) => campo.name || campo.id),
  );
  exigir(h1 === 1, `${ruta}: un solo h1`);
  exigir(sinEtiqueta.length === 0, `${ruta}: todos los campos con etiqueta${sinEtiqueta.length ? ` (faltan: ${sinEtiqueta})` : ""}`);

  // Tabulación: nadie se adelanta con tabindex positivo, el Tab avanza en el orden del documento
  // y cada parada se ve (contorno o sombra de foco distintos a los de reposo).
  const positivos = await page.locator("[tabindex]:not([tabindex='0']):not([tabindex^='-'])").count();
  exigir(positivos === 0, `${ruta}: sin tabindex positivo`);
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  // Sin transiciones mientras se mide: el estilo de foco se lee completo, no a medio camino.
  const quietud = await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
  const paradas = [];
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press("Tab");
    const parada = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const todos = [...document.querySelectorAll("*")];
      const estilo = getComputedStyle(el);
      const contorno = estilo.outlineStyle !== "none" && parseFloat(estilo.outlineWidth) > 0;
      const sombra = estilo.boxShadow !== "none";
      // Un campo sin contorno propio puede marcar el foco en su caja (:focus-within): se compara
      // la caja con el foco y sin él.
      const caja = el.parentElement;
      const huella = () => (caja ? ["borderColor", "boxShadow", "outlineStyle", "backgroundColor"].map((p) => getComputedStyle(caja)[p]).join("|") : "");
      let enLaCaja = false;
      if (!contorno && !sombra && caja) {
        const conFoco = huella();
        el.blur();
        enLaCaja = huella() !== conFoco;
        el.focus();
      }
      return {
        indice: todos.indexOf(el),
        nombre: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || el.tagName).trim().slice(0, 40),
        visible: contorno || sombra || enLaCaja,
      };
    });
    if (!parada || paradas.some((p) => p.indice === parada.indice)) break;
    paradas.push(parada);
  }
  await quietud.evaluate((estilo) => estilo.remove());
  await page.evaluate(() => document.activeElement?.blur());
  const fueraDeOrden = paradas.filter((p, i) => i > 0 && p.indice < paradas[i - 1].indice);
  const sinFoco = paradas.filter((p) => !p.visible).map((p) => p.nombre);
  exigir(paradas.length > 0 && fueraDeOrden.length === 0, `${ruta}: el Tab recorre ${paradas.length} paradas en el orden del documento`);
  exigir(sinFoco.length === 0, `${ruta}: cada parada del Tab tiene foco visible${sinFoco.length ? ` (sin foco: ${sinFoco.join(", ")})` : ""}`);
}

async function capturas() {
  const grupos = [
    {
      sesion: null,
      rutas: [
        ["/", "70-landing"],
        ["/entrar", "71-entrar"],
        ["/operacion/entrar", "72-operacion-entrar"],
        ["/recuperar", "73-recuperar"],
        [`/invitacion/${"A".repeat(43)}`, "74-invitacion-inexistente"],
        [`/recuperar/${"A".repeat(43)}`, "76-recuperar-enlace-invalido"],
        ["/esta-no-existe", "75-404"],
      ],
    },
    {
      sesion: OP,
      rutas: [
        ["/operacion", "80-operacion-resumen"],
        ["/operacion/clientes", "81-operacion-clientes"],
        [`/operacion/clientes/${estado.altamarId}`, "82-operacion-ficha"],
        ["/operacion/aprobaciones", "83-operacion-aprobaciones"],
        ["/operacion/alertas", "84-operacion-alertas"],
        ["/operacion/comisiones", "85-operacion-comisiones"],
        ["/operacion/recuperaciones", "86-operacion-recuperaciones"],
        ["/operacion/bitacora", "87-operacion-bitacora"],
        ["/operacion/precios", "88-precios-sofipo"],
        ["/entrar/seguridad", "89-seguridad-sofipo"],
      ],
    },
    {
      sesion: LAURA,
      rutas: [
        ["/telefono", "90-telefono-inicio"],
        ["/telefono/topes", "91-telefono-topes"],
        ["/telefono/facturacion", "92-telefono-factura"],
        ["/precios", "93-precios-cliente"],
        ["/entrar/seguridad", "94-seguridad-cliente"],
      ],
    },
  ];
  const contraste = {};
  for (const grupo of grupos) {
    // Una entrada por pantalla de la puerta, como lo haría la persona; luego tema y ancho en la misma sesión.
    const { ctx, page } = await contexto();
    if (grupo.sesion === OP) await entrarOperacion(page, OP);
    if (grupo.sesion === LAURA) {
      await entrarCliente(page, LAURA, estado.claves[LAURA]);
      await page.getByLabel("Código de la app autenticadora").fill(await codigoFresco(LAURA));
      await page.getByRole("button", { name: "Entrar con el código" }).click();
      await page.waitForURL(/\/consola|\/empresas|\/telefono/);
    }
    for (const tema of TEMAS) {
      await ctx.addCookies([{ name: "tema", value: tema, url: BASE }]);
      for (const ancho of ANCHOS) {
        await page.setViewportSize({ width: ancho, height: ancho < 600 ? 844 : 900 });
        const clave = `${tema}-${ancho}`;
        contraste[clave] ??= { medidos: 0, minimo: Infinity, fallas: [] };
        for (const [ruta, nombre] of grupo.rutas) {
          await page.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
          if (tema === "oscuro" && ancho === 1440) await revisarPantalla(page, ruta);
          await captura(page, `${nombre}-${tema}-${ancho}`);
          const medida = await medirContraste(page, ruta);
          contraste[clave].medidos += medida.medidos;
          contraste[clave].minimo = Math.min(contraste[clave].minimo, medida.minimo);
          contraste[clave].fallas.push(...medida.fallas);
        }
      }
    }
    await ctx.close();
  }
  for (const [clave, r] of Object.entries(contraste)) {
    r.minimo = Number(r.minimo.toFixed(2));
    console.log(`contraste ${clave}: ${r.medidos} textos, ${r.fallas.length} bajo AA, mínimo ${r.minimo}`);
    for (const f of r.fallas) console.log(`  ${f.contraste} < ${f.umbral} · ${f.ruta} · «${f.texto}» ${f.color} sobre ${f.fondo}`);
  }
  writeFileSync(`${SALIDA}/contraste.json`, JSON.stringify(contraste, null, 2));
  const bajo = Object.values(contraste).reduce((suma, r) => suma + r.fallas.length, 0);
  exigir(bajo === 0, `contraste AA medido contra la escena en 3 temas × 2 anchos: ${bajo} textos bajo AA`);
}

// ==================================================================================
// CORREOS: cada plantilla a HTML, con el logo servido por `next start`
// ==================================================================================

async function correos() {
  const dir = `${SALIDA}/correos`;
  mkdirSync(dir, { recursive: true });
  execFileSync("./node_modules/.bin/tsx", ["scripts/evidencia/ola1b-correos.ts", dir], { stdio: "inherit" });
  const plantillas = ["invitacion-empresa", "invitacion-usuario", "invitacion-personal", "recuperar-contrasena", "aviso-seguridad", "aviso-clabe-nomina"];
  for (const nombre of plantillas) {
    // En local el logo se sirve desde este mismo `next start` (public/lever-email.png), no desde producción.
    const html = readFileSync(`${dir}/${nombre}.html`, "utf8").replaceAll("https://www.leverpagos.com/lever-email.png", `${BASE}/lever-email.png`);
    for (const esquema of ["light", "dark"]) {
      const ctx = await navegador.newContext({ viewport: { width: 680, height: 900 }, colorScheme: esquema, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });
      const logo = await page.locator("img").evaluate((img) => ({ ancho: img.naturalWidth, alt: img.alt }));
      exigir(logo.ancho > 0 && logo.alt === "Lever Empresas", `correo ${nombre} (${esquema}): el logo carga (${logo.ancho} px) con alt «Lever Empresas»`);
      await captura(page, `correo-${nombre}-${esquema === "light" ? "claro" : "oscuro"}`);
      await ctx.close();
    }
  }
}

// ==================================================================================
// COMPARACIÓN: el diseño de los socios junto a la captura del producto (Oscuro)
// ==================================================================================

async function comparacion() {
  // Las capturas del diseño no viven en el repositorio: DISENO apunta a su carpeta.
  const diseno = process.env.DISENO;
  if (!diseno) throw new Error("DISENO tiene que apuntar a la carpeta con las capturas del diseño (plat-00-resumen.png…).");
  const rotulo = (texto, ancho) =>
    Buffer.from(
      `<svg width="${ancho}" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="${ancho}" height="40" fill="#000" fill-opacity="0.74"/><text x="16" y="26" font-family="Helvetica, Arial" font-size="17" fill="#fff">${texto}</text></svg>`,
    );
  async function lamina(nombre, izquierda, derecha, ancho, alto) {
    const pieza = async ([ruta, texto]) =>
      sharp(ruta)
        .resize(ancho, alto, { fit: "cover", position: "top" })
        .composite([{ input: rotulo(texto, ancho), top: alto - 40, left: 0 }])
        .png()
        .toBuffer();
    const [a, b] = await Promise.all([pieza(izquierda), pieza(derecha)]);
    await sharp({ create: { width: ancho * 2 + 20, height: alto, channels: 3, background: "#000" } })
      .composite([
        { input: a, left: 0, top: 0 },
        { input: b, left: ancho + 20, top: 0 },
      ])
      .webp({ quality: 82 })
      .toFile(`${SALIDA}/comparacion-${nombre}.webp`);
    anotar(`comparación ${nombre}: ${izquierda[1]} junto a ${derecha[1]}`);
  }
  const c = `${SALIDA}/capturas`;
  await lamina("aprobaciones", [`${diseno}/plat-02-aprobaciones.png`, "Diseño · plat-02-aprobaciones"], [`${c}/13-operacion-aprobaciones-oscuro-1440.webp`, "Producto · Operación › Aprobaciones (Oscuro, 1440)"], 1440, 900);
  await lamina("resumen", [`${diseno}/plat-00-resumen.png`, "Diseño · plat-00-resumen"], [`${c}/80-operacion-resumen-oscuro-1440.webp`, "Producto · Operación › Resumen (Oscuro, 1440)"], 1440, 900);
  await lamina("telefono", [`${diseno}/app-home.png`, "Diseño · app-home"], [`${c}/90-telefono-inicio-oscuro-390.webp`, "Producto · Teléfono › Inicio (Oscuro, 390)"], 430, 932);
}

try {
  if (FASES.includes("flujos")) await flujos();
  if (FASES.includes("publicas")) await publicas();
  if (FASES.includes("capturas")) await capturas();
  if (FASES.includes("correos")) await correos();
  if (FASES.includes("comparacion")) await comparacion();
  exigir(erroresDeConsola.length === 0, `sin errores de consola del navegador${erroresDeConsola.length ? `:\n  ${erroresDeConsola.join("\n  ")}` : ""}`);
} catch (error) {
  // Para diagnosticar: cada página abierta al momento del fallo, fuera de la carpeta de evidencia.
  const destino = process.env.FALLOS ?? "/tmp";
  let n = 0;
  for (const ctx of navegador.contexts()) {
    for (const page of ctx.pages()) {
      n += 1;
      await page.screenshot({ path: `${destino}/fallo-${n}.png`, fullPage: true }).catch(() => {});
      console.log(`fallo-${n}.png ← ${page.url()}`);
    }
  }
  throw error;
} finally {
  writeFileSync(`${SALIDA}/comprobaciones-${FASES.join("-")}.json`, JSON.stringify({ comprobaciones, erroresDeConsola }, null, 2));
  await navegador.close();
  console.log(`\n${comprobaciones.length} comprobaciones en verde.`);
}
