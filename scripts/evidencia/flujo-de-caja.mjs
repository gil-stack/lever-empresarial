// Recorrido funcional del flujo de caja con Playwright headless, contra
// `next build` + `next start` y un Postgres local recién migrado y sembrado con
// scripts/evidencia/flujo-de-caja-siembra.ts. Pasos previos y variables en
// docs/evidencia/flujo-de-caja/README.md.
//
//   BASE=http://localhost:4806 \
//   DUENO_URL=postgres://<dueño>@127.0.0.1:5541/plataforma \
//   SEMILLAS=/fuera/del/repo/flujo-semillas.json \
//   CORREO_FALSO_ARCHIVO=/fuera/del/repo/correos.jsonl \
//   CRON_SECRET_ARCHIVO=/fuera/del/repo/cron-secreto \
//   TEMPORAL=/fuera/del/repo/tmp \
//   node scripts/evidencia/flujo-de-caja.mjs
//
// Todo lo que cambia datos pasa por clics en la aplicación. La base se toca
// como dueño solo para abrir la sesión de cada persona (como los e2e de #49)
// y para leer lo que prueba cada paso (programada_el, historial, bitácora).
// Rechaza un DUENO_URL que no sea local y no imprime URLs, tokens ni el secreto.

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:4806";
const DUENO = process.env.DUENO_URL ?? "";
const SALIDA = process.env.SALIDA ?? "docs/evidencia/flujo-de-caja";
const SEMILLAS = process.env.SEMILLAS ?? "";
const CORREOS = process.env.CORREO_FALSO_ARCHIVO ?? "";
const SECRETO = process.env.CRON_SECRET_ARCHIVO ? readFileSync(process.env.CRON_SECRET_ARCHIVO, "utf8").trim() : "";
const TEMPORAL = process.env.TEMPORAL ?? "";
const PDF = process.env.PDF_PRUEBA ?? "tests/e2e/fixtures/soporte-prueba.pdf";
const SOLO = (process.env.SOLO ?? "").split(",").filter(Boolean);

if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) {
  throw new Error("DUENO_URL tiene que apuntar a un Postgres local desechable (127.0.0.1 o localhost).");
}
for (const [nombre, valor] of [["SEMILLAS", SEMILLAS], ["CORREO_FALSO_ARCHIVO", CORREOS], ["TEMPORAL", TEMPORAL]]) {
  if (!valor || valor.startsWith("docs/") || valor.includes("/docs/")) throw new Error(`${nombre} tiene que estar fuera del repositorio.`);
}
if (!SECRETO) throw new Error("Falta CRON_SECRET_ARCHIVO con el CRON_SECRET del servidor local.");

const requerir = createRequire(import.meta.url);
const { chromium } = requerir("playwright");
mkdirSync(SALIDA, { recursive: true });
mkdirSync(TEMPORAL, { recursive: true });

const semillas = JSON.parse(readFileSync(SEMILLAS, "utf8"));
const HOY = semillas.hoy;
let comprobaciones = 0;
const consola = [];
let avisosWebgl = 0;
/** Rutas que (j) espera en 404 y lo que el navegador anotó en ellas (el 404 y la precarga sin usar). */
const rutas404 = new Set();
let cuatrocientos = 0;

function anotar(texto) {
  console.log(`OK ${texto}`);
}

function exigir(condicion, texto) {
  if (!condicion) throw new Error(`FALLO ${texto}`);
  comprobaciones += 1;
  anotar(texto);
}

function sql(consulta) {
  try {
    return execFileSync("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    throw new Error(`psql: ${String(error.stderr ?? "").trim()}`);
  }
}

const empresa = (razon) => sql(`select id from companies where razon_social = '${razon}'`);
const A = semillas.empresas.altamar;
const B = empresa("Bahía Comercial");
const C = empresa("Demostración Lever");
const en = (id, ruta) => `${BASE}/c/${id}${ruta}`;
const pesos = (centavos) => `$${(centavos / 100 || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Fechas en hora de México, en texto AAAA-MM-DD, sin depender de la zona del equipo.
function desplazar(fecha, dias) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function lunesDe(fecha) {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return desplazar(fecha, dia === 0 ? -6 : 1 - dia);
}
function ultimoDia(anio, mes) {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}
function fechaDe(anio, mes, dia) {
  return new Date(Date.UTC(anio, mes - 1, dia, 12)).toISOString().slice(0, 10);
}

/** Abre una sesión para la persona, como dueño de la base (la entrada con contraseña y TOTP la cubre #49). */
function sesion(correo) {
  const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
  const entrada = randomUUID();
  sql(`
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      select '${entrada}', id, '${createHash("sha256").update(entrada).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now() from users where correo = '${correo}';
    insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
      select '${randomUUID()}', id, '${createHash("sha256").update(token).digest("hex")}', now() + interval '8 hours', 'totp', '${entrada}' from users where correo = '${correo}';`);
  return token;
}

async function abrir(navegador, correo, { tema = "claro", ancho = 1440, alto = 900 } = {}) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto }, locale: "es-MX", timezoneId: "America/Mexico_City" });
  const host = new URL(BASE).hostname;
  // `next start` es producción: la cookie lleva el prefijo __Host- (Secure, Path=/, sin Domain), como en los e2e de #49.
  await ctx.addCookies([
    { name: "__Host-sesion", value: sesion(correo), domain: host, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    { name: "tema", value: tema, domain: host, path: "/" },
  ]);
  // Sin tope, un clic sobre un botón que nunca se habilita esperaría para siempre.
  ctx.setDefaultTimeout(20000);
  const pagina = await ctx.newPage();
  pagina.on("pageerror", (error) => consola.push(`ERROR DE PÁGINA ${correo} ${pagina.url()} :: ${error.message.slice(0, 300)}`));
  pagina.on("console", (mensaje) => {
    if (mensaje.type() !== "error" && mensaje.type() !== "warning") return;
    // Avisos del driver de WebGL del fondo animado (motor de #47) en Chromium headless: fuera de esta zona, se cuentan aparte.
    if (mensaje.text().includes("GL Driver Message")) {
      avisosWebgl += 1;
      return;
    }
    const ruta = pagina.url().replace(BASE, "");
    // (j) abre a propósito páginas que deben responder 404: el navegador anota el 404 del documento.
    // En esas páginas Next deja precargadas las hojas de estilo de la ruta que el 404 no usa: el navegador lo advierte.
    if (rutas404.has(ruta) && (mensaje.text().includes("status of 404") || mensaje.text().includes("was preloaded using link preload but not used"))) {
      cuatrocientos += 1;
      return;
    }
    consola.push(`CONSOLA ${correo} ${mensaje.type()} ${ruta} :: ${mensaje.text().slice(0, 300)}`);
  });
  return { ctx, pagina };
}

async function captura(pagina, archivo, completa = true) {
  await pagina.waitForTimeout(250);
  await pagina.screenshot({ path: `${SALIDA}/${archivo}`, fullPage: completa, type: "jpeg", quality: 72 });
  anotar(`captura ${archivo}`);
}

/**
 * Clic en el botón del formulario y espera a que su acción de servidor responda
 * y React termine de pintar. No espera `response.finished()`: la respuesta de
 * una acción es un flujo RSC y Playwright no siempre la da por terminada (sin
 * tope, el recorrido se quedaba colgado); el formulario deja de estar
 * aria-busy cuando React ya la consumió.
 */
async function clicConAccion(pagina, clic) {
  await Promise.all([
    pagina.waitForResponse((r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]), { timeout: 20000 }),
    clic(),
  ]);
  await pagina.waitForFunction(() => !document.querySelector('form[aria-busy="true"], button[aria-busy="true"]'), null, { timeout: 15000 });
  await pagina.waitForTimeout(150);
}

async function enviar(formulario, boton) {
  await clicConAccion(formulario.page(), () => formulario.getByRole("button", { name: boton }).click());
  await formulario.locator(".alerta-asentado, .alerta-revisar").first().waitFor({ timeout: 15000 });
  return (await formulario.locator(".alerta-asentado").count()) > 0;
}

/**
 * Doble clic real en un botón de envío (`BotonEnviar`): el segundo clic llega
 * mientras la acción corre. Devuelve si el botón se vio ocupado entretanto
 * («Enviando…», desactivado y con aria-busy) y exige que el navegador mande una
 * sola acción de servidor. Además, cada llamada va seguida de un conteo en la
 * base que exige una sola operación.
 */
async function dobleClicConAccion(boton) {
  const pagina = boton.page();
  await pagina.evaluate(() => {
    const vistos = [];
    const revisar = () => {
      for (const b of document.querySelectorAll('button[aria-busy="true"]')) vistos.push(`${b.textContent?.trim()}|${b.disabled}`);
    };
    const observador = new MutationObserver(revisar);
    observador.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    window.__ocupados = vistos;
    window.__dejarDeVigilar = () => observador.disconnect();
  });
  let acciones = 0;
  const contar = (peticion) => {
    if (peticion.method() === "POST" && peticion.headers()["next-action"]) {
      acciones += 1;
      ultimaAccion = { url: peticion.url(), headers: peticion.headers(), cuerpo: peticion.postDataBuffer()?.toString("base64") ?? "" };
    }
  };
  pagina.on("request", contar);
  await clicConAccion(pagina, () => boton.dblclick());
  await pagina.waitForTimeout(300);
  pagina.off("request", contar);
  exigir(acciones === 1, `el doble clic manda ${acciones} acción(es) de servidor (se espera 1)`);
  const ocupados = await pagina.evaluate(() => {
    window.__dejarDeVigilar();
    return window.__ocupados;
  });
  return ocupados.includes("Enviando…|true");
}

/** La última acción de servidor que mandó un doble clic: misma URL, encabezados y cuerpo (con su altaId). */
let ultimaAccion = null;

/**
 * Manda otra vez, byte por byte, la última acción de servidor (un reintento de
 * red o un segundo envío del mismo formulario ya pintado): mismo altaId.
 */
async function repetirUltimaAccion(pagina, cambio = null) {
  if (!ultimaAccion) throw new Error("FALLO no hay acción capturada para repetir");
  const { url, headers } = ultimaAccion;
  let { cuerpo } = ultimaAccion;
  if (cambio) {
    // El mismo formulario ya pintado (mismo altaId) con otro valor en un campo: como una pestaña vieja que se reenvía.
    const [campo, valor] = cambio;
    const texto = Buffer.from(cuerpo, "base64").toString("latin1");
    const patron = new RegExp(`(name="(?:_?\\d+_)?${campo}"\r\n\r\n)[^\r]*`);
    if (!patron.test(texto)) throw new Error(`FALLO la acción capturada no trae el campo ${campo}`);
    cuerpo = Buffer.from(texto.replace(patron, `$1${valor}`), "latin1").toString("base64");
  }
  const encabezados = Object.fromEntries(Object.entries(headers).filter(([k]) => ["next-action", "content-type", "accept", "next-router-state-tree"].includes(k)));
  return pagina.evaluate(async ({ url: u, encabezados: h, cuerpo: c }) => {
    const bytes = Uint8Array.from(atob(c), (x) => x.charCodeAt(0));
    const r = await fetch(u, { method: "POST", headers: h, body: bytes });
    return { estado: r.status, texto: await r.text() };
  }, { url, encabezados, cuerpo });
}

/** El id del formulario (campo oculto altaId) que viajó en la última acción. */
function altaIdDeUltimaAccion() {
  const texto = Buffer.from(ultimaAccion?.cuerpo ?? "", "base64").toString("latin1");
  // React antepone al nombre de cada campo el número del argumento: «_1_altaId».
  return /name="(?:_?\d+_)?altaId"\r\n\r\n([0-9a-f-]{36})/.exec(texto)?.[1] ?? null;
}

async function enviarConDobleClic(formulario, boton) {
  const ocupado = await dobleClicConAccion(formulario.getByRole("button", { name: boton }));
  exigir(ocupado, `doble clic en «${boton}»: mientras se envía dice «Enviando…», queda desactivado y con aria-busy`);
  await formulario.locator(".alerta-asentado, .alerta-revisar").first().waitFor({ timeout: 15000 });
  return { asentado: (await formulario.locator(".alerta-asentado").count()) > 0, ocupado };
}

async function tablaProyeccion(pagina) {
  return pagina.locator('table[data-tabla="proyeccion"] tbody tr').evaluateAll((filas) =>
    filas.map((fila) => ({
      semana: fila.getAttribute("data-semana"),
      ...Object.fromEntries([...fila.querySelectorAll("td[data-cifra]")].map((td) => [td.getAttribute("data-cifra"), td.hasAttribute("data-centavos") ? Number(td.getAttribute("data-centavos")) : null])),
    })),
  );
}

/**
 * La proyección hecha a mano con la siembra conocida: series de nómina y renta
 * por sus reglas (quincenal 15 y fin de mes; mensual por su día), los cargos
 * de la siembra sin el cancelado (de los de antes del corte, los autorizados
 * ya están pagados en el saldo y los no autorizados van vencidos en la primera
 * semana), y el cobro que no está vencido. Semanas de lunes a domingo. No usa
 * código de la aplicación.
 */
function proyeccionAMano(saldo, corte, extras = []) {
  const inicio = lunesDe(HOY);
  const fin = desplazar(inicio, 13 * 7 - 1);
  const movs = [];
  const serie = (desde, siguiente, centavos) => {
    for (let f = desde; f <= fin; f = siguiente(f)) movs.push({ fecha: f, centavos: -centavos });
  };
  const quincenal = (f) => {
    const [a, m, d] = f.split("-").map(Number);
    if (d === 15) return fechaDe(a, m, ultimoDia(a, m));
    return m === 12 ? fechaDe(a + 1, 1, 15) : fechaDe(a, m + 1, 15);
  };
  const mensual = (ancla) => (f) => {
    const [a, m] = f.split("-").map(Number);
    const [sa, sm] = m === 12 ? [a + 1, 1] : [a, m + 1];
    return fechaDe(sa, sm, Math.min(ancla, ultimoDia(sa, sm)));
  };
  serie("2026-11-15", quincenal, 1_000_000); // Ana
  serie("2026-11-15", quincenal, 800_000); // Beto
  serie("2026-11-30", mensual(30), 2_000_000); // Carla
  serie(desplazar(HOY, 14), mensual(Number(desplazar(HOY, 14).slice(8))), 3_000_000); // Renta
  for (const cargo of Object.values(semillas.cargos)) if (cargo.estado !== "cancelado") movs.push({ fecha: cargo.programada, centavos: -cargo.total, cargo: true, estado: cargo.estado });
  movs.push({ fecha: desplazar(HOY, 19), centavos: 6_000_000 }); // Cliente Mayorista; Distribuidora Sur ya venció
  movs.push(...extras);
  const semanas = [];
  let saldoCorriente = saldo;
  for (let i = 0; i < 13; i += 1) {
    const lunes = desplazar(inicio, i * 7);
    const domingo = desplazar(lunes, 6);
    // Hasta el corte, un cargo autorizado ya está en el saldo; uno sin autorizar sigue vencido en la primera semana.
    const dentro = movs.filter((m) => (i === 0 && m.cargo && m.fecha <= corte && m.estado !== "listo_para_pagar") || (m.fecha > corte && m.fecha >= (i === 0 ? "0000-00-00" : lunes) && m.fecha <= domingo));
    const entradas = dentro.filter((m) => m.centavos > 0).reduce((s, m) => s + m.centavos, 0);
    const salidas = -dentro.filter((m) => m.centavos < 0).reduce((s, m) => s + m.centavos, 0);
    const inicial = saldoCorriente;
    saldoCorriente = inicial + entradas - salidas;
    semanas.push({ semana: lunes, "saldo-inicial": inicial, entradas, salidas, "saldo-final": saldoCorriente });
  }
  return semanas;
}

function correosAnotados() {
  return existsSync(CORREOS) ? readFileSync(CORREOS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}

async function cron(autorizacion) {
  const respuesta = await fetch(`${BASE}/tareas/correo-semanal`, { headers: autorizacion ? { authorization: autorizacion } : {} });
  return { estado: respuesta.status, cuerpo: await respuesta.json().catch(() => null) };
}

const debe = (flujo) => SOLO.length === 0 || SOLO.includes(flujo);
let accionSaldo = null;

async function principal() {
  const navegador = await chromium.launch({ headless: true });
  const { pagina: laura } = await abrir(navegador, "laura@lever.test");
  // La solicitud de la acción del saldo, para repetirla a mano como contador en (j).
  laura.on("request", (req) => {
    if (req.method() === "POST" && req.headers()["next-action"] && req.url().includes("/consola/flujo") && !accionSaldo) {
      accionSaldo = { url: req.url(), headers: req.headers(), cuerpo: req.postData() };
    }
  });

  if (debe("a")) {
    console.log("\n(a) Empresa nueva sin datos");
    const { pagina: bruno } = await abrir(navegador, "bruno@lever.test");
    await bruno.goto(en(B, "/consola"));
    const saldo = bruno.locator('.flujo-saldo[data-estado="sin-saldo"]');
    exigir(await saldo.isVisible(), "Bahía (sin datos): Inicio muestra el estado «Sin saldo declarado», no un saldo de $0.00");
    exigir(!(await bruno.locator("body").textContent()).includes("Saldo en el libro"), "ya no aparece «Saldo en el libro»");
    exigir((await bruno.locator('[data-cifra="alcance"]').innerText()) === "Sin saldo declarado", "«Cuánto alcanza el dinero» dice «Sin saldo declarado»");
    exigir(!(await bruno.locator("body").textContent()).includes("Confirmado por el banco"), "a un cliente real no se le pinta «Confirmado por el banco»");
    await captura(bruno, "a-empresa-sin-datos.jpg");
    await saldo.getByRole("link", { name: "Declarar el saldo" }).click();
    await bruno.waitForURL(/\/consola\/flujo#declarar$/);
    exigir(await bruno.locator('form[data-formulario="saldo"]').isVisible(), "«Declarar el saldo» lleva al formulario de Saldo y alertas");
  }

  if (debe("b")) {
    console.log("\n(b) Saldo declarado e historial");
    await laura.goto(en(A, "/consola"));
    await laura.locator(".flujo-saldo").getByRole("link", { name: "Declarar el saldo" }).click();
    await laura.waitForURL(/\/consola\/flujo#declarar$/);
    const h1Saldo = await laura.locator("h1").evaluateAll((hs) => hs.map((h) => `${h.textContent?.trim()}|${h.classList.contains("solo-lector")}`));
    exigir(JSON.stringify(h1Saldo) === JSON.stringify(["Saldo y alertas|true"]) && (await laura.locator("main .pagina-cabeza, main .lede").count()) === 0,
      "Saldo y alertas: un h1 solo para lector y sin encabezado grande");
    const forma = laura.locator('form[data-formulario="saldo"]');
    await forma.locator("#saldo").fill("120000.00");
    await forma.locator("#alDia").fill(desplazar(HOY, -1));
    const primera = await enviarConDobleClic(forma, "Declarar el saldo");
    exigir(primera.asentado, "primera declaración: $120,000.00 al día anterior, asentada (doble clic)");
    await forma.locator("#saldo").fill("150000.00");
    await forma.locator("#alDia").fill(HOY);
    exigir((await enviarConDobleClic(forma, "Declarar el saldo")).asentado, "segunda declaración: $150,000.00 al día de hoy, asentada (doble clic)");
    const repetida = await repetirUltimaAccion(laura);
    exigir(repetida.estado === 200 && repetida.texto.includes("El saldo quedó declarado"), "el mismo envío repetido byte por byte (mismo id del formulario) responde igual: «El saldo quedó declarado»");
    const otrosDatos = await repetirUltimaAccion(laura, ["saldo", "150001.00"]);
    exigir(otrosDatos.estado === 200 && otrosDatos.texto.includes("Este formulario ya se envió con otros datos") && otrosDatos.texto.includes("Recarga la página para capturar uno nuevo."),
      "el mismo formulario reenviado con otro saldo ($150,001.00) se rechaza: «Este formulario ya se envió con otros datos. Recarga la página para capturar uno nuevo.»");
    const idEnviado = altaIdDeUltimaAccion();
    const idEnPagina = await forma.locator('input[name="altaId"]').inputValue();
    exigir(/^[0-9a-f-]{36}$/.test(idEnviado ?? "") && idEnPagina !== idEnviado,
      `el formulario mandó su id (UUID ${idEnviado}) y la página ya trae otro (${idEnPagina}) para la siguiente declaración`);
    await laura.reload();
    const historial = await laura.locator('table[data-tabla="historial-saldo"] td[data-centavos]').evaluateAll((c) => c.map((td) => Number(td.getAttribute("data-centavos"))));
    exigir(JSON.stringify(historial) === JSON.stringify([15_000_000, 12_000_000]), `el historial conserva las dos: ${historial.map(pesos).join(" y ")}`);
    exigir(sql(`select count(*) from cash_balance_declarations where company_id = '${A}'`) === "2", "la base tiene 2 declaraciones (append-only): cada doble clic y el reenvío idéntico dejaron una sola");
    exigir(sql(`select count(*) from audit_log where company_id = '${A}' and accion = 'declarar_saldo'`) === "2", "y 2 eventos declarar_saldo en la bitácora");
    await captura(laura, "b-saldo-historial.jpg");
    await laura.goto(en(A, "/consola"));
    const hero = laura.locator('.flujo-saldo[data-estado="declarado"]');
    const textoHero = await hero.textContent();
    exigir(textoHero.includes("Declarado por tu empresa") && textoHero.includes("$150,000.00"), "Inicio muestra $150,000.00 con «Declarado por tu empresa»");
    exigir(/Al \d+ de noviembre de 2026 · declarado por Laura Méndez el/.test(textoHero), "con fecha y autor: «Al … · declarado por Laura Méndez el …»");
    exigir(textoHero.includes("No es un saldo confirmado por el banco."), "y aclara que no es un saldo confirmado por el banco");
  }

  if (debe("c")) {
    console.log("\n(c) Proyección de 13 semanas contra el cálculo a mano");
    await laura.goto(en(A, "/consola"));
    const tabla = await tablaProyeccion(laura);
    const esperado = proyeccionAMano(15_000_000, HOY);
    exigir(tabla.length === 13, "13 semanas de lunes a domingo");
    for (let i = 0; i < 13; i += 1) {
      const t = tabla[i];
      const e = esperado[i];
      exigir(
        t.semana === e.semana && t["saldo-inicial"] === e["saldo-inicial"] && t.entradas === e.entradas && t.salidas === e.salidas && t["saldo-final"] === e["saldo-final"],
        `semana del ${e.semana}: inicial ${pesos(e["saldo-inicial"])}, entra ${pesos(e.entradas)}, sale ${pesos(e.salidas)}, final ${pesos(e["saldo-final"])}`,
      );
    }
    const movimientos = await laura.locator(".flujo-movimientos").innerText();
    exigir(!movimientos.includes("TN-498"), "el cargo cancelado TN-498 ($40,000.00) no cuenta");
    exigir(!movimientos.includes("Distribuidora Sur"), "el cobro vencido de Distribuidora Sur no entra en la proyección");
    await captura(laura, "c-proyeccion-13-semanas.jpg");

    // Cargos de antes del saldo: los autorizados ya están pagados en él; el que nadie autorizó sigue vencido.
    const viejos = Object.entries(semillas.cargos).filter(([, c]) => c.programada < HOY && c.estado !== "cancelado");
    const autorizadosViejos = viejos.filter(([, c]) => c.estado === "listo_para_pagar");
    const [folioVencido, vencido] = viejos.find(([, c]) => c.estado === "por_autorizar");
    const ids = autorizadosViejos.map(([, c]) => `'${c.id}'`).join(", ");
    exigir(autorizadosViejos.length === 3 && sql(`select count(*) from supplier_payment_requests where estado = 'listo_para_pagar' and payable_id in (${ids})`) === "3",
      `la base tiene 3 cargos autorizados de antes del saldo (${autorizadosViejos.map(([f, c]) => `${f} ${pesos(c.total)} del ${c.programada}`).join(", ")}): suman ${pesos(autorizadosViejos.reduce((t, [, c]) => t + c.total, 0))}, más que el saldo`);
    exigir(sql(`select estado from supplier_payment_requests where payable_id = '${vencido.id}'`) === "por_autorizar", `y ${folioVencido} (${pesos(vencido.total)} del ${vencido.programada}) sigue por autorizar`);
    const leyenda = await laura.locator("#proyeccion-titulo + p").innerText();
    exigir(leyenda.includes("ya autorizados se dan por pagados en el saldo declarado") && leyenda.includes("los vencidos sin autorizar van en la primera semana"),
      "la proyección explica la regla: los autorizados de antes se dan por pagados y los vencidos sin autorizar van en la primera semana");
    const semana0 = laura.locator(`details[data-movimientos="${lunesDe(HOY)}"]`);
    await semana0.locator("summary").click();
    exigir(await semana0.evaluate((d) => d.open), `se abre la primera semana (${lunesDe(HOY)}) con un clic`);
    const renglonVencido = semana0.locator(`li[data-clave="cxp:${vencido.id}"]`);
    exigir(await renglonVencido.isVisible() && (await renglonVencido.locator(".insignia").innerText()) === "Vencido sin autorizar",
      `${folioVencido} aparece en la primera semana con la insignia «Vencido sin autorizar» (${(await renglonVencido.innerText()).replace(/\s+/g, " ").trim()})`);
    for (const [folio, c] of autorizadosViejos) {
      exigir((await laura.locator(`.flujo-movimientos li[data-clave="cxp:${c.id}"]`).count()) === 0 && !movimientos.includes(folio), `${folio} (autorizado) no aparece en ninguna semana: ya está pagado en el saldo declarado`);
    }
    exigir(tabla[0].salidas === esperado[0].salidas && tabla[0]["saldo-final"] > 0,
      `la primera semana sale ${pesos(tabla[0].salidas)} y cierra en ${pesos(tabla[0]["saldo-final"])}: sin los $180,000.00 autorizados que ya se pagaron`);
    await renglonVencido.scrollIntoViewIfNeeded();
    await captura(laura, "c2-vencido-sin-autorizar.jpg", false);
  }

  if (debe("d")) {
    console.log("\n(d) Alerta de faltante");
    await laura.goto(en(A, "/consola"));
    const esperado = proyeccionAMano(15_000_000, HOY);
    const primera = esperado.find((s) => s["saldo-final"] < 0);
    const alerta = laura.locator('[data-alerta="faltante"]');
    const titulo = await alerta.innerText();
    exigir(titulo.includes("Faltante: el saldo queda en negativo") && (await laura.locator(`tr[data-semana="${primera.semana}"] .insignia`).innerText()) === "Faltante",
      `la alerta marca la semana del ${primera.semana} (primera con saldo final negativo: ${pesos(primera["saldo-final"])})`);
    exigir(titulo.includes("Lo provoca:"), `y dice qué la provoca: «${titulo.split("Lo provoca:")[1]?.trim().slice(0, 90)}…»`);
    await captura(laura, "d1-faltante.jpg", false);

    await laura.goto(en(A, "/consola/cobros"));
    const cobro = laura.locator('form[data-formulario="cobro"]');
    await cobro.locator("#clienteNombre").fill("Cliente Mayorista");
    await cobro.locator("#concepto").fill("Anticipo de diciembre");
    await cobro.locator("#monto").fill("150000.00");
    await cobro.locator("#fechaProbable").fill(desplazar(lunesDe(HOY), 6 * 7 + 3));
    exigir(await enviar(cobro, "Registrar el cobro"), "se registra un cobro esperado de $150,000.00 antes del faltante");
    await laura.goto(en(A, "/consola"));
    exigir((await laura.locator('[data-alerta="faltante"]').count()) === 0, "la alerta de faltante desaparece");
    await captura(laura, "d2-sin-faltante.jpg", false);

    await laura.goto(en(A, "/consola/cobros"));
    const fila = laura.locator('tr[data-cobro]', { hasText: "Anticipo de diciembre" });
    await fila.getByRole("button", { name: "Cancelar" }).click();
    const dialogo = laura.locator("dialog.dialogo[open]");
    await dialogo.locator('input[name="motivo"]').fill("El cliente pospuso el anticipo");
    await clicConAccion(laura, () => dialogo.getByRole("button", { name: "Cancelar el cobro" }).click());
    await laura.locator(".alerta-asentado", { hasText: "cancelado con su motivo" }).waitFor();
    exigir(sql(`select estado || '|' || motivo_cancelacion from expected_collections where concepto = 'Anticipo de diciembre'`) === "cancelado|El cliente pospuso el anticipo", "se cancela el cobro con su motivo");
    await laura.goto(en(A, "/consola"));
    exigir((await laura.locator(`tr[data-semana="${primera.semana}"] .insignia`).innerText()) === "Faltante", "y la alerta regresa a la misma semana");

    await laura.goto(en(A, "/consola/flujo"));
    const colchon = laura.locator('form[data-formulario="colchon"]');
    await colchon.locator("#colchon").fill("30000.00");
    exigir(await enviar(colchon, "Guardar el colchón"), "se guarda un colchón de $30,000.00");
    await laura.goto(en(A, "/consola"));
    const bajo = esperado.find((s) => s["saldo-final"] < 3_000_000);
    const tituloColchon = await laura.locator('[data-alerta="faltante"]').innerText();
    exigir(tituloColchon.includes("El saldo baja del colchón") && (await laura.locator(`tr[data-semana="${bajo.semana}"] .insignia`).innerText()) === "Faltante",
      `con colchón la alerta se adelanta a la semana del ${bajo.semana} (${pesos(bajo["saldo-final"])} < $30,000.00)`);
    await captura(laura, "d3-faltante-colchon.jpg", false);
  }

  if (debe("h")) {
    console.log("\n(h) Escenario «¿y si muevo este pago?»");
    const cargo = semillas.cargos["TN-501"];
    const antes = sql(`select programada_el from supplier_payables where id = '${cargo.id}'`);
    const bitacora = sql(`select count(*) from audit_log where company_id = '${A}'`);
    await laura.goto(en(A, "/consola"));
    const real = await tablaProyeccion(laura);
    const nueva = desplazar(cargo.programada, 7);
    exigir((await laura.locator("#fecha-escenario").getAttribute("max")) === desplazar(real.at(-1).semana, 6),
      `la fecha del escenario no pasa del último día de la ventana (${desplazar(real.at(-1).semana, 6)})`);
    await laura.locator("#mover").selectOption(`cxp:${cargo.id}`);
    await laura.locator("#fecha-escenario").fill(nueva);
    await laura.getByRole("button", { name: "Ver el escenario" }).click();
    await laura.locator('[data-escenario="activo"]').waitFor();
    const movido = await tablaProyeccion(laura);
    const iOrigen = real.findIndex((s) => s.semana === lunesDe(cargo.programada));
    exigir(movido[iOrigen].salidas === real[iOrigen].salidas - cargo.total && movido[iOrigen + 1].salidas === real[iOrigen + 1].salidas + cargo.total,
      `mover TN-501 (${pesos(cargo.total)}) a la semana siguiente baja las salidas de la semana del ${real[iOrigen].semana} y sube las de la siguiente`);
    exigir(movido.at(-1)["saldo-final"] === real.at(-1)["saldo-final"], "el saldo al final de las 13 semanas no cambia (solo se mueve de semana)");
    exigir(sql(`select programada_el from supplier_payables where id = '${cargo.id}'`) === antes, `en la base programada_el sigue en ${antes}`);
    exigir(sql(`select count(*) from audit_log where company_id = '${A}'`) === bitacora, "y la bitácora no tiene eventos nuevos: el escenario no escribe");
    await captura(laura, "h-escenario.jpg");
    await laura.getByRole("link", { name: "Quitar el escenario" }).click();
    await laura.waitForURL((url) => !url.search.includes("mover"));
    exigir((await laura.locator('[data-escenario="activo"]').count()) === 0, "«Quitar el escenario» regresa a la proyección real");

    // El vencido sin autorizar también se mueve: deja la primera semana y cuenta en su fecha nueva, sin la marca.
    const [folioVencido, vencido] = Object.entries(semillas.cargos).find(([, c]) => c.estado === "por_autorizar" && c.programada < HOY);
    const destino = desplazar(lunesDe(HOY), 14);
    const sinMover = await tablaProyeccion(laura);
    await laura.locator("#mover").selectOption(`cxp:${vencido.id}`);
    await laura.locator("#fecha-escenario").fill(destino);
    await laura.getByRole("button", { name: "Ver el escenario" }).click();
    await laura.locator('[data-escenario="activo"]').waitFor();
    const conVencido = await tablaProyeccion(laura);
    exigir(conVencido[0].salidas === sinMover[0].salidas - vencido.total && conVencido[2].salidas === sinMover[2].salidas + vencido.total,
      `mover ${folioVencido} (vencido, ${pesos(vencido.total)}) al ${destino} lo saca de la primera semana y lo suma a la del ${conVencido[2].semana}`);
    const semanaDestino = laura.locator(`details[data-movimientos="${lunesDe(destino)}"]`);
    await semanaDestino.locator("summary").click();
    const insigniasMovido = await semanaDestino.locator(`li[data-clave="cxp:${vencido.id}"] .insignia`).allInnerTexts();
    exigir(insigniasMovido.includes("Escenario") && !insigniasMovido.includes("Vencido sin autorizar"),
      `en su semana nueva lleva «Escenario» y ya no «Vencido sin autorizar» (${insigniasMovido.join(", ")})`);
    exigir((await laura.locator(`details[data-movimientos="${lunesDe(HOY)}"] li[data-clave="cxp:${vencido.id}"]`).count()) === 0, "y ya no está en la primera semana");
    exigir(sql(`select programada_el from supplier_payables where id = '${vencido.id}'`) === vencido.programada, "en la base su fecha sigue igual");
    await semanaDestino.scrollIntoViewIfNeeded();
    await captura(laura, "h2-escenario-vencido.jpg", false);
    await laura.getByRole("link", { name: "Quitar el escenario" }).click();
    await laura.waitForURL((url) => !url.search.includes("mover"));
  }

  if (debe("e")) {
    console.log("\n(e) Cobros esperados");
    await laura.goto(en(A, "/consola/cobros"));
    // La acción principal vive en la barra del Marco y lleva al formulario.
    await laura.locator(".barra-superior").getByRole("link", { name: "Registrar un cobro" }).click();
    await laura.waitForURL(/#nuevo-cobro$/);
    exigir(await laura.locator('form[data-formulario="cobro"] #clienteNombre').isVisible(), "«Registrar un cobro» de la barra lleva al formulario");
    exigir((await laura.locator('tr[data-cobro][data-estado="vencido"]', { hasText: "Distribuidora Sur" }).count()) === 1, "el cobro con fecha pasada (Distribuidora Sur) aparece vencido");
    const cobro = laura.locator('form[data-formulario="cobro"]');
    await cobro.locator("#clienteNombre").fill("Abarrotes del Puerto");
    await cobro.locator("#clienteRfc").fill("APU150101AB1");
    await cobro.locator("#concepto").fill("Fletes de noviembre");
    await cobro.locator("#monto").fill("22500.50");
    await cobro.locator("#fechaProbable").fill(desplazar(HOY, 10));
    await cobro.locator("#referencia").fill("F-1040");
    exigir((await enviarConDobleClic(cobro, "Registrar el cobro")).asentado, "alta manual: Abarrotes del Puerto por $22,500.50 (doble clic)");
    exigir(sql(`select count(*) from expected_collections where company_id = '${A}' and cliente_nombre = 'Abarrotes del Puerto'`) === "1"
      && sql(`select count(*) from audit_log where company_id = '${A}' and accion = 'registrar_cobro' and identificador::text in (select id::text from expected_collections where cliente_nombre = 'Abarrotes del Puerto')`) === "1",
      "el doble clic deja un solo cobro y un solo evento registrar_cobro");
    const cobroRepetido = await repetirUltimaAccion(laura);
    exigir(cobroRepetido.estado === 200 && cobroRepetido.texto.includes("quedó registrado"), "el mismo formulario reenviado byte por byte responde igual");
    exigir(sql(`select count(*) from expected_collections where company_id = '${A}' and cliente_nombre = 'Abarrotes del Puerto'`) === "1"
      && sql(`select count(*) from audit_log where company_id = '${A}' and accion = 'registrar_cobro' and identificador::text in (select id::text from expected_collections where cliente_nombre = 'Abarrotes del Puerto')`) === "1",
      "y la base sigue con un cobro y un evento (el servidor usa el id del formulario)");

    const uuid = randomUUID().toUpperCase();
    const xml = (emisor) => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="${HOY}T10:00:00" TipoDeComprobante="I" Moneda="MXN" Total="45000.00" Serie="F" Folio="1041">
  <cfdi:Emisor Rfc="${emisor}" Nombre="Altamar Logística" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="CLM120101AB2" Nombre="Comercializadora La Moderna" DomicilioFiscalReceptor="06600" RegimenFiscalReceptor="601" UsoCFDI="G03" />
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" /></cfdi:Complemento>
</cfdi:Comprobante>`;
    writeFileSync(join(TEMPORAL, "emitida.xml"), xml("ALO180312AB1"));
    writeFileSync(join(TEMPORAL, "ajena.xml"), xml("XAX010101000"));
    const conXml = laura.locator('form[data-formulario="cobro-xml"]');
    await conXml.locator("#xml").setInputFiles(join(TEMPORAL, "ajena.xml"));
    await conXml.locator("#fechaProbableXml").fill(desplazar(HOY, 12));
    exigir(!(await enviar(conXml, "Registrar con el XML")), "una factura con RFC emisor ajeno se rechaza");
    const rechazo = await conXml.locator(".alerta-revisar").innerText();
    exigir(rechazo.includes("XAX010101000") && rechazo.includes("ALO180312AB1"), `con un mensaje claro: «${rechazo.replace(/\s+/g, " ").trim()}»`);
    await captura(laura, "e1-xml-ajeno-rechazado.jpg", false);
    await conXml.locator("#xml").setInputFiles(join(TEMPORAL, "emitida.xml"));
    const idXml = await conXml.locator('input[name="altaId"]').inputValue();
    exigir((await enviarConDobleClic(conXml, "Registrar con el XML")).asentado, "la factura emitida por Altamar se registra como cobro esperado (doble clic)");
    exigir(sql(`select count(*) from expected_collections where cfdi_uuid = '${uuid}'`) === "1", "el doble clic deja una sola fila con ese UUID");
    // El navegador no deja copiar los bytes del archivo de la petición capturada: se reenvía el mismo formulario
    // con su mismo id (como un reintento o una segunda pestaña con la página vieja).
    await conXml.locator('input[name="altaId"]').evaluate((campo, id) => { campo.value = id; }, idXml);
    await conXml.locator("#xml").setInputFiles(join(TEMPORAL, "emitida.xml"));
    await conXml.locator("#fechaProbableXml").fill(desplazar(HOY, 12));
    exigir(await enviar(conXml, "Registrar con el XML"), "el mismo formulario del XML reenviado con su mismo id responde igual (asentado), sin «ya está registrada»");
    exigir(sql(`select count(*) from expected_collections where cfdi_uuid = '${uuid}'`) === "1"
      && sql(`select count(*) from audit_log where accion = 'registrar_cobro' and identificador::text in (select id::text from expected_collections where cfdi_uuid = '${uuid}')`) === "1",
      "y sigue una sola fila con ese UUID y un solo evento");
    exigir(sql(`select origen || '|' || cliente_nombre || '|' || monto_centavos || '|' || cfdi_uuid from expected_collections where cfdi_uuid = '${uuid}'`) === `cfdi|Comercializadora La Moderna|4500000|${uuid}`,
      "con origen cfdi, el cliente receptor, $45,000.00 y su UUID");

    await laura.reload();
    const abarrotes = laura.locator("tr[data-cobro]", { hasText: "Abarrotes del Puerto" });
    await abarrotes.getByRole("button", { name: "Marcar cobrado" }).click();
    const dialogo = laura.locator("dialog.dialogo[open]");
    await dialogo.locator('input[name="cobradoEl"]').fill(HOY);
    exigir(await dobleClicConAccion(dialogo.getByRole("button", { name: "Marcar cobrado" })), "doble clic en «Marcar cobrado» del diálogo: el botón se ve ocupado");
    await laura.locator(".alerta-asentado", { hasText: "marcado como cobrado" }).waitFor();
    exigir(sql(`select estado || '|' || cobrado_el from expected_collections where cliente_nombre = 'Abarrotes del Puerto'`) === `cobrado|${HOY}`, "marcar cobrado guarda la fecha real");
    exigir(sql(`select count(*) from audit_log where company_id = '${A}' and accion = 'cobrar_cobro' and identificador::text in (select id::text from expected_collections where cliente_nombre = 'Abarrotes del Puerto')`) === "1", "y deja un solo evento cobrar_cobro");
    // Desde el filtro «Esperados» la fila sale de la lista al cancelarse: el aviso tiene que quedarse.
    await laura.getByRole("link", { name: "Esperados" }).click();
    await laura.waitForURL(/estado=esperado/);
    const moderna = laura.locator("tr[data-cobro]", { hasText: "Comercializadora La Moderna" });
    await moderna.getByRole("button", { name: "Cancelar" }).click();
    await laura.locator("dialog.dialogo[open]").locator('input[name="motivo"]').fill("Factura sustituida por otra");
    exigir(await dobleClicConAccion(laura.locator("dialog.dialogo[open]").getByRole("button", { name: "Cancelar el cobro" })), "doble clic en «Cancelar el cobro»: el botón se ve ocupado");
    await laura.locator(".alerta-asentado", { hasText: "cancelado con su motivo" }).waitFor();
    exigir(sql(`select estado from expected_collections where cfdi_uuid = '${uuid}'`) === "cancelado", "cancelar con motivo deja el cobro cancelado");
    exigir(sql(`select count(*) from audit_log where company_id = '${A}' and accion = 'cancelar_cobro' and identificador::text in (select id::text from expected_collections where cfdi_uuid = '${uuid}')`) === "1", "y deja un solo evento cancelar_cobro");
    exigir((await moderna.count()) === 0 && (await laura.locator(".alerta-asentado", { hasText: "cancelado con su motivo" }).isVisible()),
      "en «Esperados» la fila sale de la lista y el aviso «quedó asentado» se queda a la vista");

    await laura.goto(en(A, "/consola/cobros?estado=vencido"));
    const vencidos = await laura.locator("tr[data-cobro]").evaluateAll((f) => f.map((x) => x.getAttribute("data-estado")));
    exigir(vencidos.length === 1 && vencidos[0] === "vencido", "el filtro «Vencidos» muestra solo el vencido");
    await laura.goto(en(A, "/consola/cobros?estado=cobrado"));
    exigir((await laura.locator("tr[data-cobro]").count()) === 1, "el filtro «Cobrados» muestra el cobrado");
    await laura.goto(en(A, "/consola/cobros?vence=7"));
    const enSiete = await laura.locator("tr[data-cobro]").allInnerTexts();
    exigir(enSiete.every((t) => !t.includes("Cliente Mayorista")), "el filtro «Próximos 7 días» deja fuera el cobro del día 25");
    await laura.goto(en(A, "/consola/cobros"));
    const porCobrar = Number(await laura.locator('[data-cifra="por-cobrar"]').getAttribute("data-centavos"));
    exigir(porCobrar === 6_000_000 + 1_800_000, `total por cobrar ${pesos(porCobrar)} (esperados vigentes y vencidos, sin cobrados ni cancelados)`);
    await captura(laura, "e2-cobros.jpg");
  }

  if (debe("f")) {
    console.log("\n(f) Calendario");
    await laura.goto(en(A, "/consola/calendario"));
    await laura.locator(".barra-superior").getByRole("link", { name: "Nueva obligación" }).click();
    await laura.waitForURL(/#nueva-obligacion$/);
    exigir(await laura.locator("#nueva-obligacion").isVisible(), "«Nueva obligación» de la barra lleva al formulario");
    await laura.goto(en(A, "/consola/calendario"));
    for (const [tipo, nombre] of [["nomina", "nómina"], ["proveedor", "pago a proveedor"], ["cobro", "cobro"], ["obligacion", "renta"]]) {
      const evento = laura.locator(`.flujo-mes button.flujo-evento[data-tipo="${tipo}"]`).first();
      exigir(await evento.isVisible(), `el mes muestra ${nombre}`);
      await evento.click();
      const panel = laura.locator("dialog.panel-detalle[open]");
      await panel.locator("[data-detalle]").waitFor();
      const detalle = await panel.innerText();
      exigir(detalle.includes("Comprometido") && /\$[\d,]+\.\d\d/.test(detalle), `al clicar ${nombre} se abre su detalle con origen y monto`);
      if (tipo === "nomina") await captura(laura, "f1-detalle-nomina.jpg", false);
      await panel.getByRole("button").first().click();
      await laura.locator("dialog.panel-detalle[open]").waitFor({ state: "detached" }).catch(() => {});
    }
    const renta = laura.locator('.flujo-mes button.flujo-evento[data-tipo="obligacion"]', { hasText: "Renta" });
    exigir(await renta.count() >= 1, "la renta aparece el día 20");
    exigir((await laura.locator('.flujo-mes button.flujo-evento[data-vencido="true"]', { hasText: "Distribuidora" }).count()) === 1, "el cobro vencido sale marcado como vencido");

    const nueva = laura.locator('form[data-formulario="obligacion"]');
    exigir((await nueva.locator('[data-aviso="factura"]').innerText()).includes("factura"), "el formulario avisa que lo que llega como factura de proveedor ya cuenta en Pagos a proveedores");
    const opcionesProveedor = await nueva.locator('select[name="proveedorId"] option').allInnerTexts();
    exigir(opcionesProveedor[0] === "Sin proveedor" && opcionesProveedor.some((o) => o.includes("Transportes")), `y deja elegir el proveedor que la factura (${opcionesProveedor.length - 1} proveedores)`);
    await nueva.getByRole("button", { name: "Usar la plantilla «Impuestos provisionales (día 17)»" }).click();
    const plantilla = laura.locator('form[data-formulario="obligacion"]');
    exigir((await plantilla.locator('input[name="concepto"]').inputValue()) === "Impuestos provisionales", "la plantilla llena «Impuestos provisionales»");
    const fecha17 = await plantilla.locator('input[name="proximaFecha"]').inputValue();
    exigir(fecha17.endsWith("-17") && fecha17 >= HOY, `con el siguiente día 17 (${fecha17}) y frecuencia mensual`);
    await plantilla.locator('input[name="monto"]').fill("18500.00");
    exigir((await enviarConDobleClic(plantilla, "Registrar la obligación")).asentado, "se registra la obligación de impuestos (doble clic)");
    exigir(sql(`select count(*) from recurring_obligations where company_id = '${A}' and concepto = 'Impuestos provisionales'`) === "1"
      && sql(`select count(*) from audit_log where company_id = '${A}' and accion = 'registrar_obligacion' and identificador::text in (select id::text from recurring_obligations where concepto = 'Impuestos provisionales')`) === "1",
      "el doble clic deja una sola obligación y un solo evento registrar_obligacion");
    const obligacionRepetida = await repetirUltimaAccion(laura);
    exigir(obligacionRepetida.estado === 200 && sql(`select count(*) from recurring_obligations where company_id = '${A}' and concepto = 'Impuestos provisionales'`) === "1",
      "el mismo formulario reenviado byte por byte no crea otra obligación");
    await laura.reload();
    const impuestos = laura.locator("li[data-obligacion]", { hasText: "Impuestos provisionales" });
    await impuestos.locator("summary").click();
    const editar = impuestos.locator('form[data-formulario="editar-obligacion"]');
    await editar.locator('input[name="monto"]').fill("19250.00");
    exigir(await enviar(editar, "Guardar los cambios"), "se edita el monto a $19,250.00");
    exigir(sql(`select monto_centavos from recurring_obligations where concepto = 'Impuestos provisionales'`) === "1925000", "la base guarda el monto nuevo");
    await laura.reload();
    exigir((await laura.locator('.flujo-mes button.flujo-evento[data-tipo="obligacion"]', { hasText: "Impuestos" }).count()) >= 1 || fecha17.slice(0, 7) !== HOY.slice(0, 7),
      "los impuestos aparecen en el calendario del mes de su día 17");
    await captura(laura, "f2-calendario.jpg");
    await laura.getByRole("link", { name: "Mes siguiente →" }).click();
    await laura.waitForURL(/mes=/);
    exigir((await laura.locator(".flujo-mes button.flujo-evento").count()) > 0, "«Mes siguiente →» muestra diciembre con sus fechas");
    await laura.goto(en(A, "/consola/calendario"));
    const fila = laura.locator("li[data-obligacion]", { hasText: "Impuestos provisionales" });
    await fila.getByRole("button", { name: "Desactivar" }).click();
    exigir(await dobleClicConAccion(laura.locator("dialog.dialogo[open]").getByRole("button", { name: "Desactivar" })), "doble clic en «Desactivar»: el botón se ve ocupado");
    await laura.locator(".alerta-asentado", { hasText: "se desactivó" }).waitFor();
    exigir(sql(`select activa from recurring_obligations where concepto = 'Impuestos provisionales'`) === "f", "«Desactivar» la saca del calendario y de la proyección (activa = false)");
    exigir(sql(`select count(*) from audit_log where company_id = '${A}' and accion = 'desactivar_obligacion' and identificador::text in (select id::text from recurring_obligations where concepto = 'Impuestos provisionales')`) === "1", "con un solo evento desactivar_obligacion");

    // Una obligación que factura un proveedor cuenta solo lo que falta después de sus facturas del mes.
    const tn501 = semillas.cargos["TN-501"];
    await laura.goto(en(A, `/consola/calendario?mes=${tn501.programada.slice(0, 7)}`));
    const facturada = laura.locator('form[data-formulario="obligacion"]');
    await facturada.locator('input[name="concepto"]').fill("Mantenimiento de flotilla");
    await facturada.locator('input[name="monto"]').fill("30000.00");
    await facturada.locator('select[name="frecuencia"]').selectOption("mensual");
    await facturada.locator('input[name="proximaFecha"]').fill(tn501.programada);
    await facturada.locator('select[name="proveedorId"]').selectOption({ label: "Transportes del Norte" });
    exigir(await enviar(facturada, "Registrar la obligación"), `se registra «Mantenimiento de flotilla» ($30,000.00 al mes) facturada por Transportes del Norte, que el ${tn501.programada} trae TN-501 por ${pesos(tn501.total)}`);
    await laura.reload();
    const eventoFacturado = laura.locator('.flujo-mes button.flujo-evento[data-tipo="obligacion"]', { hasText: "Mantenimiento de flotilla" });
    const textoFacturado = (await eventoFacturado.innerText()).trim();
    exigir(textoFacturado === "Mantenimiento de flotilla: $5,000.00 restantes (ya hay factura por $25,000.00)", `el calendario la muestra como «${textoFacturado}»`);
    await eventoFacturado.click();
    const panelFacturado = laura.locator("dialog.panel-detalle[open]");
    await panelFacturado.locator("[data-detalle]").waitFor();
    const detalleFacturado = await panelFacturado.innerText();
    exigir(detalleFacturado.includes("Ya facturado este mes") && detalleFacturado.includes("$25,000.00: cuenta en Pagos a proveedores, aquí solo lo que falta") && detalleFacturado.includes("$5,000.00"),
      "al clicarla, el detalle dice cuánto ya está facturado ($25,000.00) y que solo cuenta lo que falta ($5,000.00)");
    await captura(laura, "f3-obligacion-facturada.jpg", false);
    await panelFacturado.getByRole("button").first().click();
  }

  if (debe("g")) {
    console.log("\n(g) Presupuestos");
    const { operacion, ventas } = semillas.areas;
    await laura.goto(en(A, "/consola/presupuestos"));
    const op = laura.locator(`[data-presupuesto="${operacion}"]`);
    const ve = laura.locator(`[data-presupuesto="${ventas}"]`);
    const gastoOp = Number(await op.locator('[data-cifra="gasto"]').getAttribute("data-centavos"));
    const gastoVe = Number(await ve.locator('[data-cifra="gasto"]').getAttribute("data-centavos"));
    exigir(gastoOp === 3_600_000 + 2_500_000 + 3_000_000, `Operación: nómina prorrateada $36,000.00 + Transportes del Norte $25,000.00 + renta $30,000.00 = ${pesos(gastoOp)} de $90,000.00`);
    exigir((await op.getAttribute("data-estado")) === "excedido", "Operación (101 %) aparece excedido");
    exigir(gastoVe === 2_000_000 + 1_500_000, `Ventas: nómina $20,000.00 + Publicidad Creativa $15,000.00 = ${pesos(gastoVe)} de $40,000.00`);
    exigir((await ve.getAttribute("data-estado")) === "atencion", "Ventas (87.5 %) aparece en atención");
    await captura(laura, "g1-presupuestos.jpg");
    await laura.goto(en(A, "/consola"));
    const alerta = await laura.locator('[data-alerta="presupuesto"]').innerText();
    exigir(alerta.includes("Operación") && alerta.includes("Ventas"), "Inicio avisa de los dos presupuestos");
    await laura.goto(en(A, "/consola/pendientes"));
    const pendientes = await laura.locator("body").innerText();
    exigir(pendientes.includes("El presupuesto del área Operación está excedido") && pendientes.includes("El presupuesto del área Ventas está por agotarse"), "Pendientes también");
    await captura(laura, "g2-pendientes.jpg", false);

    await laura.goto(en(A, "/consola/presupuestos"));
    const papeleria = laura.locator("form.flujo-area-proveedor", { hasText: "Papelería Central" });
    await papeleria.locator("select").selectOption(ventas);
    exigir((await enviarConDobleClic(papeleria, "Guardar")).asentado, "a Papelería Central se le asigna el área Ventas (doble clic)");
    await laura.reload();
    const gastoVe2 = Number(await laura.locator(`[data-presupuesto="${ventas}"] [data-cifra="gasto"]`).getAttribute("data-centavos"));
    exigir(gastoVe2 === gastoVe + 1_200_000 && (await laura.locator(`[data-presupuesto="${ventas}"]`).getAttribute("data-estado")) === "excedido",
      `su cargo PA-12 ($12,000.00) entra al presupuesto de Ventas: ${pesos(gastoVe2)}, excedido`);
    exigir(sql(`select count(*) from audit_log where company_id = '${A}' and accion = 'asignar_area_proveedor' and cambio->>'area_nueva' = 'Ventas'`) === "1", "con su evento asignar_area_proveedor (área por nombre)");

    await laura.goto(en(A, "/consola/proveedores/nuevo-proveedor"));
    await laura.getByLabel("RFC", { exact: true }).fill("MDE040404AB7");
    await laura.getByLabel("Razón social", { exact: true }).fill("Mensajería del Este");
    await laura.getByLabel("CLABE", { exact: true }).fill("002180701150123452");
    await laura.locator("#constancia").setInputFiles(PDF);
    await laura.locator("#areaId").selectOption({ label: "Operación" });
    await laura.getByRole("button", { name: "Dar de alta" }).click();
    await laura.getByText("Quedó asentado", { exact: true }).waitFor();
    exigir(sql(`select cost_center_id from suppliers where rfc = 'MDE040404AB7'`) === operacion, "el alta de proveedor guarda el área opcional (Operación)");
    await captura(laura, "g3-alta-proveedor-area.jpg", false);
  }

  if (debe("i")) {
    console.log("\n(i) Correo semanal");
    // Laura apaga y vuelve a encender su resumen; Diego (contador) lo enciende para él.
    await laura.goto(en(A, "/consola/flujo"));
    const correo = laura.locator('form[data-formulario="correo"]');
    exigir(await enviar(correo, "Dejar de recibirlo"), "Laura deja de recibir el resumen");
    await laura.reload();
    exigir(await enviar(laura.locator('form[data-formulario="correo"]'), "Recibirlo los lunes"), "y lo vuelve a encender");
    const { pagina: diego } = await abrir(navegador, "diego@lever.test");
    await diego.goto(en(A, "/consola/flujo"));
    exigir(await enviar(diego.locator('form[data-formulario="correo"]'), "Recibirlo los lunes"), "Diego (contador) lo enciende para sí");

    const sin = await cron(null);
    exigir(sin.estado === 401, `GET /tareas/correo-semanal sin secreto: ${sin.estado}`);
    const otro = await cron("Bearer otro-secreto");
    exigir(otro.estado === 401, `con otro secreto: ${otro.estado}`);
    const antes = correosAnotados().length;
    const primera = await cron(`Bearer ${SECRETO}`);
    exigir(primera.estado === 200, `con el secreto: 200 ${JSON.stringify(primera.cuerpo)}`);
    const correos = correosAnotados().slice(antes);
    const para = correos.map((c) => c.para[0]).sort();
    exigir(JSON.stringify(para) === JSON.stringify(["bruno@lever.test", "diego@lever.test", "fernanda@lever.test", "laura@lever.test"]),
      `el proveedor falso registra ${correos.length} correos: ${para.join(", ")}; la empresa de demostración (Diana) no recibe cifras de ejemplo`);
    exigir(sql(`select count(*) from weekly_digest_deliveries where semana = '${lunesDe(HOY)}'`) === "4", "cada persona que lo recibió queda registrada (4 entregas)");
    for (const c of correos) exigir(!c.texto.includes("1 persona") && !c.html.includes("1 persona"), `el correo a ${c.para[0]} no desglosa la nómina de una sola persona`);
    const segunda = await cron(`Bearer ${SECRETO}`);
    exigir(segunda.estado === 200 && segunda.cuerpo.enviados === 0 && segunda.cuerpo.omitidos === primera.cuerpo.empresas, `la segunda llamada de la semana no manda nada: ${JSON.stringify(segunda.cuerpo)}`);
    exigir(correosAnotados().length === antes + correos.length, "el proveedor falso no tiene correos nuevos");
    exigir(sql(`select count(*) from weekly_digest_sends where semana = '${lunesDe(HOY)}' and estado = 'enviado'`) === String(primera.cuerpo.empresas), "un envío por empresa y semana, enviado");
    const deA = correos.filter((c) => c.para[0] === "laura@lever.test")[0];
    const deB = correos.filter((c) => c.para[0] === "bruno@lever.test")[0];
    exigir(deA.texto.includes("Altamar") && deA.texto.includes("$150,000.00") && deA.texto.includes("Declarado por tu empresa") === false && deA.texto.includes("Saldo declarado por tu empresa"), "el de Altamar trae su saldo declarado ($150,000.00) con su origen");
    for (const ajeno of ["Altamar", "Transportes", "Renta de la bodega", "150,000", "Mayorista", "Operación"]) {
      exigir(!deB.html.includes(ajeno) && !deB.texto.includes(ajeno), `el correo de Bahía no trae «${ajeno}» de Altamar`);
    }
    exigir(deB.texto.includes("Sin un saldo declarado no se puede saber si el dinero alcanza") && !deB.texto.includes("alcanza para"),
      "Bahía no declaró saldo: su correo explica que sin saldo no se sabe si alcanza e invita a declararlo");
    exigir(!deA.texto.includes("Bahía") && !deA.texto.includes("Confirmado por el banco"), "ni el de Altamar trae datos de Bahía ni dice «Confirmado por el banco»");
    const ventasConGasto = /Área Ventas: excedido \(\$[\d,]+\.\d\d de \$40,000\.00\)/;
    exigir(ventasConGasto.test(deA.texto), "el de Laura (con el permiso de detalle de nómina) trae el gasto de Ventas");
    for (const quien of ["diego@lever.test", "fernanda@lever.test"]) {
      const c = correos.find((m) => m.para[0] === quien);
      exigir(c.texto.includes("Área Ventas: excedido (presupuesto de $40,000.00; el gasto está reservado).") && !ventasConGasto.test(c.texto) && !ventasConGasto.test(c.html),
        `el de ${quien} (sin el permiso) no trae el gasto de Ventas, cuya nómina es solo la de Carla`);
    }
    exigir(!deA.texto.includes("No alcanza") && !deA.html.includes("No alcanza"), "el de Altamar no dice «No alcanza»: los $180,000.00 autorizados de antes del saldo ya están pagados en él");
    writeFileSync(join(TEMPORAL, "correo-altamar.html"), deA.html);
    const vista = await navegador.newPage({ viewport: { width: 720, height: 900 } });
    await vista.goto(`file://${join(TEMPORAL, "correo-altamar.html")}`);
    await captura(vista, "i-correo-semanal.jpg");
    await vista.close();
  }

  if (debe("j")) {
    console.log("\n(j) Permisos");
    const { pagina: diego } = await abrir(navegador, "diego@lever.test");
    for (const ruta of ["/consola", "/consola/flujo", "/consola/cobros", "/consola/calendario", "/consola/presupuestos"]) {
      const r = await diego.goto(en(A, ruta));
      exigir(r.status() === 200, `el contador abre ${ruta} (${r.status()})`);
    }
    await diego.goto(en(A, "/consola/flujo"));
    exigir((await diego.locator('form[data-formulario="saldo"], form[data-formulario="colchon"]').count()) === 0, "no ve los formularios de saldo ni colchón");
    for (const ruta of ["/consola/cobros", "/consola/calendario"]) {
      await diego.goto(en(A, ruta));
      exigir((await diego.locator(".barra-superior a.boton").count()) === 0, `ni la acción de la barra en ${ruta}`);
    }
    await diego.goto(en(A, "/consola/flujo"));
    await diego.goto(en(A, "/consola/cobros"));
    exigir((await diego.locator('form[data-formulario="cobro"], form[data-formulario="cobro-xml"]').count()) === 0 && (await diego.getByRole("button", { name: "Marcar cobrado" }).count()) === 0, "ni el alta de cobros ni «Marcar cobrado»");
    await diego.goto(en(A, "/consola/presupuestos"));
    exigir((await diego.locator("form.flujo-area-proveedor").count()) === 0, "ni el área de cada proveedor");
    await captura(diego, "j1-contador-solo-lectura.jpg", false);
    // Carla cobra sola cada fin de mes: sin el permiso de detalle de nómina (contaduría, finanzas) no se ve el neto de una sola persona.
    const { pagina: fernanda } = await abrir(navegador, "fernanda@lever.test");
    for (const [quien, pagina, ruta] of [["el contador", diego, "/consola/calendario"], ["el contador", diego, "/consola/presupuestos"],
      ["finanzas", fernanda, "/consola"], ["finanzas", fernanda, "/consola/calendario"], ["finanzas", fernanda, "/consola/presupuestos"]]) {
      await pagina.goto(en(A, ruta));
      exigir(!(await pagina.locator("main").innerText()).includes("1 persona"), `${quien} no ve «1 persona» en ${ruta}`);
    }
    await fernanda.goto(en(A, "/consola"));
    const semanasFinanzas = await fernanda.locator("details[data-movimientos]").allTextContents();
    exigir(semanasFinanzas.some((s) => /· Nómina(?! quincenal| mensual)/.test(s)), "en Inicio de finanzas, la semana con la nómina de Carla junta la nómina en un renglón «Nómina»");
    await laura.goto(en(A, "/consola"));
    exigir((await laura.locator("details[data-movimientos]").allTextContents()).some((s) => s.includes("(1 persona)")), "Laura (administración) sí ve el detalle «(1 persona)»");
    // La nómina se agrupa por día: el 30 de noviembre paga a tres personas; el 30 de diciembre, solo a Carla.
    const [anio, mes] = HOY.split("-").map(Number);
    const siguienteMes = mes === 12 ? `${anio + 1}-01` : `${anio}-${String(mes + 1).padStart(2, "0")}`;
    await diego.goto(en(A, `/consola/calendario?mes=${siguienteMes}`));
    exigir((await diego.locator('[data-reservado="true"]').count()) >= 1, `en el calendario de ${siguienteMes}, el pago de una sola persona dice «Monto reservado»`);
    await captura(diego, "j4-contador-nomina-reservada.jpg", false);
    await laura.goto(en(A, `/consola/calendario?mes=${siguienteMes}`));
    exigir((await laura.locator('[data-reservado="true"]').count()) === 0, "y Laura ve todos los montos");

    // Ventas solo tiene la nómina de Carla: su gasto del mes sería su neto. Sin el permiso de detalle, solo estado y presupuesto.
    const { ventas, operacion } = semillas.areas;
    for (const [quien, pagina] of [["el contador", diego], ["finanzas", fernanda]]) {
      await pagina.goto(en(A, "/consola/presupuestos"));
      const tarjeta = pagina.locator(`[data-presupuesto="${ventas}"]`);
      const textoTarjeta = (await tarjeta.innerText()).replace(/\s+/g, " ").trim();
      exigir(await tarjeta.locator('[data-gasto="reservado"]').isVisible() && (await tarjeta.locator("[data-centavos]").count()) === 0
        && (await tarjeta.locator('[role="meter"]').count()) === 0 && textoTarjeta.includes("presupuesto de $40,000.00") && !/\d+ %/.test(textoTarjeta)
        && (await tarjeta.getAttribute("data-estado")) === "excedido",
        `${quien} ve Ventas con su estado y su presupuesto, sin gasto, porcentaje ni barra: «${textoTarjeta}»`);
      exigir((await pagina.locator(`[data-presupuesto="${operacion}"] [data-cifra="gasto"][data-centavos]`).count()) === 1, `${quien} sí ve el gasto de Operación (nómina de dos personas)`);
    }
    await diego.goto(en(A, "/consola/presupuestos"));
    await diego.locator(`[data-presupuesto="${ventas}"]`).scrollIntoViewIfNeeded();
    await captura(diego, "j5-presupuesto-reservado.jpg", false);
    await fernanda.goto(en(A, "/consola"));
    const alertaFinanzas = (await fernanda.locator('[data-alerta="presupuesto"]').innerText()).replace(/\s+/g, " ");
    exigir(alertaFinanzas.includes("Área Ventas: excedido (presupuesto de $40,000.00; el gasto está reservado)"),
      "en Inicio de finanzas, la alerta de Ventas dice «presupuesto de $40,000.00; el gasto está reservado»");
    await diego.goto(en(A, "/consola/pendientes"));
    exigir((await diego.locator("main").innerText()).includes("Presupuesto de $40,000.00 este mes. El gasto está reservado: solo lo ve quien puede ver el detalle de la nómina."),
      "en Pendientes del contador, el presupuesto de Ventas no dice cuánto lleva");
    await laura.goto(en(A, "/consola/presupuestos"));
    exigir(Number(await laura.locator(`[data-presupuesto="${ventas}"] [data-cifra="gasto"]`).getAttribute("data-centavos")) > 0, "Laura (con el permiso) sí ve el gasto de Ventas");

    if (!accionSaldo) throw new Error("FALLO no se capturó la acción del saldo en (b)");
    await diego.goto(en(A, "/consola/flujo"));
    const antes = sql(`select count(*) from cash_balance_declarations where company_id = '${A}'`);
    const { url, headers, cuerpo } = accionSaldo;
    const encabezados = Object.fromEntries(Object.entries(headers).filter(([k]) => ["next-action", "content-type", "accept", "next-router-state-tree"].includes(k)));
    const respuesta = await diego.evaluate(async ({ url: u, encabezados: h, cuerpo: c }) => {
      const r = await fetch(u, { method: "POST", headers: h, body: c });
      return { estado: r.status, texto: await r.text() };
    }, { url, encabezados, cuerpo });
    exigir(respuesta.texto.includes("Sin permiso para cambiar el flujo"), "el formulario del saldo enviado a mano por el contador: el servidor responde «Sin permiso para cambiar el flujo»");
    exigir(sql(`select count(*) from cash_balance_declarations where company_id = '${A}'`) === antes, "y la base no cambia");

    const { pagina: ernesto } = await abrir(navegador, "ernesto@lever.test");
    for (const ruta of ["/consola/flujo", "/consola/cobros", "/consola/calendario", "/consola/presupuestos"]) {
      rutas404.add(en(A, ruta).replace(BASE, ""));
      const r = await ernesto.goto(en(A, ruta));
      exigir(r.status() === 404, `un empleado sin la capacidad (tarjetahabiente) no ve ${ruta}: ${r.status()}`);
    }
    await captura(ernesto, "j2-empleado-404.jpg", false);
    for (const ruta of ["/consola/flujo", "/consola/cobros"]) {
      rutas404.add(en(B, ruta).replace(BASE, ""));
      const r = await laura.goto(en(B, ruta));
      exigir(r.status() === 404, `Laura (Altamar) en ${ruta} de Bahía: ${r.status()}`);
    }
    const { pagina: bruno } = await abrir(navegador, "bruno@lever.test");
    const r = await bruno.goto(en(A, "/consola/presupuestos"));
    exigir(r.status() === 404, `Bruno (Bahía) en Presupuestos de Altamar: ${r.status()}`);

    const { pagina: diana } = await abrir(navegador, "diana@lever.test");
    await diana.goto(en(C, "/consola"));
    const libro = diana.locator('[data-libro="demostracion"]');
    exigir(await libro.isVisible() && (await libro.textContent()).includes("Confirmado por el banco · demostración"), "en la empresa de demostración el libro sale marcado «Confirmado por el banco · demostración»");
    await captura(diana, "j3-demostracion-libro.jpg");
    await laura.goto(en(A, "/consola"));
    exigir((await laura.locator('[data-libro="demostracion"]').count()) === 0 && !(await laura.locator("body").textContent()).includes("Confirmado por el banco"), "en Altamar (cliente real) nunca");
  }

  if (debe("k")) {
    console.log("\n(k) Capturas en 3 temas × 1440 y 390");
    for (const tema of ["claro", "oscuro", "lever"]) {
      for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
        const { ctx, pagina } = await abrir(navegador, "laura@lever.test", { tema, ancho, alto });
        for (const [nombre, ruta] of [["inicio", "/consola"], ["cobros", "/consola/cobros"], ["calendario", "/consola/calendario"], ["presupuestos", "/consola/presupuestos"]]) {
          const r = await pagina.goto(en(A, ruta));
          exigir(r.status() === 200, `${nombre} ${tema} ${ancho}: 200`);
          const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          exigir(desborde <= 0, `${nombre} ${tema} ${ancho}: sin desplazamiento horizontal`);
          if (tema === "claro" && ancho === 1440) {
            // Convención de la Ola 1B: el título en la barra, un solo h1 (para lector de pantalla) y sin encabezado grande.
            const cabeza = await pagina.evaluate(() => ({
              h1: [...document.querySelectorAll("h1")].map((h) => ({ texto: h.textContent?.trim(), oculto: h.classList.contains("solo-lector") })),
              grande: document.querySelectorAll("main .pagina-cabeza, main .inicio-financiero > .inicio-cabeza, main .lede").length,
              barra: document.querySelector(".barra-titulo")?.textContent?.trim(),
            }));
            exigir(cabeza.h1.length === 1 && cabeza.h1[0].oculto && cabeza.grande === 0,
              `${nombre}: barra «${cabeza.barra}», un h1 solo para lector («${cabeza.h1[0]?.texto}») y sin encabezado grande`);
          }
          await captura(pagina, `k-${nombre}-${tema}-${ancho}.jpg`);
        }
        await ctx.close();
      }
    }
  }

  await navegador.close();
  console.log(`\n${comprobaciones} comprobaciones`);
  console.log(consola.length === 0 ? "Consola del navegador: sin errores ni advertencias de la aplicación" : `Consola del navegador (${consola.length}):\n${consola.join("\n")}`);
  console.log(`Avisos «GL Driver Message» del fondo WebGL (fuera de zona): ${avisosWebgl}`);
  console.log(`Mensajes esperados en las páginas 404 de (j) (el 404 del documento y la precarga de estilos sin usar): ${cuatrocientos}`);
  console.log("VALIDACION_FUNCIONAL_OK");
}

principal().catch((error) => {
  console.error(error.message);
  if (consola.length > 0) console.error(`Consola del navegador:\n${consola.join("\n")}`);
  process.exit(1);
});
