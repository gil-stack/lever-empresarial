// Recorrido de la Ola R1 (alta regulada) con Playwright headless propio, contra `next start`
// y la base que deja scripts/evidencia/ola-r-alta/preparar.ts. Pasos y variables en
// docs/evidencia/ola-r-alta/README.md.
//
//   ESTADO=/fuera/del/repo/ola-r-alta.json BASE=http://localhost:4811 \
//   [FASES=flujos,pantallas,contraste] node scripts/evidencia/ola-r-alta.mjs
//
// Todo pasa por clics, con la sesión SOFIPO o de cliente de cada persona. La base se toca como
// dueña solo para: envejecer el segundo factor de Ofelia (para ver «Confirma que eres tú» sin
// esperar 5 minutos), renovar el último uso de las sesiones sembradas, contar filas que prueban
// que un doble clic dejó una sola operación y, en el flujo 9, intentar como rol cliente las
// escrituras que la pantalla ya no ofrece. La fase «lumbre» de preparar.ts siembra la revisión
// de riesgo vencida del flujo 4. Solo corre contra un Postgres local.
import { execFileSync } from "node:child_process";
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
  await ctx.addCookies([
    { name: "tema", value: tema, domain: host, path: "/" },
    { name: "__Host-sesion", value: E.SESIONES[quien], domain: host, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
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
async function foto(p, nombre, completa = true) {
  numero += 1;
  const ruta = `${DIR}/capturas/${String(numero).padStart(2, "0")}-${nombre}.webp`;
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
  const caja = p.locator(".operacion-aviso");
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
  console.log("\n— Flujo 9: suspensión manual con doble firma; la consola no libera pagos ni prepara nómina");
  renovarSesiones();
  const rosa = await abrir("rosa");
  await ir(rosa.p, `/c/${TALLER}/consola/proveedores?pago=${PAGO_NORTE}`);
  exigir(await rosa.p.getByRole("button", { name: "Autorizar para pagar" }).isVisible(), "9. Rosa tiene abierto el pago de Servicios Norte por autorizar");
  const gil = await abrir("gil");
  await ir(gil.p, `/c/${TALLER}/consola/personas/nomina`);
  exigir(await gil.p.getByRole("button", { name: /^Preparar nómina del / }).isVisible(), "9. Gil tiene abierta la nómina por preparar");

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

  await rosa.p.getByRole("button", { name: "Autorizar para pagar" }).click();
  await rosa.p.getByText("La empresa está suspendida").first().waitFor({ timeout: 20000 });
  exigir(sql(`select estado from supplier_payment_requests where id = '${PAGO_NORTE}'`) === "por_autorizar", "9. «Autorizar para pagar» en la página abierta: la base lo rechaza y el pago sigue por autorizar");
  await foto(rosa.p, "f9-pago-rechazado-empresa-suspendida", false);
  await gil.p.getByRole("button", { name: /^Preparar nómina del / }).click();
  await gil.p.getByText("La empresa está suspendida").first().waitFor({ timeout: 20000 });
  exigir(cuenta(`payroll_batches where company_id = '${TALLER}'`) === 0, "9. «Preparar nómina» en la página abierta: la base lo rechaza y no hay lote");
  await foto(gil.p, "f9-nomina-rechazada-empresa-suspendida", false);
  await gil.nav.close();

  const directo = [
    ["liberar el pago", `update supplier_payment_requests set estado = 'listo_para_pagar', resuelto_por = '${E.IDS.rosa}', resuelto_en = now() where id = '${PAGO_NORTE}'`],
    ["preparar un lote", `insert into payroll_batches (id, company_id) values (gen_random_uuid(), '${TALLER}')`],
    ["editar la política", `update suppliers set nombre_comercial = 'cambio' where company_id = '${TALLER}'`],
  ];
  for (const [que, sentencia] of directo) {
    const salida = comoCliente(TALLER, que === "liberar el pago" ? E.IDS.rosa : E.IDS.gil, sentencia);
    exigir(salida.includes("empresa_suspendida"), `9. directo en la base como rol cliente, ${que}: rechazado con «empresa_suspendida»`, salida.split("\n")[0]);
  }
  await ir(rosa.p, `/c/${TALLER}/consola/proveedores`);
  exigir(await rosa.p.getByText("La operación de Taller del Cierre está suspendida.").isVisible(), "9. el aviso de empresa suspendida se ve arriba de la consola");
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

// ---------- Orden ----------
let fallo = null;
try {
  if (FASES.includes("flujos")) {
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
