// Recorrido de la Ola 1B «superficies»: Operación SOFIPO, entrada, invitación,
// recuperar contraseña, «Perdí el segundo factor», teléfono, landing, /precios, 404
// y las plantillas de correo. Playwright headless propio (no el navegador del MCP)
// contra `next start` y un Postgres local desechable.
//
//   BASE=http://localhost:4808 \
//   DUENO_URL=postgres://postgres@127.0.0.1:5543/plataforma \
//   ESTADO=/ruta/fuera/del/repo/ola1b.json \
//   DISENO=/ruta/a/las/capturas/del/diseno \
//   [FASES=flujos,publicas,capturas,correos,estados,comparacion] node scripts/evidencia/ola1b-superficies.mjs
//
// Todo pasa por clics. La base se toca como dueña solo para: fijar el token de una
// invitación o de un enlace de recuperación (en local el correo no sale), envejecer el
// segundo factor de una sesión (para ver «Confirma que eres tú» sin esperar 5 minutos),
// sembrar dos categorías de la política para el teléfono, contar filas que prueban
// que un doble clic dejó una sola operación y provocar los estados de Operación (un
// candado de unos segundos para «cargando» y un permiso retirado, y devuelto, para
// «error»). Rechaza un DUENO_URL que no sea local.

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE ?? "http://localhost:4808";
const DUENO = process.env.DUENO_URL ?? "";
const ESTADO = process.env.ESTADO ?? "";
const SALIDA = process.env.SALIDA ?? "docs/evidencia/ola1b-superficies";
const FASES = (process.env.FASES ?? "flujos,publicas,capturas,correos,estados,comparacion").split(",");
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
// Lo que el recorrido encontró y no se arregla en esta zona: queda escrito en la salida y en el JSON.
const pendientes = [];
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
async function esperarBase(consulta, valor, ms = 15_000) {
  const fin = Date.now() + ms;
  while (contar(consulta) < valor) {
    if (Date.now() > fin) throw new Error(`FALLO la base no llegó a ${valor}: ${consulta}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Toma la tabla con un candado en una conexión aparte y lo sostiene hasta soltarlo: así una sección
// que la lee se queda esperando a la base, como cuando la base tarda de verdad.
async function sostenerCandado(tabla) {
  const psql = spawn("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "inherit"] });
  const tomado = new Promise((listo, falla) => {
    psql.stdout.on("data", (d) => String(d).includes("candado_tomado") && listo());
    psql.on("exit", (codigo) => falla(new Error(`psql salió con ${codigo} antes de tomar el candado`)));
  });
  psql.stdin.write(`begin; lock table ${tabla} in access exclusive mode; select 'candado_tomado';\n`);
  await tomado;
  return () => new Promise((listo) => {
    psql.removeAllListeners("exit");
    psql.on("exit", listo);
    psql.stdin.end("rollback;\n\\q\n");
  });
}
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

/**
 * Doble clic mientras la base retiene la acción con un candado sobre la tabla que escribe: el
 * botón tiene que quedar apagado, con aria-busy y «Enviando…» (o su texto propio) hasta que
 * la base responde. Al soltar, el envío termina una sola vez; eso lo cuenta quien llama.
 */
async function dobleClicRetenido(page, boton, tabla, { texto = "Enviando…", captura: nombre, otro } = {}) {
  const soltar = await sostenerCandado(tabla);
  try {
    await dobleClic(boton);
    const ocupado = page.locator('button[aria-busy="true"]');
    await ocupado.waitFor({ timeout: 4000 });
    exigir((await ocupado.count()) === 1 && (await ocupado.isDisabled()) && (await ocupado.innerText()).trim() === texto, `mientras la base retiene ${tabla}, el botón queda apagado, con aria-busy y «${texto}»`);
    // En un formulario con dos botones, el que no se oprimió se apaga sin decir «Enviando…».
    if (otro) {
      exigir((await otro.boton.isDisabled()) && (await otro.boton.getAttribute("aria-busy")) === null && (await otro.boton.innerText()).trim() === otro.texto, `el otro botón del formulario («${otro.texto}») se apaga sin aria-busy y conserva su texto`);
    }
    if (nombre) await captura(page, nombre, { completa: false });
  } finally {
    await soltar();
  }
}

/**
 * En 390, con el cajón ya cerrado, la barra de arriba dice que la sección carga: progreso a la vista,
 * «Cargando…» en un role=status y contraste AA de lo que se ve en ese momento.
 */
async function revisarCargaMovil(page, donde, ruta) {
  const carga = page.locator(".barra-movil-carga");
  await carga.locator(".seccion-spinner").waitFor();
  exigir((await carga.getAttribute("role")) === "status" && (await carga.innerText()).trim() === "Cargando…" && (await carga.locator(".seccion-spinner").isVisible()), `${donde}: la barra de arriba muestra el progreso y dice «Cargando…»`);
  // El cajón tarda 0,22 s en salir: se mide la pantalla que queda, no el cajón a medio camino.
  await page.locator("#lateral").waitFor({ state: "hidden" });
  const medida = await medirPantalla(page, ruta);
  exigir(!medida.motivo, `${donde}: la medición mientras carga quedó firme${medida.motivo ? ` (${medida.motivo})` : ""}`);
  exigir(medida.fallas.length === 0, `${donde}: contraste AA mientras carga (${medida.medidos} textos, mínimo ${medida.minimo.toFixed(2)})`);
}

async function guardarSesion(nombre, ctx) {
  estado.sesiones[nombre] = await ctx.storageState();
  guardar();
}

// ---------- Pasos compartidos ----------

async function inscribirTotp(page, correo, { operacion, recargar = false }) {
  const semilla = (await page.locator(".arco-semilla").innerText()).trim();
  estado.semillas[correo] = semilla;
  delete estado.pasos[correo];
  guardar();
  await page.getByLabel("Código que muestra la app").fill(await codigoFresco(correo));
  await page.getByRole("button", { name: "Confirmar el código" }).click();
  await page.getByRole("heading", { name: /códigos de respaldo/i }).waitFor();
  if (operacion) {
    // Se guardan para entrar después con uno: son secretos, no se imprimen ni salen de ESTADO.
    estado.respaldos = { ...estado.respaldos, [correo]: await page.locator(".arco-codigos li").allInnerTexts() };
    guardar();
    await page.getByRole("button", { name: "Abrir operación" }).click();
  } else if (recargar) {
    // Si la página se recarga con los códigos a la vista, ya no se muestran: queda «Ya puedes entrar.».
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Ya puedes entrar." }).waitFor();
    await dobleClic(page.getByRole("button", { name: "Entrar al portal" }));
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

  // Vacíos: la plataforma recién creada todavía no tiene clientes, decisiones, alertas ni comisiones.
  for (const [ruta, nombre, titulos] of [
    ["/operacion/clientes", "09a-operacion-clientes-vacio", ["Todavía no hay clientes"]],
    ["/operacion/aprobaciones", "09b-operacion-aprobaciones-vacio", ["Nada por decidir"]],
    ["/operacion/alertas", "09c-operacion-alertas-vacio", ["Sin alertas", "Sin clientes"]],
    ["/operacion/comisiones", "09d-operacion-comisiones-vacio", ["Sin versiones", "Sin empresas activas"]],
    ["/operacion/recuperaciones", "09e-operacion-recuperaciones-vacio", ["Sin solicitudes"]],
  ]) {
    await op.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
    for (const titulo of titulos) exigir(await op.locator(".vacio-titulo", { hasText: titulo }).isVisible(), `${ruta} sin datos lo dice: «${titulo}»`);
    await capturarEnTodo(op, nombre);
  }

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
  // Reenviar anula el enlace anterior y emite otro (doble clic): Laura acepta después el vigente.
  await dobleClic(op.getByRole("button", { name: "Reenviar invitación" }));
  await esperarBase(`select count(*) from invitations where user_id = '${idDe(LAURA)}'`, 2);
  await new Promise((r) => setTimeout(r, 1500));
  await listo(op);
  exigir(
    contar(`select count(*) from invitations where user_id = '${idDe(LAURA)}'`) === 2 &&
      contar(`select count(*) from invitations where user_id = '${idDe(LAURA)}' and revocada_en is not null`) === 1 &&
      contar(`select count(*) from invitations where user_id = '${idDe(LAURA)}' and revocada_en is null and usada_en is null`) === 1,
    "doble clic en «Reenviar invitación» anula el enlace anterior y deja uno solo vigente",
  );
  await capturarEnTodo(op, "15-operacion-ficha-cliente");

  // Alertas: crear (doble clic), reasignar y cerrar con motivo.
  await irA(op, "Alertas");
  await op.waitForURL(/\/operacion\/alertas/);
  await listo(op);
  await op.getByLabel("Empresa").selectOption({ label: "Altamar Logística" });
  await op.getByLabel("Título").fill("Documentos por completar");
  await op.getByLabel("Detalle").fill("Falta el comprobante de domicilio de Altamar.");
  await dobleClicRetenido(op, op.getByRole("button", { name: "Crear alerta" }), "operational_alerts", { captura: "16a-operacion-crear-alerta-enviando-oscuro-1440" });
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
  await inscribirTotp(laura, LAURA, { operacion: false, recargar: true });
  await laura.waitForURL(/\/consola|\/empresas/);
  anotar("Laura acepta la invitación, registra su app autenticadora y entra al portal");
  anotar("si la página se recarga con los códigos a la vista, «Ya puedes entrar.» y «Entrar al portal» abren el portal");
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
  await dobleClicRetenido(rec, rec.getByRole("button", { name: "Enviar el enlace" }), "password_resets", { captura: "40a-recuperar-enviando-oscuro-1440" });
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

  // Primero se rechaza con nota (el botón de la izquierda); Laura vuelve a pedir y entonces se aprueba.
  const primera = op.getByRole("listitem", { name: "Recuperación · Laura Méndez" });
  await primera.getByLabel("Nota (obligatoria para rechazar)").fill("No se pudo confirmar la identidad por videollamada.");
  await dobleClicRetenido(op, primera.getByRole("button", { name: "Rechazar" }), "auth_recuperaciones", {
    captura: "53a-recuperaciones-rechazando-oscuro-1440",
    otro: { boton: primera.getByRole("button", { name: "Aprobar" }), texto: "Aprobar" },
  });
  await op.getByText("Decisión registrada").waitFor();
  exigir(contar(`select count(*) from auth_recuperaciones where user_id = '${idDe(LAURA)}' and estado = 'rechazada'`) === 1, "op rechaza la solicitud con nota");
  exigir(contar(`select count(*) from audit_log where accion = 'recuperacion_rechazada' and actor_id = '${idDe(OP)}'`) === 1, "doble clic en «Rechazar» deja un solo rechazo en la bitácora");
  exigir((await op.getByRole("listitem", { name: "Recuperación · Laura Méndez" }).count()) === 0, "la solicitud rechazada sale de la lista");

  const { ctx: ctxP2, page: otraVez } = await contexto();
  await entrarCliente(otraVez, LAURA, CLAVE_NUEVA);
  await otraVez.getByRole("button", { name: "Perdí el segundo factor" }).click();
  await otraVez.getByLabel("Qué pasó").fill("Cambié de teléfono y no pasé la app.");
  await otraVez.getByRole("button", { name: "Pedir recuperación" }).click();
  await otraVez.waitForURL(/aviso=recuperacion/);
  await ctxP2.close();

  await op.goto(`${BASE}/operacion/recuperaciones`);
  await listo(op);
  await confirmarSiLoPide(op, OP);
  const filaLaura = op.getByRole("listitem", { name: "Recuperación · Laura Méndez" });
  await filaLaura.getByLabel("Cómo verificaste la identidad").selectOption("videollamada");

  // Lo que el #49 exige en el servidor sigue en pie con la acción única. Con la página abierta, el
  // segundo factor de op envejece 6 minutos: aprobar no pasa, la base no cambia y vuelve a pedir
  // «Confirma que eres tú».
  const solicitadas = () => contar(`select count(*) from auth_recuperaciones where user_id = '${idDe(LAURA)}' and estado = 'solicitada'`);
  const aprobaciones = () => contar("select count(*) from audit_log where accion = 'recuperacion_aprobada'");
  envejecerFactor(OP, 6);
  await filaLaura.getByRole("button", { name: "Aprobar" }).click();
  await op.waitForURL(/aviso=reautenticacion_factor/);
  await listo(op);
  exigir(solicitadas() === 1 && aprobaciones() === 0, "con el segundo factor de hace 6 minutos, Aprobar no aprueba: la solicitud sigue abierta y la bitácora no tiene aprobación");
  exigir((await op.getByRole("region", { name: "Confirma que eres tú" }).count()) === 1, "tras el intento, Recuperaciones vuelve a pedir «Confirma que eres tú»");
  await confirmarSiLoPide(op, OP);
  // Un valor de decisión alterado cuenta como rechazo, que exige nota: sin nota no decide nada.
  const filaOtraVez = op.getByRole("listitem", { name: "Recuperación · Laura Méndez" });
  await filaOtraVez.getByRole("button", { name: "Aprobar" }).evaluate((boton) => { boton.value = "aprobar-sin-permiso"; });
  await filaOtraVez.getByRole("button", { name: "Aprobar" }).click();
  await op.waitForURL(/aviso=motivo_invalido/);
  await listo(op);
  exigir(solicitadas() === 1 && aprobaciones() === 0 && contar(`select count(*) from audit_log where accion = 'recuperacion_rechazada'`) === 1, "una decisión alterada no aprueba: sin nota no decide y la solicitud sigue abierta");
  await confirmarSiLoPide(op, OP);
  await filaLaura.getByLabel("Cómo verificaste la identidad").selectOption("videollamada");
  await dobleClicRetenido(op, filaLaura.getByRole("button", { name: "Aprobar" }), "auth_recuperaciones", {
    otro: { boton: filaLaura.getByRole("button", { name: "Rechazar" }), texto: "Rechazar" },
  });
  await op.getByText("Decisión registrada").waitFor();
  exigir(contar(`select count(*) from auth_recuperaciones where user_id = '${idDe(LAURA)}' and estado = 'aprobada'`) === 1, "op aprueba la segunda solicitud tras confirmar su identidad");
  exigir(
    (await op.getByText("Al aprobar, la persona tiene 12 horas para registrar un factor nuevo; al confirmarlo, los anteriores dejan de servir.").count()) === 1,
    "Recuperaciones dice qué provoca aprobar: 12 horas para registrar un factor nuevo y los anteriores dejan de servir",
  );
  exigir(contar(`select count(*) from audit_log where accion = 'recuperacion_aprobada' and actor_id = '${idDe(OP)}'`) === 1, "doble clic en «Aprobar» deja una sola aprobación en la bitácora");

  const { ctx: ctxN, page: nuevo } = await contexto();
  await entrarCliente(nuevo, LAURA, CLAVE_NUEVA);
  // Con la recuperación aprobada, la entrada ofrece registrar un factor nuevo (#55) y el anterior deja de servir.
  exigir((await nuevo.getByRole("heading", { name: "Registra un factor nuevo." }).count()) === 1, "con la recuperación aprobada, la entrada ofrece registrar un factor nuevo");
  await capturarEnTodo(nuevo, "54-perdi-factor-registrar-nuevo");
  await inscribirTotp(nuevo, LAURA, { operacion: false });
  await nuevo.waitForURL(/\/consola|\/empresas/);
  exigir(
    contar(`select count(*) from auth_totp where user_id = '${idDe(LAURA)}' and revocado_en is null and confirmado_en is not null`) === 1 &&
      contar(`select count(*) from auth_recuperaciones where user_id = '${idDe(LAURA)}' and estado = 'cumplida'`) === 1,
    "Laura entra con su app nueva: queda una sola activa y la recuperación cumplida",
  );
  await guardarSesion(LAURA, ctxN);

  // Seguridad de la cuenta: cada envío con su clic real y el doble clic contado en la base.
  const laId = idDe(LAURA);
  const cuenta = (consulta) => contar(`select count(*) from ${consulta.replace("$U", `'${laId}'`)}`);
  const sinAlerta = async (page) => (await page.locator("#seguridad-error").count()) === 0;
  const cdp = await ctxN.newCDPSession(nuevo);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
  await nuevo.goto(`${BASE}/entrar/seguridad`);
  await listo(nuevo);
  await nuevo.getByRole("button", { name: "Agregar una passkey" }).click();
  await nuevo.getByText("Este dispositivo").waitFor();
  exigir(cuenta("auth_passkeys where user_id = $U and revocada_en is null") === 1, "Seguridad: «Agregar una passkey» registra una con el autenticador del navegador");

  const totpRevocadas = cuenta("auth_totp where user_id = $U and revocado_en is not null");
  await dobleClic(nuevo.getByRole("button", { name: "Revocar la app" }));
  await nuevo.getByRole("button", { name: "Configurar la app autenticadora" }).waitFor();
  exigir(
    cuenta("auth_totp where user_id = $U and revocado_en is not null") === totpRevocadas + 1 &&
      cuenta("auth_totp where user_id = $U and revocado_en is null") === 0 &&
      (await sinAlerta(nuevo)),
    "doble clic en «Revocar la app» quita una sola app autenticadora, sin error",
  );

  await nuevo.getByRole("button", { name: "Configurar la app autenticadora" }).click();
  await nuevo.locator(".arco-semilla").waitFor();
  estado.semillas[LAURA] = (await nuevo.locator(".arco-semilla").innerText()).trim();
  delete estado.pasos[LAURA];
  guardar();
  await nuevo.getByLabel("Código que muestra la app").fill(await codigoFresco(LAURA));
  await dobleClic(nuevo.getByRole("button", { name: "Confirmar", exact: true }));
  await nuevo.getByRole("button", { name: "Revocar la app" }).waitFor();
  exigir(
    cuenta("auth_totp where user_id = $U and revocado_en is null and confirmado_en is not null") === 1 && (await sinAlerta(nuevo)),
    "doble clic en «Confirmar» deja una sola app autenticadora activa, sin error",
  );

  await nuevo.getByRole("button", { name: "Generar códigos nuevos" }).click();
  await nuevo.getByRole("heading", { name: "Códigos de respaldo." }).waitFor();
  const codigosLaura = await nuevo.locator(".arco-codigos li").allInnerTexts();
  exigir(await nuevo.getByRole("button", { name: "Volver a Seguridad" }).isDisabled(), "con los códigos a la vista, «Volver a Seguridad» espera a que se marque que ya se guardaron");
  await captura(nuevo, "94a-seguridad-codigos-nuevos-oscuro-1440");
  await nuevo.getByText("Ya los guardé en un lugar seguro").click();
  await nuevo.getByRole("button", { name: "Volver a Seguridad" }).click();
  await nuevo.getByRole("heading", { name: "Segundo factor." }).waitFor();
  await nuevo.getByText(`Códigos de respaldo disponibles: ${codigosLaura.length}.`).waitFor();
  exigir(codigosLaura.length >= 2 && /\/entrar\/seguridad/.test(nuevo.url()), "«Generar códigos nuevos» los muestra una vez y «Volver a Seguridad» regresa a la misma página con la cuenta al día");

  // «Confirma que eres tú» con un código de respaldo, cuando el factor ya tiene más de cinco minutos.
  envejecerFactor(LAURA, 6);
  await nuevo.reload({ waitUntil: "networkidle" });
  const confirmaL = nuevo.getByRole("region", { name: "Confirma que eres tú" });
  await confirmaL.waitFor();
  const usadosL = cuenta("auth_codigos_respaldo where user_id = $U and usado_en is not null");
  await confirmaL.getByLabel("Código de respaldo").fill(codigosLaura[0]);
  await dobleClic(confirmaL.getByRole("button", { name: "Usar un código de respaldo" }));
  await confirmaL.waitFor({ state: "detached", timeout: 15_000 });
  await listo(nuevo);
  exigir(cuenta("auth_codigos_respaldo where user_id = $U and usado_en is not null") === usadosL + 1, "«Confirma que eres tú» con un código de respaldo: el doble clic gasta uno solo");

  await dobleClic(nuevo.getByRole("listitem").filter({ hasText: "Este dispositivo" }).getByRole("button", { name: "Revocar", exact: true }));
  await nuevo.getByText("No hay passkeys.").waitFor();
  exigir(
    cuenta("auth_passkeys where user_id = $U and revocada_en is null") === 0 &&
      cuenta("auth_passkeys where user_id = $U and revocada_en is not null") === 1 &&
      (await sinAlerta(nuevo)),
    "doble clic en «Revocar» quita una sola passkey, sin error",
  );
  await guardarSesion(LAURA, ctxN);
  await ctxN.close();

  // Entrada de cliente con un código de respaldo y «Salir» del teléfono.
  const { ctx: ctxRes, page: res } = await contexto();
  await entrarCliente(res, LAURA, CLAVE_NUEVA);
  const usadosAntesEntrada = cuenta("auth_codigos_respaldo where user_id = $U and usado_en is not null");
  await res.getByLabel("Código de respaldo").fill(codigosLaura[1]);
  await dobleClic(res.getByRole("button", { name: "Usar un código de respaldo" }));
  await res.waitForURL(/\/consola|\/empresas/);
  await listo(res);
  exigir(cuenta("auth_codigos_respaldo where user_id = $U and usado_en is not null") === usadosAntesEntrada + 1, "Entrar con un código de respaldo: el doble clic gasta uno solo y abre el portal");
  await res.goto(`${BASE}/telefono`);
  await listo(res);
  const sesionesL = cuenta("sessions where user_id = $U");
  await dobleClic(res.getByRole("button", { name: "Salir" }));
  await res.waitForURL(`${BASE}/`);
  await res.goto(`${BASE}/telefono`);
  exigir(cuenta("sessions where user_id = $U") === sesionesL - 1 && !/\/telefono/.test(res.url()), "«Salir» del teléfono cierra esa sesión: la base la borra y /telefono ya no abre");
  await ctxRes.close();

  // Operación con un código de respaldo de los que se mostraron al registrar la app.
  const { ctx: ctxOr, page: opr } = await contexto();
  await opr.goto(`${BASE}/operacion/entrar`);
  await opr.getByLabel("Correo").fill(OP);
  await opr.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await opr.getByRole("button", { name: "Continuar" }).click();
  await opr.waitForURL(/\/operacion\/continuar/);
  await listo(opr);
  const usadosOp = contar(`select count(*) from auth_codigos_respaldo where user_id = '${idDe(OP)}' and usado_en is not null`);
  await opr.getByLabel("Código de respaldo").fill(estado.respaldos[OP][0]);
  await dobleClic(opr.getByRole("button", { name: "Usar un código de respaldo" }));
  await opr.waitForURL(/\/operacion(\?|$)/);
  await listo(opr);
  exigir(
    contar(`select count(*) from auth_codigos_respaldo where user_id = '${idDe(OP)}' and usado_en is not null`) === usadosOp + 1,
    "Operación: entrar con un código de respaldo gasta uno solo con doble clic",
  );
  await ctxOr.close();
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

/** Contraste de toda la página: se mide pantalla por pantalla bajando hasta el final (tope de 10 pantallas). */
async function medirContraste(page, ruta) {
  const total = { medidos: 0, minimo: Infinity, fallas: [] };
  const alto = await page.evaluate(() => document.documentElement.scrollHeight);
  const vista = page.viewportSize().height;
  for (let y = 0, n = 0; y < alto && n < 10; y += vista, n += 1) {
    for (let intento = 1; ; intento += 1) {
      await page.evaluate((destino) => window.scrollTo(0, destino), y);
      await page.waitForTimeout(150);
      const parcial = await medirPantalla(page, ruta);
      if (!parcial.motivo) {
        total.medidos += parcial.medidos;
        total.minimo = Math.min(total.minimo, parcial.minimo);
        total.fallas.push(...parcial.fallas);
        break;
      }
      // Una captura con el texto a la vista mediría el texto contra sí mismo: no cuenta, se anota y se repite.
      reintentosDeContraste.push({ ruta, ancho: page.viewportSize().width, desplazamiento: y, intento, motivo: parcial.motivo });
      console.log(`REINTENTO contraste ${ruta} (${page.viewportSize().width} px, bajando ${y} px): ${parcial.motivo}; intento ${intento} de 3`);
      if (intento === 3) throw new Error(`FALLO la medición de contraste de ${ruta} no quedó firme en 3 intentos: ${parcial.motivo}`);
      await page.reload({ waitUntil: "networkidle" });
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return total;
}

const reintentosDeContraste = [];
// Sin transiciones: el color transparente se lee completo, no a medio camino.
const OCULTAR_TEXTO = "html body *, html body *::before, html body *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; transition: none !important; } svg text { fill: transparent !important; }";
const firmaDeTexto = (t) => `«${t.texto}» en ${Math.round(t.caja.x)},${Math.round(t.caja.y)}`;

/** Corre en el navegador sobre la etiqueta de estilo: vacío si sigue puesta y deja transparente cada elemento. */
function textoOculto(estilo) {
  if (!estilo.isConnected) return "la etiqueta que oculta el texto ya no está en la página";
  const visible = [...document.querySelectorAll("body *")].find((el) => getComputedStyle(el).color !== "rgba(0, 0, 0, 0)");
  return visible ? `«${visible.tagName.toLowerCase()}.${visible.getAttribute("class") ?? ""}» conserva el color ${getComputedStyle(visible).color}` : "";
}

/**
 * Una vista: los textos con su color, la captura con el texto oculto y la comprobación de que el texto
 * siguió oculto y nada se movió mientras se capturaba. Si algo de eso falla, devuelve el motivo y no mide.
 */
async function medirPantalla(page, ruta) {
  const textos = await page.evaluate(recogerTextos);
  const oculto = await page.addStyleTag({ content: OCULTAR_TEXTO });
  await page.waitForTimeout(250);
  const antes = await oculto.evaluate(textoOculto);
  const png = PNG.sync.read(await page.screenshot());
  const despues = await oculto.evaluate(textoOculto).catch((error) => `la página cambió (${error.message.split("\n")[0]})`);
  await oculto.evaluate((n) => n.remove()).catch(() => {});
  const [previas, posteriores] = [textos.map(firmaDeTexto), (await page.evaluate(recogerTextos)).map(firmaDeTexto)];
  const cambio = previas.length !== posteriores.length ? `${previas.length} → ${posteriores.length} textos` : previas.map((f, i) => (f === posteriores[i] ? "" : `${f} → ${posteriores[i]}`)).find(Boolean);
  const motivo = antes ? `antes de la captura ${antes}` : despues ? `durante la captura ${despues}` : cambio ? `la página se movió durante la captura (${cambio})` : "";
  if (motivo) return { motivo };
  return medirContraEscena(ruta, textos, png);
}

/** Corre en el navegador: cada texto visible de la vista con su color, opacidad acumulada, tamaño, peso y caja. */
function recogerTextos() {
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
}

/** El método del #50: el color de cada texto contra los píxeles reales de su fondo en la captura con el texto oculto. */
function medirContraEscena(ruta, textos, png) {
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
  console.log(`contraste: ${reintentosDeContraste.length} vistas repetidas porque el texto no quedó oculto o la página se movió durante la captura`);
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
  const plantillas = ["invitacion-empresa", "invitacion-usuario", "invitacion-personal", "recuperar-contrasena", "aviso-seguridad", "aviso-clabe-nomina", "resumen-semanal"];
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
// ESTADOS: cargando, error y sin permiso en Operación (los vacíos salen al inicio de los flujos)
// ==================================================================================

async function estados() {
  // Cargando: Operación no reemplaza la página al navegar (f063a20); el enlace que se pidió muestra su
  // progreso y la página de antes sigue a la vista. Para verlo, la base sostiene un candado sobre las
  // solicitudes de activación, que lee la lista de Clientes: su precarga y su navegación esperan hasta
  // soltarlo (antes de los 10 s que la app espera a la base).
  {
    const { ctx, page } = await contexto();
    await entrarOperacion(page, OP);
    for (const tema of TEMAS) {
      await ctx.addCookies([{ name: "tema", value: tema, url: BASE }]);
      for (const ancho of ANCHOS) {
        await page.setViewportSize({ width: ancho, height: ancho < 600 ? 844 : 900 });
        const soltar = await sostenerCandado("company_activation_requests");
        try {
          await page.goto(`${BASE}/operacion/bitacora`, { waitUntil: "domcontentloaded" });
          await page.getByRole("heading", { level: 1, name: "Bitácora" }).waitFor();
          if (ancho < 600) await page.getByRole("button", { name: "Secciones" }).click();
          await irA(page, "Clientes");
          const enlace = page.getByRole("navigation", { name: "Operación" }).getByRole("link", { name: /^Clientes/ });
          await enlace.locator(".seccion-spinner").waitFor({ state: "attached" });
          exigir((await page.getByRole("heading", { level: 1, name: "Bitácora" }).count()) === 1, `Operación ${tema}-${ancho}: mientras carga, la página de antes sigue a la vista`);
          if (ancho < 600) {
            // El cajón se cierra al pulsar un enlace y el progreso del enlace queda dentro, oculto: lo dice la barra.
            exigir((await page.getByRole("button", { name: "Secciones" }).getAttribute("aria-expanded")) === "false", `Operación ${tema}-${ancho}: el cajón se cerró al pulsar Clientes`);
            await revisarCargaMovil(page, `Operación ${tema}-${ancho}`, "/operacion (cargando)");
          } else {
            exigir(await enlace.locator(".seccion-spinner").isVisible(), `Operación ${tema}-${ancho}: el enlace pedido muestra su progreso`);
            exigir((await enlace.locator(".seccion-lectura").innerText()) === "Cargando…", `Operación ${tema}-${ancho}: el enlace pedido anuncia «Cargando…» al lector de pantalla`);
          }
          await captura(page, `96-operacion-cargando-${tema}-${ancho}`, { completa: false });
        } finally {
          await soltar();
        }
        await page.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
        await page.locator(".seccion-spinner").first().waitFor({ state: "detached" }).catch(() => {});
        exigir((await page.locator(".seccion-spinner").count()) === 0, `Operación ${tema}-${ancho}: al llegar Clientes, el progreso del enlace se va`);
      }
    }
    await ctx.close();
  }

  // Error: la base le niega a Operación la lectura de empresas; la sección lo dice dentro del marco
  // y «Reintentar» vuelve a pedirla al servidor cuando la base responde otra vez.
  {
    const { ctx, page } = await contexto();
    await entrarOperacion(page, OP);
    const erroresAntes = erroresDeConsola.length;
    sql("revoke select on companies from plataforma_sofipo");
    try {
      for (const tema of TEMAS) {
        await ctx.addCookies([{ name: "tema", value: tema, url: BASE }]);
        for (const ancho of ANCHOS) {
          await page.setViewportSize({ width: ancho, height: ancho < 600 ? 844 : 900 });
          await page.goto(`${BASE}/operacion/clientes`, { waitUntil: "networkidle" });
          await page.getByRole("heading", { level: 1, name: "No se pudo abrir esta sección." }).waitFor();
          const navegacion = ancho < 600 ? page.getByRole("button", { name: "Secciones" }) : page.getByRole("navigation", { name: "Operación" });
          exigir((await navegacion.count()) === 1, `Operación ${tema}-${ancho}: el error se muestra dentro del marco, con la navegación a la mano`);
          await captura(page, `97-operacion-error-${tema}-${ancho}`);
        }
      }
    } finally {
      sql("grant select on companies to plataforma_sofipo");
    }
    await page.getByRole("button", { name: "Reintentar" }).click();
    await page.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
    anotar("Operación: «Reintentar» vuelve a pedir la sección y Clientes abre en cuanto la base responde");
    // El navegador anota el error del servidor que se provocó a propósito; cualquier otro se queda en la lista.
    const provocados = erroresDeConsola.splice(erroresAntes).filter((e) => {
      // #441 es el error de render de Server Components en producción: lo dejan los prefetch de las demás
      // secciones, que también leen empresas mientras la base niega la lectura.
      const esperado = /operacion\/clientes/.test(e) && /Server Components render|status of 500|digest|React error #441/i.test(e);
      if (!esperado) erroresDeConsola.push(e);
      return esperado;
    });
    anotar(`Operación: ${provocados.length} errores de consola esperados por el error provocado, ninguno más`);
    await ctx.close();
  }

  // Cargando en la consola (390) y sin permiso, con la sesión de Laura.
  {
    const { ctx, page } = await contexto();
    await entrarCliente(page, LAURA, estado.claves[LAURA]);
    await page.getByLabel("Código de la app autenticadora").fill(await codigoFresco(LAURA));
    await page.getByRole("button", { name: "Entrar con el código" }).click();
    await page.waitForURL(/\/consola|\/empresas|\/telefono/);

    // Laura pulsa Personas en el cajón. El navegador retiene la respuesta de la sección (su precarga y su
    // navegación) hasta que se comprueba la barra; luego la deja pasar.
    await page.setViewportSize({ width: 390, height: 844 });
    // La consola con empresa elegida vive en /c/<empresa>/consola/….
    const personas = (url) => /\/consola\/personas$/.test(url.pathname);
    let soltar = () => {};
    let retenida = Promise.resolve();
    await page.route(personas, async (ruta) => {
      if (ruta.request().headers().rsc) await retenida;
      await ruta.continue();
    });
    for (const tema of TEMAS) {
      retenida = new Promise((listo) => (soltar = listo));
      await ctx.addCookies([{ name: "tema", value: tema, url: BASE }]);
      await page.goto(`${BASE}/consola/pendientes`, { waitUntil: "domcontentloaded" });
      await page.locator("main#contenido").waitFor();
      await page.getByRole("button", { name: "Secciones" }).click();
      await page.locator("#lateral").getByRole("link", { name: /^Personas/ }).click();
      exigir((await page.getByRole("button", { name: "Secciones" }).getAttribute("aria-expanded")) === "false", `consola ${tema}-390: el cajón se cerró al pulsar Personas`);
      exigir(/\/consola\/pendientes$/.test(new URL(page.url()).pathname) && (await page.locator("main#contenido").isVisible()), `consola ${tema}-390: mientras carga, Pendientes sigue a la vista`);
      await revisarCargaMovil(page, `consola ${tema}-390`, "/consola (cargando)");
      await captura(page, `96b-consola-cargando-${tema}-390`, { completa: false });
      soltar();
      await page.waitForURL(/\/consola\/personas/);
      await page.locator(".barra-movil-carga .seccion-spinner").waitFor({ state: "detached" });
      exigir((await page.locator(".barra-movil-carga").innerText()).trim() === "", `consola ${tema}-390: al llegar Personas, la barra deja de decir «Cargando…»`);
    }
    await page.unroute(personas);

    // Sin permiso: una sesión de cliente no abre Operación; la manda a la puerta del personal.
    await page.goto(`${BASE}/operacion/clientes`, { waitUntil: "networkidle" });
    exigir(new URL(page.url()).pathname === "/operacion/entrar", "Sin permiso: con sesión de cliente, /operacion/clientes lleva a la entrada de Operación");
    for (const tema of TEMAS) {
      await ctx.addCookies([{ name: "tema", value: tema, url: BASE }]);
      for (const ancho of ANCHOS) {
        await page.setViewportSize({ width: ancho, height: ancho < 600 ? 844 : 900 });
        await page.goto(`${BASE}/operacion/clientes`, { waitUntil: "networkidle" });
        await captura(page, `98-operacion-sin-permiso-${tema}-${ancho}`);
      }
    }
    await ctx.close();
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
  if (FASES.includes("estados")) await estados();
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
  writeFileSync(`${SALIDA}/comprobaciones-${FASES.join("-")}.json`, JSON.stringify({ comprobaciones, pendientes, erroresDeConsola, reintentosDeContraste }, null, 2));
  await navegador.close();
  console.log(`\n${comprobaciones.length} comprobaciones en verde.`);
}
