// Recorrido de la Ola R2 (PLD) con Playwright headless propio, contra `next start` y la base que deja
// scripts/evidencia/ola-r2-pld/preparar.ts. Pasos y variables en docs/evidencia/ola-r2-pld/README.md.
//
//   ESTADO=/fuera/del/repo/ola-r2-pld.json BASE=http://localhost:4813 E2E_RELOJ_PLD=/fuera/del/repo/reloj.txt \
//   [FASES=flujos,pantallas,contraste] node scripts/evidencia/ola-r2-pld.mjs
//
// Todo pasa por clics, con la sesión SOFIPO o de cliente de cada persona. La base se toca como dueña
// solo para: contar filas (un doble clic deja una sola operación), renovar el último uso de las
// sesiones sembradas y el segundo factor de quien decide (o envejecerlo para ver «Confirma que eres
// tú»), fechar el caso del flujo 8 del 27 al 29 de octubre de 2026 y envejecer 61 días la alerta del
// flujo 9 (SQL exacto en el README), y en el flujo 13 intentar DELETE y TRUNCATE. El reloj fijo de PLD
// (tests/pld/reloj-preload.mjs) solo cambia el «hoy» con que se leen los plazos. Solo corre contra un
// Postgres local.
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
const RELOJ = process.env.E2E_RELOJ_PLD ?? "";
if (!RELOJ || RELOJ.includes("/docs/")) throw new Error("E2E_RELOJ_PLD tiene que apuntar al archivo del reloj fijo, el mismo que lee next start.");
const BASE = process.env.BASE ?? "http://localhost:4813";
const DIR = process.env.DIR ?? "docs/evidencia/ola-r2-pld";
const FASES = (process.env.FASES ?? "flujos,pantallas,contraste").split(",");
const TEMAS = ["oscuro", "claro", "lever"];
const ANCHOS = [1440, 390];
const TALLER = E.EMPRESA_TALLER;
const NOGAL = E.EMPRESA_NOGAL;
const COBRE = E.EMPRESA_COBRE;
const NOMBRES = { ofelia: "Ofelia Plataforma", omar: "Omar Originación", ana: "Ana Aprobación", celia: "Celia Cumplimiento", aurelio: "Aurelio Auditoría" };
const PERSONAL = ["ofelia", "omar", "ana", "celia", "aurelio"];
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
if (hoy() < "2026-11-06" || hoy() > "2026-12-31") throw new Error("Las fechas del flujo 8 (sesión del 30-oct, 2-nov inhábil) suponen que hoy es entre el 6-nov y el 31-dic de 2026.");

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

function sql(consulta, url = DUENO) {
  return execFileSync("psql", [url, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8" }).trim();
}
const cuenta = (desde) => Number(sql(`select count(*) from ${desde}`));
/** Una sentencia que la base debe rechazar; devuelve el mensaje. */
function rechazo(url, sentencia) {
  try {
    execFileSync("psql", [url, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", `begin; ${sentencia}; rollback;`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return "sin error";
  } catch (error) {
    return String(error.stderr ?? error.message).trim();
  }
}
const renovarSesiones = () => sql("update sessions set ultimo_uso = now() where expires_at > now()");
/** El segundo factor de la sesión de alguien, probado hace `minutos` (0 = ahora). */
function factor(userId, minutos) {
  sql(`begin; set local session_replication_role = replica;
       update sessions set segundo_factor_en = now() - interval '${minutos} minutes' where user_id = '${userId}'; commit;`);
}
/** El «hoy» con que la aplicación lee los plazos de PLD. Vacío: la hora real. */
function reloj(iso) {
  writeFileSync(RELOJ, iso ?? "");
}

// ---------- Días hábiles, calculados aparte de la base para comprobarla ----------
// Inhábiles de 2026 entre semana en los dos instrumentos del DOF del 10-12-2025 (criterio conservador
// de la 0030: un día es inhábil si es fin de semana o si los dos instrumentos lo dicen).
const INHABILES_2026 = new Set(["2026-01-01", "2026-02-02", "2026-03-16", "2026-04-02", "2026-04-03", "2026-05-01", "2026-09-16", "2026-11-02", "2026-11-16"]);
const masDias = (fecha, n) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const habil = (fecha) => ![0, 6].includes(new Date(`${fecha}T12:00:00Z`).getUTCDay()) && !INHABILES_2026.has(fecha);
function sumarHabiles(desde, n) {
  let dia = desde;
  for (let contados = 0; contados < n; ) {
    dia = masDias(dia, 1);
    if (habil(dia)) contados += 1;
  }
  return dia;
}
function habilesEntre(desde, hasta) {
  let total = 0;
  for (let dia = masDias(desde, 1); dia <= hasta; dia = masDias(dia, 1)) if (habil(dia)) total += 1;
  return total;
}
const fechaDia = (valor) => new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${valor}T00:00:00Z`));

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
const abiertos = new Set();
async function abrir(quien, { tema = "oscuro", ancho = 1440 } = {}) {
  const nav = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  abiertos.add(nav);
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
  return { nav, p, errores };
}
async function cerrar({ nav, errores }, quien) {
  await nav.close();
  abiertos.delete(nav);
  exigir(errores.length === 0, `consola limpia en la sesión de ${quien}`, errores.join(" | "));
}
async function ir(p, ruta) {
  return p.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
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
    if (!completa) throw error;
    console.log(`NOTA  ${nombre}: la página no cabe en una captura completa; se guarda la ventana`);
    imagen = await p.screenshot({ fullPage: false });
  }
  await sharp(imagen).webp({ quality: 76 }).toFile(ruta);
  return ruta;
}
async function aviso(p) {
  const caja = p.locator("#aviso-operacion");
  return (await caja.count()) ? (await caja.innerText()).replace(/\s+/g, " ").trim() : "";
}
/** Envía un formulario con un clic (o doble clic) real y espera la redirección con su aviso. */
async function enviar(p, boton, codigo, { doble = false } = {}) {
  await p.evaluate(() => history.replaceState(history.state, "", location.pathname + location.hash));
  await (doble ? boton.dblclick() : boton.click());
  await p.waitForURL((url) => url.searchParams.get("aviso") !== null, { timeout: 20000 });
  await listo(p);
  const obtenido = new URL(p.url()).searchParams.get("aviso");
  if (codigo) exigir(obtenido === codigo, `aviso «${codigo}» tras la acción`, `llegó «${obtenido}»: ${await aviso(p)}`);
  return obtenido;
}
async function descargar(p, accion) {
  const [descarga] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), accion()]);
  const ruta = await descarga.path();
  return { nombre: descarga.suggestedFilename(), bytes: readFileSync(ruta) };
}
const PDF = (titulo) => Buffer.from(`%PDF-1.4\n% ${titulo}\n1 0 obj << /Type /Catalog >> endobj\n${"0".repeat(64)}\n%%EOF\n`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const PLD_EN_PANTALLA = /Alertas PLD|Excede el perfil|Fraccionamiento|Nómina atípica|Aviso del personal|perfil transaccional|caso de análisis|Comité de Comunicación|operación inusual|\bPLD\b/i;
const fila = (p, texto) => p.locator("li", { hasText: texto });
/** La sección de una Hoja: el id va en su h2 y la sección lo nombra con aria-labelledby. */
const hoja = (p, id) => p.locator(`section[aria-labelledby="${id}"]`);
/** Confirma la identidad con el código de la app autenticadora en la región «Confirma que eres tú». */
async function confirmarIdentidad(p, quien) {
  const confirma = p.getByRole("region", { name: "Confirma que eres tú" });
  await confirma.getByLabel("Código de la app autenticadora").fill(await totp(quien));
  await confirma.getByRole("button", { name: "Confirmar con el código" }).click();
  await confirma.waitFor({ state: "detached", timeout: 20000 });
  await listo(p);
}

// ---------- Datos del recorrido ----------
const INTEGRANTES = {
  presidente: { nombres: "Pedro", primer: "Ramos", segundo: "Luna", cargo: "PRESIDENTE", rfc: "RALP700101AB1", curp: "RALP700101HDFMNDA1", area: "Dirección General", cargoEntidad: "Director general" },
  secretario: { nombres: "Sofía", primer: "Torres", segundo: "Díaz", cargo: "SECRETARIO", rfc: "TODS750202AB2", curp: "TODS750202MDFRZFA2", area: "Jurídico", cargoEntidad: "Directora jurídica" },
  oficial: { nombres: "Celia", primer: "Morales", segundo: "Vega", cargo: "INTEGRANTE", rfc: "MOVC800303AB3", curp: "MOVC800303MDFRGLA3", area: "Cumplimiento", cargoEntidad: "Oficial de Cumplimiento", oficial: true },
  vocal: { nombres: "Iván", primer: "Garza", segundo: "Solís", cargo: "INTEGRANTE", rfc: "GASI820404AB4", curp: "GASI820404HNLRLVA4", area: "Operaciones", cargoEntidad: "Director de operaciones" },
  suplente: { nombres: "Pablo", primer: "Ruiz", segundo: "Orta", cargo: "PRESIDENTE", rfc: "RUOP850505AB5", curp: "RUOP850505HDFZRBA5", area: "Finanzas", cargoEntidad: "Director de finanzas", suplenteDe: 0 },
};
const DESIGNADO = "2026-10-28";
const SIT = { presidente: "PEDRO RAMOS LUNA", secretario: "SOFIA TORRES DIAZ", oficial: "CELIA MORALES VEGA", vocal: "IVAN GARZA SOLIS" };
const ids = {};

async function llenarIntegrantes(p, filas) {
  for (const [i, persona] of filas.entries()) {
    await p.locator(`#integrante-nombres-${i}`).fill(persona.nombres);
    await p.locator(`#integrante-primer-${i}`).fill(persona.primer);
    await p.locator(`#integrante-segundo-${i}`).fill(persona.segundo);
    await p.locator(`#integrante-cargo-${i}`).selectOption(persona.cargo);
    await p.locator(`#integrante-titularidad-${i}`).selectOption(persona.suplenteDe === undefined ? "TITULAR" : "SUPLENTE");
    if (persona.suplenteDe !== undefined) await p.locator(`#integrante-suplente-${i}`).selectOption({ label: `La persona ${persona.suplenteDe + 1} de este formulario` });
    await p.locator(`#integrante-rfc-${i}`).fill(persona.rfc);
    await p.locator(`#integrante-curp-${i}`).fill(persona.curp);
    await p.locator(`#integrante-area-${i}`).fill(persona.area);
    await p.locator(`#integrante-cargo-entidad-${i}`).fill(persona.cargoEntidad);
    await p.locator(`#integrante-designado-${i}`).fill(DESIGNADO);
    if (persona.oficial) await p.locator(`input[name="esOficial-${i}"]`).check();
  }
}

async function registrarSesion(p, fecha, presentes, { auditor = false } = {}) {
  await ir(p, "/operacion/comite#sesiones-titulo");
  await p.locator("#sesion-fecha").fill(fecha);
  for (const nombre of presentes) await p.getByLabel(new RegExp(`${nombre} · `)).check();
  if (auditor) await p.locator('input[name="auditorPresente"]').check();
  await p.evaluate(() => history.replaceState(history.state, "", location.pathname + location.hash));
  await p.getByRole("button", { name: "Registrar sesión" }).dblclick();
  await p.waitForURL((url) => url.pathname.startsWith("/operacion/comite/sesiones/") && url.searchParams.get("aviso") !== null, { timeout: 20000 });
  await listo(p);
  return { id: new URL(p.url()).pathname.split("/").pop(), aviso: new URL(p.url()).searchParams.get("aviso") };
}

/** Cada integrante presente vota en la fila de la propuesta del caso; doble clic = un voto. */
async function votar(p, razonSocial, votos) {
  for (const [nombre, voto] of votos) {
    const tema = p.locator("li", { has: p.locator("h3", { hasText: razonSocial }) }).first();
    const boton = tema.getByRole("button", { name: `${nombre} vota ${voto === "a_favor" ? "a favor" : "en contra"}` });
    await p.evaluate(() => history.replaceState(history.state, "", location.pathname + location.hash));
    await boton.dblclick();
    await p.waitForURL((url) => url.searchParams.get("aviso") !== null, { timeout: 20000 });
    await listo(p);
  }
}

// ---------- Flujos ----------
async function flujo1() {
  console.log("\n— Flujo 1: perfil transaccional; sin perfil la base no deja activar; con perfil, otra persona aprueba");
  renovarSesiones();
  factor(E.IDS.ana, 0);
  const ana = await abrir("ana");
  await ir(ana.p, "/operacion/aprobaciones");
  await ana.p.locator("li.decision", { hasText: "Nogal Comercial" }).getByRole("button", { name: "Aprobar", exact: true }).click();
  await ana.p.waitForURL((url) => url.searchParams.get("aviso") !== null, { timeout: 20000 });
  await listo(ana.p);
  const codigo = new URL(ana.p.url()).searchParams.get("aviso");
  exigir(codigo === "activacion_sin_perfil_transaccional", "1. la base rechaza activar a Nogal: falta el perfil transaccional", codigo);
  exigir((await aviso(ana.p)).includes("falta el perfil transaccional"), "1. Aprobación ve el mensaje del candado", await aviso(ana.p));
  exigir(sql(`select estado from companies where id = '${NOGAL}'`) === "en_alta", "1. Nogal sigue en alta");
  await foto(ana.p, "f1-activacion-rechazada-sin-perfil");
  await cerrar(ana, "Ana");

  const omar = await abrir("omar");
  await ir(omar.p, `/operacion/clientes/${NOGAL}/expediente#perfil-titulo`);
  await omar.p.locator("#perfil-pagos-monto").fill("250,000.00");
  await omar.p.locator("#perfil-pagos-operaciones").fill("30");
  await omar.p.locator("#perfil-nomina-monto").fill("90000");
  await omar.p.locator("#perfil-nomina-operaciones").fill("2");
  await enviar(omar.p, omar.p.getByRole("button", { name: "Registrar perfil" }), "perfil_declarado", { doble: true });
  exigir(cuenta(`pld_perfiles where company_id = '${NOGAL}'`) === 1, "1. doble clic en «Registrar perfil» = 1 perfil");
  exigir(cuenta(`audit_log where accion = 'expediente_perfil_declarado' and company_id = '${NOGAL}'`) === 1, "1. un solo evento «expediente_perfil_declarado»");
  exigir(sql(`select pagos_monto_mensual_centavos || ' ' || nomina_monto_mensual_centavos from pld_perfiles where company_id = '${NOGAL}'`) === "25000000 9000000", "1. montos en centavos: $250,000.00 y $90,000.00");
  await foto(omar.p, "f1-perfil-declarado");
  await cerrar(omar, "Omar");

  factor(E.IDS.ana, 0);
  const ana2 = await abrir("ana");
  await ir(ana2.p, "/operacion/aprobaciones");
  await ana2.p.locator("li.decision", { hasText: "Nogal Comercial" }).getByRole("button", { name: "Aprobar", exact: true }).click();
  await ana2.p.waitForURL((url) => url.searchParams.get("aviso") !== null, { timeout: 20000 });
  await listo(ana2.p);
  exigir(new URL(ana2.p.url()).searchParams.get("aviso") === "decision_registrada", "1. con el perfil, Aprobación (otra persona) aprueba la activación");
  exigir(sql(`select estado from companies where id = '${NOGAL}'`) === "activa", "1. Nogal queda activa");
  await foto(ana2.p, "f1-activacion-aprobada");
  await cerrar(ana2, "Ana");
}

async function autorizarPago(pago) {
  factor(E.IDS.rosa, 0);
  const rosa = await abrir("rosa");
  await ir(rosa.p, `/c/${TALLER}/consola/proveedores?pago=${pago}`);
  await rosa.p.getByRole("button", { name: "Autorizar para pagar" }).dblclick();
  await rosa.p.locator(".detalle-cabeza").getByText("Listo para pagar", { exact: true }).waitFor({ timeout: 20000 });
  await listo(rosa.p);
  return rosa;
}

async function flujo2() {
  console.log("\n— Flujo 2: un pago que cruza el perfil del mes; alerta «Excede el perfil», el pago no se bloquea");
  renovarSesiones();
  const rosa = await autorizarPago(E.PAGO_EXCEDE);
  exigir(sql(`select estado from supplier_payment_requests where id = '${E.PAGO_EXCEDE}'`) === "listo_para_pagar", "2. el pago N-204 queda listo para pagar: la alerta no lo bloquea");
  exigir(cuenta(`audit_log where accion = 'autorizar_pago_proveedor' and identificador = '${E.PAGO_EXCEDE}'`) === 1, "2. doble clic en «Autorizar para pagar» = 1 autorización");
  const alerta = sql(`select (observado->>'suma_mes_centavos') || ' ' || (observado->>'declarado_centavos') from pld_alertas where regla = 'excede_perfil' and company_id = '${TALLER}'`);
  exigir(alerta === "6090500 5000000", "2. una alerta «excede_perfil»: el mes suma $60,905.00 contra $50,000.00 declarados", alerta);
  await foto(rosa.p, "f2-pago-autorizado-sin-bloqueo", false);
  const html = await rosa.p.content();
  exigir(!PLD_EN_PANTALLA.test(html), "2. la consola del cliente (HTML y RSC) no menciona nada de PLD", html.match(PLD_EN_PANTALLA)?.[0] ?? "");
  await cerrar(rosa, "Rosa");

  const gil = await abrir("gil");
  for (const ruta of [`/c/${TALLER}/consola`, `/c/${TALLER}/consola/proveedores`, `/c/${TALLER}/consola/pendientes`]) {
    await ir(gil.p, ruta);
    exigir(!PLD_EN_PANTALLA.test(await gil.p.content()), `2. ${ruta}: nada de PLD para el cliente`);
  }
  await ir(gil.p, `/c/${TALLER}/consola`);
  await foto(gil.p, "f2-consola-del-cliente-sin-pld");
  await cerrar(gil, "Gil");

  const celia = await abrir("celia");
  await ir(celia.p, "/operacion/pld");
  const item = fila(celia.p, "Excede el perfil · Taller del Cierre").filter({ hasText: "Pagos a proveedores" });
  exigir((await item.count()) === 1, "2. Cumplimiento ve «Excede el perfil · Taller del Cierre»");
  exigir((await item.innerText()).includes("Quedan 60 días"), "2. con sus días restantes: «Quedan 60 días»", await item.innerText());
  exigir((await item.innerText()).includes("$60,905.00"), "2. con la suma del mes contra el perfil", await item.innerText());
  await foto(celia.p, "f2-alerta-excede-el-perfil");
  await cerrar(celia, "Celia");
}

async function flujo3() {
  console.log("\n— Flujo 3: tres instrucciones de menos de $100,000.00 a la misma CLABE que suman más");
  renovarSesiones();
  const rosa = await autorizarPago(E.PAGO_FRACCION);
  await cerrar(rosa, "Rosa");
  const alerta = sql(`select (observado->>'instrucciones') || ' ' || (observado->>'suma_centavos') || ' ' || (observado->>'clabe') from pld_alertas where regla = 'fraccionamiento' and company_id = '${TALLER}'`);
  exigir(alerta === "3 10590500 002180701150123452", "3. una alerta «fraccionamiento»: 3 instrucciones a la misma CLABE suman $105,905.00", alerta);
  exigir(cuenta(`pld_alertas where regla = 'excede_perfil' and company_id = '${TALLER}'`) === 1, "3. el perfil ya estaba cruzado este mes: no hay una segunda «Excede el perfil»");
  const celia = await abrir("celia");
  await ir(celia.p, "/operacion/pld");
  const item = fila(celia.p, "Fraccionamiento · Taller del Cierre");
  exigir((await item.count()) === 1 && (await item.innerText()).includes("Quedan 60 días"), "3. Cumplimiento ve «Fraccionamiento · Taller del Cierre» con sus días", await item.innerText().catch(() => ""));
  await foto(celia.p, "f3-alerta-fraccionamiento");
  await cerrar(celia, "Celia");
}

async function flujo4() {
  console.log("\n— Flujo 4: un lote de nómina que pasa el monto de nómina declarado");
  renovarSesiones();
  const gil = await abrir("gil");
  await ir(gil.p, `/c/${TALLER}/consola/personas/nomina`);
  await gil.p.getByRole("button", { name: /^Preparar nómina del / }).dblclick();
  await gil.p.waitForFunction(() => !document.querySelector("button[aria-busy=true]"), null, { timeout: 20000 }).catch(() => {});
  for (let i = 0; i < 40 && cuenta(`payroll_batches where company_id = '${TALLER}'`) === 0; i += 1) await gil.p.waitForTimeout(250);
  await listo(gil.p);
  exigir(cuenta(`payroll_batches where company_id = '${TALLER}'`) === 1, "4. doble clic en «Preparar nómina» = 1 lote");
  exigir(!PLD_EN_PANTALLA.test(await gil.p.content()), "4. la nómina del cliente no menciona nada de PLD");
  await foto(gil.p, "f4-nomina-preparada");
  await cerrar(gil, "Gil");
  const alerta = sql(`select (observado->>'monto_centavos') || ' ' || (observado->>'lote_sobre_perfil') from pld_alertas where regla = 'nomina_atipica' and company_id = '${TALLER}'`);
  exigir(alerta === "1850000 true", "4. una alerta «nomina_atipica»: el lote de $18,500.00 pasa los $15,000.00 declarados", alerta);
  const celia = await abrir("celia");
  await ir(celia.p, "/operacion/pld");
  exigir((await fila(celia.p, "Nómina atípica · Taller del Cierre").count()) === 1, "4. Cumplimiento ve «Nómina atípica · Taller del Cierre»");
  await foto(celia.p, "f4-alerta-nomina-atipica");
  await cerrar(celia, "Celia");
}

async function emitirAviso(quien, { tipo, empresa, descripcion, mencionada = null }) {
  const s = await abrir(quien);
  await ir(s.p, "/operacion/avisos");
  await s.p.locator("#aviso-tipo").selectOption(tipo);
  const empresaId = await s.p.locator("#aviso-empresa option", { hasText: empresa }).first().getAttribute("value");
  await s.p.locator("#aviso-empresa").selectOption(empresaId);
  await s.p.locator("#aviso-descripcion").fill(descripcion);
  if (mencionada) {
    const valor = await s.p.locator("#aviso-mencionada option", { hasText: mencionada }).first().getAttribute("value");
    await s.p.locator("#aviso-mencionada").selectOption(valor);
  }
  await enviar(s.p, s.p.getByRole("button", { name: "Enviar aviso" }), "pld_aviso_emitido", { doble: true });
  return s;
}

async function flujo5() {
  console.log("\n— Flujo 5: aviso del personal que menciona a otra persona; confidencial (60ª)");
  renovarSesiones();
  const antes = cuenta("pld_avisos");
  const omar = await emitirAviso("omar", {
    tipo: "posible_interna_preocupante", empresa: "Taller del Cierre", mencionada: NOMBRES.aurelio,
    descripcion: "El 4 de noviembre vi que alguien de Auditoría pidió por teléfono los datos de los pagos de Taller del Cierre fuera del sistema.",
  });
  exigir(cuenta("pld_avisos") === antes + 1, "5. doble clic en «Enviar aviso» = 1 aviso");
  ids.avisoOmar = sql("select id from pld_avisos order by registrado_en desc limit 1");
  exigir((await hoja(omar.p, "acuses-titulo").innerText()).includes(ids.avisoOmar.slice(0, 8).toUpperCase()), `5. quien avisa ve su acuse con el folio ${ids.avisoOmar.slice(0, 8).toUpperCase()}`);
  exigir(!(await hoja(omar.p, "acuses-titulo").innerText()).includes("Auditoría pidió"), "5. el acuse no repite el texto del aviso");
  await foto(omar.p, "f5-acuse-de-quien-avisa");
  await cerrar(omar, "Omar");

  const celia = await abrir("celia");
  await ir(celia.p, "/operacion/pld");
  exigir((await fila(celia.p, "Aviso del personal · Taller del Cierre").count()) === 1, "5. Cumplimiento ve la alerta «Aviso del personal · Taller del Cierre»");
  await foto(celia.p, "f5-cumplimiento-ve-el-aviso");
  await cerrar(celia, "Celia");

  const aurelio = await abrir("aurelio");
  await ir(aurelio.p, "/operacion/pld");
  exigir((await fila(aurelio.p, "Aviso del personal").count()) === 0, "5. la persona mencionada (Aurelio, Auditoría) no ve la alerta");
  await ir(aurelio.p, "/operacion/bitacora");
  exigir(!(await aurelio.p.content()).includes("Emitió un aviso a Cumplimiento"), "5. ni el evento en su bitácora");
  await foto(aurelio.p, "f5-la-persona-mencionada-no-lo-ve");
  await cerrar(aurelio, "Aurelio");

  const ofelia = await abrir("ofelia");
  await ir(ofelia.p, "/operacion/bitacora");
  const bitacora = await ofelia.p.content();
  exigir(!bitacora.includes("Emitió un aviso a Cumplimiento") && !/pld_(aviso|caso|alerta|nota|documento|propuesta|voto|dictamen|reporte|sesion|acta|comite|modo|parametros|periodico|entidad|manifiesto|archivo)/.test(await ofelia.p.locator("main").innerText()), "5. la bitácora de Administración no muestra el aviso");
  exigir(cuenta(`audit_log where accion = 'pld_aviso_emitido' and identificador = '${ids.avisoOmar}'`) === 1, "5. el evento existe en la base: solo está oculto");
  await foto(ofelia.p, "f5-bitacora-de-administracion-sin-el-aviso");
  await cerrar(ofelia, "Ofelia");

  // Un segundo aviso, de Aprobación, sobre Cobre: su caso se dictamina «no reportar» (flujo 7).
  const ana = await emitirAviso("ana", {
    tipo: "posible_inusual", empresa: "Cobre Antiguo",
    descripcion: "Cobre Antiguo pidió cambiar su CLABE dos veces en una semana y no explicó por qué.",
  });
  await cerrar(ana, "Ana");
}

async function abrirCaso(p, texto, detalle = "") {
  await ir(p, "/operacion/pld");
  await enviar(p, fila(p, texto).filter({ hasText: detalle }).getByRole("button", { name: "Abrir caso" }), "pld_caso_abierto", { doble: true });
  return new URL(p.url()).pathname.split("/").pop();
}

async function proponer(p, propuesta, justificacion) {
  await p.locator("#propuesta-propuesta").selectOption(propuesta);
  await p.locator("#propuesta-justificacion").fill(justificacion);
  await enviar(p, p.getByRole("button", { name: "Registrar propuesta" }), "pld_propuesta_registrada", { doble: true });
}

async function flujo6() {
  console.log("\n— Flujo 6: Cumplimiento analiza: caso con la serie de Taller, nota, documento y propuesta");
  renovarSesiones();
  const celia = await abrir("celia");
  const { p } = celia;
  ids.casoTaller = await abrirCaso(p, "Excede el perfil · Taller del Cierre", "Pagos a proveedores");
  exigir(cuenta(`pld_casos where company_id = '${TALLER}'`) === 1, "6. doble clic en «Abrir caso» = 1 caso");
  // El lote de nómina sobre el perfil dio dos alertas (27ª y 41ª); van en la misma serie.
  for (const regla of ["Fraccionamiento", "Nómina atípica", "Excede el perfil"]) {
    const sumable = p.locator("li", { has: p.locator("h4", { hasText: regla }) });
    await enviar(p, sumable.getByRole("button", { name: "Sumar a este caso" }), "pld_alerta_sumada", { doble: true });
  }
  exigir(cuenta(`pld_caso_alertas where caso_id = '${ids.casoTaller}'`) === 4, "6. la serie de Taller va en un solo caso: el perfil de pagos y de nómina, el fraccionamiento y la nómina atípica");
  exigir((await p.locator("li", { has: p.locator("h4", { hasText: "Aviso del personal" }) }).count()) === 1, "6. el aviso del personal queda fuera, para su propio caso");

  await p.locator("#nota-texto").fill("Los tres pagos van al mismo proveedor y la nómina subió con una sola persona. Pido el contrato de suministro.");
  await enviar(p, p.getByRole("button", { name: "Agregar nota" }), "pld_nota_agregada", { doble: true });
  exigir(cuenta(`pld_notas where caso_id = '${ids.casoTaller}'`) === 1, "6. doble clic en «Agregar nota» = 1 nota");

  const soporte = PDF("Contrato de suministro de Taller del Cierre");
  await p.locator("#documento-archivo").setInputFiles({ name: "contrato-suministro.pdf", mimeType: "application/pdf", buffer: soporte });
  await enviar(p, p.getByRole("button", { name: "Subir documento" }), "pld_documento_cargado", { doble: true });
  exigir(cuenta(`pld_documentos where caso_id = '${ids.casoTaller}'`) === 1, "6. doble clic en «Subir documento» = 1 documento");
  const bajado = await descargar(p, () => p.getByRole("link", { name: "contrato-suministro.pdf" }).click());
  exigir(sha256(bajado.bytes) === sha256(soporte), "6. el documento se descarga igual a como se subió (misma huella)");
  exigir(cuenta(`audit_log where accion = 'pld_documento_descargado'`) === 1, "6. la descarga deja su evento en la bitácora");

  await proponer(p, "reportar_inusual", "Fraccionamiento al mismo proveedor y nómina fuera del perfil sin justificación documental.");
  exigir(cuenta(`pld_propuestas where caso_id = '${ids.casoTaller}'`) === 1, "6. doble clic en «Registrar propuesta» = 1 propuesta");
  await foto(p, "f6-caso-con-nota-documento-y-propuesta");
  await cerrar(celia, "Celia");
}

async function flujo7() {
  console.log("\n— Flujo 7: Comité: integrantes y validaciones, auditor, aviso 49ª, sesiones, votos, acta y dictamen");
  renovarSesiones();
  const celia = await abrir("celia");
  const { p } = celia;
  const { presidente, secretario, oficial, vocal, suplente } = INTEGRANTES;
  for (const [filas, codigo, texto] of [
    [[presidente, { ...secretario, cargo: "PRESIDENTE" }, oficial], "comite_presidente_unico", "un segundo presidente titular"],
    [[presidente, { ...secretario, oficial: true }], "comite_minimo_tres_titulares", "menos de tres titulares"],
    [[presidente, secretario, vocal], "comite_sin_oficial", "la falta del Oficial"],
  ]) {
    await ir(p, "/operacion/comite#integrantes-titulo");
    await llenarIntegrantes(p, filas);
    await enviar(p, p.getByRole("button", { name: "Registrar en el Comité" }), codigo);
    exigir(cuenta("pld_comite_integrantes") === 0, `7. la validación rechaza ${texto} y no guarda a nadie`);
  }
  await foto(p, "f7-integrantes-validacion-sin-oficial");
  await ir(p, "/operacion/comite#integrantes-titulo");
  await llenarIntegrantes(p, [presidente, secretario, oficial, vocal, suplente]);
  await enviar(p, p.getByRole("button", { name: "Registrar en el Comité" }), "pld_integrantes_registrados", { doble: true });
  exigir(cuenta("pld_comite_integrantes") === 5, "7. doble clic en «Registrar en el Comité» = 5 integrantes, una vez");
  const vence = sumarHabiles(DESIGNADO, 15);
  exigir(vence === "2026-11-20", "7. 15 días hábiles desde el 28-oct saltan el 2 y el 16 de noviembre: 20-nov", vence);
  const comunicaciones = await hoja(p, "comunicaciones-titulo").innerText();
  exigir((comunicaciones.match(new RegExp(`Comunicar a más tardar el ${fechaDia(vence)}`, "g")) ?? []).length === 5, `7. cada designación con su pendiente 49ª: «Comunicar a más tardar el ${fechaDia(vence)}»`, comunicaciones.slice(0, 300));
  exigir((await hoja(p, "comunicaciones-titulo").locator("pre").innerText()).includes("RAMOS"), "7. lo que el Oficial captura en el SITI está a la vista, en mayúsculas sin acentos");
  await foto(p, "f7-integrantes-y-aviso-49a");
  await ir(p, "/operacion/cumplimiento#pld-comite-titulo");
  exigir((await hoja(p, "pld-comite-titulo").innerText()).includes(`Designación de ${SIT.presidente}`), "7. la bandeja de Cumplimiento lista las designaciones por comunicar");
  await foto(p, "f7-bandeja-designaciones-por-comunicar");

  await ir(p, "/operacion/comite#auditor-titulo");
  await p.locator("#auditor-nombre").fill("Raquel Espinosa Lara");
  await p.locator("#auditor-cargo").fill("Auditora interna");
  await p.locator("#auditor-designado").fill(DESIGNADO);
  await enviar(p, p.getByRole("button", { name: "Registrar auditor" }), "pld_auditor_registrado", { doble: true });
  exigir(cuenta("pld_comite_auditores") === 1, "7. doble clic en «Registrar auditor» = 1 auditor (no es integrante)");

  await ir(p, "/operacion/comite#comunicaciones-titulo");
  await p.locator("#comunicacion-folio").fill("SITI-INT-2026-0001");
  await p.locator("#comunicacion-recibido").fill(`${hoy()}T09:00`);
  await enviar(p, p.getByRole("button", { name: "Registrar comunicación" }), "pld_comunicacion_registrada", { doble: true });
  exigir(cuenta("pld_comite_comunicaciones") === 1, "7. doble clic en «Registrar comunicación» = 1 acuse");
  exigir((await hoja(p, "comunicaciones-titulo").innerText()).includes("Nada por comunicar"), "7. con el acuse, las cinco designaciones quedan comunicadas");

  // El caso del aviso de Aprobación (Cobre): su propuesta es «no reportar».
  ids.casoCobre = await abrirCaso(p, "Aviso del personal · Cobre Antiguo");
  await proponer(p, "no_reportar", "Cobre explicó por escrito el cambio de banco y presentó el contrato de la cuenta nueva.");

  const s1 = await registrarSesion(p, hoy(), [SIT.presidente, SIT.secretario], { auditor: true });
  exigir(s1.aviso === "pld_sesion_sin_quorum", "7. dos de cuatro titulares: la sesión queda «sin quórum»", s1.aviso);
  exigir(await p.getByText("Sin quórum: no admite votos").isVisible(), "7. la sesión sin quórum lo dice y no ofrece votar");
  exigir((await p.getByRole("button", { name: /vota a favor/ }).count()) === 0, "7. ni un botón de voto");
  exigir(cuenta("pld_sesiones") === 1, "7. doble clic en «Registrar sesión» = 1 sesión");
  await foto(p, "f7-sesion-sin-quorum");

  const s2 = await registrarSesion(p, hoy(), [SIT.presidente, SIT.secretario, SIT.oficial, SIT.vocal], { auditor: true });
  ids.sesionHoy = s2.id;
  exigir(s2.aviso === "pld_sesion_registrada" && cuenta("pld_sesiones") === 2, "7. cuatro de cuatro titulares: sesión con quórum (doble clic = 1 sesión más)", s2.aviso);
  exigir((await hoja(p, "quorum-titulo").innerText()).includes("Asistió, con voz y sin voto"), "7. el auditor asiste con voz y sin voto");
  await votar(p, "Taller del Cierre", [[SIT.presidente, "a_favor"], [SIT.vocal, "a_favor"], [SIT.secretario, "en_contra"], [SIT.oficial, "en_contra"]]);
  exigir(cuenta(`pld_votos where sesion_id = '${s2.id}'`) === 4, "7. doble clic en cada voto = 4 votos, uno por integrante");
  exigir(sql(`select pld_resultado_votacion('${s2.id}', (select id from pld_propuestas where caso_id = '${ids.casoTaller}'))`) === "aprobada", "7. empate 2-2: decide el presidente, la propuesta queda aprobada");
  exigir((await p.locator("li", { has: p.locator("h3", { hasText: "Taller del Cierre" }) }).first().innerText()).includes("Aprobada"), "7. la pantalla dice «Aprobada»");
  await votar(p, "Cobre Antiguo", [[SIT.presidente, "a_favor"], [SIT.secretario, "a_favor"], [SIT.oficial, "a_favor"], [SIT.vocal, "a_favor"]]);
  await foto(p, "f7-sesion-con-empate-que-decide-el-presidente");

  const acta = await descargar(p, () => p.getByRole("link", { name: "Descargar el acta en PDF para firmar" }).click());
  exigir(acta.bytes.subarray(0, 5).toString() === "%PDF-", "7. Lever genera el acta en PDF");
  await p.locator("#acta-archivo").setInputFiles({ name: "acta-firmada.pdf", mimeType: "application/pdf", buffer: PDF("Acta firmada") });
  await enviar(p, p.getByRole("button", { name: "Subir acta firmada" }), "pld_acta_cargada", { doble: true });
  exigir(cuenta(`pld_actas where sesion_id = '${s2.id}'`) === 1, "7. doble clic en «Subir acta firmada» = 1 acta");
  await foto(p, "f7-acta-firmada");

  // Dictamen del Comité: el factor de Celia tiene 31 minutos y la página pide confirmarlo.
  factor(E.IDS.celia, 31);
  await ir(p, `/operacion/pld/casos/${ids.casoTaller}#dictamen-titulo`);
  exigir(await p.getByRole("region", { name: "Confirma que eres tú" }).isVisible(), "7. con el factor de hace 31 minutos, el dictamen pide «Confirma que eres tú»");
  await foto(p, "f7-dictamen-pide-confirmar");
  await confirmarIdentidad(p, "celia");
  anotar("7. Celia confirmó con su app autenticadora");
  await p.locator("#dictamen-justificacion").fill("El Comité aprobó reportar la serie como operación inusual en la sesión de hoy.");
  await enviar(p, p.getByRole("button", { name: "Registrar dictamen" }), "pld_dictamen_registrado", { doble: true });
  exigir(cuenta(`pld_dictamenes where caso_id = '${ids.casoTaller}'`) === 1, "7. doble clic en «Registrar dictamen» = 1 dictamen");
  const dictamen = sql(`select dictaminado_el || ' ' || reporte_vence_el || ' ' || fuera_de_plazo from pld_dictamenes where caso_id = '${ids.casoTaller}'`);
  exigir(dictamen === `${hoy()} ${sumarHabiles(hoy(), 3)} false`, `7. dictamen del día de la sesión; el reporte vence a 3 días hábiles (${sumarHabiles(hoy(), 3)})`, dictamen);
  await ir(p, `/operacion/pld/casos/${ids.casoCobre}#dictamen-titulo`);
  await p.locator("#dictamen-justificacion").fill("El Comité aprobó no reportar: la explicación del cliente está documentada.");
  await enviar(p, p.getByRole("button", { name: "Registrar dictamen" }), "pld_dictamen_registrado", { doble: true });
  exigir(sql(`select resultado || ' ' || coalesce(reporte_vence_el::text, 'sin plazo') from pld_dictamenes where caso_id = '${ids.casoCobre}'`) === "no_reportar sin plazo", "7. el otro caso queda «no reportar», con justificación y sin plazo de reporte");
  exigir((await hoja(p, "reporte-titulo").count()) === 0, "7. un «no reportar» no ofrece reporte al SITI");
  await foto(p, "f7-dictamen-no-reportar");
  await cerrar(celia, "Celia");
}

async function flujo8() {
  console.log("\n— Flujo 8: dictamen «reportar» con un inhábil en medio (sesión del viernes 30-oct; el 2-nov no cuenta)");
  renovarSesiones();
  const celia = await abrir("celia");
  const { p } = celia;
  ids.casoAviso = await abrirCaso(p, "Aviso del personal · Taller del Cierre");
  await proponer(p, "reportar_interna", "La conducta descrita encuadra en una operación interna preocupante: solicitar datos fuera del sistema.");
  // La dueña fecha el caso: alerta y aviso del 27-oct, caso del 28-oct y propuesta del 29-oct (SQL en el README).
  const alerta = sql(`select alerta_id from pld_caso_alertas where caso_id = '${ids.casoAviso}'`);
  sql(`begin;
    set local session_replication_role = replica;
    update pld_avisos set registrado_en = timestamptz '2026-10-27 10:00:00-06' where id = '${ids.avisoOmar}';
    update pld_alertas set creada_en = timestamptz '2026-10-27 10:00:00-06' where id = '${alerta}';
    update pld_casos set registrado_en = timestamptz '2026-10-28 10:00:00-06' where id = '${ids.casoAviso}';
    update pld_caso_alertas set registrado_en = timestamptz '2026-10-28 10:00:00-06' where caso_id = '${ids.casoAviso}';
    update pld_propuestas set registrado_en = timestamptz '2026-10-29 10:00:00-06' where caso_id = '${ids.casoAviso}';
    commit;`);
  anotar("8. la dueña fechó el caso del aviso: alerta 27-oct, caso 28-oct, propuesta 29-oct");

  const s3 = await registrarSesion(p, "2026-10-30", [SIT.presidente, SIT.secretario, SIT.oficial, SIT.vocal]);
  exigir(s3.aviso === "pld_sesion_registrada", "8. sesión del viernes 30-oct con quórum (los integrantes se designaron el 28-oct)");
  exigir((await p.locator("li", { has: p.locator("h3", { hasText: "Taller del Cierre" }) }).count()) === 1, "8. la sesión del 30-oct solo ofrece la propuesta del 29-oct (no las de hoy)");
  await votar(p, "Taller del Cierre", [[SIT.presidente, "a_favor"], [SIT.secretario, "a_favor"], [SIT.oficial, "a_favor"], [SIT.vocal, "a_favor"]]);
  factor(E.IDS.celia, 0);
  await ir(p, `/operacion/pld/casos/${ids.casoAviso}#dictamen-titulo`);
  await p.locator("#dictamen-sesion").selectOption({ label: `Sesión del ${fechaDia("2026-10-30")}` });
  await p.locator("#dictamen-justificacion").fill("El Comité aprobó reportar la conducta como operación interna preocupante en la sesión del 30 de octubre.");
  await enviar(p, p.getByRole("button", { name: "Registrar dictamen" }), "pld_dictamen_registrado", { doble: true });
  const dictamen = sql(`select dictaminado_el || ' ' || reporte_vence_el from pld_dictamenes where caso_id = '${ids.casoAviso}'`);
  exigir(sumarHabiles("2026-10-30", 3) === "2026-11-05", "8. cálculo aparte: 3 días hábiles desde el viernes 30-oct, sin el 2-nov inhábil, son el 5-nov");
  exigir(dictamen === "2026-10-30 2026-11-05", "8. la base fecha el dictamen el 30-oct y el reporte vence el 5-nov", dictamen);

  reloj("2026-11-03T15:00:00.000Z");
  await ir(p, "/operacion/cumplimiento#pld-reportar-titulo");
  const quedan = habilesEntre("2026-11-03", "2026-11-05");
  const item = hoja(p, "pld-reportar-titulo").locator("li", { hasText: "Taller del Cierre" }).filter({ hasText: "operación interna preocupante" });
  exigir((await item.innerText()).includes(`Quedan ${quedan} días hábiles`), `8. con el reloj en el martes 3-nov, la bandeja dice «Quedan ${quedan} días hábiles»`, await item.innerText().catch(() => ""));
  await foto(p, "f8-bandeja-reloj-3-nov-quedan-2-habiles");
  await ir(p, `/operacion/pld/casos/${ids.casoAviso}#reporte-titulo`);
  exigir((await hoja(p, "reporte-titulo").innerText()).includes(`${fechaDia("2026-11-05")} (3 días hábiles)`), "8. el caso dice que el reporte vence el 5-nov (3 días hábiles)");
  await p.locator("#reporte-folio").fill("UIF-2026-000123");
  await p.locator("#reporte-periodo").fill("20261104");
  await p.locator("#reporte-recibido").fill("2026-11-04T10:00");
  await p.locator("#reporte-registros").fill("1");
  await enviar(p, p.getByRole("button", { name: "Registrar acuse" }), "pld_reporte_registrado", { doble: true });
  exigir(cuenta(`pld_reportes where caso_id = '${ids.casoAviso}'`) === 1, "8. doble clic en «Registrar acuse» = 1 acuse");
  exigir(sql(`select folio || ' ' || tipo_reporte || ' ' || fuera_de_plazo from pld_reportes where caso_id = '${ids.casoAviso}'`) === "UIF-2026-000123 3 false", "8. folio y acuse registrados a tiempo, tipo 3 (interna preocupante)");
  exigir((await hoja(p, "reporte-titulo").innerText()).includes("A tiempo"), "8. la pantalla dice «A tiempo»");
  const borrador = await descargar(p, () => p.getByRole("link", { name: "Descargar el borrador con el layout de 41 columnas" }).click());
  const renglones = borrador.bytes.toString("utf8").split("\r\n").filter(Boolean);
  exigir(renglones.length >= 1 && renglones.every((r) => (r.match(/;/g) ?? []).length === 41), "8. el borrador del reporte trae renglones de 41 columnas", renglones[0]?.slice(0, 120));
  await foto(p, "f8-acuse-registrado-a-tiempo");
  reloj(null);
  await cerrar(celia, "Celia");
}

async function flujo9() {
  console.log("\n— Flujo 9: una alerta llega a 60 días; modo Oficial; dictamen tardío marcado");
  renovarSesiones();
  const ofelia = await emitirAviso("ofelia", {
    tipo: "posible_inusual", empresa: "Nogal Comercial",
    descripcion: "Nogal pidió que su primer pago saliera a una cuenta a nombre de un tercero.",
  });
  await cerrar(ofelia, "Ofelia");
  const alerta = sql(`select a.id from pld_alertas a join pld_avisos v on v.id = a.aviso_id where a.company_id = '${NOGAL}'`);
  sql(`begin;
    set local session_replication_role = replica;
    update pld_alertas set creada_en = creada_en - interval '61 days' where id = '${alerta}';
    update pld_avisos set registrado_en = registrado_en - interval '61 days' where id = (select aviso_id from pld_alertas where id = '${alerta}');
    commit;`);
  const creada = sql(`select pld_fecha_mx(creada_en) || ' ' || vence_el from pld_alertas where id = '${alerta}'`).split(" ");
  anotar(`9. la dueña envejeció la alerta de Nogal 61 días: generada el ${creada[0]}, vence el ${creada[1]}`);
  const celia = await abrir("celia");
  const { p } = celia;
  reloj(`${creada[1]}T18:00:00.000Z`);
  await ir(p, "/operacion/pld");
  exigir((await fila(p, "Aviso del personal · Nogal Comercial").innerText()).includes("Vence hoy"), `9. con el reloj en el día 60 (${creada[1]}): «Vence hoy»`);
  reloj(null);
  await ir(p, "/operacion/pld");
  exigir((await fila(p, "Aviso del personal · Nogal Comercial").innerText()).includes("Fuera de plazo: venció hace 1 día"), "9. al día 61: «Fuera de plazo: venció hace 1 día»");
  await foto(p, "f9-alerta-fuera-de-plazo");

  // Modo Oficial: cambiar quién dictamina pide el factor reciente.
  factor(E.IDS.celia, 31);
  await ir(p, "/operacion/comite#modo-titulo");
  exigir(await p.getByRole("region", { name: "Confirma que eres tú" }).isVisible(), "9. cambiar quién dictamina pide «Confirma que eres tú»");
  await confirmarIdentidad(p, "celia");
  await p.getByRole("radio", { name: "El Oficial de Cumplimiento" }).check();
  const oficial = await p.locator("#modo-oficial option", { hasText: NOMBRES.celia }).first().getAttribute("value");
  await p.locator("#modo-oficial").selectOption(oficial);
  await p.locator("#modo-motivo").fill("La SOFIPO tiene menos de 25 personas a su servicio: dictamina el Oficial.");
  await enviar(p, p.getByRole("button", { name: "Guardar quién dictamina" }), "pld_modo_cambiado", { doble: true });
  exigir(cuenta("pld_modo_dictamen") === 1, "9. doble clic en «Guardar quién dictamina» = 1 cambio");
  exigir(await p.getByText("Dictamina el Oficial de Cumplimiento: en este modo no hay sesiones del Comité.").isVisible(), "9. en modo Oficial no hay sesiones");
  await foto(p, "f9-modo-oficial");

  ids.casoNogal = await abrirCaso(p, "Aviso del personal · Nogal Comercial");
  exigir((await hoja(p, "plazo-titulo").innerText()).includes(fechaDia(creada[1])), "9. el caso hereda el plazo de la alerta más antigua");
  await p.locator("#dictamen-resultado").selectOption("reportar_inusual");
  await p.locator("#dictamen-justificacion").fill("El Oficial dictamina reportar: pago a un tercero sin relación documentada.");
  await enviar(p, p.getByRole("button", { name: "Registrar dictamen" }), "pld_dictamen_fuera_de_plazo", { doble: true });
  exigir(sql(`select via || ' ' || fuera_de_plazo from pld_dictamenes where caso_id = '${ids.casoNogal}'`) === "oficial true", "9. el Oficial dictamina sin sesión y la base lo marca fuera de plazo");
  exigir((await hoja(p, "dictamen-titulo").innerText()).includes("Fuera de plazo"), "9. la pantalla dice «Fuera de plazo»");
  await foto(p, "f9-dictamen-tardio-marcado");
  await cerrar(celia, "Celia");
}

async function flujo10() {
  console.log("\n— Flujo 10: Relevantes del trimestre en ceros, clave CASFIM y acuse; la 37ª sin formato para SOFIPO");
  renovarSesiones();
  const celia = await abrir("celia");
  const { p } = celia;
  await ir(p, "/operacion/cumplimiento#pld-periodicos-titulo");
  exigir(await hoja(p, "pld-periodicos-titulo").getByText("Falta la clave de la entidad").isVisible(), "10. sin la clave CASFIM, la bandeja lo dice");
  await foto(p, "f10-bandeja-falta-clave-casfim");
  await ir(p, "/operacion/reportes");
  const tarjeta = p.locator("#reporte-36-202609");
  await tarjeta.getByRole("link", { name: "Descargar el archivo de 41 columnas" }).click();
  await p.waitForURL((url) => url.searchParams.get("aviso") === "falta_clave_entidad", { timeout: 20000 });
  anotar("10. sin la clave, el archivo no se genera y la pantalla lo dice");
  await ir(p, "/operacion/reportes#entidad-titulo");
  await p.locator("#entidad-casfim").fill("060201");
  await p.locator("#entidad-supervisor").fill("001002");
  await enviar(p, p.getByRole("button", { name: "Registrar claves" }), "pld_entidad_registrada", { doble: true });
  exigir(cuenta("pld_entidad") === 1, "10. doble clic en «Registrar claves» = 1 registro");
  const archivo = await descargar(p, () => p.locator("#reporte-36-202609").getByRole("link", { name: "Descargar el archivo de 41 columnas" }).click());
  const renglon = archivo.bytes.toString("utf8");
  exigir(renglon === `1;202609;;001002;060201;${";".repeat(36)}\r\n`, "10. el archivo del trimestre jul-sep es el reporte vacío: 41 columnas, llenas la 1, 2, 4 y 5", JSON.stringify(renglon));
  await p.locator("#reporte-36-202609-folio").fill("SITI-REL-2026-09");
  await p.locator("#reporte-36-202609-recibido").fill("2026-10-09T11:30");
  await p.locator("#reporte-36-202609-registros").fill("1");
  await enviar(p, p.locator("#reporte-36-202609").getByRole("button", { name: "Registrar envío" }), "pld_periodico_registrado", { doble: true });
  exigir(sql("select folio || ' ' || archivo_sha256 from pld_periodicos where reporte = '36' and periodo = '202609'") === `SITI-REL-2026-09 ${sha256(archivo.bytes)}`, "10. doble clic en «Registrar envío» = 1 acuse con la huella del archivo descargado");
  exigir((await p.locator("#reporte-36-202609").innerText()).includes("Registrado"), "10. la tarjeta queda «Registrado»");
  exigir(await p.getByText("Sin formato oficial para SOFIPO").isVisible(), "10. la 37ª aparece «sin formato oficial para SOFIPO»");
  exigir((await p.locator("#reporte-36-202612").innerText()).includes("El periodo aún no cierra") && (await p.locator("#reporte-36-202612 form").count()) === 0, "10. el trimestre en curso no ofrece archivo ni registro");
  await foto(p, "f10-relevantes-registrado-y-37a-sin-formato");
  await cerrar(celia, "Celia");
}

async function flujo11() {
  console.log("\n— Flujo 11: constancia mensual 38ª en ceros con su plazo de 15 días hábiles; «Falta el calendario 2027»");
  renovarSesiones();
  const celia = await abrir("celia");
  const { p } = celia;
  await ir(p, "/operacion/reportes#internacionales-titulo");
  const vence = sumarHabiles("2026-10-30", 15);
  exigir(vence === "2026-11-24", "11. cálculo aparte: 15 días hábiles desde el último hábil de octubre (30-oct), sin el 2 ni el 16 de noviembre, son el 24-nov");
  const tarjeta = p.locator("#reporte-38-202610");
  const texto = await tarjeta.innerText();
  const quedan = habilesEntre(hoy(), vence);
  exigir(texto.includes(`Vence el ${fechaDia(vence)}`) && texto.includes(`Quedan ${quedan} ${quedan === 1 ? "día hábil" : "días hábiles"}`), `11. octubre vence el ${fechaDia(vence)} y quedan ${quedan} días hábiles`, texto);
  const constancia = await descargar(p, () => tarjeta.getByRole("link", { name: "Descargar la constancia interna" }).click());
  exigir(constancia.bytes.toString("utf8").includes("Transferencias internacionales enviadas o recibidas en el mes: 0."), "11. la constancia de octubre va en ceros");
  await enviar(p, tarjeta.getByRole("button", { name: "Registrar constancia" }), "pld_periodico_registrado", { doble: true });
  exigir(cuenta("pld_periodicos where reporte = '38' and periodo = '202610'") === 1, "11. doble clic en «Registrar constancia» = 1 registro");
  await foto(p, "f11-constancia-38a-registrada");

  reloj("2027-01-04T16:00:00.000Z");
  await ir(p, "/operacion/reportes");
  exigir(await p.getByText("Falta el calendario 2027").first().isVisible(), "11. con el reloj en el 4-ene-2027, reportes dice «Falta el calendario 2027»");
  await foto(p, "f11-reportes-falta-calendario-2027");
  await ir(p, "/operacion/cumplimiento#pld-periodicos-titulo");
  exigir(await hoja(p, "pld-periodicos-titulo").getByText("Falta el calendario 2027").isVisible(), "11. y la bandeja también");
  await foto(p, "f11-bandeja-falta-calendario-2027");
  reloj(null);
  await cerrar(celia, "Celia");
}

async function flujo12() {
  console.log("\n— Flujo 12: la evaluación semestral de Cobre está pendiente y Cumplimiento la registra");
  renovarSesiones();
  const celia = await abrir("celia");
  const { p } = celia;
  await ir(p, "/operacion/cumplimiento#pld-evaluaciones-titulo");
  const item = hoja(p, "pld-evaluaciones-titulo").locator("li", { hasText: "Cobre Antiguo" });
  exigir((await item.innerText()).includes(`Contrato del ${fechaDia(E.CELEBRACION_COBRE)}`) && (await item.innerText()).includes(`Antes del ${fechaDia("2026-12-31")}`), "12. Cobre (contrato de hace siete meses) aparece con su evaluación del semestre pendiente", await item.innerText());
  await foto(p, "f12-evaluacion-semestral-pendiente");
  await item.getByRole("link", { name: "Cobre Antiguo, S.A. de C.V." }).click();
  await listo(p);
  await p.getByLabel("Se mantiene").check();
  await p.locator("#evaluacion-justificacion").fill("Revisé los pagos y la nómina del semestre: corresponden al perfil declarado y al giro.");
  await enviar(p, p.getByRole("button", { name: "Registrar evaluación" }), "evaluacion_registrada", { doble: true });
  exigir(cuenta(`pld_evaluaciones where company_id = '${COBRE}'`) === 1, "12. doble clic en «Registrar evaluación» = 1 evaluación");
  await foto(p, "f12-evaluacion-registrada");
  await ir(p, "/operacion/cumplimiento#pld-evaluaciones-titulo");
  exigir((await hoja(p, "pld-evaluaciones-titulo").locator("li", { hasText: "Cobre Antiguo" }).count()) === 0, "12. el pendiente desaparece de la bandeja");
  await cerrar(celia, "Celia");
}

async function flujo13() {
  console.log("\n— Flujo 13: conservación: la base no borra ni trunca; manifiesto descargado con su evento");
  const comoApp = rechazo(E.DATABASE_URL, "delete from supplier_payment_requests where id = '88888888-8888-4888-8888-888888888881'");
  exigir(/permission denied|permiso denegado/i.test(comoApp), "13. la aplicación no puede borrar un pago", comoApp);
  const truncarApp = rechazo(E.DATABASE_URL, "truncate payroll_batches");
  exigir(/permission denied|permiso denegado|must be owner/i.test(truncarApp), "13. ni truncar la nómina", truncarApp);
  const comoDuena = rechazo(DUENO, "delete from pld_alertas");
  exigir(comoDuena !== "sin error", "13. ni la dueña borra alertas de PLD", comoDuena);
  const truncarDuena = rechazo(DUENO, "truncate supplier_payment_requests cascade");
  exigir(truncarDuena !== "sin error", "13. ni trunca los pagos", truncarDuena);

  renovarSesiones();
  const celia = await abrir("celia");
  const { p } = celia;
  await ir(p, "/operacion/conservacion");
  const valor = await p.locator("#manifiesto-empresa option", { hasText: "Taller del Cierre" }).first().getAttribute("value");
  await p.locator("#manifiesto-empresa").selectOption(valor);
  const manifiesto = await descargar(p, () => p.getByRole("button", { name: "Descargar manifiesto" }).click());
  const lineas = manifiesto.bytes.toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
  const pagos = lineas.find((l) => l.tabla === "supplier_payment_requests");
  exigir(Boolean(pagos) && Number(pagos.filas) >= 3, "13. el manifiesto cuenta los pagos de Taller en el periodo", JSON.stringify(pagos));
  exigir(lineas.some((l) => l.sha256 && /^[0-9a-f]{64}$/.test(l.sha256)), "13. y trae la huella SHA-256 de cada documento");
  exigir(cuenta(`audit_log where accion = 'pld_manifiesto_descargado' and company_id = '${TALLER}'`) === 1, "13. la descarga deja su evento en la bitácora");
  writeFileSync(`${DIR}/datos/manifiesto-taller.ndjson`, manifiesto.bytes);
  await ir(p, "/operacion/bitacora");
  exigir((await p.content()).includes("Descargó el manifiesto de conservación"), "13. Cumplimiento ve el evento en la bitácora");
  await foto(p, "f13-bitacora-con-el-manifiesto");
  await cerrar(celia, "Celia");
}

async function flujo14() {
  console.log("\n— Flujo 14: qué ve cada rol y el cliente en cada pantalla nueva, en los avisos y en la bitácora");
  renovarSesiones();
  const VEN_PLD = { ofelia: false, omar: false, ana: false, celia: true, aurelio: true };
  const MENU = ["Alertas PLD", "Comité", "Reportes regulatorios", "Conservación"];
  const rutas = {
    pld: "/operacion/pld",
    parametros: "/operacion/pld/parametros",
    caso: `/operacion/pld/casos/${ids.casoTaller}`,
    comite: "/operacion/comite",
    sesion: `/operacion/comite/sesiones/${ids.sesionHoy}`,
    reportes: "/operacion/reportes",
    conservacion: "/operacion/conservacion",
    cumplimiento: "/operacion/cumplimiento",
    avisos: "/operacion/avisos",
  };
  const matriz = {};
  for (const quien of PERSONAL) {
    const s = await abrir(quien);
    const { p } = s;
    matriz[quien] = {};
    await ir(p, "/operacion");
    const nav = await p.locator("nav").first().innerText();
    for (const entrada of MENU) {
      exigir(nav.includes(entrada) === VEN_PLD[quien], `14. ${NOMBRES[quien]}: «${entrada}» ${VEN_PLD[quien] ? "está" : "no está"} en su menú`);
    }
    exigir(nav.includes("Avisar a Cumplimiento"), `14. ${NOMBRES[quien]}: «Avisar a Cumplimiento» está en su menú`);
    await foto(p, `f14-menu-${quien}`, false);
    for (const [clave, ruta] of Object.entries(rutas)) {
      const respuesta = await ir(p, ruta);
      const texto = await p.locator("main").innerText();
      const sinPermiso = (await p.locator("#sin-permiso-titulo").count()) > 0;
      matriz[quien][clave] = respuesta?.status() === 404 ? "404" : sinPermiso ? "sin permiso" : "ve";
      if (clave === "avisos") {
        exigir(matriz[quien][clave] === "ve" && (await p.getByRole("button", { name: "Enviar aviso" }).count()) === 1, `14. ${NOMBRES[quien]} puede avisar a Cumplimiento`);
        continue;
      }
      if (VEN_PLD[quien]) {
        exigir(matriz[quien][clave] === "ve", `14. ${NOMBRES[quien]} ve ${ruta}`);
      } else {
        exigir(matriz[quien][clave] !== "ve" && !/Excede el perfil|Fraccionamiento|Nómina atípica|Taller del Cierre|PEDRO RAMOS/.test(texto), `14. ${NOMBRES[quien]} no ve ${ruta} ni un dato de PLD`, texto.slice(0, 200));
      }
    }
    const botones = ["Abrir caso", "Registrar propuesta", "Registrar dictamen", "Registrar en el Comité", "Registrar claves"];
    if (quien === "aurelio") {
      await ir(p, rutas.caso);
      for (const boton of botones) exigir((await p.getByRole("button", { name: boton }).count()) === 0, `14. Auditoría consulta sin el botón «${boton}»`);
      const antes404 = s.errores.length;
      const excluido = await ir(p, `/operacion/pld/casos/${ids.casoAviso}`);
      exigir(excluido?.status() === 404, "14. Aurelio, mencionado en el aviso, no encuentra ese caso (60ª)");
      // El 404 que se busca deja en la consola «Failed to load resource … 404»: es la respuesta esperada.
      const nuevos = s.errores.splice(antes404);
      exigir(nuevos.every((e) => /status of 404/.test(e)), "14. el único mensaje de consola de esa navegación es el 404 esperado", nuevos.join(" | "));
      matriz[quien].casoDelAviso = "404";
      await foto(p, "f14-auditoria-no-encuentra-el-caso-que-lo-menciona", false);
    }
    await ir(p, "/operacion/bitacora");
    const avisosVistos = (await p.locator("main").innerText()).split("Emitió un aviso a Cumplimiento").length - 1;
    const esperados = quien === "celia" ? 3 : quien === "aurelio" ? 2 : 0;
    exigir(avisosVistos === esperados, `14. bitácora de ${NOMBRES[quien]}: ${esperados} avisos (${quien === "aurelio" ? "el que lo menciona no" : VEN_PLD[quien] ? "todos" : "ninguno"})`, String(avisosVistos));
    matriz[quien].avisosEnBitacora = avisosVistos;
    if (quien === "ana") {
      await ir(p, `/operacion/clientes/${COBRE}/expediente#perfil-titulo`);
      const expediente = await p.locator("main").innerText();
      exigir(expediente.includes("Perfil transaccional") && !expediente.includes("Evaluación semestral"), "14. Aprobación ve el perfil en el expediente, sin la evaluación semestral");
      exigir(!/Alertas PLD|Excede el perfil|Fraccionamiento|Nómina atípica|Aviso del personal|caso de análisis|alertas abiertas/i.test(expediente), "14. ni alertas, ni casos, ni conteos de PLD (55ª)");
      await hoja(p, "perfil-titulo").scrollIntoViewIfNeeded();
      await foto(p, "f14-aprobacion-ve-solo-el-perfil", false);
    }
    await cerrar(s, NOMBRES[quien]);
  }
  for (const quien of ["gil", "rosa"]) {
    const s = await abrir(quien);
    const { p } = s;
    matriz[quien] = {};
    for (const ruta of [`/c/${TALLER}/consola`, `/c/${TALLER}/consola/proveedores`, `/c/${TALLER}/consola/personas/nomina`, `/c/${TALLER}/consola/pendientes`]) {
      await ir(p, ruta);
      exigir(!PLD_EN_PANTALLA.test(await p.content()), `14. cliente (${quien}): ${ruta} sin nada de PLD (HTML y RSC)`);
    }
    await ir(p, "/operacion/pld");
    matriz[quien].pld = new URL(p.url()).pathname;
    exigir(new URL(p.url()).pathname === "/operacion/entrar", `14. cliente (${quien}): /operacion/pld lo manda a la entrada SOFIPO`, p.url());
    await cerrar(s, quien);
  }
  writeFileSync(`${DIR}/datos/matriz-visibilidad.json`, JSON.stringify(matriz, null, 2));
}

// ---------- Pantallas en 3 temas × 2 anchos y contraste ----------
const PANTALLAS = () => [
  { clave: "cumplimiento", quien: "celia", ruta: "/operacion/cumplimiento" },
  { clave: "pld", quien: "celia", ruta: "/operacion/pld" },
  { clave: "caso", quien: "celia", ruta: `/operacion/pld/casos/${ids.casoTaller ?? sql(`select id from pld_casos where company_id = '${TALLER}' order by registrado_en desc limit 1`)}` },
  { clave: "parametros", quien: "celia", ruta: "/operacion/pld/parametros" },
  { clave: "comite", quien: "celia", ruta: "/operacion/comite" },
  { clave: "sesion", quien: "celia", ruta: `/operacion/comite/sesiones/${ids.sesionHoy ?? sql("select id from pld_sesiones where quorum order by celebrada_el desc, registrado_en desc limit 1")}` },
  { clave: "reportes", quien: "celia", ruta: "/operacion/reportes" },
  { clave: "conservacion", quien: "celia", ruta: "/operacion/conservacion" },
  { clave: "avisos", quien: "omar", ruta: "/operacion/avisos" },
  { clave: "expediente", quien: "celia", ruta: `/operacion/clientes/${COBRE}/expediente` },
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
    // En móvil, un texto que no corta línea ensancha el viewport: innerWidth deja de ser el ancho pedido.
    return { h1, sinNombre, desborde: document.documentElement.scrollWidth - window.innerWidth, ventana: window.innerWidth };
  });
}

async function pantallas() {
  console.log("\n— Pantallas: 3 temas × 1440/390");
  for (const pantalla of PANTALLAS()) {
    for (const tema of TEMAS) {
      for (const ancho of ANCHOS) {
        renovarSesiones();
        factor(E.IDS.celia, 0);
        const { nav, p, errores } = await abrir(pantalla.quien, { tema, ancho });
        await ir(p, pantalla.ruta);
        const revision = await revisarPagina(p);
        await foto(p, `pantalla-${pantalla.clave}-${tema}-${ancho}`);
        await nav.close();
        abiertos.delete(nav);
        exigir(revision.h1 === 1 && revision.sinNombre.length === 0 && revision.desborde <= 1 && revision.ventana === ancho && errores.length === 0,
          `pantalla ${pantalla.clave} ${tema} ${ancho}: un h1, campos con etiqueta, sin desborde ni viewport ensanchado, consola limpia`,
          JSON.stringify({ ...revision, errores }));
      }
    }
  }
}

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
        factor(E.IDS.celia, 0);
        const { nav, p } = await abrir(pantalla.quien, { tema, ancho });
        await ir(p, pantalla.ruta);
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
        abiertos.delete(nav);
      }
      informe[`${tema}-${ancho}`] = { medidos, minimo: Number(minimo.toFixed(2)), fallas };
      exigir(fallas.length === 0, `contraste ${tema} ${ancho}: ${medidos} textos, mínimo ${minimo.toFixed(2)}`, fallas.slice(0, 8).map((f) => `${f.contraste}<${f.umbral} ${f.pantalla} «${f.texto}» ${f.color} sobre ${f.fondo}`).join(" | "));
    }
  }
  writeFileSync(`${DIR}/datos/contraste.json`, JSON.stringify(informe, null, 2));
}

// ---------- Corrida ----------
const FLUJOS = { f1: flujo1, f2: flujo2, f3: flujo3, f4: flujo4, f5: flujo5, f6: flujo6, f7: flujo7, f8: flujo8, f9: flujo9, f10: flujo10, f11: flujo11, f12: flujo12, f13: flujo13, f14: flujo14 };
const IDS_GUARDADOS = `${RUTA_ESTADO}.ids.json`;
let fallo = null;
const inicio = Date.now();
mkdirSync(`${DIR}/datos`, { recursive: true });
try {
  Object.assign(ids, JSON.parse(readFileSync(IDS_GUARDADOS, "utf8")));
} catch {
  // Primera corrida: los ids salen de los flujos.
}
try {
  reloj(null);
  for (const fase of FASES) {
    if (fase === "flujos") for (const flujo of Object.values(FLUJOS)) await flujo();
    else if (FLUJOS[fase]) await FLUJOS[fase]();
    else if (fase === "pantallas") await pantallas();
    else if (fase === "contraste") await contraste();
    else throw new Error(`Fase desconocida: ${fase}`);
    writeFileSync(IDS_GUARDADOS, JSON.stringify(ids, null, 2), { mode: 0o600 });
  }
} catch (error) {
  fallo = error;
  console.error(error);
} finally {
  reloj(null);
  for (const nav of abiertos) await nav.close().catch(() => {});
}
const verdes = resultados.filter((r) => r.ok).length;
const rojos = resultados.filter((r) => !r.ok).length;
writeFileSync(`${DIR}/datos/resultados-${FASES.join("-")}.json`, JSON.stringify({ fases: FASES, segundos: Math.round((Date.now() - inicio) / 1000), verdes, rojos, resultados }, null, 2));
console.log(`\n${verdes} comprobaciones en verde, ${rojos} en rojo${fallo ? " (se detuvo en el primer fallo)" : ""}.`);
process.exitCode = fallo || rojos > 0 ? 1 : 0;
