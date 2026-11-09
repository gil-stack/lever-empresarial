// Recorrido de la Ola R1 (alta regulada) con Playwright headless propio, contra `next start`
// y la base que deja scripts/evidencia/ola-r-alta/preparar.ts. Pasos y variables en
// docs/evidencia/ola-r-alta/README.md.
//
//   ESTADO=/fuera/del/repo/ola-r-alta.json BASE=http://localhost:4811 \
//   [FASES=flujos,pantallas,contraste,regresiones] node scripts/evidencia/ola-r-alta.mjs
//
// Todo pasa por clics, con la sesión SOFIPO o de cliente de cada persona. La base se toca como
// dueña solo para: envejecer el segundo factor de Ofelia (para ver «Confirma que eres tú» sin
// esperar 5 minutos), renovar el último uso de las sesiones sembradas, contar filas que prueban
// que un doble clic dejó una sola operación y, en el flujo 9, intentar además como rol cliente
// las escrituras que la consola suspendida ofrece y la base rechaza. El arranque (flujo 0) corre
// el comando de roles iniciales con la conexión de la dueña, como se hará tras el despliegue. La
// fase «lumbre» de preparar.ts siembra la revisión de riesgo vencida del flujo 4. Solo corre
// contra un Postgres local.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const requerir = createRequire(`${process.cwd()}/package.json`);
const { chromium } = requerir("playwright");
const sharp = requerir("sharp");
const { PNG } = requerir("pngjs");

const RUTA_ESTADO = process.env.ESTADO ?? "";
if (!RUTA_ESTADO || RUTA_ESTADO.includes("/docs/")) throw new Error("ESTADO tiene que apuntar al archivo fuera del repositorio que dejó preparar.ts.");
const E = JSON.parse(readFileSync(RUTA_ESTADO, "utf8"));
const DUENO = E.DUENO_URL;
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) throw new Error("DUENO_URL tiene que ser un Postgres local.");
const BASE = process.env.BASE ?? "http://localhost:4811";
const DIR = process.env.DIR ?? "docs/evidencia/ola-r-alta";
const FASES = (process.env.FASES ?? "flujos,pantallas,contraste").split(",");
const TEMAS = ["oscuro", "claro", "lever"];
const ANCHOS = [1440, 390];
const TALLER = E.EMPRESA_TALLER;
const NOMBRES = { ofelia: "Ofelia Plataforma", omar: "Omar Originación", ana: "Ana Aprobación", celia: "Celia Cumplimiento", aurelio: "Aurelio Auditoría" };
const PAGO_NORTE = E.PAGO_POR_AUTORIZAR;

const resultados = [];
function anotar(texto) {
  resultados.push({ ok: true, texto });
  console.log(`OK    ${texto}`);
}
function exigir(condicion, texto, detalle = "") {
  if (!condicion) {
    resultados.push({ ok: false, texto, detalle });
    throw new Error(`FALLO ${texto}${detalle ? ` · ${detalle}` : ""}`);
  }
  anotar(texto);
}

function sql(consulta) {
  return execFileSync("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8" }).trim();
}
const cuenta = (desde) => Number(sql(`select count(*) from ${desde}`));
/** La misma consulta como dueña de otra base local (la del arranque de la quinta revisión). */
function sqlEn(url, consulta) {
  return execFileSync("psql", [url, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8" }).trim();
}
/** Intenta una escritura como rol cliente de una empresa; devuelve el mensaje de la base. */
function comoCliente(companyId, userId, sentencia) {
  try {
    execFileSync("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", `begin;
      set local role plataforma_cliente;
      select set_config('app.company_id', '${companyId}', true), set_config('app.user_id', '${userId}', true),
             set_config('app.operator_id', (select operator_id::text from companies where id = '${companyId}'), true);
      ${sentencia};
      rollback;`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return "sin error";
  } catch (error) {
    return String(error.stderr ?? error.message);
  }
}
const renovarSesiones = () => sql("update sessions set ultimo_uso = now() where expires_at > now()");
function envejecerFactor(userId, minutos) {
  sql(`begin; set local session_replication_role = replica;
       update sessions set segundo_factor_en = now() - interval '${minutos} minutes' where user_id = '${userId}'; commit;`);
}
function hoyMexico(dias = 0) {
  const fecha = new Date(Date.now() + dias * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
}

// ---------- TOTP: un código por paso de 30 s, nunca uno ya usado ----------
const pasosUsados = {};
function codigoTotp(semilla, paso) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const letra of semilla) bits += alfabeto.indexOf(letra).toString(2).padStart(5, "0");
  const llave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const hmac = createHmac("sha1", llave).update(contador).digest();
  const desplazamiento = hmac[hmac.length - 1] & 15;
  return String((hmac.readUInt32BE(desplazamiento) & 0x7fffffff) % 1e6).padStart(6, "0");
}
async function totp(quien) {
  for (;;) {
    const paso = Math.floor(Date.now() / 30000);
    const resta = 30000 - (Date.now() % 30000);
    if ((pasosUsados[quien] ?? 0) < paso && resta > 4000) {
      pasosUsados[quien] = paso;
      return codigoTotp(E.SEMILLAS[quien], paso);
    }
    await new Promise((listo) => setTimeout(listo, resta + 300));
  }
}

// ---------- Navegador ----------
const abiertos = [];
async function abrir(quien, { tema = "oscuro", ancho = 1440 } = {}) {
  const nav = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const movil = ancho < 600;
  const ctx = await nav.newContext({
    viewport: { width: ancho, height: movil ? 844 : 900 }, isMobile: movil, hasTouch: movil, deviceScaleFactor: 1,
    reducedMotion: "reduce", locale: "es-MX", timezoneId: "America/Mexico_City", acceptDownloads: true,
  });
  const host = new URL(BASE).hostname;
  // Quien no tiene sesión sembrada (Iván, que llega por su invitación) entra sin cookie.
  await ctx.addCookies([
    { name: "tema", value: tema, domain: host, path: "/" },
    ...(E.SESIONES[quien] ? [{ name: "__Host-sesion", value: E.SESIONES[quien], domain: host, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }] : []),
  ]);
  const p = await ctx.newPage();
  const errores = [];
  p.on("pageerror", (e) => errores.push(`pageerror ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Download the React DevTools|favicon/.test(m.text())) errores.push(`consola ${m.text().slice(0, 240)}`);
  });
  abiertos.push({ quien, errores, nav });
  return { nav, p, errores };
}
async function ir(p, ruta) {
  await p.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
}
async function listo(p) {
  await p.waitForLoadState("networkidle");
}
let numero = 0;
// La fase de regresiones numera aparte («r01-…») para no pisar las capturas de los flujos.
let prefijo = "";
async function foto(p, nombre, completa = true) {
  numero += 1;
  const ruta = `${DIR}/capturas/${prefijo}${String(numero).padStart(2, "0")}-${nombre}.webp`;
  mkdirSync(`${DIR}/capturas`, { recursive: true });
  await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  await p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()).catch(() => {});
  await p.waitForTimeout(350);
  let imagen;
  try {
    imagen = await p.screenshot({ fullPage: completa });
  } catch (error) {
    // Chromium con SwiftShader no captura páginas muy altas (la bitácora pasa de 9 000 px): queda la ventana y se anota.
    if (!completa) throw error;
    const alto = await p.evaluate(() => document.documentElement.scrollHeight);
    console.log(`NOTA  ${nombre}: la página mide ${alto} px y no cabe en una captura completa; se guarda la ventana`);
    imagen = await p.screenshot({ fullPage: false });
  }
  await sharp(imagen).webp({ quality: 76 }).toFile(ruta);
  return ruta;
}
async function aviso(p) {
  // El de la página: el formulario del accionista y el diálogo de «Rechazar» traen el suyo, con otro id.
  const caja = p.locator("#aviso-operacion");
  return (await caja.count()) ? (await caja.innerText()).replace(/\s+/g, " ").trim() : "";
}
/**
 * Envía un formulario de Operación con un clic (o doble clic) real y espera la redirección con su aviso.
 * Antes quita el aviso anterior de la dirección, así la espera no se confunde con el de la acción previa.
 */
async function enviar(p, boton, codigo, { doble = false } = {}) {
  await p.evaluate(() => history.replaceState(history.state, "", location.pathname + location.hash));
  await (doble ? boton.dblclick() : boton.click());
  return esperarAviso(p, codigo);
}

/** Espera la redirección de una acción de Operación y devuelve el código del aviso. */
async function esperarAviso(p, codigo) {
  await p.waitForURL((url) => url.searchParams.get("aviso") !== null, { timeout: 20000 });
  await listo(p);
  const obtenido = new URL(p.url()).searchParams.get("aviso");
  if (codigo) exigir(obtenido === codigo, `aviso «${codigo}» tras la acción`, `llegó «${obtenido}»: ${await aviso(p)}`);
  return obtenido;
}
/**
 * «Agregar accionista» rechazado: el formulario vuelve sin recargar con su propio aviso. Marca el aviso
 * anterior (si lo hay) para esperar al nuevo, y devuelve su texto.
 */
async function rechazarSocio(p) {
  await p.evaluate(() => history.replaceState(history.state, "", location.pathname + location.hash));
  await p.locator("#aviso-accionista").evaluate((nodo) => { nodo.dataset.anterior = "1"; }).catch(() => {});
  await p.getByRole("button", { name: "Agregar accionista" }).click();
  const nuevo = p.locator("#aviso-accionista:not([data-anterior])");
  await nuevo.waitFor({ timeout: 20000 });
  await listo(p);
  return (await nuevo.innerText()).replace(/\s+/g, " ").trim();
}
/** «Agregar representante» rechazado: como el del socio, vuelve sin recargar con su propio aviso y lo capturado. */
async function rechazarRepresentante(p) {
  await p.evaluate(() => history.replaceState(history.state, "", location.pathname + location.hash));
  await p.locator("#aviso-representante").evaluate((nodo) => { nodo.dataset.anterior = "1"; }).catch(() => {});
  await p.getByRole("button", { name: "Agregar representante" }).click();
  const nuevo = p.locator("#aviso-representante:not([data-anterior])");
  await nuevo.waitFor({ timeout: 20000 });
  await listo(p);
  return (await nuevo.innerText()).replace(/\s+/g, " ").trim();
}
const PDF = (titulo) => Buffer.from(`%PDF-1.4\n% ${titulo}\n1 0 obj << /Type /Catalog >> endobj\n${"0".repeat(64)}\n%%EOF\n`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ---------- Datos del recorrido ----------
const EBANO = { razonSocial: "Grupo Ébano Industrial, S.A. de C.V.", rfc: "GEI150301AB1" };
const DATOS = {
  giro: "Fabricación de muebles de madera", nacionalidad: "Mexicana", fechaConstitucion: "2015-03-01", serieEfirma: "00001000000500000123",
  domicilioCalle: "Av. Constitución", domicilioExterior: "1500", domicilioInterior: "", domicilioColonia: "Centro", domicilioMunicipio: "Monterrey",
  domicilioEntidad: "Nuevo León", domicilioCodigoPostal: "64000", domicilioPais: "México", telefono: "8181234567", correo: "contacto@ebano.mx",
  volumenMensualCentavos: "1500000.00",
};
const REPRESENTANTE = { nombre: "Elena Vargas Ochoa", rfc: "VAOE800101AB1", curp: "VAOE800101MNLRCL09", designado: "Asamblea constitutiva" };
const SOCIOS = [
  { nombre: "Inversiones Ébano, S.A. de C.V.", tipo: "moral", rfc: "IEB100101AB2", curp: "", capital: "70", votos: "70", padre: null },
  { nombre: "Joaquín Ramos Salas", tipo: "fisica", rfc: "RASJ700303AB4", curp: "RASJ700303HNLMLQ02", capital: "30", votos: "30", padre: null },
  { nombre: "Mariana Ébano Ruiz", tipo: "fisica", rfc: "EARM750404AB5", curp: "EARM750404MNLBZR03", capital: "70", votos: "70", padre: "Inversiones Ébano, S.A. de C.V." },
  { nombre: "Héctor Lozano Díaz", tipo: "fisica", rfc: "LODH800505AB6", curp: "LODH800505HNLZZC01", capital: "30", votos: "30", padre: "Inversiones Ébano, S.A. de C.V." },
];
const LPB_1 = [
  "nombre,rfc,curp,tipo,fecha",
  "Mariana Ébano Ruiz,EARM750404AB5,,fisica,2026-11-02",
  "HECTOR LOZANO DIAZ,,,fisica,2026-11-02",
  "Comercializadora Sin Relación SA de CV,CSR010101AB1,,moral,2026-11-02",
].join("\n");
const LPB_2 = `${LPB_1}\nServicios Norte Integrales,BBB020202BA2,,moral,2026-11-06`;
const companyIdDe = (rfc) => sql(`select id from companies where rfc = '${rfc}'`);

// ---------- Flujos ----------
/** El comando de roles iniciales (scripts/plataforma.ts personal:rol) con la conexión de la dueña de la base. */
function comandoDeRoles(...args) {
  const salida = spawnSync("./node_modules/.bin/tsx", ["scripts/plataforma.ts", "personal:rol", "--quien-corre", "evidencia@lever.test", ...args], {
    encoding: "utf8", env: { ...process.env, DATABASE_URL: "", DATABASE_URL_UNPOOLED: DUENO },
  });
  return { estado: salida.status, texto: `${salida.stdout}${salida.stderr}`.trim() };
}

async function flujo0() {
  console.log("\n— Arranque: comando de roles iniciales cuando Ofelia es la única que administra al personal");
  renovarSesiones();
  exigir(cuenta("platform_staff_roles where rol = 'administracion_plataforma'") === 1, "0. como en producción, una sola persona administra al personal y nadie puede darle un rol por pantalla");
  const motivo = "Arranque de la 0028 en la evidencia local: acta del consejo";
  const eventos = (accion) => cuenta(`audit_log where accion = '${accion}' and identificador = '${E.IDS.ofelia}' and actor_tipo = 'sistema' and origen = 'comando'`);
  const primero = comandoDeRoles("--correo", "ofelia@lever.test", "--rol", "originacion", "--motivo", motivo);
  exigir(primero.estado === 0 && primero.texto.includes("Se asignó el rol originacion"), "0. el comando le da Originación a Ofelia", primero.texto);
  const segundo = comandoDeRoles("--correo", "ofelia@lever.test", "--rol", "originacion", "--motivo", motivo);
  exigir(segundo.texto.includes("ya tenía el rol originacion"), "0. correrlo dos veces no cambia nada", segundo.texto);
  exigir(cuenta(`platform_staff_roles where user_id = '${E.IDS.ofelia}' and rol = 'originacion'`) === 1 && eventos("rol_personal_asignado") === 1, "0. una fila y un solo evento «rol_personal_asignado» del comando, con su motivo");
  exigir(!/postgres(ql)?:\/\//.test(primero.texto + segundo.texto), "0. el comando no imprime el connection string");
  const { nav, p } = await abrir("ofelia");
  await ir(p, "/operacion/personal");
  const fila = p.locator("li", { has: p.getByRole("heading", { name: "Ofelia Plataforma (tú)" }) });
  exigir(await fila.getByText("Originación", { exact: true }).isVisible(), "0. Personal muestra a Ofelia con Originación");
  await foto(p, "f0-personal-rol-por-comando", false);
  await ir(p, "/operacion/bitacora");
  exigir(await p.getByText("Asignó un rol del personal").first().isVisible(), "0. la bitácora muestra «Asignó un rol del personal»");
  await foto(p, "f0-bitacora-rol-por-comando", false);
  const quitado = comandoDeRoles("--correo", "ofelia@lever.test", "--rol", "originacion", "--motivo", motivo, "--quitar");
  exigir(quitado.texto.includes("Se quitó el rol originacion") && eventos("rol_personal_retirado") === 1, "0. quitarlo deja su propio evento", quitado.texto);
  const sinAdmin = comandoDeRoles("--correo", "ofelia@lever.test", "--rol", "administracion_plataforma", "--motivo", motivo, "--quitar");
  exigir(sinAdmin.estado === 1 && sinAdmin.texto.includes("no se queda sin administración"), "0. el comando no deja al personal sin administración", sinAdmin.texto);
  await ir(p, "/operacion/personal");
  exigir(!(await fila.getByText("Originación", { exact: true }).isVisible()), "0. Ofelia vuelve a solo Administración: los flujos siguen como en producción");
  await nav.close();
}

async function flujo1() {
  console.log("\n— Flujo 1: Administración asigna roles; el auditor no recibe Cumplimiento");
  renovarSesiones();
  const { nav, p } = await abrir("ofelia");
  envejecerFactor(E.IDS.ofelia, 6);
  await ir(p, "/operacion/personal");
  const confirma = p.getByRole("region", { name: "Confirma que eres tú" });
  exigir((await confirma.count()) === 1, "1. con el factor de hace 6 minutos, Personal pide «Confirma que eres tú» antes de tocar roles");
  await foto(p, "f1-personal-confirma-identidad");
  await confirma.getByLabel("Código de la app autenticadora").fill(await totp("ofelia"));
  await confirma.getByRole("button", { name: "Confirmar con el código" }).click();
  await confirma.waitFor({ state: "detached", timeout: 20000 });
  await listo(p);
  anotar("1. Ofelia confirmó con su app autenticadora y la pantalla deja asignar roles");
  for (const [quien, rol, etiqueta] of [["omar", "originacion", "Originación"], ["ana", "aprobacion", "Aprobación"], ["celia", "cumplimiento", "Cumplimiento"], ["aurelio", "auditoria", "Auditoría"]]) {
    const grupo = p.getByRole("group", { name: `Roles de ${NOMBRES[quien]}` });
    await enviar(p, grupo.getByRole("button", { name: `Dar ${etiqueta}`, exact: true }), "rol_asignado", { doble: true });
    exigir(cuenta(`platform_staff_roles where user_id = '${E.IDS[quien]}' and rol = '${rol}'`) === 1, `1. ${NOMBRES[quien]} recibe ${etiqueta} (doble clic = 1 fila)`);
    exigir(cuenta(`audit_log where accion = 'rol_personal_asignado' and identificador = '${E.IDS[quien]}'`) === 1, `1. un solo evento «rol_personal_asignado» para ${NOMBRES[quien]}`);
  }
  await enviar(p, p.getByRole("group", { name: `Roles de ${NOMBRES.aurelio}` }).getByRole("button", { name: "Dar Cumplimiento", exact: true }), "roles_incompatibles");
  exigir((await aviso(p)).includes("Cumplimiento no se junta con Auditoría"), "1. la pantalla explica la 50ª: Cumplimiento no se junta con Auditoría");
  exigir(cuenta(`platform_staff_roles where user_id = '${E.IDS.aurelio}' and rol = 'cumplimiento'`) === 0, "1. la base no dejó a Aurelio con Cumplimiento");
  await enviar(p, p.getByRole("group", { name: `Roles de ${NOMBRES.omar}` }).getByRole("button", { name: "Dar Cumplimiento", exact: true }), "roles_incompatibles");
  exigir(cuenta(`platform_staff_roles where user_id = '${E.IDS.omar}' and rol = 'cumplimiento'`) === 0, "1. tampoco Originación con Cumplimiento (Omar)");
  exigir(await p.getByText("Tus roles los cambia otra persona de Administración.").isVisible(), "1. la fila de Ofelia no tiene botones: nadie se da roles a sí mismo");
  await foto(p, "f1-personal-roles-asignados-y-rechazo-50a");
  await nav.close();
  execFileSync("./node_modules/.bin/tsx", ["scripts/evidencia/ola-r-alta/preparar.ts", "lumbre"], { stdio: "inherit", env: process.env });
}

async function campo(p, selector, valor) {
  await p.locator(selector).fill(valor);
}

async function subirDocumento(p, { tipo, emitido = "", vigente = "", detalle = "", representante = false }) {
  await p.locator("#doc-tipo").selectOption(tipo);
  if (representante) await p.locator("#doc-representante").selectOption({ index: 1 });
  if (emitido) await campo(p, "#doc-emitido", emitido);
  if (vigente) await campo(p, "#doc-vigente", vigente);
  if (detalle) await campo(p, "#doc-detalle", detalle);
  await p.locator("#doc-archivo").setInputFiles({ name: `${tipo}.pdf`, mimeType: "application/pdf", buffer: PDF(tipo) });
  await enviar(p, p.getByRole("button", { name: "Guardar documento" }), "expediente_documento_cargado");
}

const ctxEbano = {};
async function flujo2() {
  console.log("\n— Flujo 2: Originación registra el prospecto y arma el expediente (2 capas, propietarios reales calculados)");
  renovarSesiones();
  const { nav, p } = await abrir("omar");
  await ir(p, "/operacion/clientes");
  await p.getByLabel("Razón social").fill(EBANO.razonSocial);
  await p.getByLabel("RFC").fill(EBANO.rfc);
  await p.getByLabel("Código postal").fill("64000");
  await enviar(p, p.getByRole("button", { name: "Registrar prospecto" }), "prospecto_registrado", { doble: true });
  exigir(cuenta(`companies where rfc = '${EBANO.rfc}'`) === 1, "2. doble clic en «Registrar prospecto» = 1 empresa");
  ctxEbano.id = companyIdDe(EBANO.rfc);
  await p.getByRole("link", { name: "Abrir expediente" }).click();
  await p.waitForURL(/\/expediente/);
  await listo(p);
  await enviar(p, p.getByRole("button", { name: "Abrir versión 1" }), "expediente_version_creada", { doble: true });
  exigir(cuenta(`kyb_versiones where company_id = '${ctxEbano.id}'`) === 1, "2. doble clic en «Abrir versión 1» = 1 versión");
  await campo(p, "#dato-razonSocial", EBANO.razonSocial);
  await campo(p, "#dato-rfc", EBANO.rfc);
  for (const [nombre, valor] of Object.entries(DATOS)) await campo(p, `#dato-${nombre}`, valor);
  await enviar(p, p.getByRole("button", { name: "Guardar datos" }), "expediente_datos_guardados");
  await campo(p, "#rep-nombre", REPRESENTANTE.nombre);
  await campo(p, "#rep-rfc", REPRESENTANTE.rfc);
  await campo(p, "#rep-curp", REPRESENTANTE.curp);
  await campo(p, "#rep-designado", REPRESENTANTE.designado);
  await p.getByText("Administra la empresa (administrador único o consejo)").click();
  await enviar(p, p.getByRole("button", { name: "Agregar representante" }), "expediente_representante_agregado", { doble: true });
  exigir(cuenta(`kyb_representantes r join kyb_versiones v on v.id = r.version_id where v.company_id = '${ctxEbano.id}'`) === 1, "2. doble clic en «Agregar representante» = 1 representante");
  // Un representante capturado por error se quita del borrador: queda marcado, con su evento, y no se borra.
  await campo(p, "#rep-nombre", "Raúl Error Captura");
  await campo(p, "#rep-rfc", "EOCR800101AB2");
  await campo(p, "#rep-curp", "EOCR800101HNLRPL08");
  await campo(p, "#rep-designado", "Captura equivocada");
  await enviar(p, p.getByRole("button", { name: "Agregar representante" }), "expediente_representante_agregado");
  await enviar(p, p.locator("li", { has: p.getByRole("heading", { name: "Raúl Error Captura" }) }).getByRole("button", { name: "Quitar" }), "expediente_retirado", { doble: true });
  exigir(
    cuenta(`kyb_representantes r join kyb_versiones v on v.id = r.version_id where v.company_id = '${ctxEbano.id}' and r.retirado_en is not null`) === 1
      && cuenta(`audit_log where accion = 'expediente_representante_retirado' and company_id = '${ctxEbano.id}'`) === 1,
    "2. doble clic en «Quitar» = 1 representante quitado del borrador, con un solo evento; la fila se conserva",
  );
  for (const socio of SOCIOS) {
    if (socio.padre) await p.locator("#acc-padre").selectOption({ label: new RegExp(socio.padre.slice(0, 12)) }).catch(async () => p.locator("#acc-padre").selectOption({ index: 1 }));
    await p.locator("#acc-tipo").selectOption(socio.tipo);
    await campo(p, "#acc-nombre", socio.nombre);
    await campo(p, "#acc-rfc", socio.rfc);
    if (socio.curp) await campo(p, "#acc-curp", socio.curp);
    await campo(p, "#acc-capital", socio.capital);
    await campo(p, "#acc-votos", socio.votos);
    await enviar(p, p.getByRole("button", { name: "Agregar accionista" }), "expediente_accionista_agregado", { doble: true });
  }
  exigir(cuenta(`kyb_accionistas a join kyb_versiones v on v.id = a.version_id where v.company_id = '${ctxEbano.id}'`) === 4, "2. cuatro accionistas en dos capas, sin duplicados por doble clic");
  // Un socio capturado por error también se quita; la estructura vuelve a sumar 100 %.
  await p.locator("#acc-tipo").selectOption("fisica");
  await campo(p, "#acc-nombre", "Socio Capturado Por Error");
  await campo(p, "#acc-rfc", "SCPE800101AB3");
  await campo(p, "#acc-curp", "SCPE800101HNLPRR07");
  await campo(p, "#acc-capital", "10");
  await campo(p, "#acc-votos", "10");
  await enviar(p, p.getByRole("button", { name: "Agregar accionista" }), "expediente_accionista_agregado");
  await enviar(p, p.locator("li", { has: p.getByRole("heading", { name: "Socio Capturado Por Error" }) }).getByRole("button", { name: "Quitar" }), "expediente_retirado", { doble: true });
  exigir(
    cuenta(`kyb_accionistas a join kyb_versiones v on v.id = a.version_id where v.company_id = '${ctxEbano.id}' and a.retirado_en is null`) === 4
      && cuenta(`audit_log where accion = 'expediente_accionista_retirado' and company_id = '${ctxEbano.id}'`) === 1,
    "2. doble clic en «Quitar» = 1 socio quitado con un solo evento; quedan los cuatro de la estructura",
  );
  const hoy = hoyMexico();
  await subirDocumento(p, { tipo: "acta_constitutiva", detalle: "Escritura 4,521, Notaría 12 de Monterrey" });
  await subirDocumento(p, { tipo: "constancia_situacion_fiscal", emitido: hoy });
  await subirDocumento(p, { tipo: "certificado_efirma" });
  await subirDocumento(p, { tipo: "comprobante_domicilio", emitido: hoy });
  await subirDocumento(p, { tipo: "declaracion_propietarios", emitido: hoy });
  await subirDocumento(p, { tipo: "identificacion_representante", vigente: "2031-12-31", representante: true });
  exigir(cuenta(`kyb_documentos where company_id = '${ctxEbano.id}' and sha256 ~ '^[0-9a-f]{64}$'`) === 6, "2. seis documentos guardados, cada uno con su SHA-256");
  await foto(p, "f2-borrador-1-completo");
  await enviar(p, p.getByRole("button", { name: "Enviar versión 1" }), "expediente_enviado", { doble: true });
  const beneficiarios = sql(`select string_agg(nombre || ' ' || capital_pct, ', ' order by nombre) from kyb_beneficiarios b join kyb_versiones v on v.id = b.version_id where v.company_id = '${ctxEbano.id}' and v.numero = 1`);
  exigir(/Joaquín Ramos Salas 30(\.0+)?\b/.test(beneficiarios) && /Mariana Ébano Ruiz 49(\.0+)?\b/.test(beneficiarios) && !/Héctor/.test(beneficiarios), "2. propietarios reales calculados: Mariana 49 % (70 % × 70 %) y Joaquín 30 %; Héctor (21 %) no llega al 25 %", beneficiarios);
  exigir(await p.getByText("Mariana Ébano Ruiz").first().isVisible(), "2. la vista de la versión enviada muestra la estructura y los propietarios reales");
  await foto(p, "f2-version-1-enviada-propietarios-reales");
  await nav.close();
}

async function flujo3() {
  console.log("\n— Flujo 3: Cumplimiento observa la versión 1; Originación abre la 2; Cumplimiento aprueba");
  renovarSesiones();
  const celia = await abrir("celia");
  await ir(celia.p, "/operacion/cumplimiento");
  exigir(await celia.p.getByRole("link", { name: EBANO.razonSocial }).first().isVisible(), "3. la versión 1 aparece en «Expedientes por dictaminar»");
  await celia.p.getByRole("link", { name: EBANO.razonSocial }).first().click();
  await celia.p.waitForURL(/\/expediente/);
  await listo(celia.p);
  await celia.p.locator("#dictamen-resultado").selectOption("observado");
  await enviar(celia.p, celia.p.getByRole("button", { name: "Registrar dictamen" }), null);
  exigir(cuenta(`kyb_dictamenes d join kyb_versiones v on v.id = d.version_id where v.company_id = '${ctxEbano.id}'`) === 0, "3. «observado» sin motivo no se registra");
  await celia.p.locator("#dictamen-resultado").selectOption("observado");
  await celia.p.locator("#dictamen-motivo").fill("Falta la estructura corporativa interna: una persona moral es socia directa.");
  await enviar(celia.p, celia.p.getByRole("button", { name: "Registrar dictamen" }), "expediente_dictaminado", { doble: true });
  exigir(cuenta(`kyb_dictamenes d join kyb_versiones v on v.id = d.version_id where v.company_id = '${ctxEbano.id}' and d.resultado = 'observado' and v.numero = 1`) === 1, "3. dictamen «observado» con motivo sobre la versión 1 (doble clic = 1)");
  await foto(celia.p, "f3-version-1-observada");

  const omar = await abrir("omar");
  await ir(omar.p, `/operacion/clientes/${ctxEbano.id}/expediente`);
  await enviar(omar.p, omar.p.getByRole("button", { name: "Abrir versión 2" }), "expediente_version_creada");
  exigir(cuenta(`kyb_accionistas a join kyb_versiones v on v.id = a.version_id where v.company_id = '${ctxEbano.id}' and v.numero = 2`) === 4, "3. la versión 2 hereda accionistas, representantes y documentos de la 1");
  await subirDocumento(omar.p, { tipo: "estructura_corporativa", emitido: hoyMexico(), detalle: "Organigrama firmado por la asamblea" });
  await enviar(omar.p, omar.p.getByRole("button", { name: "Enviar versión 2" }), "expediente_enviado");
  await omar.nav.close();

  await ir(celia.p, `/operacion/clientes/${ctxEbano.id}/expediente`);
  await celia.p.locator("#dictamen-resultado").selectOption("aprobado");
  await enviar(celia.p, celia.p.getByRole("button", { name: "Registrar dictamen" }), "expediente_dictaminado");
  exigir(cuenta(`kyb_dictamenes d join kyb_versiones v on v.id = d.version_id where v.company_id = '${ctxEbano.id}' and d.resultado = 'aprobado' and v.numero = 2`) === 1, "3. la versión 2 queda aprobada por Cumplimiento");
  exigir(sql(`select resultado from kyb_dictamenes d join kyb_versiones v on v.id = d.version_id where v.company_id = '${ctxEbano.id}' and v.numero = 1`) === "observado", "3. el dictamen de la versión 1 no cambia (append-only)");
  await foto(celia.p, "f3-version-2-aprobada");
  await celia.nav.close();
}

async function aprobarDecision(p, texto) {
  await ir(p, "/operacion/aprobaciones");
  const fila = p.locator("li.decision", { hasText: texto });
  await fila.getByRole("button", { name: "Aprobar", exact: true }).click();
  return esperarAviso(p, null);
}

async function flujo8a() {
  console.log("\n— Flujo 8 (a): Originación pide la activación; la base la rechaza sin grado de riesgo");
  renovarSesiones();
  const omar = await abrir("omar");
  await ir(omar.p, `/operacion/clientes/${ctxEbano.id}`);
  await enviar(omar.p, omar.p.getByRole("button", { name: "Solicitar activación" }), "activacion_solicitada", { doble: true });
  exigir(cuenta(`company_activation_requests where company_id = '${ctxEbano.id}'`) === 1, "8. doble clic en «Solicitar activación» = 1 solicitud");
  await ir(omar.p, "/operacion/aprobaciones");
  exigir(await omar.p.locator("li.decision", { hasText: "Grupo Ébano" }).getByText("La pediste tú: decide otra persona.").isVisible().catch(() => false)
    || await omar.p.locator("li.decision", { hasText: "Grupo Ébano" }).getByText("La decide").isVisible().catch(() => false), "8. Originación no decide su propia solicitud");
  await omar.nav.close();
  const ana = await abrir("ana");
  const codigo = await aprobarDecision(ana.p, "Grupo Ébano");
  exigir(codigo === "activacion_sin_riesgo_vigente", "8. la base rechaza la activación: falta un grado de riesgo vigente", codigo);
  exigir((await aviso(ana.p)).includes("La base no deja activar"), "8. Aprobación ve el mensaje propio del candado");
  exigir(sql(`select estado from companies where id = '${ctxEbano.id}'`) === "en_alta", "8. la empresa sigue en alta");
  await foto(ana.p, "f8-activacion-rechazada-por-la-base");
  await ana.nav.close();
}

async function flujo4() {
  console.log("\n— Flujo 4: Cumplimiento califica el riesgo; la revisión vencida aparece en la bandeja");
  renovarSesiones();
  const { nav, p } = await abrir("celia");
  await ir(p, `/operacion/clientes/${ctxEbano.id}/expediente`);
  await p.locator("#riesgo-actividad").selectOption("media");
  await p.locator("#riesgo-zona").selectOption("baja");
  await enviar(p, p.getByRole("button", { name: "Registrar grado al alta" }), "riesgo_calificado", { doble: true });
  const fila = sql(`select grado || ' ' || puntaje || ' ' || revisar_antes_de from kyb_calificaciones_riesgo where company_id = '${ctxEbano.id}'`);
  exigir(cuenta(`kyb_calificaciones_riesgo where company_id = '${ctxEbano.id}'`) === 1, "4. doble clic en «Registrar grado al alta» = 1 calificación", fila);
  exigir(fila.startsWith("medio"), "4. matriz de factores: actividad media + dos capas + volumen = grado medio", fila);
  await foto(p, "f4-grado-de-riesgo-registrado");
  await ir(p, "/operacion/cumplimiento");
  const lumbre = p.locator("li", { hasText: "Distribuidora Lumbre" }).filter({ hasText: "Revisión vencida" });
  exigir((await lumbre.count()) >= 1, "4. la bandeja marca «Revisión vencida» a Distribuidora Lumbre (calificada hace 7 meses; se calcula al leer)");
  exigir((await p.locator("li", { hasText: "Grupo Ébano" }).filter({ hasText: "Vigente" }).count()) >= 1, "4. Grupo Ébano aparece «Vigente» con su fecha de revisión");
  await foto(p, "f4-bandeja-revision-vencida");
  await nav.close();
}

let fichaVieja = null;
async function flujo8b() {
  console.log("\n— Flujo 8 (b): con todo en regla, otra persona aprueba la activación");
  renovarSesiones();
  // 0030 (Ola R2): el candado también exige el perfil transaccional (25ª). Originación lo declara por clic.
  const omar = await abrir("omar");
  await ir(omar.p, `/operacion/clientes/${ctxEbano.id}/expediente#perfil-titulo`);
  await omar.p.locator("#perfil-pagos-monto").fill("400,000.00");
  await omar.p.locator("#perfil-pagos-operaciones").fill("60");
  await omar.p.locator("#perfil-nomina-monto").fill("250,000.00");
  await omar.p.locator("#perfil-nomina-operaciones").fill("2");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Registrar perfil" }), "perfil_declarado", { doble: true });
  exigir(cuenta(`pld_perfiles where company_id = '${ctxEbano.id}'`) === 1, "8. doble clic en «Registrar perfil» = 1 perfil transaccional de Grupo Ébano");
  await foto(omar.p, "f8-perfil-transaccional-de-ebano");
  await omar.nav.close();
  const ana = await abrir("ana");
  const codigo = await aprobarDecision(ana.p, "Grupo Ébano");
  exigir(codigo === "decision_registrada", "8. Aprobación aprueba y la base deja pasar en_alta → activa", codigo);
  exigir(sql(`select estado from companies where id = '${ctxEbano.id}'`) === "activa", "8. Grupo Ébano queda activa");
  await ana.nav.close();
  // Ofelia deja abierta la ficha con el formulario de invitación: se usa en el flujo 7.
  fichaVieja = await abrir("ofelia");
  await ir(fichaVieja.p, `/operacion/clientes/${ctxEbano.id}`);
  exigir(await fichaVieja.p.getByRole("button", { name: "Enviar invitación" }).isVisible(), "8. con la empresa activa, la ficha ofrece invitar al primer administrador");
}

let coincidenciaHector = null;
async function flujo5() {
  console.log("\n— Flujo 5: Cumplimiento carga la Lista de Personas Bloqueadas (CSV documentado)");
  renovarSesiones();
  const { nav, p } = await abrir("celia");
  await ir(p, "/operacion/lpb");
  await p.locator("#archivo").setInputFiles({ name: "lpb-renglon-malo.csv", mimeType: "text/csv", buffer: Buffer.from("nombre,rfc,curp,tipo,fecha\nSin Tipo,,,,2026-11-02\n") });
  await enviar(p, p.getByRole("button", { name: "Cargar y cotejar" }), "lpb_renglon_invalido");
  exigir((await aviso(p)).includes("línea 2"), "5. un renglón inválido se rechaza diciendo qué línea revisar", await aviso(p));
  exigir(cuenta("lpb_cargas") === 0, "5. el archivo con error no deja carga");
  await p.locator("#archivo").setInputFiles({ name: "lpb-uif-2026-11-02.csv", mimeType: "text/csv", buffer: Buffer.from(LPB_1) });
  await enviar(p, p.getByRole("button", { name: "Cargar y cotejar" }), "lpb_cargada", { doble: true });
  exigir(cuenta("lpb_cargas") === 1 && cuenta("lpb_personas") === 3, "5. doble clic en «Cargar y cotejar» = 1 carga con 3 renglones");
  exigir((await aviso(p)).includes("3 renglones"), "5. el aviso dice cuántos renglones y coincidencias nuevas", await aviso(p));
  await foto(p, "f5-lpb-cargada-coincidencias");
  coincidenciaHector = sql(`select id from lpb_coincidencias where sujeto_nombre = 'Héctor Lozano Díaz'`);
  await nav.close();
}

async function flujo6() {
  console.log("\n— Flujo 6: posible coincidencia por nombre; nunca se descarta sola, la resuelve Cumplimiento con motivo");
  renovarSesiones();
  exigir(sql(`select tipo || ' ' || estado || ' ' || coalesce(plazo_reporte_hasta::text, 'sin plazo') from lpb_coincidencias where id = '${coincidenciaHector}'`) === "posible pendiente sin plazo", "6. Héctor (accionista) coincide solo por nombre: «posible», pendiente y sin plazo de reporte");
  const { nav, p } = await abrir("celia");
  await ir(p, "/operacion/cumplimiento");
  const fila = p.locator(`li:has(#resolucion-${coincidenciaHector})`);
  exigir(await fila.getByText("Nombre parecido").isVisible(), "6. la fila dice «Nombre parecido»");
  await fila.locator(`#resolucion-${coincidenciaHector}`).selectOption("falso_positivo");
  await fila.locator(`#motivo-${coincidenciaHector}`).fill("La persona de la lista tiene otra fecha de nacimiento; la CURP del accionista no coincide.");
  await enviar(p, fila.getByRole("button", { name: "Registrar dictamen" }), "coincidencia_resuelta", { doble: true });
  exigir(sql(`select estado || ' ' || (resuelta_por = '${E.IDS.celia}') from lpb_coincidencias where id = '${coincidenciaHector}'`) === "falso_positivo true", "6. queda «falso positivo» con motivo y con quién lo resolvió");
  exigir(cuenta(`audit_log where accion = 'lpb_coincidencia_resuelta' and identificador = '${coincidenciaHector}'`) === 1, "6. un solo evento de resolución (doble clic)");
  await foto(p, "f6-posible-coincidencia-resuelta");
  await nav.close();
}

async function flujo7() {
  console.log("\n— Flujo 7: coincidencia exacta de un propietario real → suspensión inmediata y pendiente de 24 horas");
  renovarSesiones();
  const exacta = sql(`select id from lpb_coincidencias where company_id = '${ctxEbano.id}' and sujeto_tipo = 'beneficiario' and tipo = 'exacta'`);
  exigir(Boolean(exacta), "7. la carga detectó a Mariana Ébano Ruiz (propietaria real) por RFC idéntico");
  exigir(sql(`select estado from companies where id = '${ctxEbano.id}'`) === "suspendida", "7. Grupo Ébano quedó suspendida de inmediato, sin segunda firma");
  exigir(cuenta(`audit_log where accion = 'empresa_suspendida_lpb' and company_id = '${ctxEbano.id}' and actor_tipo = 'sistema'`) === 1, "7. evento del sistema «empresa_suspendida_lpb»");
  exigir(sql(`select (plazo_reporte_hasta - detectada_en) = interval '24 hours' from lpb_coincidencias where id = '${exacta}'`) === "t", "7. plazo de reporte: 24 horas desde la detección");
  const { nav, p } = await abrir("celia");
  await ir(p, "/operacion/cumplimiento");
  const fila = p.locator(`li:has(#resolucion-${exacta})`);
  exigir(await fila.getByText("RFC idéntico").isVisible(), "7. la bandeja muestra «RFC idéntico» con su plazo");
  await foto(p, "f7-bandeja-coincidencia-exacta-24h");
  await fila.locator(`#resolucion-${exacta}`).selectOption("confirmada");
  await fila.locator(`#motivo-${exacta}`).fill("RFC y nombre idénticos a la persona de la lista de la UIF.");
  await enviar(p, fila.getByRole("button", { name: "Registrar dictamen" }), "coincidencia_resuelta");
  const conFolio = p.locator(`li:has(#folio-${exacta})`);
  await conFolio.locator(`#folio-${exacta}`).fill("UIF-24H-2026-000123");
  await conFolio.locator(`#presentado-${exacta}`).fill(hoyMexico());
  await conFolio.locator(`#aviso-${exacta}`).fill(hoyMexico());
  await enviar(p, conFolio.getByRole("button", { name: "Anotar folio" }), "reporte_registrado", { doble: true });
  exigir(sql(`select reporte_folio from lpb_coincidencias where id = '${exacta}'`) === "UIF-24H-2026-000123", "7. Cumplimiento anota el folio que presentó por su vía (Lever no transmite)");
  exigir((await p.content()).includes("Lever no transmite reportes a la UIF"), "7. el texto dice la verdad: Lever no transmite a la UIF");
  await foto(p, "f7-folio-anotado");
  await nav.close();
  // La ficha que Ofelia abrió con la empresa activa: invitar ya no pasa.
  await fichaVieja.p.getByLabel("Nombre").fill("Ernesto Ébano");
  await fichaVieja.p.getByLabel("Correo").fill("ernesto@ebano.mx");
  const codigo = await enviar(fichaVieja.p, fichaVieja.p.getByRole("button", { name: "Enviar invitación" }), null);
  exigir(codigo === "cliente_no_activo" || codigo === "empresa_suspendida", "7. con la empresa suspendida, la invitación queda bloqueada", codigo);
  exigir(cuenta(`invitations where company_id = '${ctxEbano.id}'`) === 0, "7. no quedó ninguna invitación");
  await foto(fichaVieja.p, "f7-invitacion-bloqueada");
  await fichaVieja.nav.close();
}

async function flujo9() {
  console.log("\n— Flujo 9: suspensión manual con doble firma; la consola queda en solo lectura veraz");
  renovarSesiones();
  const omar = await abrir("omar");
  await ir(omar.p, `/operacion/clientes/${TALLER}`);
  await omar.p.locator("#motivo-suspension").fill("El banco corresponsal reportó operaciones que hay que revisar.");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Pedir suspensión" }), "suspension_solicitada", { doble: true });
  exigir(cuenta(`company_suspensions where company_id = '${TALLER}' and estado = 'pendiente'`) === 1, "9. doble clic en «Pedir suspensión» = 1 solicitud pendiente");
  exigir(sql(`select estado from companies where id = '${TALLER}'`) === "activa", "9. sin la segunda firma la empresa sigue activa");
  await ir(omar.p, "/operacion/aprobaciones");
  exigir(await omar.p.locator("li.decision", { hasText: "Taller del Cierre" }).getByText("La pediste tú: decide otra persona.").isVisible(), "9. quien pidió no decide");
  await omar.nav.close();
  const ana = await abrir("ana");
  const codigo = await aprobarDecision(ana.p, "Suspensión · Taller del Cierre");
  exigir(codigo === "decision_registrada", "9. Aprobación (otra persona) aprueba la suspensión", codigo);
  exigir(sql(`select estado from companies where id = '${TALLER}'`) === "suspendida", "9. Taller del Cierre queda suspendida");
  await ana.nav.close();

  // Cada página se abre ya con la empresa suspendida: la consola conserva los botones de cada rol y,
  // al usarlos, la base rechaza con su propio motivo y la pantalla lo dice (no un «sin permiso»).
  const rosa = await abrir("rosa");
  await ir(rosa.p, `/c/${TALLER}/consola/proveedores?pago=${PAGO_NORTE}`);
  exigir(await rosa.p.getByText("La operación de Taller del Cierre está suspendida.").isVisible(), "9. el aviso de empresa suspendida se ve arriba de la consola");
  const autorizar = rosa.p.getByRole("button", { name: "Autorizar para pagar" });
  exigir(await autorizar.isVisible(), "9. Pagos sigue ofreciendo «Autorizar para pagar» a Rosa");
  await autorizar.dblclick();
  await rosa.p.getByText("La empresa está suspendida").first().waitFor({ timeout: 20000 });
  exigir(
    sql(`select estado from supplier_payment_requests where id = '${PAGO_NORTE}'`) === "por_autorizar"
      && cuenta(`audit_log where accion = 'autorizar_pago_proveedor' and identificador = '${PAGO_NORTE}'`) === 0,
    "9. doble clic en «Autorizar para pagar»: la base lo rechaza, el pago sigue por autorizar y no hay evento",
  );
  await foto(rosa.p, "f9-pago-rechazado-empresa-suspendida", false);

  const gil = await abrir("gil");
  await ir(gil.p, `/c/${TALLER}/consola/personas/nomina`);
  const preparar = gil.p.getByRole("button", { name: /^Preparar nómina del / });
  exigir(await preparar.isVisible(), "9. Nómina sigue ofreciendo «Preparar nómina» a Gil");
  await preparar.dblclick();
  await gil.p.getByText("La empresa está suspendida").first().waitFor({ timeout: 20000 });
  exigir(cuenta(`payroll_batches where company_id = '${TALLER}'`) === 0, "9. doble clic en «Preparar nómina»: la base lo rechaza y no hay lote");
  await foto(gil.p, "f9-nomina-rechazada-empresa-suspendida", false);

  await ir(gil.p, `/c/${TALLER}/consola/personas/areas`);
  await gil.p.locator("#centroNombre").fill("Ventas");
  await gil.p.locator("#centroPresupuesto").fill("5000.00");
  await gil.p.getByRole("button", { name: "Crear área" }).dblclick();
  await gil.p.getByText("La empresa está suspendida").first().waitFor({ timeout: 20000 });
  exigir(cuenta(`cost_centers where company_id = '${TALLER}' and nombre = 'Ventas'`) === 0, "9. Personas: doble clic en «Crear área»: la base lo rechaza y no hay área");
  await foto(gil.p, "f9-area-rechazada-empresa-suspendida", false);

  const ivan = sql(`select id from employees where company_id = '${TALLER}' and nombre = 'Iván Invitado'`);
  const invitaciones = () => cuenta(`invitations i join users u on u.id = i.user_id where i.company_id = '${TALLER}' and lower(u.correo) = 'ivan@taller.test'`);
  const antes = invitaciones();
  await ir(gil.p, `/c/${TALLER}/consola/personas/${ivan}`);
  await gil.p.getByRole("button", { name: "Renovar y reenviar invitación" }).dblclick();
  await gil.p.getByText("La empresa está suspendida").first().waitFor({ timeout: 20000 });
  exigir(invitaciones() === antes, "9. Invitaciones: doble clic en «Renovar y reenviar invitación»: la base lo rechaza y no sale otra");
  await foto(gil.p, "f9-invitacion-rechazada-empresa-suspendida", false);
  await gil.nav.close();

  const invitado = await abrir("ivan");
  await ir(invitado.p, `/invitacion/${E.INVITACION_IVAN}`);
  const marcadas = () => invitado.p.locator('#contrasena[aria-invalid="true"], #confirmacion[aria-invalid="true"]').count();
  // Un error de lo escrito sí marca los campos de contraseña.
  await invitado.p.getByLabel("Contraseña nueva").fill("clave-segura-12");
  await invitado.p.getByLabel("Repite la contraseña").fill("clave-segura-13");
  await invitado.p.getByRole("button", { name: "Aceptar la invitación" }).click();
  await invitado.p.getByText("Las dos contraseñas no coinciden.").waitFor({ timeout: 20000 });
  exigir(await marcadas() === 2, "9. con contraseñas distintas, el aviso marca los dos campos de contraseña");
  // Con la empresa suspendida, el aviso dice el motivo real y no culpa a la contraseña.
  await invitado.p.getByLabel("Contraseña nueva").fill("clave-segura-12");
  await invitado.p.getByLabel("Repite la contraseña").fill("clave-segura-12");
  await invitado.p.getByRole("button", { name: "Aceptar la invitación" }).dblclick();
  await invitado.p.getByRole("alert").getByText("La empresa está suspendida", { exact: true }).waitFor({ timeout: 20000 });
  exigir(
    cuenta(`invitations i join users u on u.id = i.user_id where i.company_id = '${TALLER}' and lower(u.correo) = 'ivan@taller.test' and i.usada_en is not null`) === 0
      && cuenta(`memberships m join users u on u.id = m.user_id where m.company_id = '${TALLER}' and lower(u.correo) = 'ivan@taller.test' and m.estado = 'activa'`) === 0,
    "9. Iván no puede aceptar su invitación: la base lo rechaza y la pantalla dice que la empresa está suspendida",
  );
  exigir(
    await marcadas() === 0 && await invitado.p.getByText("Por ahora no admite cuentas nuevas. Comunícate con Lever.").isVisible(),
    "9. el aviso de la suspensión no marca los campos de contraseña: el motivo es la empresa, no lo escrito",
  );
  await foto(invitado.p, "f9-aceptar-invitacion-empresa-suspendida", false);
  await invitado.nav.close();

  const directo = [
    ["liberar el pago", `update supplier_payment_requests set estado = 'listo_para_pagar', resuelto_por = '${E.IDS.rosa}', resuelto_en = now() where id = '${PAGO_NORTE}'`],
    ["preparar un lote", `insert into payroll_batches (id, company_id) values (gen_random_uuid(), '${TALLER}')`],
    ["editar un proveedor", `update suppliers set nombre_comercial = 'cambio' where company_id = '${TALLER}'`],
  ];
  for (const [que, sentencia] of directo) {
    const salida = comoCliente(TALLER, que === "liberar el pago" ? E.IDS.rosa : E.IDS.gil, sentencia);
    exigir(salida.includes("empresa_suspendida"), `9. directo en la base como rol cliente, ${que}: rechazado con «empresa_suspendida»`, salida.split("\n")[0]);
  }
  for (const tema of TEMAS) {
    for (const ancho of ANCHOS) {
      const vista = await abrir("rosa", { tema, ancho });
      await ir(vista.p, `/c/${TALLER}/consola/proveedores`);
      await foto(vista.p, `f9-consola-aviso-suspendida-${tema}-${ancho}`, false);
      await vista.nav.close();
    }
  }
  await rosa.nav.close();
}

async function flujo10() {
  console.log("\n— Flujo 10: reactivar con doble firma; tras la lista, primero el dictamen de falso positivo");
  renovarSesiones();
  const celia = await abrir("celia");
  await ir(celia.p, `/operacion/clientes/${ctxEbano.id}`);
  await celia.p.locator("#motivo-suspension").fill("La empresa pidió revisar su caso.");
  await enviar(celia.p, celia.p.getByRole("button", { name: "Pedir reactivación" }), "reactivacion_con_coincidencia_lpb");
  exigir(cuenta(`company_suspensions where company_id = '${ctxEbano.id}' and tipo = 'reactivacion'`) === 0, "10. Grupo Ébano (suspendida por la lista, coincidencia confirmada) no se puede reactivar sin dictamen de falso positivo");
  await foto(celia.p, "f10-reactivacion-bloqueada-por-lpb");
  await ir(celia.p, `/operacion/clientes/${TALLER}`);
  await celia.p.locator("#motivo-suspension").fill("El banco corresponsal confirmó que las operaciones son legítimas.");
  await enviar(celia.p, celia.p.getByRole("button", { name: "Pedir reactivación" }), "reactivacion_solicitada", { doble: true });
  exigir(cuenta(`company_suspensions where company_id = '${TALLER}' and tipo = 'reactivacion' and estado = 'pendiente'`) === 1, "10. doble clic en «Pedir reactivación» = 1 solicitud");
  await celia.nav.close();
  const ana = await abrir("ana");
  const codigo = await aprobarDecision(ana.p, "Reactivación · Taller del Cierre");
  exigir(codigo === "decision_registrada" && sql(`select estado from companies where id = '${TALLER}'`) === "activa", "10. Aprobación aprueba y Taller vuelve a activa", codigo);
  exigir(sql(`select string_agg(estado_anterior || '→' || estado_nuevo, ' ' order by ocurrido_en) from company_state_history where company_id = '${TALLER}'`).endsWith("activa→suspendida suspendida→activa"), "10. el historial guarda suspender y reactivar");
  await foto(ana.p, "f10-reactivacion-aprobada");
  await ana.nav.close();
  const gil = await abrir("gil");
  await ir(gil.p, `/c/${TALLER}/consola/personas/nomina`);
  exigir(!(await gil.p.getByText("La operación de Taller del Cierre está suspendida.").isVisible()), "10. el aviso desaparece de la consola");
  await gil.p.getByRole("button", { name: /^Preparar nómina del / }).click();
  await gil.p.waitForURL(/\/consola\/personas\/nomina\/[0-9a-f-]{36}$/, { timeout: 20000 });
  exigir(cuenta(`payroll_batches where company_id = '${TALLER}'`) === 1, "10. reactivada, la nómina se prepara otra vez");
  await gil.nav.close();
}

async function flujo11() {
  console.log("\n— Flujo 11: proveedor en la lista → ese pago queda bloqueado");
  renovarSesiones();
  const celia = await abrir("celia");
  await ir(celia.p, "/operacion/lpb");
  await celia.p.locator("#archivo").setInputFiles({ name: "lpb-uif-2026-11-06.csv", mimeType: "text/csv", buffer: Buffer.from(LPB_2) });
  await enviar(celia.p, celia.p.getByRole("button", { name: "Cargar y cotejar" }), "lpb_cargada");
  exigir(cuenta("lpb_cargas") === 2, "11. la carga nueva se guarda aparte; la anterior no se borra");
  const cargas = celia.p.locator('section[aria-labelledby="cargas-titulo"] li');
  const nueva = cargas.filter({ hasText: "lpb-uif-2026-11-06.csv" });
  const vieja = cargas.filter({ hasText: "lpb-uif-2026-11-02.csv" });
  exigir(
    await nueva.getByText("Vigente", { exact: true }).isVisible() && await vieja.getByText("Anterior", { exact: true }).isVisible(),
    "11. la pantalla distingue la carga vigente de la anterior",
  );
  exigir(cuenta(`lpb_coincidencias where company_id = '${TALLER}' and sujeto_tipo = 'contraparte'`) === 1, "11. Servicios Norte Integrales coincide como contraparte de Taller");
  exigir(sql(`select estado from companies where id = '${TALLER}'`) === "activa", "11. una contraparte no suspende a la empresa");
  exigir(sql(`select estado from lpb_coincidencias where sujeto_nombre = 'Héctor Lozano Díaz'`) === "falso_positivo", "11. el falso positivo dictaminado no se reabre con la carga nueva");
  await foto(celia.p, "f11-lpb-segunda-carga");
  await celia.nav.close();
  const rosa = await abrir("rosa");
  await ir(rosa.p, `/c/${TALLER}/consola/proveedores?pago=${PAGO_NORTE}`);
  await rosa.p.getByRole("button", { name: "Autorizar para pagar" }).dblclick();
  await rosa.p.getByText("Este pago quedó detenido para revisión de cumplimiento").first().waitFor({ timeout: 20000 });
  exigir(sql(`select estado from supplier_payment_requests where id = '${PAGO_NORTE}'`) === "por_autorizar", "11. la base no libera el pago a un proveedor en la lista; el mensaje no revela la lista");
  await foto(rosa.p, "f11-pago-bloqueado-proveedor-en-lista", false);
  await rosa.nav.close();
}

async function flujo12() {
  console.log("\n— Flujo 12: lectura auditada (abrir el expediente y descargar un documento) en la bitácora");
  renovarSesiones();
  const antes = cuenta(`audit_log where accion = 'expediente_consultado' and actor_id = '${E.IDS.aurelio}'`);
  const { nav, p } = await abrir("aurelio");
  await ir(p, `/operacion/clientes/${ctxEbano.id}/expediente`);
  exigir(cuenta(`audit_log where accion = 'expediente_consultado' and actor_id = '${E.IDS.aurelio}'`) === antes + 1, "12. abrir el expediente deja «expediente_consultado» con Aurelio, la hora y la empresa");
  exigir((await p.getByRole("button", { name: /Registrar|Guardar|Enviar|Abrir versión/ }).count()) === 0, "12. Auditoría consulta sin botones de captura ni dictamen");
  const enlace = p.locator('a[href*="/expediente/documento/"]').first();
  const huella = (await p.locator(".operacion-mono").filter({ hasText: /^[0-9a-f]{64}$/ }).first().innerText().catch(() => "")).trim();
  const [descarga] = await Promise.all([p.waitForEvent("download"), enlace.click()]);
  const ruta = await descarga.path();
  const bytes = readFileSync(ruta);
  exigir(bytes.subarray(0, 5).toString() === "%PDF-", "12. la descarga entrega el PDF guardado");
  const documento = sql(`select sha256 from kyb_documentos where sha256 = '${sha256(bytes)}'`);
  exigir(Boolean(documento), "12. la SHA-256 del archivo descargado coincide con la guardada en la base", huella);
  exigir(cuenta(`audit_log where accion = 'expediente_documento_descargado' and actor_id = '${E.IDS.aurelio}'`) === 1, "12. descargar deja «expediente_documento_descargado»");
  await ir(p, "/operacion/bitacora");
  exigir(await p.getByText("Abrió el expediente").first().isVisible() && await p.getByText("Descargó un documento del expediente").first().isVisible(), "12. la bitácora muestra las dos lecturas con su etiqueta");
  await foto(p, "f12-bitacora-lecturas-auditadas");
  await ir(p, "/operacion/personal");
  exigir(await p.getByText("Tu rol no abre esta sección").isVisible(), "12. Auditoría ve «Sin permiso» en Personal");
  await foto(p, "f12-sin-permiso-personal");
  await nav.close();
}

// ---------- Pantallas: 3 temas × 1440/390, un h1, etiquetas, sin desborde, consola limpia ----------
const PANTALLAS = () => [
  { clave: "personal", quien: "ofelia", ruta: "/operacion/personal" },
  { clave: "cumplimiento", quien: "celia", ruta: "/operacion/cumplimiento" },
  { clave: "lpb", quien: "celia", ruta: "/operacion/lpb" },
  { clave: "expediente", quien: "omar", ruta: `/operacion/clientes/${ctxEbano.id}/expediente` },
  { clave: "ficha", quien: "omar", ruta: `/operacion/clientes/${ctxEbano.id}` },
  { clave: "aprobaciones", quien: "ana", ruta: "/operacion/aprobaciones" },
  { clave: "clientes", quien: "omar", ruta: "/operacion/clientes" },
  { clave: "bitacora", quien: "aurelio", ruta: "/operacion/bitacora" },
  { clave: "sin-permiso", quien: "aurelio", ruta: "/operacion/personal" },
];

async function revisarPagina(p) {
  return p.evaluate(() => {
    const h1 = document.querySelectorAll("h1").length;
    const sinNombre = [];
    for (const control of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
      if (control.closest("[hidden], dialog:not([open])")) continue;
      const etiqueta = (control.id && document.querySelector(`label[for="${CSS.escape(control.id)}"]`)) || control.closest("label");
      if (!(control.getAttribute("aria-label") || control.getAttribute("aria-labelledby") || etiqueta)) sinNombre.push(control.name || control.id);
    }
    return { h1, sinNombre, desborde: document.documentElement.scrollWidth - window.innerWidth };
  });
}

async function pantallas() {
  console.log("\n— Pantallas: 3 temas × 1440/390");
  for (const pantalla of PANTALLAS()) {
    for (const tema of TEMAS) {
      for (const ancho of ANCHOS) {
        renovarSesiones();
        const { nav, p, errores } = await abrir(pantalla.quien, { tema, ancho });
        await ir(p, pantalla.ruta);
        const revision = await revisarPagina(p);
        await foto(p, `pantalla-${pantalla.clave}-${tema}-${ancho}`);
        exigir(revision.h1 === 1 && revision.sinNombre.length === 0 && revision.desborde <= 1 && errores.length === 0,
          `pantalla ${pantalla.clave} ${tema} ${ancho}: un h1, campos con etiqueta, sin desborde, consola limpia`,
          JSON.stringify({ ...revision, errores }));
        await nav.close();
      }
    }
  }
}

// ---------- Contraste AA medido contra lo que de verdad hay detrás de cada texto ----------
const lineal = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminancia = ([r, g, b]) => 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
const razon = (a, b) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mezcla = (frente, fondo, a) => frente.map((v, i) => v * a + fondo[i] * (1 - a));

async function contraste() {
  console.log("\n— Contraste AA por texto");
  const informe = {};
  for (const tema of TEMAS) {
    for (const ancho of ANCHOS) {
      const fallas = [];
      let medidos = 0;
      let minimo = Infinity;
      for (const pantalla of PANTALLAS()) {
        renovarSesiones();
        const { nav, p } = await abrir(pantalla.quien, { tema, ancho });
        await ir(p, pantalla.ruta);
        await p.waitForFunction(() => ["quieto", "lento", "sin-motor"].includes(document.querySelector(".escena-fondo canvas")?.dataset.estado ?? ""), null, { timeout: 20000 }).catch(() => {});
        await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await p.waitForTimeout(300);
        const textos = await p.evaluate(() => {
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
            const rango = document.createRange();
            rango.selectNodeContents(nodo);
            const r = rango.getBoundingClientRect();
            if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
            let recortado = false;
            for (let a = el; a && !recortado; a = a.parentElement) {
              const caja = a.getBoundingClientRect();
              recortado = (caja.width < 2 || caja.height < 2) && getComputedStyle(a).overflow !== "visible";
            }
            if (recortado) continue;
            let opacidad = 1;
            for (let a = el; a; a = a.parentElement) opacidad *= Number(getComputedStyle(a).opacity);
            const n = estilo.color.match(/[\d.]+/g).map(Number);
            const color = estilo.color.startsWith("color(") ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : [n[0], n[1], n[2], n[3] ?? 1];
            salida.push({ texto: nodo.textContent.trim().slice(0, 40), color, opacidad, tamano: parseFloat(estilo.fontSize), peso: Number(estilo.fontWeight), caja: { x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.width, h: r.height } });
          }
          return salida;
        });
        const oculto = await p.addStyleTag({ content: "html body *, html body *::before, html body *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } svg text { fill: transparent !important; }" });
        await p.waitForTimeout(200);
        const png = PNG.sync.read(await p.screenshot());
        await oculto.evaluate((nodo) => nodo.remove());
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
              const c = razon(mezcla(t.color.slice(0, 3), fondo, alfa), fondo);
              if (c < peor) {
                peor = c;
                fondoPeor = fondo;
              }
            }
          }
          const umbral = t.tamano >= 24 || (t.tamano >= 18.66 && t.peso >= 600) ? 3 : 4.5;
          medidos += 1;
          minimo = Math.min(minimo, peor);
          if (peor < umbral) fallas.push({ pantalla: pantalla.clave, texto: t.texto, color: hex(t.color), fondo: hex(fondoPeor), contraste: Number(peor.toFixed(2)), umbral });
        }
        await nav.close();
      }
      informe[`${tema}-${ancho}`] = { medidos, minimo: Number(minimo.toFixed(2)), fallas };
      exigir(fallas.length === 0, `contraste ${tema} ${ancho}: ${medidos} textos, mínimo ${minimo.toFixed(2)}`, fallas.slice(0, 8).map((f) => `${f.contraste}<${f.umbral} ${f.pantalla} «${f.texto}» ${f.color} sobre ${f.fondo}`).join(" | "));
    }
  }
  mkdirSync(`${DIR}/datos`, { recursive: true });
  writeFileSync(`${DIR}/datos/contraste.json`, JSON.stringify(informe, null, 2));
}

// ---------- Regresiones de la revisión del PR: lo que cambió en pantalla (corre después de los flujos) ----------
const PAGO_UNO = "88888888-8888-4888-8888-888888888881";
async function regresiones() {
  console.log("\n— Regresiones: pago que regresa, doble envío en dos pestañas, aviso de tamaño y lo que ve cada rol");
  prefijo = "r";
  numero = 0;
  renovarSesiones();

  // H12: la suspensión del flujo 9 regresó a «por autorizar» el pago que Rosa había autorizado; tras reactivar se vuelve a autorizar.
  exigir(sql(`select estado from supplier_payment_requests where id = '${PAGO_UNO}'`) === "por_autorizar", "H12. el pago que estaba listo para pagar regresó a «por autorizar» al suspender a Taller (flujo 9)");
  exigir(
    sql(`select count(*) || ' · ' || max(motivo) from audit_log where accion = 'regresar_pago_proveedor' and identificador = '${PAGO_UNO}' and actor_tipo = 'sistema'`)
      === "1 · La empresa quedó suspendida. La autorización anterior se retiró.",
    "H12. un solo evento del sistema, con el motivo",
  );
  const rosa = await abrir("rosa");
  await ir(rosa.p, `/c/${TALLER}/consola/proveedores?pago=${PAGO_UNO}`);
  exigir(await rosa.p.getByText("La empresa quedó suspendida. La autorización anterior se retiró.").first().isVisible(), "H12. el historial del pago dice por qué regresó");
  exigir(await rosa.p.locator(".detalle-cabeza").getByText("Por autorizar", { exact: true }).isVisible(), "H12. la cabeza del pago dice «Por autorizar»");
  await foto(rosa.p, "h12-pago-regresa-por-autorizar", false);
  const autorizaciones = () => cuenta(`audit_log where accion = 'autorizar_pago_proveedor' and identificador = '${PAGO_UNO}'`);
  const antes = autorizaciones();
  await rosa.p.getByRole("button", { name: "Autorizar para pagar" }).dblclick();
  await rosa.p.locator(".detalle-cabeza").getByText("Listo para pagar", { exact: true }).waitFor({ timeout: 20000 });
  exigir(
    sql(`select estado from supplier_payment_requests where id = '${PAGO_UNO}'`) === "listo_para_pagar" && autorizaciones() === antes + 1,
    "H12. con Taller reactivada, doble clic en «Autorizar para pagar» = una autorización nueva",
  );
  await foto(rosa.p, "h12-pago-autorizado-de-nuevo", false);
  await rosa.nav.close();

  // F4: dos pestañas abren versión del expediente al mismo tiempo: una versión, y la otra pestaña dice por qué.
  const rutaEbano = `/operacion/clientes/${ctxEbano.id}/expediente`;
  const versiones = () => cuenta(`kyb_versiones where company_id = '${ctxEbano.id}'`);
  const antesVersiones = versiones();
  const omar = await abrir("omar");
  const otra = await omar.p.context().newPage();
  await Promise.all([ir(omar.p, rutaEbano), ir(otra, rutaEbano)]);
  const [primera, segunda] = await Promise.all([omar.p, otra].map(async (pagina) => {
    await pagina.getByRole("button", { name: /^Abrir versión/ }).click();
    return esperarAviso(pagina);
  }));
  exigir(
    [primera, segunda].sort().join(" ") === "expediente_con_borrador expediente_version_creada" && versiones() === antesVersiones + 1,
    "F4. dos pestañas a la vez: una versión nueva; la otra pestaña dice «Ya hay un borrador abierto», no «base no disponible»",
    `${primera}, ${segunda}`,
  );
  const tarde = primera === "expediente_con_borrador" ? omar.p : otra;
  exigir((await aviso(tarde)).includes("Ya hay un borrador abierto"), "F4. el aviso de la pestaña que llegó tarde", await aviso(tarde));
  await foto(tarde, "f4-doble-envio-dos-pestanas");
  await otra.close();

  // F1: un PDF de 4.6 MB no sale del navegador; el aviso queda ligado al campo y no hay fila nueva.
  const documentos = () => cuenta(`kyb_documentos where company_id = '${ctxEbano.id}'`);
  const antesDocumentos = documentos();
  await ir(omar.p, rutaEbano);
  const pesado = Buffer.concat([PDF("pesado"), Buffer.alloc(4_600_000 - PDF("pesado").length)]);
  await omar.p.locator("#doc-tipo").selectOption("acta_constitutiva");
  await campo(omar.p, "#doc-detalle", "Folio mercantil 4321");
  await omar.p.locator("#doc-archivo").setInputFiles({ name: "acta-escaneada.pdf", mimeType: "application/pdf", buffer: pesado });
  const avisoDocumento = omar.p.locator("#doc-archivo-error");
  exigir(
    (await avisoDocumento.innerText()) === "El archivo pasa de 4 MB. Sube uno más ligero."
      && (await omar.p.locator("#doc-archivo").getAttribute("aria-describedby")) === "doc-archivo-error",
    "F1. al elegir el PDF de 4.6 MB aparece el aviso, ligado al campo, antes de enviar",
  );
  await omar.p.getByRole("button", { name: "Guardar documento" }).click();
  await omar.p.waitForTimeout(1500);
  exigir(new URL(omar.p.url()).searchParams.get("aviso") === null && documentos() === antesDocumentos, "F1. clic en «Guardar documento»: no sale la petición y hay 0 filas nuevas");
  // Captura de la ventana en el campo: la página completa repetiría la barra lateral fija a media altura.
  await omar.p.locator("#doc-archivo").evaluate((nodo) => nodo.scrollIntoView({ block: "center" }));
  await foto(omar.p, "f1-documento-pasa-del-tope", false);

  // F8: Originación ve «En revisión de Cumplimiento», sin folio, plazo, nombre en la lista ni motivos.
  const folio = "UIF-24H-2026-000123";
  const motivoCumplimiento = "RFC y nombre idénticos a la persona de la lista de la UIF.";
  exigir(await omar.p.getByText("En revisión de Cumplimiento", { exact: true }).isVisible() && await omar.p.getByText("El detalle lo ven Cumplimiento y Auditoría.").isVisible(), "F8. Originación ve en el expediente «En revisión de Cumplimiento»");
  exigir(!(await omar.p.content()).includes(folio) && !(await omar.p.content()).includes(motivoCumplimiento), "F8. Originación no ve el folio ni el motivo de Cumplimiento");
  await omar.p.getByText("El detalle lo ven Cumplimiento y Auditoría.").evaluate((nodo) => nodo.scrollIntoView({ block: "center" }));
  await foto(omar.p, "f8-originacion-ve-en-revision", false);
  await ir(omar.p, `/operacion/clientes/${ctxEbano.id}`);
  exigir(
    await omar.p.getByText("en revisión de Cumplimiento").first().isVisible()
      && !(await omar.p.content()).includes("Coincidencia con la Lista de Personas Bloqueadas"),
    "F8. en la ficha, Originación ve la suspensión «en revisión de Cumplimiento», sin el motivo",
  );
  await foto(omar.p, "f8-ficha-originacion-sin-motivo");
  await omar.nav.close();
  const celia = await abrir("celia");
  await ir(celia.p, rutaEbano);
  exigir((await celia.p.content()).includes(folio), "F8. Cumplimiento ve el detalle del caso con su folio");
  await foto(celia.p, "f8-cumplimiento-ve-el-detalle");
  await celia.nav.close();

  // F8: en la bitácora, Administración ve que pasó, no por qué; Auditoría ve el motivo.
  const motivoHector = "La persona de la lista tiene otra fecha de nacimiento";
  const ofelia = await abrir("ofelia");
  await ir(ofelia.p, "/operacion/bitacora");
  exigir(!(await ofelia.p.content()).includes(motivoHector) && !(await ofelia.p.content()).includes(motivoCumplimiento), "F8. Administración no lee en la bitácora los motivos de la lista");
  await foto(ofelia.p, "f8-bitacora-administracion-sin-motivo", false);
  await ofelia.nav.close();
  const aurelio = await abrir("aurelio");
  await ir(aurelio.p, "/operacion/bitacora");
  exigir((await aurelio.p.content()).includes(motivoHector), "F8. Auditoría sí lee el motivo de Cumplimiento");
  await foto(aurelio.p, "f8-bitacora-auditoria-con-motivo", false);

  // F2: la descarga del expediente llega con su política aislada (sandbox) en la aplicación real.
  await ir(aurelio.p, rutaEbano);
  const href = await aurelio.p.locator('a[href*="/expediente/documento/"]').first().getAttribute("href");
  const descargas = () => cuenta(`audit_log where accion = 'expediente_documento_descargado' and actor_id = '${E.IDS.aurelio}'`);
  const antesDescargas = descargas();
  const respuesta = await aurelio.p.request.get(`${BASE}${href}`);
  exigir(
    respuesta.status() === 200 && respuesta.headers()["content-security-policy"] === "sandbox; default-src 'none'; frame-ancestors 'none'"
      && descargas() === antesDescargas + 1,
    "F2. la descarga del expediente llega con «sandbox; default-src 'none'» y deja su evento",
    respuesta.headers()["content-security-policy"],
  );
  await aurelio.nav.close();

  // F1: la lista de más de 4 MB tampoco sale del navegador.
  const cargas = () => cuenta("lpb_cargas");
  const antesCargas = cargas();
  const celiaLista = await abrir("celia");
  await ir(celiaLista.p, "/operacion/lpb");
  const renglon = "Persona De Relleno Sin Relacion,,,fisica,2026-11-02\n";
  const listaPesada = Buffer.from(`nombre,rfc,curp,tipo,fecha\n${renglon.repeat(Math.ceil(4_600_000 / renglon.length))}`);
  await celiaLista.p.locator("#archivo").setInputFiles({ name: "lpb-pesada.csv", mimeType: "text/csv", buffer: listaPesada });
  exigir((await celiaLista.p.locator("#archivo-error").innerText()).includes("4 MB"), "F1. al elegir la lista de 4.6 MB aparece el aviso ligado al campo");
  await celiaLista.p.getByRole("button", { name: "Cargar y cotejar" }).click();
  await celiaLista.p.waitForTimeout(1500);
  exigir(new URL(celiaLista.p.url()).searchParams.get("aviso") === null && cargas() === antesCargas, "F1. clic en «Cargar y cotejar»: no sale la petición y hay 0 cargas nuevas");
  await foto(celiaLista.p, "f1-lista-pasa-del-tope");
  await celiaLista.nav.close();

  await terceraRonda(rutaEbano);
}

// ---------- Tercera revisión del PR (corre al final de las regresiones) ----------
const PISTA = "Originación y Aprobación leen este motivo: no menciones la Lista ni el reporte.";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fraseFecha = (iso) => {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
};
const enVista = (localizador) => localizador.evaluate((nodo) => nodo.scrollIntoView({ block: "center" }));

/** N7 y N8: los comandos de la dueña exigen el correo de quien los corre y el arranque no se repite (con un solo operador). */
function comandosDeLaDuena() {
  const correr = (...args) => {
    const salida = spawnSync("./node_modules/.bin/tsx", ["scripts/plataforma.ts", ...args], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "", DATABASE_URL_UNPOOLED: DUENO, OPERADORES_PLATAFORMA: "segunda@lever.test" },
    });
    return { estado: salida.status, texto: `${salida.stdout}${salida.stderr}`.trim() };
  };
  const sinQuien = correr("personal:rol", "--correo", "ofelia@lever.test", "--rol", "originacion", "--motivo", "Prueba sin el correo de quien corre");
  exigir(sinQuien.estado === 1 && sinQuien.texto.includes("Falta --quien-corre"), "N8. personal:rol sin --quien-corre no hace nada", sinQuien.texto);
  const otraVez = correr("personal:migrar-variable", "--quien-corre", "evidencia@lever.test");
  exigir(
    otraVez.estado === 1 && otraVez.texto.includes("ya tiene Administración del personal") && cuenta("users where correo = 'segunda@lever.test'") === 0,
    "N7. personal:migrar-variable con Administración activa no invita a nadie",
    otraVez.texto,
  );
  exigir(
    sql(`select cambio ->> 'corrido_por' from audit_log where accion = 'rol_personal_asignado' and origen = 'comando' order by ocurrido_en limit 1`) === "evidencia@lever.test",
    "N8. el rol que dio el comando queda en la bitácora con el correo de quien lo corrió (corrido_por) además de la conexión",
  );
}

async function terceraRonda(rutaEbano) {
  console.log("\n— Tercera revisión: avisos sin la lista, pistas de Cumplimiento, socio extranjero, bitácora, contrato y 69-B por operador");
  execFileSync("./node_modules/.bin/tsx", ["scripts/evidencia/ola-r-alta/preparar.ts", "ronda3"], { stdio: "inherit", env: process.env });
  renovarSesiones();
  // Antes de que H2 siembre un segundo operador: con dos, el comando ni siquiera arranca (operador_ambiguo).
  comandosDeLaDuena();
  const brisa = companyIdDe("BRR180303CD6");
  const cedro = companyIdDe("CER170404CD5");

  // S5: Celia mete a Brisa (en alta, activación pedida) en una carga nueva de la lista, por pantalla.
  const celia = await abrir("celia");
  await ir(celia.p, "/operacion/lpb");
  await celia.p.locator("#archivo").setInputFiles({
    name: "lpb-uif-2026-11-08.csv", mimeType: "text/csv", buffer: Buffer.from(`${LPB_2}\nBrisa Regresión SA de CV,BRR180303CD6,,moral,2026-11-08`),
  });
  await enviar(celia.p, celia.p.getByRole("button", { name: "Cargar y cotejar" }), "lpb_cargada");
  exigir(cuenta(`lpb_coincidencias where company_id = '${brisa}' and estado = 'pendiente' and sujeto_tipo = 'empresa'`) === 1, "S5. la carga deja un caso abierto de Brisa Regresión, que sigue en alta");
  // S11: la pista bajo «Motivo» la ve Cumplimiento en el dictamen (Cedro) y en la solicitud de reactivación (Ébano).
  await ir(celia.p, `/operacion/clientes/${cedro}/expediente`);
  const pistaDictamen = celia.p.locator("#dictamen-motivo-pista");
  exigir(
    (await pistaDictamen.innerText()) === PISTA && (await celia.p.locator("#dictamen-motivo").getAttribute("aria-describedby")) === "dictamen-motivo-pista",
    "S11. bajo «Motivo» del dictamen, Cumplimiento lee la pista, ligada al campo",
  );
  await enVista(pistaDictamen);
  await foto(celia.p, "s11-pista-dictamen-cumplimiento", false);
  await ir(celia.p, `/operacion/clientes/${ctxEbano.id}`);
  const pistaReactivacion = celia.p.locator("#motivo-suspension-pista");
  exigir((await pistaReactivacion.innerText()) === PISTA, "S11. bajo «Motivo» de la reactivación, Cumplimiento lee la pista");
  await enVista(pistaReactivacion);
  await foto(celia.p, "s11-pista-reactivacion-cumplimiento", false);
  await celia.nav.close();

  // S5: Aprobación intenta activar a Brisa: la base no deja y el aviso no nombra la lista.
  const ana = await abrir("ana");
  const codigoBrisa = await aprobarDecision(ana.p, "Brisa Regresión");
  const avisoAna = await aviso(ana.p);
  exigir(
    codigoBrisa === "activacion_con_coincidencia_lpb"
      && avisoAna.includes("Cumplimiento tiene un caso abierto de esta empresa: no se puede activar hasta que lo resuelva.")
      && !/lista|bloquead/i.test(avisoAna),
    "S5. Aprobación ve «Cumplimiento tiene un caso abierto…», sin «Lista» ni «bloqueada»",
    avisoAna,
  );
  exigir(sql(`select estado from companies where id = '${brisa}'`) === "en_alta", "S5. Brisa Regresión sigue en alta");
  await foto(ana.p, "s5-aprobacion-aviso-sin-la-lista", false);
  await ana.nav.close();

  // S5 y S11: Originación pide reactivar a Ébano: aviso sin la lista; y no ve la pista de Cumplimiento.
  const omar = await abrir("omar");
  await ir(omar.p, `/operacion/clientes/${ctxEbano.id}`);
  exigir((await omar.p.locator("#motivo-suspension-pista").count()) === 0, "S11. Originación no ve la pista de Cumplimiento");
  await omar.p.locator("#motivo-suspension").fill("La empresa pidió revisar su caso.");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Pedir reactivación" }), "reactivacion_con_coincidencia_lpb");
  const avisoOmar = await aviso(omar.p);
  exigir(
    avisoOmar.includes("Cumplimiento tiene un caso abierto de esta empresa: no se puede reactivar hasta que lo resuelva.") && !/lista|bloquead/i.test(avisoOmar),
    "S5. Originación ve «Cumplimiento tiene un caso abierto…», sin «Lista» ni «bloqueada»",
    avisoOmar,
  );
  exigir(cuenta(`company_suspensions where company_id = '${ctxEbano.id}' and tipo = 'reactivacion' and estado = 'pendiente'`) === 0, "S5. no queda solicitud de reactivación");
  await foto(omar.p, "s5-originacion-aviso-sin-la-lista", false);

  // N2: socio extranjero sin CURP en el borrador de Ébano (abierto en F4).
  await ir(omar.p, rutaEbano);
  await omar.p.locator("#acc-nacionalidad").selectOption("extranjera");
  exigir(
    (await omar.p.locator("#acc-curp").count()) === 0 && await omar.p.locator("#acc-pais").isVisible()
      && await omar.p.locator("#acc-documento").isVisible() && await omar.p.locator("#acc-nacimiento").isVisible(),
    "N2. con «Extranjera» el formulario pide país, pasaporte o identificación y fecha de nacimiento, y no CURP",
  );
  const socio = async (documento) => {
    await omar.p.locator("#acc-nacionalidad").selectOption("extranjera");
    await omar.p.locator("#acc-pais").selectOption("US");
    await campo(omar.p, "#acc-nombre", "John Smith Taylor");
    if (documento) await campo(omar.p, "#acc-documento", documento);
    await omar.p.locator("#acc-nacimiento").fill("1980-05-01");
    await campo(omar.p, "#acc-capital", "10");
    await campo(omar.p, "#acc-votos", "10");
  };
  await socio(null);
  await enVista(omar.p.locator("#acc-pais"));
  await foto(omar.p, "n2-formulario-socio-extranjero", false);
  // Sin documento el navegador no envía: con país, el documento es obligatorio (y el servidor y la base lo exigen).
  await omar.p.evaluate(() => history.replaceState(history.state, "", location.pathname + location.hash));
  await omar.p.getByRole("button", { name: "Agregar accionista" }).click();
  await omar.p.waitForTimeout(800);
  exigir(
    new URL(omar.p.url()).searchParams.get("aviso") === null && await omar.p.locator("#acc-documento").evaluate((nodo) => nodo.validity.valueMissing),
    "N2. clic en «Agregar accionista» sin documento: el navegador no envía, el campo es obligatorio",
  );
  await foto(omar.p, "n2-documento-obligatorio", false);
  await socio("x12-345 678");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Agregar accionista" }), "expediente_accionista_agregado");
  const fila = omar.p.locator("li", { hasText: "John Smith Taylor" });
  exigir(
    (await fila.innerText()).includes("Estados Unidos · identificación X12345678 · nació el")
      && sql(`select pais || ' ' || documento_extranjero || ' ' || fecha_nacimiento from kyb_accionistas a join kyb_versiones v on v.id = a.version_id
              where v.company_id = '${ctxEbano.id}' and v.estado = 'borrador' and a.retirado_en is null and a.curp is null`) === "US X12345678 1980-05-01",
    "N2. el socio extranjero queda en el borrador con su país, su documento normalizado y su fecha de nacimiento",
  );
  await enVista(fila);
  await foto(omar.p, "n2-socio-extranjero-en-el-borrador", false);
  await omar.nav.close();

  // S6: Administración no lee en la bitácora los eventos de la lista de una empresa; la carga sí. Auditoría los lee.
  const ofelia = await abrir("ofelia");
  await ir(ofelia.p, "/operacion/bitacora");
  const deOfelia = await ofelia.p.locator("main").innerText();
  exigir(
    !deOfelia.includes("El sistema detectó una coincidencia") && !deOfelia.includes("Resolvió una coincidencia")
      && !deOfelia.includes("El sistema suspendió la empresa por la lista") && deOfelia.includes("Cargó la Lista de Personas Bloqueadas"),
    "S6. la bitácora de Administración no trae coincidencias, resoluciones ni suspensiones por la lista; la carga, sí",
  );
  await foto(ofelia.p, "s6-bitacora-administracion-sin-eventos-de-la-lista", false);
  await ofelia.nav.close();
  const aurelio = await abrir("aurelio");
  await ir(aurelio.p, "/operacion/bitacora");
  exigir((await aurelio.p.locator("main").innerText()).includes("El sistema detectó una coincidencia"), "S6. Auditoría sí lee las coincidencias detectadas");
  await foto(aurelio.p, "s6-bitacora-auditoria-con-eventos-de-la-lista", false);
  await aurelio.nav.close();

  // S7: «Agregar contrato» no envía un PDF de 4.6 MB; el aviso queda ligado al campo.
  const gil = await abrir("gil");
  const proveedor = "44444444-4444-4444-8444-444444444441";
  await ir(gil.p, `/c/${TALLER}/consola/proveedores?vista=proveedores&proveedor=${proveedor}`);
  const dialogo = gil.p.getByRole("dialog");
  await dialogo.getByText("Agregar contrato", { exact: true }).click();
  let posts = 0;
  gil.p.on("request", (peticion) => {
    if (peticion.method() === "POST") posts += 1;
  });
  const documentos = () => cuenta(`documents where company_id = '${TALLER}'`);
  const antesDocumentos = documentos();
  const contrato = gil.p.locator(`#contrato-nuevo-${proveedor}`);
  await contrato.setInputFiles({ name: "contrato-firmado.pdf", mimeType: "application/pdf", buffer: Buffer.concat([PDF("contrato"), Buffer.alloc(4_600_000)]) });
  await dialogo.getByRole("button", { name: "Guardar el contrato" }).click();
  await gil.p.waitForTimeout(1500);
  exigir(
    (await gil.p.locator(`#contrato-nuevo-${proveedor}-error`).innerText()) === "El contrato debe ser un PDF de hasta 4 MB."
      && (await contrato.getAttribute("aria-describedby")) === `contrato-nuevo-${proveedor}-error` && posts === 0 && documentos() === antesDocumentos,
    "S7. clic en «Guardar el contrato» con 4.6 MB: aviso ligado al campo, 0 envíos y 0 documentos nuevos",
  );
  await enVista(contrato);
  await foto(gil.p, "s7-contrato-pasa-del-tope", false);

  // H2: otro operador carga una copia del 69-B más reciente con un RFC en definitivo (la siembra la dueña:
  // sin red no hay SAT). El portal de Taller consulta la copia de su operador.
  const otro = "e0000000-0000-4000-8000-0000000000e1";
  const copiaAjena = "e0000000-0000-4000-8000-0000000000e2";
  sql(`begin;
    insert into operators (id, nombre) values ('${otro}', 'Operador Ajeno');
    insert into lista_69b_snapshots (id, operator_id, fecha_archivo, cargado_en) values ('${copiaAjena}', '${otro}', current_date, now());
    insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador)
      values ('${otro}', 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', '${copiaAjena}');
    insert into lista_69b_rows (snapshot_id, rfc, situacion) values ('${copiaAjena}', 'CSR010101AB1', 'Definitivo');
    commit;`);
  const propia = sql(`select fecha_archivo::text from lista_69b_snapshots where operator_id <> '${otro}' order by cargado_en desc, id desc limit 1`);
  await ir(gil.p, `/c/${TALLER}/consola/lista-69b?rfc=CSR010101AB1`);
  const deGil = await gil.p.locator("main").innerText();
  exigir(
    deGil.includes("No aparece en la lista 69-B.") && deGil.includes(fraseFecha(propia)),
    "H2. el portal consulta la copia de su operador: el RFC en definitivo de otro operador no aparece y la fecha es la de su copia",
    `${fraseFecha(propia)}`,
  );
  await foto(gil.p, "h2-portal-consulta-la-copia-de-su-operador", false);
  await gil.nav.close();

  await cuartaRonda(rutaEbano);
}

// ---------- Cuarta revisión del PR (corre al final de las regresiones) ----------
async function cuartaRonda(rutaEbano) {
  console.log("\n— Cuarta revisión: socio extranjero física y moral, misma persona, grado de riesgo por rol, formulario reusado, pistas y carga");
  renovarSesiones();
  const brisa = companyIdDe("BRR180303CD6");
  const cedro = companyIdDe("CER170404CD5");
  const omar = await abrir("omar");
  await ir(omar.p, rutaEbano);
  const socio = async ({ tipo, nombre, documento, fecha = "", capital = "5" }) => {
    await omar.p.locator("#acc-tipo").selectOption(tipo);
    await omar.p.locator("#acc-nacionalidad").selectOption("extranjera");
    await campo(omar.p, "#acc-nombre", nombre);
    await omar.p.locator("#acc-pais").selectOption("US");
    await campo(omar.p, "#acc-documento", documento);
    if (fecha) await omar.p.locator("#acc-nacimiento").fill(fecha);
    await campo(omar.p, "#acc-capital", capital);
    await campo(omar.p, "#acc-votos", capital);
  };
  const documentoLigado = async () => [
    await omar.p.locator("#acc-nacionalidad").inputValue(),
    await omar.p.locator("#acc-documento").getAttribute("aria-invalid"),
    await omar.p.locator("#acc-documento").getAttribute("aria-describedby"),
  ].join("|");

  // N11: un documento que no es documento se rechaza y el formulario vuelve en «Extranjera», con el campo
  // marcado, ligado a su pista y al aviso, y el texto de ese error.
  await socio({ tipo: "fisica", nombre: "Hans Müller Weber", documento: "A1", fecha: "1975-03-03" });
  const textoN11 = await rechazarSocio(omar.p);
  exigir(
    (await documentoLigado()) === "extranjera|true|acc-documento-pista aviso-accionista" && (await omar.p.locator("#acc-tipo").inputValue()) === "fisica"
      && textoN11.includes("de 4 a 20 letras y números"),
    "N11. tras el rechazo de la persona física extranjera, el formulario vuelve en «Extranjera» con el documento marcado y su texto",
    await documentoLigado(),
  );
  await enVista(omar.p.locator("#acc-documento"));
  await foto(omar.p, "n11-rechazo-socio-extranjero-fisica", false);
  await socio({ tipo: "moral", nombre: "Delaware Holdings LLC", documento: "A1" });
  await rechazarSocio(omar.p);
  exigir(
    (await documentoLigado()) === "extranjera|true|acc-documento-pista aviso-accionista" && (await omar.p.locator("#acc-tipo").inputValue()) === "moral"
      && (await omar.p.locator('label[for="acc-documento"]').innerText()) === "Número de identificación fiscal o de registro en su país",
    "N11. tras el rechazo de la moral extranjera, vuelve como persona moral, en «Extranjera» y con el registro marcado",
    await documentoLigado(),
  );
  await enVista(omar.p.locator("#acc-documento"));
  await foto(omar.p, "n11-rechazo-socio-extranjero-moral", false);

  // N6: la moral extranjera entra sin RFC, con su país y su registro.
  await socio({ tipo: "moral", nombre: "Delaware Holdings LLC", documento: "12-3456789" });
  exigir((await omar.p.locator('label[for="acc-rfc"]').innerText()) === "RFC en México (si tiene)", "N6. con «Extranjera» el RFC es opcional");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Agregar accionista" }), "expediente_accionista_agregado");
  const llc = omar.p.locator("li", { hasText: "Delaware Holdings LLC" });
  exigir(
    (await llc.innerText()).includes("Estados Unidos · registro 123456789")
      && sql(`select coalesce(a.rfc, 'sin RFC') || ' ' || a.pais || ' ' || a.documento_extranjero from kyb_accionistas a join kyb_versiones v on v.id = a.version_id
              where v.company_id = '${ctxEbano.id}' and v.estado = 'borrador' and a.retirado_en is null and a.tipo_persona = 'moral' and a.pais is not null`) === "sin RFC US 123456789",
    "N6. Delaware Holdings LLC queda en el borrador sin RFC, con su país y su registro normalizado",
  );
  await enVista(llc);
  await foto(omar.p, "n6-moral-extranjera-en-el-borrador", false);

  // N2 (e): el mismo John Smith con otro documento y la misma fecha: la base no deja enviar la versión.
  await socio({ tipo: "fisica", nombre: "SMITH TAYLOR, John", documento: "D98765432", fecha: "1980-05-01" });
  await enviar(omar.p, omar.p.getByRole("button", { name: "Agregar accionista" }), "expediente_accionista_agregado");
  await enviar(omar.p, omar.p.getByRole("button", { name: /^Enviar versión/ }), "expediente_misma_persona_dos_identificadores");
  exigir(
    (await aviso(omar.p)).includes("captúralo con el mismo identificador en cada lugar donde aparece")
      && sql(`select estado from kyb_versiones where company_id = '${ctxEbano.id}' order by numero desc limit 1`) === "borrador",
    "N2. la misma persona con dos documentos no se envía; el aviso dice qué corregir y el borrador sigue abierto",
    await aviso(omar.p),
  );
  await enVista(omar.p.locator("#aviso-operacion"));
  await foto(omar.p, "n2-misma-persona-dos-identificadores", false);

  // N10: el mismo formulario de «Guardar documento» con otro archivo no se da por guardado; con el mismo, sí (una vez).
  const formularioDocumento = omar.p.locator("form", { has: omar.p.locator("#doc-tipo") }).locator('input[name="formId"]');
  const reusado = await formularioDocumento.inputValue();
  const documentosEbano = () => cuenta(`kyb_version_documentos d join kyb_versiones v on v.id = d.version_id where v.company_id = '${ctxEbano.id}' and v.estado = 'borrador'`);
  const subir = async (titulo) => {
    await omar.p.locator("#doc-tipo").selectOption("estructura_corporativa");
    await omar.p.locator("#doc-archivo").setInputFiles({ name: `${titulo}.pdf`, mimeType: "application/pdf", buffer: PDF(titulo) });
  };
  await subir("estructura-a");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Guardar documento" }), "expediente_documento_cargado");
  const tras = documentosEbano();
  // Una segunda pestaña con el mismo formulario: el formId que ya usó el primer envío.
  await formularioDocumento.evaluate((nodo, valor) => { nodo.value = valor; }, reusado);
  await subir("estructura-b");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Guardar documento" }), "formulario_invalido");
  exigir(documentosEbano() === tras && (await aviso(omar.p)).includes("El formulario caducó"), "N10. mismo formulario con otro archivo: «El formulario caducó» y ningún documento nuevo");
  await enVista(omar.p.locator("#aviso-operacion"));
  await foto(omar.p, "n10-mismo-formulario-otro-archivo", false);
  await formularioDocumento.evaluate((nodo, valor) => { nodo.value = valor; }, reusado);
  await subir("estructura-a");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Guardar documento" }), "expediente_documento_cargado");
  exigir(documentosEbano() === tras, "N10. mismo formulario con el mismo archivo: se da por guardado sin un documento de más");
  await enVista(omar.p.locator("#aviso-operacion"));
  await foto(omar.p, "n10-mismo-formulario-mismo-archivo", false);
  await omar.nav.close();

  // N9: Cumplimiento registra la revisión periódica de Brisa con su caso abierto; cada rol abre el expediente.
  const celia = await abrir("celia");
  await ir(celia.p, `/operacion/clientes/${brisa}/expediente`);
  await enviar(celia.p, celia.p.getByRole("button", { name: "Registrar revisión periódica" }), "riesgo_calificado");
  const vistas = {
    omar: "Originación", ana: "Aprobación", celia: "Cumplimiento", aurelio: "Auditoría", ofelia: "Administración",
  };
  for (const [quien, rol] of Object.entries(vistas)) {
    const sesion = quien === "celia" ? celia : await abrir(quien);
    await ir(sesion.p, `/operacion/clientes/${brisa}/expediente`);
    const texto = (await sesion.p.locator("main").innerText()).replace(/\s+/g, " ");
    if (quien === "ofelia") {
      exigir(texto.includes("El expediente lo consultan Originación, Aprobación, Cumplimiento y Auditoría."), "N9. Administración no abre el expediente");
    } else if (quien === "omar" || quien === "ana") {
      const riesgo = (await sesion.p.locator("section", { has: sesion.p.locator("#riesgo-titulo") }).innerText()).replace(/\s+/g, " ");
      // serv-N9 (quinta revisión): solo el grado y la fecha de revisión, sin ningún factor.
      exigir(
        riesgo.includes("Grado alto") && riesgo.includes("El desglose de la calificación lo ven Cumplimiento y Auditoría.")
          && !/lista|exacta|puntaje|punto|actividad|zona/i.test(riesgo)
          && (await sesion.p.locator("#coincidencias-titulo").innerText()) === "Revisión de Cumplimiento",
        `N9. ${rol} ve solo el grado y la fecha de revisión, sin factores ni puntaje`,
        riesgo,
      );
      await enVista(sesion.p.locator("#riesgo-titulo"));
    } else {
      const riesgo = (await sesion.p.locator("section", { has: sesion.p.locator("#riesgo-titulo") }).innerText()).replace(/\s+/g, " ");
      exigir(riesgo.includes("Coincidencias en listas exacta · 3 puntos") && riesgo.includes("Puntaje"), `N9. ${rol} ve el factor de listas con sus puntos`, riesgo);
      await enVista(sesion.p.locator("#riesgo-titulo"));
    }
    await foto(sesion.p, `n9-riesgo-${quien}`, false);
    if (quien !== "celia") await sesion.nav.close();
  }

  // N12: el dictamen sin motivo marca el campo y anuncia la pista y el aviso.
  await ir(celia.p, `/operacion/clientes/${cedro}/expediente`);
  await celia.p.locator("#dictamen-resultado").selectOption("observado");
  await enviar(celia.p, celia.p.getByRole("button", { name: "Registrar dictamen" }), "motivo_invalido");
  const motivo = celia.p.locator("#dictamen-motivo");
  exigir(
    (await motivo.getAttribute("aria-describedby")) === "dictamen-motivo-pista aviso-operacion" && (await motivo.getAttribute("aria-invalid")) === "true",
    "N12. el motivo con error anuncia la pista y el aviso",
  );
  await enVista(motivo);
  await foto(celia.p, "n12-dictamen-sin-motivo-pista-y-aviso", false);

  // N13: la carga de un renglón dice «1 renglón; 1 coincidencia nueva.».
  await ir(celia.p, "/operacion/lpb");
  await celia.p.locator("#archivo").setInputFiles({
    name: "lpb-uif-2026-11-09.csv", mimeType: "text/csv", buffer: Buffer.from("nombre,rfc,curp,tipo,fecha\nCedro Regresión SA de CV,CER170404CD5,,moral,2026-11-09"),
  });
  await enviar(celia.p, celia.p.getByRole("button", { name: "Cargar y cotejar" }), "lpb_cargada");
  exigir((await aviso(celia.p)).includes("1 renglón; 1 coincidencia nueva."), "N13. el detalle de la carga va en singular", await aviso(celia.p));
  await foto(celia.p, "n13-carga-un-renglon", false);
  await celia.nav.close();
  await quintaRonda(rutaEbano);
}

// ---------- Quinta revisión (sobre c67424a) ----------
const BASE_ARRANQUE = process.env.BASE_ARRANQUE ?? "http://localhost:3151";

/**
 * personal:migrar-variable contra la base del arranque (un operador y 0 personal, como Preview), sin
 * correo: el proveedor no está, como cuando el correo no sale. El enlace es de la persona invitada: se
 * lee de la salida para abrirlo y se omite de lo que se imprime y se guarda.
 */
function comandoDeArranque(correos, ...banderas) {
  const env = { ...process.env, DATABASE_URL: "", DATABASE_URL_UNPOOLED: E.DUENO_ARRANQUE, OPERADORES_PLATAFORMA: correos, URL_APLICACION: BASE_ARRANQUE };
  delete env.RESEND_API_KEY;
  delete env.CORREO_REMITENTE;
  const salida = spawnSync("./node_modules/.bin/tsx", ["scripts/plataforma.ts", "personal:migrar-variable", "--quien-corre", "evidencia@lever.test", ...banderas], {
    encoding: "utf8", env,
  });
  const crudo = `${salida.stdout}${salida.stderr}`.trim();
  const enlace = /https?:\/\/\S+\/invitacion\/([A-Za-z0-9_-]{43})/g;
  return {
    estado: salida.status,
    enlaces: [...crudo.matchAll(enlace)].map((m) => m[1]),
    texto: crudo.replace(enlace, "<enlace omitido>"),
    orden: `OPERADORES_PLATAFORMA=${correos} tsx scripts/plataforma.ts personal:migrar-variable --quien-corre evidencia@lever.test${banderas.length ? ` ${banderas.join(" ")}` : ""}`,
  };
}

async function quintaRonda(rutaEbano) {
  console.log("\n— Quinta revisión: grado sin desglose con y sin caso, socio extranjero tras otro rechazo, motivo corto y arranque sin personal");
  renovarSesiones();
  const brisa = companyIdDe("BRR180303CD6");
  const lumbre = E.EMPRESA_LUMBRE;

  // serv-N9: quien no ve la Lista recibe solo el grado y la fecha de revisión, con caso (Brisa) y sin caso (Lumbre).
  const vistas = { omar: "Originación", ana: "Aprobación", celia: "Cumplimiento", aurelio: "Auditoría", ofelia: "Administración" };
  for (const [empresa, cual] of [[brisa, "con-caso"], [lumbre, "sin-caso"]]) {
    for (const [quien, rol] of Object.entries(vistas)) {
      const sesion = await abrir(quien);
      await ir(sesion.p, `/operacion/clientes/${empresa}/expediente`);
      const hoja = sesion.p.locator("section", { has: sesion.p.locator("#riesgo-titulo") });
      if (quien === "ofelia") {
        const texto = (await sesion.p.locator("main").innerText()).replace(/\s+/g, " ");
        exigir(texto.includes("El expediente lo consultan Originación, Aprobación, Cumplimiento y Auditoría."), `serv-N9 (${cual}). Administración no abre el expediente`);
      } else {
        const riesgo = (await hoja.innerText()).replace(/\s+/g, " ");
        if (quien === "omar" || quien === "ana") {
          const pagina = await sesion.p.content();
          exigir(
            /Grado (bajo|medio|alto)/.test(riesgo) && /Revisar antes del|Revisión vencida/.test(riesgo)
              && riesgo.includes("El desglose de la calificación lo ven Cumplimiento y Auditoría.") && (await hoja.locator("dl").count()) === 0
              && !/lista|exacta|puntaje|punto|actividad|zona/i.test(riesgo) && !/antiguedad_meses|volumen_mensual|coincidencias\\?"|puntaje/i.test(pagina),
            `serv-N9 (${cual}). ${rol} ve solo el grado y la fecha de revisión; ni la página ni su respuesta RSC traen los factores`,
            riesgo,
          );
        } else {
          exigir(riesgo.includes("Coincidencias en listas") && riesgo.includes("Puntaje") && riesgo.includes("Calificó"), `serv-N9 (${cual}). ${rol} ve el desglose completo`, riesgo);
        }
        await enVista(sesion.p.locator("#riesgo-titulo"));
      }
      await foto(sesion.p, `sn9-riesgo-${cual}-${quien}`, false);
      await sesion.nav.close();
    }
  }

  // serv-N15: si lo rechazado es otro campo del socio extranjero (el RFC opcional o el capital), el
  // formulario también vuelve en «Extranjera», con ese campo marcado y el tipo de persona.
  const omar = await abrir("omar");
  await ir(omar.p, rutaEbano);
  const sociosEbano = () => cuenta(`kyb_accionistas a join kyb_versiones v on v.id = a.version_id where v.company_id = '${ctxEbano.id}' and v.estado = 'borrador' and a.retirado_en is null`);
  const socios = sociosEbano();
  for (const [tipo, nombre, rfc, capital, codigo, selector] of [
    ["fisica", "Greta Lind Berg", "XX123", "5", "dato_invalido_rfc", "#acc-rfc"],
    ["moral", "Nordic Holdings LLC", "", "abc", "dato_invalido_capital", "#acc-capital"],
  ]) {
    await omar.p.locator("#acc-tipo").selectOption(tipo);
    await omar.p.locator("#acc-nacionalidad").selectOption("extranjera");
    await campo(omar.p, "#acc-nombre", nombre);
    // Siempre se escribe (vacío para la moral): tras un rechazo, el formulario conserva lo capturado (serv-N15).
    await campo(omar.p, "#acc-rfc", rfc);
    await omar.p.locator("#acc-pais").selectOption("US");
    await campo(omar.p, "#acc-documento", "X12345678");
    if (tipo === "fisica") await omar.p.locator("#acc-nacimiento").fill("1975-03-03");
    await campo(omar.p, "#acc-capital", capital);
    await campo(omar.p, "#acc-votos", "5");
    await rechazarSocio(omar.p);
    const estado = [
      new URL(omar.p.url()).search === "" ? "sin-consulta" : new URL(omar.p.url()).search,
      await omar.p.locator("#acc-nacionalidad").inputValue(),
      await omar.p.locator("#acc-tipo").inputValue(),
      await omar.p.locator(selector).getAttribute("aria-invalid"),
      await omar.p.locator("#acc-documento").isVisible(),
    ].join("|");
    exigir(
      estado === `sin-consulta|extranjera|${tipo}|true|true` && sociosEbano() === socios,
      `serv-N15. rechazado ${selector === "#acc-rfc" ? "el RFC opcional" : "el capital"} de la ${tipo === "fisica" ? "física" : "moral"} extranjera (${codigo}), vuelve en «Extranjera» con ese campo marcado y sin socio de más`,
      estado,
    );
    await enVista(omar.p.locator(selector));
    await foto(omar.p, `sn15-rechazo-otro-campo-${tipo}-extranjera`, false);
  }

  // serv-N17: «Pedir suspensión» (o reactivación) con un motivo corto. El navegador no lo envía; sin
  // ese mínimo (una petición armada a mano), el servidor lo rechaza con el aviso ligado al campo.
  const operadorOmar = sql("select s.operator_id from platform_staff s join users u on u.id = s.user_id where u.correo = 'omar@lever.test'");
  const empresa = sql(`select c.id from companies c where c.operator_id = '${operadorOmar}' and c.estado in ('activa', 'suspendida')
    and not exists (select 1 from company_suspensions s where s.company_id = c.id and s.estado = 'pendiente') order by c.razon_social limit 1`);
  const solicitudes = () => cuenta(`company_suspensions where company_id = '${empresa}'`);
  const previas = solicitudes();
  await ir(omar.p, `/operacion/clientes/${empresa}`);
  const motivo = omar.p.locator("#motivo-suspension");
  const pedir = omar.p.getByRole("button", { name: /^Pedir (suspensión|reactivación)$/ });
  await motivo.pressSequentially("Revisar");
  await pedir.click();
  await omar.p.waitForTimeout(800);
  exigir(
    (await motivo.evaluate((nodo) => nodo.validity.tooShort)) && new URL(omar.p.url()).searchParams.get("aviso") === null && solicitudes() === previas
      && (await omar.p.locator('label[for="motivo-suspension"]').innerText()) === "Motivo (de 10 a 500 caracteres)",
    "serv-N17. con «Revisar» (7 caracteres) el navegador no envía la solicitud: el campo pide de 10 a 500",
  );
  await enVista(motivo);
  await foto(omar.p, "sn17-motivo-corto-en-el-navegador", false);
  await motivo.evaluate((nodo) => nodo.removeAttribute("minlength"));
  await enviar(omar.p, pedir, "motivo_corto");
  const ligado = [await motivo.getAttribute("aria-invalid"), await motivo.getAttribute("aria-describedby")].join("|");
  exigir(
    ligado.startsWith("true|") && ligado.includes("aviso-operacion") && (await aviso(omar.p)).includes("El motivo lleva al menos 10 caracteres") && solicitudes() === previas,
    "serv-N17. sin el mínimo del navegador, el servidor rechaza el motivo corto con el aviso ligado al campo y no queda solicitud",
    `${ligado} · ${await aviso(omar.p)}`,
  );
  // Página completa: el aviso arriba y el campo marcado abajo.
  await foto(omar.p, "sn17-motivo-corto-aviso-en-el-campo");
  await omar.nav.close();

  // base-N15: el arranque de un operador sin personal. La primera corrida no entrega el enlace; la
  // siguiente con los mismos correos emite uno nuevo y el anterior deja de servir.
  if (!E.DUENO_ARRANQUE) throw new Error("Falta la base del arranque: corre «preparar.ts arranque» y el segundo next start (BASE_ARRANQUE).");
  const enArranque = (consulta) => sqlEn(E.DUENO_ARRANQUE, consulta);
  const salidas = [];
  const correr = (correos, ...banderas) => {
    const corrida = comandoDeArranque(correos, ...banderas);
    salidas.push(`$ ${corrida.orden}\n${corrida.texto}\n(salida ${corrida.estado})`);
    return corrida;
  };
  exigir(enArranque("select count(*) from operators") === "1" && enArranque("select count(*) from platform_staff") === "0", "base-N15. la base del arranque tiene un operador y 0 personal, como Preview");
  const correos = "primera@lever.test,segunda@lever.test";
  const primera = correr(correos);
  exigir(
    primera.estado === 0 && primera.enlaces.length === 0 && /primera@lever\.test: invitada/.test(primera.texto) && /el correo no salió/.test(primera.texto),
    "base-N15. primera corrida: las dos quedan invitadas, el correo no sale y sin --mostrar-enlace no hay enlace",
    primera.texto,
  );
  const segunda = correr(correos, "--mostrar-enlace");
  exigir(
    segunda.estado === 0 && segunda.enlaces.length === 2 && (segunda.texto.match(/invitación nueva; el enlace anterior ya no sirve/g) ?? []).length === 2,
    "base-N15. segunda corrida con los mismos correos y --mostrar-enlace: un enlace nuevo por persona",
    segunda.texto,
  );
  exigir(
    enArranque("select count(*) filter (where revocada_en is not null) || '/' || count(*) filter (where revocada_en is null) from invitations") === "2/2"
      && enArranque("select count(*) from platform_staff where estado = 'invitado'") === "2",
    "base-N15. las invitaciones de la primera corrida quedan revocadas y el personal sigue siendo el mismo",
  );
  exigir(
    enArranque(`select count(*) from audit_log where accion = 'emitir_invitacion' and cambio ->> 'corrido_por' = 'evidencia@lever.test' and cambio ->> 'ejecutado_por' = session_user`) === "4",
    "base-N15. cada enlace (los de la primera corrida y los nuevos) queda en la bitácora con quién corrió el comando y la conexión",
  );
  const otro = correr("tercera@lever.test", "--mostrar-enlace");
  const mezcla = correr("primera@lever.test,tercera@lever.test", "--mostrar-enlace");
  exigir(
    otro.estado === 1 && mezcla.estado === 1 && [otro, mezcla].every((r) => r.texto.includes("Administración invitada con otros correos") && r.enlaces.length === 0)
      && enArranque("select count(*) from users where correo = 'tercera@lever.test'") === "0" && enArranque("select count(*) from invitations") === "4",
    "base-N15. un correo distinto, solo o junto a los mismos, se rechaza y no emite nada",
    `${otro.texto} | ${mezcla.texto}`,
  );
  const tercera = correr(correos, "--mostrar-enlace");
  exigir(tercera.estado === 0 && tercera.enlaces.length === 2, "base-N15. otra corrida con los mismos correos vuelve a emitir", tercera.texto);
  const invitada = await abrir("primera");
  await invitada.p.goto(`${BASE_ARRANQUE}/invitacion/${segunda.enlaces[0]}`, { waitUntil: "networkidle" });
  const vieja = (await invitada.p.locator("main").innerText()).replace(/\s+/g, " ");
  exigir(vieja.includes("Esta invitación ya no sirve."), "base-N15. el enlace que reemplazó la corrida siguiente ya no sirve", vieja);
  await foto(invitada.p, "sn15b-enlace-anterior-ya-no-sirve", false);
  await invitada.p.goto(`${BASE_ARRANQUE}/invitacion/${tercera.enlaces[0]}`, { waitUntil: "networkidle" });
  await invitada.p.getByLabel("Contraseña nueva").fill("clave-segura-12");
  await invitada.p.getByLabel("Repite la contraseña").fill("clave-segura-12");
  await invitada.p.getByRole("button", { name: "Aceptar la invitación" }).click();
  await invitada.p.waitForURL((url) => !url.pathname.startsWith("/invitacion/"), { timeout: 20000 });
  await listo(invitada.p);
  exigir(
    enArranque("select s.estado from platform_staff s join users u on u.id = s.user_id where u.correo = 'primera@lever.test'") === "activo",
    "base-N15. con el enlace nuevo, primera acepta y su Administración queda activa",
  );
  // Llega a registrar su segundo factor: el QR y la semilla son secretos aunque la base sea desechable, se tapan.
  await invitada.p.addStyleTag({ content: ".arco-qr { filter: blur(18px); }" });
  await invitada.p.locator(".arco-semilla").evaluate((nodo) => { nodo.textContent = "(semilla omitida en la evidencia)"; });
  await foto(invitada.p, "sn15b-acepta-con-el-enlace-nuevo", false);
  await invitada.nav.close();
  const activa = correr(correos, "--mostrar-enlace");
  exigir(
    activa.estado === 1 && activa.texto.includes("ya tiene Administración del personal activa") && enArranque("select count(*) from invitations") === "6",
    "base-N15. con Administración activa, el comando ya no invita ni reenvía",
    activa.texto,
  );
  mkdirSync(`${DIR}/datos`, { recursive: true });
  writeFileSync(`${DIR}/datos/quinta-arranque.txt`, `${salidas.join("\n\n")}\n`);
  await sextaRonda(rutaEbano);
}

// ---------- Sexta revisión (sobre 701bc25) ----------
/** 9 caracteres y 10 unidades UTF-16: el mínimo del navegador (minLength) lo deja pasar. */
const EMOJI = "Revisar 😀";
const REGISTRO_SERVIDOR = process.env.REGISTRO_SERVIDOR ?? "";

/** El emulador de Blob con del() caído («503», «sin_respuesta») o de vuelta («normal»). */
async function blobBorrado(borrado) {
  const respuesta = await fetch(`${process.env.E2E_BLOB_LOCAL_URL}/simular`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ borrado }),
  });
  exigir(respuesta.ok, `emulador de Blob: borrado «${borrado}»`);
}

async function sextaRonda(rutaEbano) {
  console.log("\n— Sexta revisión: motivo con emoji, socio extranjero que conserva lo capturado y borrado con Blob caído");
  if (!REGISTRO_SERVIDOR) throw new Error("Falta REGISTRO_SERVIDOR: la salida del next start de 4811, para leer el registro del huérfano.");
  renovarSesiones();

  // serv-N18 · suspensión: «Revisar 😀» pasa el navegador; el servidor cuenta 9 caracteres y responde
  // «motivo_corto» con el aviso en el campo (antes, el CHECK de la base lo rechazaba: «La base no respondió»).
  const omar = await abrir("omar");
  const operadorOmar = sql("select s.operator_id from platform_staff s join users u on u.id = s.user_id where u.correo = 'omar@lever.test'");
  // Una empresa activa: una suspendida con caso de la Lista pediría reactivación, que la base niega por el caso.
  const empresa = sql(`select c.id from companies c where c.operator_id = '${operadorOmar}' and c.estado = 'activa'
    and not exists (select 1 from company_suspensions s where s.company_id = c.id and s.estado = 'pendiente') order by c.razon_social limit 1`);
  const razonSocial = sql(`select razon_social from companies where id = '${empresa}'`);
  const solicitudes = () => cuenta(`company_suspensions where company_id = '${empresa}'`);
  const previas = solicitudes();
  await ir(omar.p, `/operacion/clientes/${empresa}`);
  const motivo = omar.p.locator("#motivo-suspension");
  const pedir = omar.p.getByRole("button", { name: /^Pedir (suspensión|reactivación)$/ });
  await campo(omar.p, "#motivo-suspension", EMOJI);
  exigir(!(await motivo.evaluate((nodo) => nodo.validity.tooShort)), "serv-N18. «Revisar 😀» pasa el mínimo de 10 del navegador (cuenta unidades UTF-16)");
  await enviar(omar.p, pedir, "motivo_corto");
  exigir(
    (await motivo.getAttribute("aria-invalid")) === "true" && (await aviso(omar.p)).includes("El motivo lleva al menos 10 caracteres") && solicitudes() === previas,
    "serv-N18. suspensión con «Revisar 😀»: «El motivo lleva al menos 10 caracteres» en el campo, no «La base no respondió», y no queda solicitud",
    await aviso(omar.p),
  );
  await foto(omar.p, "sn18-suspension-motivo-emoji");
  // sexta-N1: escrito en dos renglones (Enter en el textarea): entra y se guarda en uno. Antes, «La base no respondió».
  await campo(omar.p, "#motivo-suspension", "Operaciones inusuales\nen revisión 🔎");
  const pedida = await enviar(omar.p, pedir, null);
  exigir(/^(suspension|reactivacion)_solicitada$/.test(pedida) && solicitudes() === previas + 1, "serv-N18. con un motivo de 10 o más caracteres (y su emoji) la solicitud entra", pedida);
  exigir(
    sql(`select motivo from company_suspensions where company_id = '${empresa}' order by solicitada_en desc limit 1`) === "Operaciones inusuales en revisión 🔎",
    "sexta-N1. el motivo escrito con Enter entra y se guarda en un renglón",
  );
  await omar.nav.close();

  // serv-N18 · Aprobaciones: «Rechazar» con «Revisar 😀». El diálogo sigue abierto con lo escrito, el aviso
  // ligado al campo y el foco en él (antes se cerraba y el texto se perdía); corregido, rechaza.
  const ana = await abrir("ana");
  await ir(ana.p, "/operacion/aprobaciones");
  const fila = ana.p.locator("li.decision").filter({ hasText: razonSocial }).filter({ hasText: /Suspensión|Reactivación/ });
  await fila.getByRole("button", { name: "Rechazar" }).click();
  const dialogo = ana.p.getByRole("dialog", { name: "Rechazar" });
  const texto = dialogo.getByLabel("Motivo (de 10 a 500 caracteres)");
  await texto.fill(EMOJI);
  await dialogo.getByRole("button", { name: "Rechazar" }).click();
  await dialogo.locator(".operacion-aviso").waitFor({ timeout: 20000 });
  const ligado = await texto.getAttribute("aria-describedby");
  const enDialogo = [
    await dialogo.isVisible(),
    await texto.inputValue(),
    await texto.getAttribute("aria-invalid"),
    (await dialogo.locator(`[id="${ligado}"]`).innerText()).includes("El motivo lleva al menos 10 caracteres"),
    await texto.evaluate((nodo) => nodo === document.activeElement),
    new URL(ana.p.url()).searchParams.get("aviso"),
  ].join("|");
  const pendiente = () => sql(`select estado from company_suspensions where company_id = '${empresa}' order by solicitada_en desc limit 1`);
  exigir(
    enDialogo === `true|${EMOJI}|true|true|true|` && pendiente() === "pendiente",
    "serv-N18. Aprobaciones: el diálogo sigue abierto con «Revisar 😀», el aviso ligado al campo y el foco en él; la solicitud sigue pendiente",
    enDialogo,
  );
  await foto(ana.p, "sn18-aprobaciones-dialogo-motivo-emoji", false);
  // sexta-N1: la corrección también lleva Enter; se guarda en un renglón.
  await texto.fill("El cliente aclaró la operación\ncon su estado de cuenta");
  await enviar(ana.p, dialogo.getByRole("button", { name: "Rechazar" }), "decision_registrada");
  exigir(
    pendiente() === "rechazada"
      && sql(`select motivo_decision from company_suspensions where company_id = '${empresa}' order by solicitada_en desc limit 1`) === "El cliente aclaró la operación con su estado de cuenta",
    "serv-N18. corregido en el mismo diálogo, el rechazo queda con su motivo",
  );
  await foto(ana.p, "sn18-aprobaciones-rechazo-registrado", false);
  await ana.nav.close();

  // serv-N18 · dictamen y caso de la Lista (Cumplimiento): «Revisar 😀» responde «motivo_corto».
  const celia = await abrir("celia");
  const cedro = companyIdDe("CER170404CD5");
  const dictamenes = () => cuenta(`kyb_dictamenes where company_id = '${cedro}'`);
  const antes = dictamenes();
  await ir(celia.p, `/operacion/clientes/${cedro}/expediente`);
  await celia.p.locator("#dictamen-resultado").selectOption("observado");
  await campo(celia.p, "#dictamen-motivo", EMOJI);
  // Cedro también tiene un caso de la Lista abierto, con su propio «Registrar dictamen»: el del expediente es el del motivo.
  await enviar(celia.p, celia.p.locator("form", { has: celia.p.locator("#dictamen-motivo") }).getByRole("button", { name: "Registrar dictamen" }), "motivo_corto");
  exigir(
    (await celia.p.locator("#dictamen-motivo").getAttribute("aria-invalid")) === "true" && (await aviso(celia.p)).includes("El motivo lleva al menos 10 caracteres") && dictamenes() === antes,
    "serv-N18. dictamen observado con «Revisar 😀»: «motivo_corto» en el campo y ningún dictamen",
    await aviso(celia.p),
  );
  await enVista(celia.p.locator("#dictamen-titulo"));
  await foto(celia.p, "sn18-dictamen-motivo-emoji", false);
  const caso = sql(`select id from lpb_coincidencias where company_id = '${cedro}' and estado = 'pendiente' limit 1`);
  await ir(celia.p, "/operacion/lpb");
  await celia.p.locator(`[id="resolucion-${caso}"]`).selectOption("falso_positivo");
  await campo(celia.p, `[id="motivo-${caso}"]`, EMOJI);
  await enviar(celia.p, celia.p.locator("form", { has: celia.p.locator(`[id="motivo-${caso}"]`) }).getByRole("button", { name: "Registrar dictamen" }), "motivo_corto");
  exigir(
    (await aviso(celia.p)).includes("El motivo lleva al menos 10 caracteres") && sql(`select estado from lpb_coincidencias where id = '${caso}'`) === "pendiente",
    "serv-N18. caso de la Lista con «Revisar 😀»: «motivo_corto» y el caso sigue abierto",
    await aviso(celia.p),
  );
  await foto(celia.p, "sn18-caso-lpb-motivo-emoji", false);
  await celia.nav.close();

  // serv-N15: los seis rechazos de la revisión (RFC «XX», nombre en blanco y capital «abc», en física y en
  // moral extranjera) vuelven sin recargar con todo lo capturado; ningún dato del socio va en la dirección.
  const omar2 = await abrir("omar");
  await ir(omar2.p, rutaEbano);
  const sociosEbano = () => cuenta(`kyb_accionistas a join kyb_versiones v on v.id = a.version_id where v.company_id = '${ctxEbano.id}' and v.estado = 'borrador' and a.retirado_en is null`);
  const socios = sociosEbano();
  const capturado = async () => {
    const valores = {};
    for (const [clave, selector] of Object.entries({ tipo: "#acc-tipo", nacionalidad: "#acc-nacionalidad", pais: "#acc-pais", documento: "#acc-documento", nombre: "#acc-nombre", rfc: "#acc-rfc", capital: "#acc-capital", votos: "#acc-votos", pep: "#acc-pep" })) {
      valores[clave] = await omar2.p.locator(selector).inputValue();
    }
    if (valores.tipo === "fisica") valores.nacimiento = await omar2.p.locator("#acc-nacimiento").inputValue();
    valores.control = await omar2.p.locator('input[name="controlOtrosMedios"]').isChecked();
    return valores;
  };
  let ultimo = null;
  for (const tipo of ["fisica", "moral"]) {
    for (const [cual, cambio, selector] of [
      ["el RFC «XX»", { rfc: "XX" }, "#acc-rfc"],
      ["el nombre en blanco", { nombre: "   " }, "#acc-nombre"],
      ["el capital «abc»", { capital: "abc" }, "#acc-capital"],
    ]) {
      const esperado = {
        tipo, nacionalidad: "extranjera", pais: "SE", documento: "SE-884213", nombre: tipo === "fisica" ? "Ingrid Lind Berg" : "Nordic Capital AB",
        rfc: "", capital: "2.5", votos: "2.5", pep: "no", ...cambio, ...(tipo === "fisica" ? { nacimiento: "1979-04-12" } : {}), control: tipo === "moral",
      };
      await omar2.p.locator("#acc-tipo").selectOption(tipo);
      await omar2.p.locator("#acc-nacionalidad").selectOption("extranjera");
      await campo(omar2.p, "#acc-nombre", esperado.nombre);
      await campo(omar2.p, "#acc-rfc", esperado.rfc);
      await omar2.p.locator("#acc-pais").selectOption(esperado.pais);
      await campo(omar2.p, "#acc-documento", esperado.documento);
      if (tipo === "fisica") await omar2.p.locator("#acc-nacimiento").fill(esperado.nacimiento);
      await campo(omar2.p, "#acc-capital", esperado.capital);
      await campo(omar2.p, "#acc-votos", esperado.votos);
      await omar2.p.locator('input[name="controlOtrosMedios"]').setChecked(esperado.control);
      const textoAviso = await rechazarSocio(omar2.p);
      const obtenido = await capturado();
      const marca = [await omar2.p.locator(selector).getAttribute("aria-invalid"), await omar2.p.locator(selector).getAttribute("aria-describedby"), await omar2.p.locator(selector).evaluate((nodo) => nodo === document.activeElement)].join("|");
      exigir(
        JSON.stringify(obtenido) === JSON.stringify(esperado) && marca === "true|aviso-accionista|true" && new URL(omar2.p.url()).search === "" && sociosEbano() === socios,
        `serv-N15. ${cual} de la ${tipo === "fisica" ? "física" : "moral"} extranjera: vuelve con país, documento, ${tipo === "fisica" ? "fecha, " : ""}nombre y porcentajes, el campo marcado y con el foco, sin datos en la dirección`,
        `${JSON.stringify(obtenido)} · ${marca} · ${textoAviso}`,
      );
      await enVista(omar2.p.locator("#aviso-accionista"));
      await foto(omar2.p, `sn15r-${tipo}-${selector.slice(5)}-conserva-lo-capturado`, false);
      ultimo = esperado;
    }
  }
  // El último (capital «abc» de la moral) se corrige en el mismo formulario y entra; el formulario queda limpio.
  await campo(omar2.p, "#acc-capital", "2.5");
  await enviar(omar2.p, omar2.p.getByRole("button", { name: "Agregar accionista" }), "expediente_accionista_agregado");
  exigir(
    sociosEbano() === socios + 1 && sql(`select a.pais || '|' || a.documento_extranjero from kyb_accionistas a join kyb_versiones v on v.id = a.version_id where v.company_id = '${ctxEbano.id}' and v.estado = 'borrador' and a.nombre = '${ultimo.nombre}'`) === "SE|SE884213"
      && (await omar2.p.locator("#aviso-accionista").count()) === 0 && (await omar2.p.locator("#acc-nombre").inputValue()) === "",
    "serv-N15. corregido el capital en el mismo formulario, la moral extranjera entra y el formulario queda limpio",
  );
  await enVista(omar2.p.locator("#accionistas-titulo"));
  await foto(omar2.p, "sn15r-corregido-entra", false);

  // serv-N16: con Blob caído para del() (503 o sin respuesta), el envío que deja un huérfano vuelve dentro del
  // tope de 5 s y deja la clave en el registro. El huérfano se provoca con un representante que no es de la
  // versión (una petición armada a mano: la página solo ofrece los suyos): el archivo sube, la fila no entra
  // (`documento_sin_representante`) y el servidor intenta borrarlo. Con un formulario ya usado y otro archivo no
  // sirve: el servidor lo rechaza antes de subir (N10).
  const registro = () => readFileSync(REGISTRO_SERVIDOR, "utf8").split("\n").filter((renglon) => renglon.includes('"huerfano_sin_borrar"')).map((renglon) => JSON.parse(renglon.slice(renglon.indexOf("{"))));
  const huerfanos = [];
  for (const borrado of ["503", "sin_respuesta"]) {
    await ir(omar2.p, rutaEbano);
    const previos = registro().length;
    const documentosAntes = cuenta(`kyb_documentos where company_id = '${ctxEbano.id}'`);
    await blobBorrado(borrado);
    await omar2.p.locator("#doc-tipo").selectOption("identificacion_representante");
    await omar2.p.locator("#doc-representante").evaluate((select) => {
      const ajeno = document.createElement("option");
      ajeno.value = crypto.randomUUID();
      ajeno.textContent = "Representante de otra versión";
      select.append(ajeno);
      select.value = ajeno.value;
    });
    await omar2.p.locator("#doc-vigente").fill("2031-12-31");
    await omar2.p.locator("#doc-archivo").setInputFiles({ name: `ine-sexta-${borrado}.pdf`, mimeType: "application/pdf", buffer: PDF(`ine-sexta-${borrado}`) });
    const inicio = Date.now();
    await enviar(omar2.p, omar2.p.getByRole("button", { name: "Guardar documento" }), "documento_sin_representante");
    const tardo = Date.now() - inicio;
    await blobBorrado("normal");
    const nuevos = registro().slice(previos);
    exigir(
      tardo >= 4500 && tardo <= 6500 && nuevos.length === 1 && nuevos[0].causa === "tiempo_agotado" && nuevos[0].tope_ms === 5000
        && cuenta(`kyb_documentos where company_id = '${ctxEbano.id}'`) === documentosAntes,
      `serv-N16. Blob ${borrado === "503" ? "responde 503" : "no responde"} al borrar el huérfano: la página vuelve en ${(tardo / 1000).toFixed(1)} s (tope de 5 s más la página), sin documento, y la clave queda en el registro`,
      `${tardo} ms · ${JSON.stringify(nuevos)}`,
    );
    huerfanos.push({ blob: borrado, segundos_hasta_la_pagina: Number((tardo / 1000).toFixed(2)), registro: nuevos[0] });
    await enVista(omar2.p.locator("#aviso-operacion"));
    await foto(omar2.p, `sn16r-blob-${borrado}-vuelve-al-tope`, false);
  }
  writeFileSync(`${DIR}/datos/sexta-huerfanos.json`, `${JSON.stringify(huerfanos, null, 2)}\n`);

  // bar-2: un documento con «Vigente hasta» antes de «Emitido el» vuelve con el campo marcado, sin documento
  // nuevo (antes subía el archivo y el CHECK de la base respondía «La base no respondió»). Los días que no existen
  // en el calendario (bar-4) no se pueden teclear en un campo de fecha: los cubren las pruebas de la base.
  await ir(omar2.p, rutaEbano);
  const documentosEbano = () => cuenta(`kyb_documentos where company_id = '${ctxEbano.id}'`);
  const docsAntes = documentosEbano();
  await omar2.p.locator("#doc-tipo").selectOption("poder");
  await omar2.p.locator("#doc-emitido").fill("2026-10-01");
  await omar2.p.locator("#doc-vigente").fill("2026-09-30");
  await omar2.p.locator("#doc-archivo").setInputFiles({ name: "poder-sexta.pdf", mimeType: "application/pdf", buffer: PDF("poder-sexta") });
  await enviar(omar2.p, omar2.p.getByRole("button", { name: "Guardar documento" }), "dato_invalido_vigenteHasta");
  exigir(
    (await omar2.p.locator("#doc-vigente").getAttribute("aria-invalid")) === "true" && documentosEbano() === docsAntes && !(await aviso(omar2.p)).includes("La base no respondió"),
    "bar-2. «Vigente hasta» 30 sep antes de «Emitido el» 1 oct: el campo queda marcado, sin documento nuevo y sin «La base no respondió»",
    await aviso(omar2.p),
  );
  await enVista(omar2.p.locator("#doc-vigente"));
  await foto(omar2.p, "bar2-documento-vigencia-antes-de-emision", false);
  await omar2.nav.close();

  // Consola de Taller del Cierre (Gil, Administración).
  const gil = await abrir("gil");
  const resultadoFlujo = async (forma) => {
    await forma.locator(".alerta-asentado, .alerta-revisar, .error-campo").first().waitFor({ timeout: 20000 });
    await listo(gil.p);
    return (await forma.locator(".alerta-asentado").count()) > 0;
  };

  // bar-1: el RFC del cliente escrito con guion (13 caracteres, cabe en el campo) se guarda sin el guion.
  await ir(gil.p, `/c/${TALLER}/consola/cobros`);
  const cobro = gil.p.locator('form[data-formulario="cobro"]');
  // base-N21: un RFC de puros guiones es error de su campo, no «La base no respondió».
  await cobro.locator("#clienteNombre").fill("Cliente sin RFC");
  await cobro.locator("#clienteRfc").fill(" - - ");
  await cobro.locator("#concepto").fill("Asesoría sin RFC");
  await cobro.locator("#monto").fill("100.00");
  await cobro.getByRole("button", { name: "Registrar el cobro" }).click();
  const asentadoGuiones = await resultadoFlujo(cobro);
  const textoGuiones = (await cobro.innerText()).replace(/\s+/g, " ");
  exigir(
    !asentadoGuiones && textoGuiones.includes("no tiene la forma de un RFC") && (await cobro.locator("#clienteRfc").getAttribute("aria-invalid")) === "true"
      && cuenta(`expected_collections where company_id = '${TALLER}' and concepto = 'Asesoría sin RFC'`) === 0,
    "base-N21. cobro manual con el RFC « - - »: «Ese RFC no tiene la forma de un RFC» en su campo y sin cobro",
    textoGuiones.slice(0, 200),
  );
  await foto(gil.p, "baseN21-cobro-rfc-de-guiones", false);
  await ir(gil.p, `/c/${TALLER}/consola/cobros`);
  await cobro.locator("#clienteNombre").fill("Cliente con guion");
  await cobro.locator("#clienteRfc").fill("EKU900317-3C9");
  await cobro.locator("#concepto").fill("Asesoría de la sexta revisión");
  await cobro.locator("#monto").fill("1500.00");
  await cobro.getByRole("button", { name: "Registrar el cobro" }).click();
  exigir(
    (await resultadoFlujo(cobro)) && sql(`select cliente_rfc from expected_collections where company_id = '${TALLER}' and concepto = 'Asesoría de la sexta revisión'`) === "EKU9003173C9",
    "bar-1. cobro manual con el RFC «EKU900317-3C9»: queda registrado con «EKU9003173C9» (antes, «La base no respondió»)",
  );
  await foto(gil.p, "bar1-cobro-rfc-con-guion-registrado", false);

  // líder-N2: cancelar ese cobro con «ok 😀» (4 caracteres, 5 unidades UTF-16): el servidor lo rechaza en el campo;
  // con «ok 😀!» se cancela. Antes, el dominio lo aceptaba y la base respondía «La base no respondió».
  await ir(gil.p, `/c/${TALLER}/consola/cobros`);
  const filaCobro = gil.p.locator("tr[data-cobro]", { hasText: "Asesoría de la sexta revisión" });
  await filaCobro.getByRole("button", { name: "Cancelar" }).click();
  const dialogoCobro = gil.p.locator("dialog.dialogo[open]");
  const formaCancelar = dialogoCobro.locator("form.flujo-resolver");
  await dialogoCobro.locator('input[name="motivo"]').fill("ok 😀");
  await dialogoCobro.getByRole("button", { name: "Cancelar el cobro" }).click();
  await resultadoFlujo(formaCancelar);
  const textoCancelar = (await dialogoCobro.innerText()).replace(/\s+/g, " ");
  exigir(
    textoCancelar.includes("al menos 5 caracteres") && !textoCancelar.includes("no respondió")
      && sql(`select estado from expected_collections where company_id = '${TALLER}' and concepto = 'Asesoría de la sexta revisión'`) === "esperado",
    "líder-N2. cancelar con «ok 😀»: «Explica el motivo en al menos 5 caracteres» en el campo y el cobro sigue esperado",
    textoCancelar.slice(0, 200),
  );
  await foto(gil.p, "lider2-cancelar-cobro-motivo-emoji", false);
  await dialogoCobro.locator('input[name="motivo"]').fill("ok 😀!");
  await dialogoCobro.getByRole("button", { name: "Cancelar el cobro" }).click();
  await gil.p.locator(".alerta-asentado", { hasText: "cancelado" }).first().waitFor({ timeout: 20000 });
  exigir(
    sql(`select estado || '|' || char_length(motivo_cancelacion) from expected_collections where company_id = '${TALLER}' and concepto = 'Asesoría de la sexta revisión'`) === "cancelado|5",
    "líder-N2. con «ok 😀!» (5 caracteres) el cobro se cancela y la base guarda 5 caracteres",
  );

  // bar-9 y bar-8: cobro desde el XML de una factura emitida por Taller con «&amp;» en el nombre del receptor:
  // se guarda con «&». Con «&#x9;» en la serie (un control escrito como referencia), «Al XML le faltan datos» en el
  // campo. serv-nuevo-1/3: en el nombre, «&#x85;» se quita.
  const rfcTaller = sql(`select rfc from companies where id = '${TALLER}'`);
  const xml = (uuid, nombre, serie = "S") => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="2026-11-02T10:00:00" TipoDeComprobante="I" Moneda="MXN" Total="3480.00" Serie="${serie}" Folio="6">
  <cfdi:Emisor Rfc="${rfcTaller}" Nombre="Taller del Cierre" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="PAS120101AB2" Nombre="${nombre}" DomicilioFiscalReceptor="06600" RegimenFiscalReceptor="601" UsoCFDI="G03" />
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" /></cfdi:Complemento>
</cfdi:Comprobante>`);
  const conXml = gil.p.locator('form[data-formulario="cobro-xml"]');
  await ir(gil.p, `/c/${TALLER}/consola/cobros`);
  await conXml.locator("#xml").setInputFiles({ name: "control.xml", mimeType: "text/xml", buffer: xml("6A6A6A6A-0000-4000-8000-000000000085", "PEREZ ASOCIADOS", "S&#x9;1") });
  await conXml.getByRole("button", { name: "Registrar con el XML" }).click();
  const asentadoControl = await resultadoFlujo(conXml);
  const textoControl = (await conXml.innerText()).replace(/\s+/g, " ");
  exigir(
    !asentadoControl && textoControl.includes("faltan datos") && cuenta(`expected_collections where cfdi_uuid = '6A6A6A6A-0000-4000-8000-000000000085'`) === 0,
    "bar-8. XML con «&#x9;» en la serie: «Al XML le faltan datos» en el campo, sin cobro (antes se guardaba «&#x9;» literal)",
    textoControl.slice(0, 200),
  );
  await foto(gil.p, "bar8-xml-con-control-rechazado", false);
  await ir(gil.p, `/c/${TALLER}/consola/cobros`);
  await conXml.locator("#xml").setInputFiles({ name: "ampersand.xml", mimeType: "text/xml", buffer: xml("6A6A6A6A-0000-4000-8000-000000000026", "PEREZ &amp;&#x85; ASOCIADOS") });
  await conXml.getByRole("button", { name: "Registrar con el XML" }).click();
  exigir(
    (await resultadoFlujo(conXml)) && sql(`select cliente_nombre from expected_collections where cfdi_uuid = '6A6A6A6A-0000-4000-8000-000000000026'`) === "PEREZ & ASOCIADOS",
    "bar-9. XML con «PEREZ &amp;&#x85; ASOCIADOS»: el cobro se registra y la base guarda «PEREZ & ASOCIADOS» (sin el control)",
  );
  await ir(gil.p, `/c/${TALLER}/consola/cobros`);
  exigir(await gil.p.locator("tr[data-cobro]", { hasText: "PEREZ & ASOCIADOS" }).first().isVisible(), "bar-9. la lista de cobros muestra «PEREZ & ASOCIADOS»");
  await enVista(gil.p.locator("tr[data-cobro]", { hasText: "PEREZ & ASOCIADOS" }).first());
  await foto(gil.p, "bar9-cobro-xml-ampersand", false);

  // líder-N2: pago por excepción con el motivo «Revisar 😀» (9 caracteres, 10 unidades UTF-16: el navegador lo
  // deja pasar). El servidor responde en el formulario; con «Pago 😀 ya!» (10 caracteres) queda en autorización.
  await ir(gil.p, `/c/${TALLER}/consola/proveedores/nuevo`);
  const opciones = await gil.p.locator("#supplierId option").evaluateAll((nodos) => nodos.map((nodo) => ({ valor: nodo.value, texto: nodo.textContent ?? "" })));
  const elegido = opciones.find((opcion) => opcion.valor && !/Norte/i.test(opcion.texto));
  exigir(Boolean(elegido), "líder-N2. hay un proveedor para el pago por excepción", JSON.stringify(opciones));
  await gil.p.locator("#supplierId").selectOption(elegido.valor);
  await gil.p.getByRole("button", { name: /Excepción/ }).click();
  await gil.p.locator("#pdf").setInputFiles({ name: "soporte-sexta.pdf", mimeType: "application/pdf", buffer: PDF("soporte-sexta") });
  await gil.p.locator("#monto").fill("1250.00");
  await gil.p.locator("#referencia").fill("Servicio extraordinario de la sexta revisión");
  await gil.p.locator("#motivoExcepcion").fill("Revisar 😀");
  exigir(!(await gil.p.locator("#motivoExcepcion").evaluate((nodo) => nodo.validity.tooShort)), "líder-N2. «Revisar 😀» pasa el mínimo de 10 del navegador");
  const pagosAntes = cuenta(`supplier_payables where company_id = '${TALLER}' and referencia = 'Servicio extraordinario de la sexta revisión'`);
  await gil.p.getByRole("button", { name: "Revisar y solicitar" }).click();
  await gil.p.locator("#pago-error").waitFor({ timeout: 20000 });
  const errorPago = (await gil.p.locator("#pago-error").innerText()).replace(/\s+/g, " ");
  exigir(
    !errorPago.includes("no respondió") && cuenta(`supplier_payables where company_id = '${TALLER}' and referencia = 'Servicio extraordinario de la sexta revisión'`) === pagosAntes,
    "líder-N2. pago por excepción con «Revisar 😀»: «No se guardó» con el aviso del motivo, sin pago (antes, el CHECK lo rechazaba con un error genérico)",
    errorPago,
  );
  await enVista(gil.p.locator("#motivoExcepcion"));
  await foto(gil.p, "lider2-pago-excepcion-motivo-emoji", false);
  await gil.p.locator("#motivoExcepcion").fill("Pago 😀 ya!");
  await gil.p.getByRole("button", { name: "Revisar y solicitar" }).click();
  await gil.p.getByText("Quedó en autorización").first().waitFor({ timeout: 20000 });
  exigir(
    sql(`select char_length(motivo_excepcion) from supplier_payables where company_id = '${TALLER}' and referencia = 'Servicio extraordinario de la sexta revisión'`) === "10",
    "líder-N2. con «Pago 😀 ya!» (10 caracteres) queda en autorización y la base guarda 10 caracteres",
  );
  await foto(gil.p, "lider2-pago-excepcion-en-autorizacion", false);
  await gil.nav.close();
  await septimaRonda(rutaEbano);
}

/**
 * Re-verificación sobre 98224e0. base-N23 y serv-nuevo-4: una identidad (nombre de representante o socio, razón
 * social) con un control invisible se rechaza en su campo, y en los textos libres el control vale un espacio.
 * P3: el área y la razón social del alta dan su error de forma, y cada fecha mala de Pagos marca su campo.
 */
/**
 * Una petición armada, como la del revisor: el campo de fecha no deja escribir un día que no existe. Se escribe una
 * fecha válida y única y, en la petición de la acción que sale del navegador, se cambia por la imposible.
 */
async function armarFecha(p, real, forzada) {
  await p.route("**/*", async (ruta) => {
    const peticion = ruta.request();
    const cuerpo = peticion.method() === "POST" && peticion.headers()["next-action"] ? peticion.postDataBuffer()?.toString("latin1") ?? "" : "";
    if (!cuerpo.includes(real)) return ruta.fallback();
    await ruta.continue({ postData: Buffer.from(cuerpo.split(real).join(forzada), "latin1") });
  });
}

async function septimaRonda(rutaEbano) {
  console.log("\n— Séptima revisión: identidades con un control, textos libres con espacio y avisos en su campo");
  renovarSesiones();
  const omar = await abrir("omar");
  const marcado = async (p, selector) => (await p.locator(selector).getAttribute("aria-invalid")) === "true";

  // base-N23: el representante «Pedro<U+000B>Ruiz Sol» se rechaza en su campo (antes se guardaba «PedroRuiz Sol» y
  // la Lista con el nombre bien escrito ya no lo encontraba).
  await ir(omar.p, rutaEbano);
  const borrador = `(select id from kyb_versiones where company_id = '${ctxEbano.id}' and estado = 'borrador')`;
  const representantes = () => cuenta(`kyb_representantes where version_id = ${borrador} and retirado_en is null`);
  const repsAntes = representantes();
  await campo(omar.p, "#rep-nombre", "Pedro\u000bRuiz Sol");
  const textoRep = await rechazarRepresentante(omar.p);
  exigir(
    (await marcado(omar.p, "#rep-nombre")) && representantes() === repsAntes && textoRep.includes("carácter invisible"),
    "base-N23. el representante «Pedro\\u000bRuiz Sol» se rechaza en su campo y no se guarda (antes, «PedroRuiz Sol»)",
    textoRep,
  );
  await enVista(omar.p.locator("#rep-nombre"));
  await foto(omar.p, "n23-representante-con-control", false);

  // base-N23: el socio extranjero «Luis<U+0085>Gómez Paz» (sin RFC ni CURP: el nombre es su llave contra la Lista)
  // se rechaza en su campo y el formulario conserva lo capturado.
  await ir(omar.p, rutaEbano);
  const socios = () => cuenta(`kyb_accionistas where version_id = ${borrador} and retirado_en is null`);
  const sociosAntes = socios();
  await omar.p.locator("#acc-tipo").selectOption("fisica");
  await omar.p.locator("#acc-nacionalidad").selectOption("extranjera");
  await campo(omar.p, "#acc-nombre", "Luis\u0085Gómez Paz");
  await omar.p.locator("#acc-pais").selectOption("SE");
  await campo(omar.p, "#acc-documento", "SE-771020");
  await omar.p.locator("#acc-nacimiento").fill("1981-02-02");
  await campo(omar.p, "#acc-capital", "1");
  await campo(omar.p, "#acc-votos", "1");
  const textoSocio = await rechazarSocio(omar.p);
  exigir(
    (await marcado(omar.p, "#acc-nombre")) && socios() === sociosAntes && (await omar.p.locator("#acc-documento").inputValue()) === "SE-771020",
    "base-N23. el socio extranjero «Luis\\u0085Gómez Paz» se rechaza en su campo, sin socio de más y con lo capturado",
    textoSocio,
  );
  await enVista(omar.p.locator("#aviso-accionista"));
  await foto(omar.p, "n23-socio-con-control", false);

  // La razón social del expediente también es una identidad: con U+0085 se rechaza en su campo. El giro es texto
  // libre: el NEL entre dos palabras se guarda como un espacio (serv-nuevo-4; antes, «Distribuciónde abarrotes»).
  await ir(omar.p, rutaEbano);
  const razonAntes = sql(`select razon_social from kyb_versiones where id = ${borrador}`);
  await campo(omar.p, "#dato-razonSocial", "Grupo Ébano\u0085Industrial, S.A. de C.V.");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Guardar datos" }), "invisible_razonSocial");
  exigir(
    (await marcado(omar.p, "#dato-razonSocial")) && sql(`select razon_social from kyb_versiones where id = ${borrador}`) === razonAntes,
    "base-N23. la razón social del expediente con U+0085 se rechaza en su campo y no cambia",
    await aviso(omar.p),
  );
  await enVista(omar.p.locator("#dato-razonSocial"));
  await foto(omar.p, "n23-razon-social-expediente-con-control", false);
  await ir(omar.p, rutaEbano);
  await campo(omar.p, "#dato-giro", "Distribución\u0085de abarrotes");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Guardar datos" }), "expediente_datos_guardados");
  exigir(
    sql(`select giro from kyb_versiones where id = ${borrador}`) === "Distribución de abarrotes",
    "serv-nuevo-4. el giro «Distribución\\u0085de abarrotes» se guarda «Distribución de abarrotes»",
  );
  await enVista(omar.p.locator("#dato-giro"));
  await foto(omar.p, "sn4-giro-con-nel-guardado", false);

  // P3: el alta del prospecto dice qué falla y marca el campo (antes, «No se pudo completar…» sin campo).
  await ir(omar.p, "/operacion/clientes");
  const prospectos = () => cuenta(`companies where rfc = 'EUN010101AB1'`);
  await campo(omar.p, "#razonSocial", "Empresa\u0085Uno SA de CV");
  await campo(omar.p, "#rfc", "EUN010101AB1");
  await campo(omar.p, "#codigoPostal", "06600");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Registrar prospecto" }), "razon_social_control");
  exigir(
    (await marcado(omar.p, "#razonSocial")) && (await aviso(omar.p)).includes("carácter invisible") && prospectos() === 0,
    "P3. la razón social del alta con U+0085: «trae un carácter invisible», con el campo marcado y sin empresa",
    await aviso(omar.p),
  );
  await enVista(omar.p.locator("#razonSocial"));
  await foto(omar.p, "p3-prospecto-razon-social-con-control", false);
  await campo(omar.p, "#razonSocial", "Empresa Uno SA de CV");
  await campo(omar.p, "#rfc", "EUN010101AB1");
  await campo(omar.p, "#codigoPostal", "17000");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Registrar prospecto" }), "codigo_postal_invalido");
  exigir(
    (await marcado(omar.p, "#codigoPostal")) && (await aviso(omar.p)).includes("código postal") && prospectos() === 0,
    "P3. el código postal 17000 del alta: su aviso, con el campo marcado y sin empresa",
    await aviso(omar.p),
  );
  await foto(omar.p, "p3-prospecto-codigo-postal", false);
  await omar.nav.close();

  // Consola de Taller (Gil).
  const gil = await abrir("gil");
  const resultadoFlujo = async (forma) => {
    await forma.locator(".alerta-asentado, .alerta-revisar, .error-campo").first().waitFor({ timeout: 20000 });
    await listo(gil.p);
    return (await forma.locator(".alerta-asentado").count()) > 0;
  };
  // serv-nuevo-4: en el cobro manual, el nombre del cliente y el concepto son texto libre: el control vale un
  // espacio. Regla 1: el RFC con un tabulador dentro se rechaza en su campo (antes se borraba y se aceptaba).
  await ir(gil.p, `/c/${TALLER}/consola/cobros`);
  const cobro = gil.p.locator('form[data-formulario="cobro"]');
  await cobro.locator("#clienteNombre").fill("Comercializadora\u0085Uno");
  await cobro.locator("#concepto").fill("Servicio\u000bde la séptima revisión");
  await cobro.locator("#monto").fill("200.00");
  await cobro.getByRole("button", { name: "Registrar el cobro" }).click();
  exigir(
    (await resultadoFlujo(cobro)) && sql(`select cliente_nombre from expected_collections where company_id = '${TALLER}' and concepto = 'Servicio de la séptima revisión'`) === "Comercializadora Uno",
    "serv-nuevo-4. cobro con «Comercializadora\\u0085Uno» y «Servicio\\u000bde la séptima revisión»: se guardan con espacio",
  );
  await ir(gil.p, `/c/${TALLER}/consola/cobros`);
  await enVista(gil.p.locator("tr[data-cobro]", { hasText: "Comercializadora Uno" }).first());
  await foto(gil.p, "sn4-cobro-con-control-vale-espacio", false);
  await ir(gil.p, `/c/${TALLER}/consola/cobros`);
  await cobro.locator("#clienteNombre").fill("Cliente con tabulador");
  await cobro.locator("#clienteRfc").fill("EKU900317\t3C9");
  await cobro.locator("#concepto").fill("Asesoría con tabulador");
  await cobro.locator("#monto").fill("100.00");
  await cobro.getByRole("button", { name: "Registrar el cobro" }).click();
  const asentadoTab = await resultadoFlujo(cobro);
  exigir(
    !asentadoTab && (await marcado(cobro, "#clienteRfc")) && cuenta(`expected_collections where company_id = '${TALLER}' and concepto = 'Asesoría con tabulador'`) === 0,
    "regla 1. el RFC «EKU900317\\t3C9» del cobro se rechaza en su campo y no hay cobro (antes, el tabulador se borraba)",
    (await cobro.innerText()).replace(/\s+/g, " ").slice(0, 200),
  );
  await foto(gil.p, "regla1-cobro-rfc-con-tabulador", false);

  // P3: el área con un control dice que trae un carácter invisible y marca su campo (antes, «Escribe el nombre del área.»).
  await ir(gil.p, `/c/${TALLER}/consola/personas/areas`);
  await gil.p.locator("#centroNombre").fill("Ventas\u0085Norte");
  await gil.p.getByRole("button", { name: "Crear área" }).click();
  await gil.p.getByText("carácter invisible").first().waitFor({ timeout: 20000 });
  exigir(
    (await marcado(gil.p, "#centroNombre")) && cuenta(`cost_centers where company_id = '${TALLER}' and nombre like 'Ventas%Norte'`) === 0,
    "P3. el área «Ventas\\u0085Norte»: «trae un carácter invisible» en su campo y sin área",
  );
  await foto(gil.p, "p3-area-con-control", false);

  // P3 bar-10: con la fecha forzada (una petición armada: el campo de fecha no deja escribirla), cada aviso marca
  // su campo. «Vigente desde» 2026-02-30 marca «Vigente desde», no «Vigente hasta».
  const proveedor = "44444444-4444-4444-8444-444444444441";
  const documentos = () => cuenta(`documents where company_id = '${TALLER}'`);
  const docsAntes = documentos();
  await ir(gil.p, `/c/${TALLER}/consola/proveedores?vista=proveedores&proveedor=${proveedor}`);
  const dialogo = gil.p.getByRole("dialog");
  await dialogo.getByText("Agregar contrato", { exact: true }).click();
  await gil.p.locator(`#contrato-nuevo-${proveedor}`).setInputFiles({ name: "contrato-septima.pdf", mimeType: "application/pdf", buffer: PDF("contrato-septima") });
  const desde = gil.p.locator(`#desde-${proveedor}`);
  await desde.fill("2026-10-17");
  await armarFecha(gil.p, "2026-10-17", "2026-02-30");
  await dialogo.getByRole("button", { name: "Guardar el contrato" }).click();
  await gil.p.locator(`#desde-${proveedor}[aria-invalid="true"]`).waitFor({ timeout: 20000 });
  exigir(
    !(await marcado(gil.p, `#hasta-${proveedor}`)) && documentos() === docsAntes
      && (await gil.p.locator(`#contrato-${proveedor}-aviso`).innerText()).includes("Vigente desde"),
    "P3 bar-10. contrato con «Vigente desde» 2026-02-30: el aviso marca «Vigente desde» y no hay documento",
    (await dialogo.innerText()).replace(/\s+/g, " ").slice(0, 200),
  );
  await gil.p.unroute("**/*");
  await enVista(desde);
  await foto(gil.p, "p3-contrato-vigente-desde", false);

  // Pago por excepción con «Fecha de la obligación» 0000-01-01: el aviso marca esa fecha, no el vencimiento.
  await ir(gil.p, `/c/${TALLER}/consola/proveedores/nuevo`);
  const opciones = await gil.p.locator("#supplierId option").evaluateAll((nodos) => nodos.map((nodo) => ({ valor: nodo.value, texto: nodo.textContent ?? "" })));
  const elegido = opciones.find((opcion) => opcion.valor && !/Norte/i.test(opcion.texto));
  await gil.p.locator("#supplierId").selectOption(elegido.valor);
  await gil.p.getByRole("button", { name: /Excepción/ }).click();
  await gil.p.locator("#pdf").setInputFiles({ name: "soporte-septima.pdf", mimeType: "application/pdf", buffer: PDF("soporte-septima") });
  await gil.p.locator("#monto").fill("900.00");
  await gil.p.locator("#referencia").fill("Servicio de la séptima revisión");
  await gil.p.locator("#motivoExcepcion").fill("Anticipo sin factura del mes");
  const obligacion = gil.p.locator("#emitidaEl");
  await obligacion.fill("2026-10-19");
  await armarFecha(gil.p, "2026-10-19", "0000-01-01");
  const pagosAntes = cuenta(`supplier_payables where company_id = '${TALLER}' and referencia = 'Servicio de la séptima revisión'`);
  await gil.p.getByRole("button", { name: "Revisar y solicitar" }).click();
  await gil.p.locator("#pago-error").waitFor({ timeout: 20000 });
  exigir(
    (await marcado(gil.p, "#emitidaEl")) && !(await marcado(gil.p, "#venceEl"))
      && cuenta(`supplier_payables where company_id = '${TALLER}' and referencia = 'Servicio de la séptima revisión'`) === pagosAntes,
    "P3 bar-10. excepción con «Fecha de la obligación» 0000-01-01: el aviso marca esa fecha, no el vencimiento, y no hay pago",
    (await gil.p.locator("#pago-error").innerText()).replace(/\s+/g, " "),
  );
  await gil.p.unroute("**/*");
  await enVista(obligacion);
  await foto(gil.p, "p3-excepcion-fecha-de-la-obligacion", false);
  await gil.nav.close();
  await octavaRonda(rutaEbano);
}

/**
 * Re-verificación sobre b2db0b5. serv-nuevo-5: las identidades rechazan también los caracteres de formato (Cf); el
 * aviso del carácter invisible es propio, marca el campo y le da el foco; el formulario de representante conserva lo
 * capturado; base-N24 (renglón de la Lista con tabulador), base-N25 (documento extranjero con tabulador) y el
 * contrato con «Vigente hasta» que tiene su propio aviso.
 */
async function octavaRonda(rutaEbano) {
  console.log("\n— Octava revisión: caracteres invisibles con su propio aviso, representante que conserva lo capturado, Lista y documento extranjero");
  renovarSesiones();
  const INVISIBLE_NOMBRE = "El nombre trae un carácter invisible, algo común al copiar y pegar. Escríbelo de nuevo a mano.";
  const FORMATO = "Revisa el campo marcado: el dato no tiene el formato esperado.";
  const marcado = async (p, selector) => (await p.locator(selector).getAttribute("aria-invalid")) === "true";
  const enFoco = (p) => p.evaluate(() => document.activeElement?.id ?? "");
  const sinDatosEnDireccion = (p) => new URL(p.url()).search === "";
  const omar = await abrir("omar");
  const borrador = `(select id from kyb_versiones where company_id = '${ctxEbano.id}' and estado = 'borrador')`;
  const socios = () => cuenta(`kyb_accionistas where version_id = ${borrador} and retirado_en is null`);
  const representantes = () => cuenta(`kyb_representantes where version_id = ${borrador} and retirado_en is null`);

  // Aviso propio: el socio «Juan\u0085Pérez López» (persona física mexicana) dice qué pasó, marca el nombre y le da el foco.
  await ir(omar.p, rutaEbano);
  const sociosAntes = socios();
  const capturarSocio = async (nombre) => {
    await omar.p.locator("#acc-tipo").selectOption("fisica");
    await omar.p.locator("#acc-nacionalidad").selectOption("mexicana");
    await campo(omar.p, "#acc-nombre", nombre);
    await campo(omar.p, "#acc-curp", "PELJ800101HNLRPN07");
    await campo(omar.p, "#acc-capital", "1");
    await campo(omar.p, "#acc-votos", "1");
    return rechazarSocio(omar.p);
  };
  const textoJuan = await capturarSocio("Juan\u0085Pérez López");
  exigir(
    textoJuan === INVISIBLE_NOMBRE && (await marcado(omar.p, "#acc-nombre")) && (await enFoco(omar.p)) === "acc-nombre"
      && (await omar.p.locator("#acc-nombre").inputValue()) === "Juan\u0085Pérez López" && sinDatosEnDireccion(omar.p) && socios() === sociosAntes,
    "aviso propio. el socio «Juan\\u0085Pérez López»: «El nombre trae un carácter invisible…», nombre marcado y con el foco, sin socio",
    textoJuan,
  );
  await enVista(omar.p.locator("#aviso-accionista"));
  await foto(omar.p, "r8-socio-caracter-invisible", false);
  // serv-nuevo-5: un Cf (U+200B) también, y un nombre mal formado sin invisibles conserva el aviso de formato.
  const textoAna = await capturarSocio("Ana\u200bRuiz Sol");
  exigir(textoAna === INVISIBLE_NOMBRE && socios() === sociosAntes, "serv-nuevo-5. el socio «Ana\\u200bRuiz Sol» (espacio de ancho cero): el mismo aviso y sin socio", textoAna);
  const textoBlanco = await capturarSocio("   ");
  exigir(
    textoBlanco === FORMATO && (await marcado(omar.p, "#acc-nombre")) && (await enFoco(omar.p)) === "acc-nombre",
    "aviso propio. un nombre en blanco, sin invisibles, conserva «Revisa el campo marcado: el dato no tiene el formato esperado.»",
    textoBlanco,
  );
  await enVista(omar.p.locator("#aviso-accionista"));
  await foto(omar.p, "r8-socio-nombre-con-formato", false);

  // P3: el formulario de representante conserva lo capturado tras el rechazo (antes recargaba y lo perdía).
  await ir(omar.p, rutaEbano);
  const repsAntes = representantes();
  const REP = { rfc: "RUSP800101AB1", curp: "RUSP800101HDFZLD09", cargo: "apoderado", pep: "no", designado: "Poder notarial 4512" };
  await campo(omar.p, "#rep-nombre", "Pedro\u00adRuiz Sol");
  await campo(omar.p, "#rep-rfc", REP.rfc);
  await campo(omar.p, "#rep-curp", REP.curp);
  await omar.p.locator("#rep-cargo").selectOption(REP.cargo);
  await omar.p.locator("#rep-pep").selectOption(REP.pep);
  await campo(omar.p, "#rep-designado", REP.designado);
  await omar.p.locator('input[name="esAdministrador"]').check();
  const conservado = async (curp = REP.curp) =>
    (await omar.p.locator("#rep-rfc").inputValue()) === REP.rfc && (await omar.p.locator("#rep-curp").inputValue()) === curp
    && (await omar.p.locator("#rep-cargo").inputValue()) === REP.cargo && (await omar.p.locator("#rep-pep").inputValue()) === REP.pep
    && (await omar.p.locator("#rep-designado").inputValue()) === REP.designado && (await omar.p.locator('input[name="esAdministrador"]').isChecked())
    && sinDatosEnDireccion(omar.p) && representantes() === repsAntes;
  const textoPedro = await rechazarRepresentante(omar.p);
  exigir(
    textoPedro === INVISIBLE_NOMBRE && (await marcado(omar.p, "#rep-nombre")) && (await enFoco(omar.p)) === "rep-nombre"
      && (await omar.p.locator("#rep-nombre").inputValue()) === "Pedro\u00adRuiz Sol" && (await conservado()),
    "P3 y serv-nuevo-5. el representante «Pedro\\u00adRuiz Sol» (guion suave): aviso propio, nombre marcado y con el foco, y vuelve con RFC, CURP, cargo, PEP, quién lo designó y «Administra»",
    textoPedro,
  );
  await enVista(omar.p.locator("#aviso-representante"));
  await foto(omar.p, "r8-representante-conserva-lo-capturado", false);
  await campo(omar.p, "#rep-nombre", "Pedro Ruiz Sol");
  await campo(omar.p, "#rep-curp", "XX");
  const textoCurp = await rechazarRepresentante(omar.p);
  exigir(
    textoCurp === FORMATO && (await marcado(omar.p, "#rep-curp")) && !(await marcado(omar.p, "#rep-nombre")) && (await enFoco(omar.p)) === "rep-curp"
      && (await omar.p.locator("#rep-nombre").inputValue()) === "Pedro Ruiz Sol" && (await conservado("XX")),
    "P3. con la CURP «XX» el aviso de formato marca la CURP y todo lo demás sigue capturado",
    textoCurp,
  );
  await campo(omar.p, "#rep-curp", REP.curp);
  await enviar(omar.p, omar.p.getByRole("button", { name: "Agregar representante" }), "expediente_representante_agregado", { doble: true });
  exigir(
    representantes() === repsAntes + 1
      && sql(`select concat_ws('|', rfc, curp, cargo, es_administrador, designado_por) from kyb_representantes where version_id = ${borrador} and nombre = 'Pedro Ruiz Sol' and retirado_en is null`)
        === [REP.rfc, REP.curp, REP.cargo, "t", REP.designado].join("|"),
    "P3. corregido en el mismo formulario, doble clic en «Agregar representante» = un representante con todo lo capturado",
  );
  await enVista(omar.p.locator("#representantes-titulo"));
  await foto(omar.p, "r8-representante-agregado", false);

  // serv-nuevo-5: la razón social del expediente con U+FEFF tiene su propio aviso, con el campo marcado y el foco.
  await ir(omar.p, rutaEbano);
  const razonAntes = sql(`select razon_social from kyb_versiones where id = ${borrador}`);
  await campo(omar.p, "#dato-razonSocial", "Grupo Ébano\ufeffIndustrial, S.A. de C.V.");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Guardar datos" }), "invisible_razonSocial");
  exigir(
    (await aviso(omar.p)) === "La razón social trae un carácter invisible, algo común al copiar y pegar. Escríbela de nuevo a mano."
      && (await marcado(omar.p, "#dato-razonSocial")) && (await enFoco(omar.p)) === "dato-razonSocial"
      && sql(`select razon_social from kyb_versiones where id = ${borrador}`) === razonAntes,
    "serv-nuevo-5. la razón social del expediente con U+FEFF: aviso propio, campo marcado y con el foco, y no cambia",
    await aviso(omar.p),
  );
  await enVista(omar.p.locator("#dato-razonSocial"));
  await foto(omar.p, "r8-razon-social-caracter-invisible", false);

  // base-N25: el documento del socio extranjero con un tabulador se rechaza (antes «X123\t4567» quedaba X1234567).
  await ir(omar.p, rutaEbano);
  await omar.p.locator("#acc-tipo").selectOption("fisica");
  await omar.p.locator("#acc-nacionalidad").selectOption("extranjera");
  await campo(omar.p, "#acc-nombre", "Mia Larsson Berg");
  await omar.p.locator("#acc-pais").selectOption("SE");
  await campo(omar.p, "#acc-documento", "X123\t4567");
  await omar.p.locator("#acc-nacimiento").fill("1984-03-03");
  await campo(omar.p, "#acc-capital", "1");
  await campo(omar.p, "#acc-votos", "1");
  const textoDoc = await rechazarSocio(omar.p);
  exigir(
    textoDoc.includes("de 4 a 20 letras y números") && (await marcado(omar.p, "#acc-documento")) && socios() === sociosAntes
      && cuenta(`kyb_accionistas where documento_extranjero = 'X1234567'`) === 0,
    "base-N25. el documento extranjero «X123\\t4567» se rechaza en su campo; no se guarda X1234567",
    textoDoc,
  );
  await enVista(omar.p.locator("#aviso-accionista"));
  await foto(omar.p, "r8-documento-extranjero-con-tabulador", false);

  // serv-nuevo-5: la razón social del alta con U+2060 (unión de palabras), con su aviso.
  await ir(omar.p, "/operacion/clientes");
  await campo(omar.p, "#razonSocial", "Empresa\u2060Dos SA de CV");
  await campo(omar.p, "#rfc", "EDO010101AB1");
  await campo(omar.p, "#codigoPostal", "06600");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Registrar prospecto" }), "razon_social_control");
  exigir(
    (await marcado(omar.p, "#razonSocial")) && (await enFoco(omar.p)) === "razonSocial" && cuenta(`companies where rfc = 'EDO010101AB1'`) === 0,
    "serv-nuevo-5. la razón social del alta con U+2060: su aviso, campo marcado y con el foco, sin empresa",
    await aviso(omar.p),
  );
  await enVista(omar.p.locator("#razonSocial"));
  await foto(omar.p, "r8-prospecto-razon-social-u2060", false);
  await omar.nav.close();

  // Cumplimiento: la Lista con «EVA\tRUIZ SOL» (base-N24) y el folio con U+2060; el motivo con un emoji compuesto se guarda.
  const celia = await abrir("celia");
  await ir(celia.p, "/operacion/lpb");
  const cargasAntes = cuenta("lpb_cargas");
  await celia.p.locator("#archivo").setInputFiles({
    name: "lpb-con-tabulador.csv", mimeType: "text/csv", buffer: Buffer.from(`${LPB_2}\nEVA\tRUIZ SOL,,,fisica,2026-11-06\n`),
  });
  await enviar(celia.p, celia.p.getByRole("button", { name: "Cargar y cotejar" }), "lpb_renglon_invalido");
  const lineaEva = LPB_2.split("\n").length + 1;
  exigir(
    (await aviso(celia.p)).includes(`línea ${lineaEva}`) && cuenta("lpb_cargas") === cargasAntes && cuenta("lpb_personas where nombre ilike 'eva%ruiz%sol'") === 0,
    `base-N24. la Lista con «EVA\\tRUIZ SOL» se rechaza en la línea ${lineaEva} y no deja carga (antes se guardaba «EVA RUIZ SOL»)`,
    await aviso(celia.p),
  );
  await foto(celia.p, "r8-lista-con-tabulador", false);
  await ir(celia.p, "/operacion/cumplimiento");
  // Una empresa de las regresiones (Brisa o Cedro) que la Lista encontró por su RFC y sigue pendiente.
  const caso = sql(`select id from lpb_coincidencias where estado = 'pendiente' and tipo = 'exacta' and sujeto_tipo = 'empresa' order by detectada_en limit 1`);
  exigir(Boolean(caso), "octava. hay una coincidencia pendiente para confirmar y anotar su folio");
  const motivoEmoji = "Coincide el RFC; lo revisó la familia 👨‍👩‍👧 de Cumplimiento";
  const fila = celia.p.locator(`li:has([id="resolucion-${caso}"])`);
  await fila.locator(`[id="resolucion-${caso}"]`).selectOption("confirmada");
  await fila.locator(`[id="motivo-${caso}"]`).fill(motivoEmoji);
  await enviar(celia.p, fila.getByRole("button", { name: "Registrar dictamen" }), "coincidencia_resuelta");
  exigir(
    sql(`select motivo_resolucion from lpb_coincidencias where id = '${caso}'`) === motivoEmoji,
    "serv-nuevo-5. el motivo con un emoji compuesto (U+200D) se guarda tal cual: los textos libres no cambian",
  );
  const conFolio = celia.p.locator(`li:has([id="folio-${caso}"])`);
  await conFolio.locator(`[id="folio-${caso}"]`).fill("UIF-2026-\u20600007");
  await conFolio.locator(`[id="presentado-${caso}"]`).fill(hoyMexico());
  await enviar(celia.p, conFolio.getByRole("button", { name: "Anotar folio" }), "invisible_folio");
  exigir(
    (await aviso(celia.p)) === "El folio trae un carácter invisible, algo común al copiar y pegar. Escríbelo de nuevo a mano."
      && (await marcado(celia.p, `[id="folio-${caso}"]`)) && (await enFoco(celia.p)) === `folio-${caso}`
      && sql(`select coalesce(reporte_folio, '') from lpb_coincidencias where id = '${caso}'`) === "",
    "serv-nuevo-5. el folio «UIF-2026-\\u20600007»: aviso propio, el folio de esa coincidencia marcado y con el foco, sin folio guardado",
    await aviso(celia.p),
  );
  await enVista(celia.p.locator(`[id="folio-${caso}"]`));
  await foto(celia.p, "r8-folio-caracter-invisible", false);
  await celia.nav.close();

  // P3: el contrato con «Vigente hasta» antes de «Vigente desde» tiene su propio aviso y marca «Vigente hasta».
  const gil = await abrir("gil");
  const proveedor = "44444444-4444-4444-8444-444444444441";
  const documentos = () => cuenta(`documents where company_id = '${TALLER}'`);
  const docsAntes = documentos();
  await ir(gil.p, `/c/${TALLER}/consola/proveedores?vista=proveedores&proveedor=${proveedor}`);
  const dialogo = gil.p.getByRole("dialog");
  await dialogo.getByText("Agregar contrato", { exact: true }).click();
  await gil.p.locator(`#contrato-nuevo-${proveedor}`).setInputFiles({ name: "contrato-octava.pdf", mimeType: "application/pdf", buffer: PDF("contrato-octava") });
  await gil.p.locator(`#desde-${proveedor}`).fill("2026-11-01");
  await gil.p.locator(`#hasta-${proveedor}`).fill("2026-10-31");
  await dialogo.getByRole("button", { name: "Guardar el contrato" }).click();
  await gil.p.locator(`#hasta-${proveedor}[aria-invalid="true"]`).waitFor({ timeout: 20000 });
  const textoContrato = (await gil.p.locator(`#contrato-${proveedor}-aviso`).innerText()).replace(/\s+/g, " ").trim();
  exigir(
    textoContrato.includes("Revisa «Vigente hasta»: debe existir en el calendario y no puede ser anterior a «Vigente desde».")
      && !textoContrato.includes("emisión") && !(await marcado(gil.p, `#desde-${proveedor}`)) && documentos() === docsAntes,
    "P3. el contrato con «Vigente hasta» antes de «Vigente desde»: su propio aviso (no el de la emisión del pago), «Vigente hasta» marcado y sin documento",
    textoContrato,
  );
  await enVista(gil.p.locator(`#hasta-${proveedor}`));
  await foto(gil.p, "r8-contrato-vigente-hasta", false);

  // serv-nuevo-5: el alta del proveedor con U+FEFF en la razón social dice que trae un carácter invisible.
  await ir(gil.p, `/c/${TALLER}/consola/proveedores/nuevo-proveedor`);
  await gil.p.locator("#rfc").fill("EKU9003173C9");
  await gil.p.locator("#razonSocial").fill("Escuela\ufeffKemper Urgate");
  await gil.p.getByRole("button", { name: "Dar de alta" }).click();
  await gil.p.locator('#razonSocial[aria-invalid="true"]').waitFor({ timeout: 20000 });
  const textoProveedor = (await gil.p.locator("form.alta-formulario").innerText()).replace(/\s+/g, " ");
  exigir(
    textoProveedor.includes("La razón social trae un carácter invisible, algo común al copiar y pegar. Escríbela de nuevo a mano.")
      && cuenta(`suppliers where company_id = '${TALLER}' and rfc = 'EKU9003173C9'`) === 0,
    "serv-nuevo-5. el alta del proveedor con U+FEFF en la razón social: su aviso, campo marcado y sin proveedor",
    textoProveedor.slice(0, 240),
  );
  await enVista(gil.p.locator("#razonSocial"));
  await foto(gil.p, "r8-proveedor-razon-social-ufeff", false);
  await gil.nav.close();
  await novenaRonda(rutaEbano);
}

/**
 * Re-verificación sobre a75d5e4. base-N26: los demás invisibles de Unicode (Default_Ignorable_Code_Point); base-N27:
 * con varias recuperaciones, el aviso marca la tarjeta que falló; serv-nuevo-6b: las fechas del folio marcan su campo;
 * serv-nuevo-6d: enviar una versión sin datos generales dice qué falta.
 */
async function novenaRonda(rutaEbano) {
  console.log("\n— Novena revisión: invisibles de Unicode, recuperación en su tarjeta, fechas del folio y envío sin datos generales");
  renovarSesiones();
  const marcado = async (p, selector) => (await p.locator(selector).getAttribute("aria-invalid")) === "true";
  const enFoco = (p) => p.evaluate(() => document.activeElement?.id ?? "");
  const marcados = (p) => p.locator('[aria-invalid="true"]').count();
  // La captura lleva el aviso de la página y el campo marcado juntos: se sube al inicio y se comprueba que los dos se ven.
  const avisoYCampo = async (p, selector) => {
    await p.evaluate(() => window.scrollTo(0, 0));
    const alto = p.viewportSize().height;
    const cajas = await Promise.all(["#aviso-operacion", selector].map((s) => p.locator(s).boundingBox()));
    return cajas.every((caja) => caja && caja.y >= 0 && caja.y + caja.height <= alto);
  };

  // base-N26: el representante «Luis Rodr<U+3164>íguez» (relleno hangul, no es Cc ni Cf) tiene el aviso propio.
  const omar = await abrir("omar");
  await ir(omar.p, rutaEbano);
  const borrador = `(select id from kyb_versiones where company_id = '${ctxEbano.id}' and estado = 'borrador')`;
  const representantes = () => cuenta(`kyb_representantes where version_id = ${borrador} and retirado_en is null`);
  const repsAntes = representantes();
  await campo(omar.p, "#rep-nombre", "Luis Rodrㅤíguez");
  await campo(omar.p, "#rep-rfc", "ROLU800101AB1");
  await campo(omar.p, "#rep-curp", "ROLU800101HDFDSS09");
  await omar.p.locator("#rep-cargo").selectOption("apoderado");
  await omar.p.locator("#rep-pep").selectOption("no");
  await campo(omar.p, "#rep-designado", "Poder notarial 7781");
  const textoLuis = await rechazarRepresentante(omar.p);
  exigir(
    textoLuis === "El nombre trae un carácter invisible, algo común al copiar y pegar. Escríbelo de nuevo a mano."
      && (await marcado(omar.p, "#rep-nombre")) && (await enFoco(omar.p)) === "rep-nombre" && representantes() === repsAntes,
    "base-N26. el representante «Luis Rodr\\u3164íguez» (relleno hangul): aviso propio, nombre marcado y con el foco, sin representante",
    textoLuis,
  );
  await enVista(omar.p.locator("#aviso-representante"));
  await foto(omar.p, "r9-representante-relleno-hangul", false);

  // serv-nuevo-6d: un prospecto nuevo con datos generales sin giro ni domicilio. Enviar dice qué falta (antes, «La
  // base no respondió» por el CHECK kyb_versiones_forma); la versión sigue en borrador y sin evento.
  const NOVENA = { razonSocial: "Laboratorio Novena, S.A. de C.V.", rfc: "NOV150301AB1" };
  await ir(omar.p, "/operacion/clientes");
  await omar.p.getByLabel("Razón social").fill(NOVENA.razonSocial);
  await omar.p.getByLabel("RFC").fill(NOVENA.rfc);
  await omar.p.getByLabel("Código postal").fill("06600");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Registrar prospecto" }), "prospecto_registrado");
  const idNovena = companyIdDe(NOVENA.rfc);
  await ir(omar.p, `/operacion/clientes/${idNovena}/expediente`);
  await enviar(omar.p, omar.p.getByRole("button", { name: "Abrir versión 1" }), "expediente_version_creada");
  await campo(omar.p, "#dato-razonSocial", NOVENA.razonSocial);
  await campo(omar.p, "#dato-rfc", NOVENA.rfc);
  const sinGiroNiDomicilio = Object.entries(DATOS).filter(([nombre]) => nombre !== "giro" && !nombre.startsWith("domicilio"));
  for (const [nombre, valor] of sinGiroNiDomicilio) await campo(omar.p, `#dato-${nombre}`, valor);
  await enviar(omar.p, omar.p.getByRole("button", { name: "Guardar datos" }), "expediente_datos_guardados");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Enviar versión 1" }), "expediente_datos_incompletos");
  const textoFaltan = await aviso(omar.p);
  exigir(
    textoFaltan.includes("Faltan el giro y el domicilio. Captura esos datos en «Datos generales» y vuelve a enviar.")
      && !textoFaltan.includes("La base no respondió") && new URL(omar.p.url()).searchParams.get("en") === "enviar-titulo"
      && sql(`select estado from kyb_versiones where company_id = '${idNovena}'`) === "borrador"
      && cuenta(`audit_log where accion = 'expediente_enviado' and company_id = '${idNovena}'`) === 0,
    "serv-nuevo-6d. enviar sin giro ni domicilio: «Faltan el giro y el domicilio…», la versión sigue en borrador y sin evento «expediente_enviado»",
    textoFaltan,
  );
  await enVista(omar.p.locator("#aviso-operacion"));
  await foto(omar.p, "r9-enviar-sin-giro-ni-domicilio", false);
  await omar.nav.close();

  // serv-nuevo-6b: las fechas del folio de una coincidencia confirmada marcan su propio campo, no el folio.
  const celia = await abrir("celia");
  const caso = sql(`select id from lpb_coincidencias where estado = 'confirmada' and reporte_folio is null order by resuelta_en desc limit 1`);
  exigir(Boolean(caso), "novena. hay una coincidencia confirmada sin folio para anotarlo");
  const folioGuardado = () => sql(`select coalesce(reporte_folio, '') from lpb_coincidencias where id = '${caso}'`);
  for (const [nombre, codigo, real, forzada, texto] of [
    ["presentado", "dato_invalido_presentadoEl", hoyMexico(), "2026-02-30", "Revisa la fecha de presentación del reporte: debe existir en el calendario y no puede ser futura."],
    ["aviso", "dato_invalido_avisoClienteEl", hoyMexico(-1), "2026-13-01", "Revisa la fecha del aviso al cliente: debe existir en el calendario y no puede ser futura. Déjala vacía si aún no avisas."],
  ]) {
    await ir(celia.p, "/operacion/cumplimiento");
    const fila = celia.p.locator(`li:has([id="folio-${caso}"])`);
    await fila.locator(`[id="folio-${caso}"]`).fill("UIF-2026-0009");
    // La fecha de presentación siempre va; la del aviso al cliente solo en el segundo intento.
    await fila.locator(`[id="presentado-${caso}"]`).fill(nombre === "presentado" ? real : hoyMexico());
    if (nombre === "aviso") await fila.locator(`[id="aviso-${caso}"]`).fill(real);
    await armarFecha(celia.p, real, forzada);
    await enviar(celia.p, fila.getByRole("button", { name: "Anotar folio" }), codigo);
    await celia.p.unroute("**/*");
    exigir(
      (await aviso(celia.p)) === texto && new URL(celia.p.url()).searchParams.get("en") === `${nombre}-${caso}`
        && (await marcado(celia.p, `[id="${nombre}-${caso}"]`)) && (await enFoco(celia.p)) === `${nombre}-${caso}`
        && !(await marcado(celia.p, `[id="folio-${caso}"]`)) && (await marcados(celia.p)) === 1 && folioGuardado() === "",
      `serv-nuevo-6b. «${nombre === "presentado" ? "Presentado el" : "Aviso al cliente"}» ${forzada}: su aviso, solo ese campo marcado y con el foco (no el folio), sin folio guardado`,
      await aviso(celia.p),
    );
    exigir(await avisoYCampo(celia.p, `[id="${nombre}-${caso}"]`), `serv-nuevo-6b. la captura muestra el aviso y «${nombre}» marcado`);
    await foto(celia.p, `r9-folio-fecha-${nombre}-imposible`, false);
  }
  await celia.nav.close();

  // base-N27: con tres recuperaciones pendientes, el rechazo sin nota marca y enfoca solo la nota de esa tarjeta.
  const quienes = ["gil", "rosa", "aurelio"];
  const correos = quienes.map((quien) => sql(`select correo from users where id = '${E.IDS[quien]}'`));
  const ids = quienes.map((quien) => sql(`with r as (
      insert into auth_recuperaciones (id, user_id, solicitada_en, motivo) values (gen_random_uuid(), '${E.IDS[quien]}', now(), 'Cambié de teléfono y perdí la app.')
      returning id, user_id
    )
    insert into audit_log (id, operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, ocurrido_en)
    select gen_random_uuid(), (select id from operators order by alta_en limit 1), null, 'miembro', r.user_id, 'cliente',
      'recuperacion_solicitada', 'auth_recuperaciones', r.id, now()
    from r returning identificador`));
  const ofelia = await abrir("ofelia");
  envejecerFactor(E.IDS.ofelia, 6);
  await ir(ofelia.p, "/operacion/recuperaciones");
  const confirma = ofelia.p.getByRole("region", { name: "Confirma que eres tú" });
  await confirma.getByLabel("Código de la app autenticadora").fill(await totp("ofelia"));
  await confirma.getByRole("button", { name: "Confirmar con el código" }).click();
  await confirma.waitFor({ state: "detached", timeout: 20000 });
  await listo(ofelia.p);
  const tarjeta = (correo) => ofelia.p.locator("li.decision").filter({ hasText: correo });
  const nota = (indice) => `[id="nota-${ids[indice]}"]`;
  exigir((await Promise.all(correos.map((correo) => tarjeta(correo).count()))).every((n) => n === 1), "base-N27. tres recuperaciones pendientes en la bandeja");
  await enviar(ofelia.p, tarjeta(correos[1]).getByRole("button", { name: "Rechazar" }), "motivo_invalido");
  exigir(
    new URL(ofelia.p.url()).searchParams.get("en") === ids[1] && (await marcado(ofelia.p, nota(1))) && (await enFoco(ofelia.p)) === `nota-${ids[1]}`
      && !(await marcado(ofelia.p, nota(0))) && !(await marcado(ofelia.p, nota(2))) && (await marcados(ofelia.p)) === 1
      && cuenta(`auth_recuperaciones where id in ('${ids.join("','")}') and estado = 'solicitada'`) === 3,
    "base-N27. rechazar sin nota la recuperación de en medio: «en» es su id y solo su nota queda marcada y con el foco; las tres siguen pendientes",
    await aviso(ofelia.p),
  );
  exigir(await avisoYCampo(ofelia.p, nota(1)), "base-N27. la captura muestra el aviso y la nota marcada de la tarjeta de en medio");
  await foto(ofelia.p, "r9-recuperacion-nota-en-su-tarjeta", false);
  for (const [indice, correo] of correos.entries()) {
    await ofelia.p.locator(nota(indice)).fill("No se pudo confirmar la identidad por videollamada.");
    await enviar(ofelia.p, tarjeta(correo).getByRole("button", { name: "Rechazar" }), "decision_registrada");
  }
  exigir(
    cuenta(`auth_recuperaciones where id in ('${ids.join("','")}') and estado = 'rechazada'`) === 3,
    "base-N27. con su nota, las tres se rechazan: ninguna queda abierta",
  );
  await ofelia.nav.close();
}

// ---------- Orden ----------
let fallo = null;
try {
  if (FASES.includes("flujos")) {
    await flujo0();
    await flujo1();
    await flujo2();
    await flujo3();
    await flujo8a();
    await flujo4();
    await flujo8b();
    await flujo5();
    await flujo6();
    await flujo7();
    await flujo9();
    await flujo10();
    await flujo11();
    await flujo12();
    const sucios = abiertos.flatMap((a) => a.errores.map((e) => `${a.quien}: ${e}`));
    exigir(sucios.length === 0, "consola del navegador limpia en todos los flujos", sucios.slice(0, 5).join(" | "));
  } else {
    ctxEbano.id = companyIdDe(EBANO.rfc);
  }
  if (FASES.includes("pantallas")) await pantallas();
  if (FASES.includes("contraste")) await contraste();
  if (FASES.includes("regresiones")) {
    await regresiones();
    const sucios = abiertos.flatMap((a) => a.errores.map((e) => `${a.quien}: ${e}`));
    exigir(sucios.length === 0, "consola del navegador limpia en las regresiones", sucios.slice(0, 5).join(" | "));
  }
} catch (error) {
  fallo = error;
  console.error(error.message);
} finally {
  for (const { nav } of abiertos) if (nav.isConnected()) await nav.close().catch(() => {});
  mkdirSync(`${DIR}/datos`, { recursive: true });
  writeFileSync(`${DIR}/datos/resultados-${FASES.join("-")}.json`, JSON.stringify({ fases: FASES, comprobaciones: resultados }, null, 2));
  const fallas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - fallas} comprobaciones en verde, ${fallas} en rojo${fallo ? " (el recorrido se detuvo)" : ""}.`);
  process.exitCode = fallo || fallas ? 1 : 0;
}
