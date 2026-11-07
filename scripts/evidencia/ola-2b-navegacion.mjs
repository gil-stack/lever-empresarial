// Recorrido de la Ola 2b (navegación del diseño, modo demostración, Aprobaciones y Perfil)
// con Playwright headless propio, contra `next start` y la base que deja
// scripts/evidencia/ola-2b/preparar.ts. Pasos y variables en docs/evidencia/ola-2b-navegacion/README.md.
//
//   node scripts/evidencia/ola-2b-navegacion.mjs flujos      los 6 flujos clicados, con doble clic y conteo en la base
//   node scripts/evidencia/ola-2b-navegacion.mjs lado        los 16 módulos de Altamar junto a su captura del diseño
//   node scripts/evidencia/ola-2b-navegacion.mjs pantallas   3 temas × 1440/390: un h1, etiquetas, consola limpia, foco
//   node scripts/evidencia/ola-2b-navegacion.mjs modulos     Movimientos y Fiscal clicados en 3 temas × 1440/390
//   node scripts/evidencia/ola-2b-navegacion.mjs contraste   AA de cada texto contra la escena real
//   node scripts/evidencia/ola-2b-navegacion.mjs cargando    «Cargando…» de una sección nueva mientras llega la página
//   node scripts/evidencia/ola-2b-navegacion.mjs caida       con el Postgres apagado: el error de cada pantalla nueva
//
// Solo corre contra un Postgres local (DUENO_URL en 127.0.0.1 o localhost).
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const requerir = createRequire(`${process.cwd()}/package.json`);
const { chromium } = requerir("playwright");
const sharp = requerir("sharp");
const { PNG } = requerir("pngjs");

const ENTORNO = JSON.parse(readFileSync(process.env.ENTORNO ?? "test-results/ola-2b/entorno.json", "utf8"));
const BASE = process.env.BASE ?? "http://localhost:4812";
const DIR = process.env.DIR ?? "docs/evidencia/ola-2b-navegacion";
const DISENO = process.env.DISENO ?? "";
const DUENO = ENTORNO.DUENO_URL;
const SESIONES_CAIDA = process.env.SESIONES_CAIDA ?? "test-results/ola-2b/sesiones-caida.json";
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) throw new Error("DUENO_URL tiene que ser un Postgres local.");
const TALLER = `/c/${ENTORNO.EMPRESA_TALLER}`;
const ALTAMAR = `/c/${ENTORNO.EMPRESA_ALTAMAR}`;
const TEMAS = (process.env.TEMAS ?? "oscuro,claro,lever").split(",");
const ANCHOS = (process.env.ANCHOS ?? "1440,390").split(",").map(Number);

/** Quien recorre: su correo en la base sembrada y lo que debe ver. */
const PERSONAS = {
  gil: "gil-pagos@ejemplo.mx",
  rosa: "rosa-pagos@ejemplo.mx",
  ana: "ana-2b@lever.test",
  fernanda: "fernanda-2b@lever.test",
  carla: "carla-2b@lever.test",
  sergio: "sergio-2b@lever.test",
  laura: "laura-2b@lever.test",
  daniela: "daniela-2b@lever.test",
};
const SESIONES = {};

const resultados = [];
function anotar(ok, texto, detalle = "") {
  resultados.push({ ok, texto, detalle });
  console.log(`${ok ? "OK   " : "FALLO"} ${texto}${detalle ? ` · ${detalle}` : ""}`);
}

function sql(consulta) {
  return execFileSync("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8" }).trim();
}

/**
 * Una sesión nueva por persona, con su entrada verificada por TOTP en este
 * momento: abre la consola y autoriza pagos (el factor tiene menos de 30 min).
 */
function sesionesFrescas() {
  for (const [quien, correo] of Object.entries(PERSONAS)) {
    const usuario = sql(`select id from users where correo = '${correo}'`);
    if (!usuario) throw new Error(`No existe ${correo} en la base sembrada.`);
    const valor = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
    const entrada = randomUUID();
    sql(`
      insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
        values ('${entrada}', '${usuario}', '${createHash("sha256").update(entrada).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
      insert into sessions (id, user_id, token_hash, expires_at, superficie, segundo_factor, entrada_id)
        values ('${randomUUID()}', '${usuario}', '${createHash("sha256").update(valor).digest("hex")}', now() + interval '12 hours', 'cliente', 'totp', '${entrada}');
    `);
    SESIONES[quien] = valor;
  }
}

function renovarSesiones() {
  sql("update sessions set ultimo_uso = now() where expires_at > now()");
}

async function abrir({ quien, tema = "oscuro", ancho = 1440, javaScript = true }) {
  const nav = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const movil = ancho < 600;
  const ctx = await nav.newContext({
    javaScriptEnabled: javaScript,
    viewport: { width: ancho, height: movil ? 844 : 900 },
    isMobile: movil,
    hasTouch: movil,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
  });
  const host = new URL(BASE).hostname;
  // `next start` corre en producción: la cookie lleva el prefijo __Host- (Secure, Path=/, sin Domain).
  await ctx.addCookies([
    { name: "tema", value: tema, domain: host, path: "/" },
    ...(quien ? [{ name: "__Host-sesion", value: SESIONES[quien], domain: host, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }] : []),
  ]);
  const p = await ctx.newPage();
  const errores = [];
  p.on("pageerror", (e) => errores.push(`pageerror ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Download the React DevTools|favicon/.test(m.text())) errores.push(`consola ${m.text().slice(0, 240)}`);
  });
  return { nav, ctx, p, errores };
}

async function capturar(p, ruta, opciones = {}) {
  mkdirSync(ruta.slice(0, ruta.lastIndexOf("/")), { recursive: true });
  await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  if (!opciones.conFoco) await p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()).catch(() => {});
  await p.waitForTimeout(opciones.espera ?? 500);
  await sharp(await p.screenshot({ fullPage: opciones.completa ?? true })).webp({ quality: 78 }).toFile(ruta);
}

/** Lo que dice el lateral: los grupos, en orden, con sus enlaces. */
async function leerLateral(p) {
  return p.evaluate(() =>
    [...document.querySelectorAll("nav.secciones a.seccion")].map((a) => ({
      texto: [...a.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim(),
      href: a.getAttribute("href"),
      actual: a.getAttribute("aria-current") === "page",
    })),
  );
}

// ---------- Centinelas: nombres y cifras que solo existen en los datos de ejemplo ----------
function centinelas() {
  const fuente = readFileSync("src/server/demo/centinelas.ts", "utf8");
  return [...fuente.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]).filter((texto) => texto.length >= 3);
}

/** El HTML y la carga RSC de una página, pedidos con la sesión de la persona. */
async function htmlYRsc(quien, ruta) {
  const cookie = `__Host-sesion=${SESIONES[quien]}; tema=oscuro`;
  const html = await fetch(`${BASE}${ruta}`, { headers: { cookie }, redirect: "manual" });
  // Next 16 valida el parámetro _rsc contra los encabezados del enrutador y redirige (307) al bueno: se sigue
  // esa redirección a mano para conservar la cookie y el encabezado RSC.
  let rsc = await fetch(`${BASE}${ruta}`, { headers: { cookie, RSC: "1" }, redirect: "manual" });
  const destino = rsc.headers.get("location");
  if (rsc.status === 307 && destino?.includes("_rsc")) rsc = await fetch(new URL(destino, BASE), { headers: { cookie, RSC: "1" }, redirect: "manual" });
  return {
    html: { estado: html.status, tipo: html.headers.get("content-type") ?? "", cuerpo: await html.text() },
    rsc: { estado: rsc.status, tipo: rsc.headers.get("content-type") ?? "", cuerpo: await rsc.text() },
  };
}

const MODULOS_DEMO = [
  ["conciliacion", "Conciliación"],
  ["gastos", "Gastos"],
  ["tarjetas", "Tarjetas"],
  ["movimientos", "Movimientos"],
  ["fiscal", "Fiscal"],
  ["cuenta", "Cuenta"],
  ["internacional", "Pagos internacionales"],
  ["credito", "Crédito"],
  ["inversion", "Inversión"],
  ["viajes", "Viajes y proyectos"],
  ["gasolina", "Gasolina"],
  ["ahorro", "Ahorro"],
  ["integraciones", "Integraciones"],
];

/** Lo que el diseño pone en cada rol (verificado contra las capacidades en secciones.test.ts). */
const LATERAL_POR_ROL = {
  ana: {
    ve: ["Resumen", "Conciliación", "Aprobaciones", "Gastos", "Tarjetas", "Movimientos", "Fiscal", "Saldo y alertas", "Cuenta", "Pagos internacionales", "Proveedores", "Nómina", "Crédito", "Inversión", "Viajes y proyectos", "Gasolina", "Ahorro"],
    noVe: [],
  },
  fernanda: { ve: ["Resumen", "Aprobaciones", "Gastos", "Tarjetas", "Movimientos", "Saldo y alertas", "Cuenta", "Crédito", "Inversión", "Ahorro"], noVe: ["Fiscal", "Proveedores", "Nómina", "Conciliación"] },
  carla: { ve: ["Conciliación", "Aprobaciones", "Gastos", "Movimientos", "Fiscal", "Saldo y alertas", "Pagos internacionales", "Proveedores", "Nómina", "Viajes y proyectos", "Gasolina", "Ahorro"], noVe: ["Resumen", "Tarjetas", "Cuenta", "Crédito", "Inversión"] },
  rosa: { ve: ["Aprobaciones", "Fiscal", "Pagos internacionales", "Proveedores", "Nómina", "Viajes y proyectos", "Gasolina"], noVe: ["Resumen", "Gastos", "Tarjetas", "Cuenta", "Crédito", "Inversión", "Ahorro"] },
  sergio: { ve: ["Aprobaciones", "Fiscal", "Pagos internacionales", "Proveedores", "Viajes y proyectos", "Gasolina"], noVe: ["Resumen", "Nómina", "Gastos", "Tarjetas", "Cuenta", "Crédito", "Inversión", "Ahorro"] },
};

// ---------- Flujos ----------
async function flujos() {
  const carpeta = `${DIR}/flujos`;

  // Flujo 1: lateral en escritorio y cajón móvil por rol; cada enlace abre (ningún 404).
  for (const [quien, esperado] of Object.entries(LATERAL_POR_ROL)) {
    const { nav, p, errores } = await abrir({ quien });
    await p.goto(`${BASE}${TALLER}/consola/aprobaciones`, { waitUntil: "networkidle" });
    const lateral = await leerLateral(p);
    const textos = lateral.map((l) => l.texto);
    const faltan = esperado.ve.filter((t) => !textos.includes(t));
    const sobran = esperado.noVe.filter((t) => textos.includes(t));
    anotar(faltan.length === 0 && sobran.length === 0, `1 lateral ${quien}: ve lo de su rol y nada más`, `[${textos.join(", ")}]${faltan.length ? ` faltan ${faltan}` : ""}${sobran.length ? ` sobran ${sobran}` : ""}`);
    const rotos = [];
    for (const enlace of lateral) {
      const r = await fetch(`${BASE}${enlace.href}`, { headers: { cookie: `__Host-sesion=${SESIONES[quien]}` }, redirect: "manual" });
      if (r.status !== 200) rotos.push(`${enlace.texto}=${r.status}`);
    }
    anotar(rotos.length === 0, `1 lateral ${quien}: los ${lateral.length} enlaces responden 200`, rotos.join(", "));
    await capturar(p, `${carpeta}/1-lateral-${quien}-1440.webp`, { completa: false });
    // Un clic de verdad en el último enlace del lateral: navega y lo marca como actual.
    const ultimo = lateral.at(-1);
    await p.locator("nav.secciones a.seccion").last().click();
    await p.waitForURL(`**${ultimo.href}`, { timeout: 15000 }).catch(() => {});
    const marcado = (await leerLateral(p)).find((l) => l.actual)?.texto;
    anotar(new URL(p.url()).pathname === ultimo.href && marcado === ultimo.texto, `1 lateral ${quien}: clic en «${ultimo.texto}» abre y queda marcado`, `${new URL(p.url()).pathname} actual=${marcado}`);
    anotar(errores.length === 0, `1 lateral ${quien}: sin errores de consola`, errores.join(" | "));
    await nav.close();

    // Cajón móvil: se abre, atrapa el foco, Escape lo cierra y regresa el foco a «Secciones».
    const movil = await abrir({ quien, ancho: 390 });
    await movil.p.goto(`${BASE}${TALLER}/consola/aprobaciones`, { waitUntil: "networkidle" });
    const boton = movil.p.getByRole("button", { name: "Secciones" });
    await boton.click();
    await movil.p.waitForTimeout(400);
    await capturar(movil.p, `${carpeta}/1-cajon-${quien}-390.webp`, { completa: false });
    const dentro = [];
    for (let i = 0; i < 40; i += 1) {
      await movil.p.keyboard.press("Tab");
      dentro.push(await movil.p.evaluate(() => Boolean(document.activeElement?.closest("#lateral, .boton-menu"))));
    }
    anotar(dentro.every(Boolean), `1 cajón ${quien} 390: 40 tabulaciones sin salir del cajón`);
    await movil.p.keyboard.press("Escape");
    await movil.p.waitForTimeout(300);
    const regreso = await movil.p.evaluate(() => document.activeElement?.textContent?.includes("Secciones") ?? false);
    anotar(regreso, `1 cajón ${quien} 390: Escape cierra y el foco vuelve a «Secciones»`);
    anotar(movil.errores.length === 0, `1 cajón ${quien} 390: sin errores de consola`, movil.errores.join(" | "));
    await movil.nav.close();
  }

  // Flujo 2 (interacción): cada módulo de demostración de Altamar con su aviso y sus botones apagados.
  const todos = centinelas();
  for (const [modulo, titulo] of MODULOS_DEMO) {
    const { nav, p, errores } = await abrir({ quien: "laura" });
    const posts = [];
    p.on("request", (r) => r.method() === "POST" && posts.push(r.url()));
    const respuesta = await p.goto(`${BASE}${ALTAMAR}/consola/${modulo}`, { waitUntil: "networkidle" });
    const estado = await p.evaluate(() => {
      const main = document.querySelector("main");
      const botones = [...main.querySelectorAll("button")].filter((b) => b.type !== "submit");
      return {
        aviso: /Demostración\.\s+Datos de ejemplo de Altamar Logística/.test(main.innerText),
        encendidos: botones.filter((b) => !b.disabled).map((b) => b.textContent.trim().slice(0, 30)),
        marcas: main.querySelectorAll(".demo-marca").length,
        postForms: main.querySelectorAll('form[method="post" i]').length,
      };
    });
    anotar(respuesta?.status() === 200 && estado.aviso, `2 demo ${titulo}: abre con el aviso de demostración`, `${respuesta?.status()}`);
    anotar(estado.encendidos.length === 0 && estado.postForms === 0, `2 demo ${titulo}: ningún botón que mueva dinero encendido, ningún form POST`, estado.encendidos.join(","));
    // Clic forzado en el primer botón con la marca «Demostración»: no manda nada.
    const marcado = p.locator("main button:has(.demo-marca)").first();
    if ((await marcado.count()) > 0) {
      await marcado.click({ force: true }).catch(() => {});
      await p.waitForTimeout(400);
      anotar(posts.length === 0, `2 demo ${titulo}: clic en «${(await marcado.innerText()).replace(/\s+/g, " ").slice(0, 40)}» no envía nada`, posts.join(","));
    }
    anotar(errores.length === 0, `2 demo ${titulo}: sin errores de consola`, errores.join(" | "));
    await nav.close();
  }
  {
    // Lo que sí se mueve en la demo: pestañas y filtros por la dirección, y los enlaces reales de Fiscal.
    const { nav, p, errores } = await abrir({ quien: "laura" });
    await p.goto(`${BASE}${ALTAMAR}/consola/tarjetas`, { waitUntil: "networkidle" });
    await p.getByRole("link", { name: "Presupuestos por área" }).click();
    await p.waitForURL(/vista=presupuestos/);
    anotar(await p.getByText("Al ritmo actual se acaba el día 24").isVisible(), "2 demo Tarjetas: clic en «Presupuestos por área» cambia la vista");
    await capturar(p, `${carpeta}/2-tarjetas-presupuestos-1440.webp`);
    await p.goto(`${BASE}${ALTAMAR}/consola/movimientos`, { waitUntil: "networkidle" });
    // Como mfBar del diseño: sin botón «Filtrar»; elegir en un selector filtra, y «Limpiar filtros» sale con un filtro puesto.
    const filtrar = p.getByRole("button", { name: "Filtrar" });
    const limpiar = p.getByRole("link", { name: "Limpiar filtros" });
    anotar((await filtrar.count()) === 0 && (await limpiar.count()) === 0, "2 demo Movimientos: sin filtros no hay «Filtrar» ni «Limpiar filtros»");
    await p.getByLabel("Persona", { exact: true }).selectOption("Carlos Méndez");
    await p.waitForURL(/persona=Carlos/);
    await p.waitForFunction(() => !/\b34 compras con los filtros/.test(document.querySelector("main")?.innerText ?? ""));
    const filtrado = await p.evaluate(() => document.querySelector("main").innerText.match(/(\d+) compras? con los filtros/)?.[1] ?? null);
    anotar(filtrado !== null && Number(filtrado) < 34, "2 demo Movimientos: elegir a Carlos Méndez en Persona deja solo sus compras, sin botón", `${filtrado} de 34`);
    anotar(await limpiar.isVisible(), "2 demo Movimientos: con un filtro puesto aparece «Limpiar filtros»");
    await capturar(p, `${carpeta}/2-movimientos-filtrado-1440.webp`);
    await limpiar.click();
    await p.waitForURL((url) => url.pathname.endsWith("/consola/movimientos") && url.search === "");
    anotar((await limpiar.count()) === 0, "2 demo Movimientos: «Limpiar filtros» vuelve a todas las compras");
    {
      // Sin JavaScript el formulario GET sigue filtrando con el botón de <noscript>.
      const sinJs = await abrir({ quien: "laura", javaScript: false });
      await sinJs.p.goto(`${BASE}${ALTAMAR}/consola/movimientos`);
      await sinJs.p.getByLabel("Persona", { exact: true }).selectOption("Carlos Méndez");
      await sinJs.p.getByRole("button", { name: "Filtrar" }).click();
      await sinJs.p.waitForURL(/persona=Carlos/);
      const sinJsFiltrado = await sinJs.p.evaluate(() => document.querySelector("main").innerText.match(/(\d+) compras? con los filtros/)?.[1] ?? null);
      anotar(sinJsFiltrado === filtrado, "2 demo Movimientos: sin JavaScript, «Filtrar» deja las mismas compras", `${sinJsFiltrado} de 34`);
      await sinJs.nav.close();
    }
    await p.goto(`${BASE}${ALTAMAR}/consola/fiscal`, { waitUntil: "networkidle" });
    await p.getByRole("link", { name: "Lista 69-B" }).click();
    await p.waitForURL(/\/consola\/lista-69b/);
    const fiscalMarcado = (await leerLateral(p)).find((l) => l.actual)?.texto;
    anotar(fiscalMarcado === "Fiscal", "2 demo Fiscal: «Lista 69-B» abre la lista real y el lateral sigue en Fiscal", fiscalMarcado);
    anotar(errores.length === 0, "2 demo interacción: sin errores de consola", errores.join(" | "));
    await nav.close();
  }

  // Flujo 3: empresa real. «Disponible pronto» en pantalla; ni el HTML ni la carga RSC traen cifras o nombres de ejemplo.
  for (const [modulo, titulo] of MODULOS_DEMO) {
    const { nav, p, errores } = await abrir({ quien: "ana" });
    await p.goto(`${BASE}${TALLER}/consola/${modulo}`, { waitUntil: "networkidle" });
    const main = await p.evaluate(() => document.querySelector("main").innerText);
    // «Lista 69-B» es el nombre del enlace real de Fiscal, no una cifra.
    anotar(/Disponible pronto/i.test(main) && !/\d/.test(main.replaceAll("69-B", "")) && !/Demostración/.test(main), `3 real ${titulo}: «Disponible pronto», sin dígitos ni marca de demostración`, main.replace(/\s+/g, " ").slice(0, 120));
    if (modulo === "gastos" || modulo === "cuenta") await capturar(p, `${carpeta}/3-pronto-${modulo}-1440.webp`, { completa: false });
    const { html, rsc } = await htmlYRsc("ana", `${TALLER}/consola/${modulo}`);
    const enHtml = todos.filter((c) => html.cuerpo.includes(c));
    const enRsc = todos.filter((c) => rsc.cuerpo.includes(c));
    anotar(html.estado === 200 && enHtml.length === 0, `3 real ${titulo}: el HTML (${html.cuerpo.length} B) no trae ninguno de los ${todos.length} centinelas`, enHtml.join(","));
    anotar(rsc.estado === 200 && /x-component/.test(rsc.tipo) && enRsc.length === 0, `3 real ${titulo}: la carga RSC (${rsc.cuerpo.length} B, ${rsc.tipo}) no trae ninguno`, enRsc.join(","));
    anotar(errores.length === 0, `3 real ${titulo}: sin errores de consola`, errores.join(" | "));
    await nav.close();
  }
  {
    // Control positivo: la misma prueba sobre la empresa de demostración sí encuentra los centinelas.
    const { html, rsc } = await htmlYRsc("laura", `${ALTAMAR}/consola/cuenta`);
    anotar(html.cuerpo.includes("1,284,560") && rsc.cuerpo.includes("1,284,560"), "3 control: en Altamar el HTML y la RSC de Cuenta sí traen el saldo de ejemplo (la prueba detecta)");
  }

  // Flujo 4: Aprobaciones. Autorizar como segundo liberador, rechazar con el atajo R, preparar el lote; doble clic = una operación.
  {
    const autorizar = ENTORNO.PAGO_AUTORIZAR;
    const rechazar = ENTORNO.PAGO_RECHAZAR;
    const { nav, p, errores } = await abrir({ quien: "rosa" });
    await p.goto(`${BASE}${TALLER}/consola/aprobaciones`, { waitUntil: "networkidle" });
    await capturar(p, `${carpeta}/4a-aprobaciones-rosa-antes-1440.webp`);
    const antes = sql(`select estado from supplier_payment_requests where id = '${autorizar}'`);
    const fila = p.locator("li.decision", { hasText: "N-204" });
    await fila.getByRole("button", { name: "Autorizar" }).dblclick();
    await p.getByText("Decisión asentada").waitFor({ timeout: 15000 });
    await capturar(p, `${carpeta}/4b-autorizado-1440.webp`);
    const despues = sql(`select estado from supplier_payment_requests where id = '${autorizar}'`);
    const eventos = sql(`select count(*) from audit_log where accion = 'autorizar_pago_proveedor' and identificador = '${autorizar}'`);
    anotar(antes === "por_autorizar" && despues === "listo_para_pagar" && eventos === "1", "4 autorizar (doble clic): queda listo para pagar con un solo evento en la bitácora", `${antes}→${despues}, eventos=${eventos}`);
    anotar((await p.locator("li.decision", { hasText: "N-204" }).count()) === 0, "4 autorizar: la fila decidida sale de la bandeja");

    // Rechazar con el atajo R desde la fila: abre el diálogo, pide motivo y un doble clic manda una sola decisión.
    const otra = p.locator("li.decision", { hasText: "Mantenimiento de montacargas" });
    await otra.focus();
    await p.keyboard.press("r");
    const dialogo = p.getByRole("dialog", { name: "Rechazar el pago" });
    await dialogo.waitFor();
    await capturar(p, `${carpeta}/4c-rechazar-dialogo-1440.webp`, { completa: false, conFoco: true });
    // Con el diálogo abierto y el foco en sus botones, la tecla A no autoriza el pago que se está rechazando.
    await dialogo.getByLabel("Motivo").pressSequentially("Falta la factura");
    await p.keyboard.press("Tab");
    await p.keyboard.press("a");
    await p.keyboard.press("Tab");
    await p.keyboard.press("a");
    await p.waitForTimeout(1500);
    const trasA = sql(`select estado from supplier_payment_requests where id = '${rechazar}'`);
    const autorizadoPorA = sql(`select count(*) from audit_log where accion = 'autorizar_pago_proveedor' and identificador = '${rechazar}'`);
    const foco = await p.evaluate(() => document.activeElement?.textContent?.trim());
    anotar(
      trasA === "por_autorizar" && autorizadoPorA === "0" && (await dialogo.isVisible()),
      "4 atajos: con el rechazo abierto, A en «Cancelar» y en su «Rechazar» no autoriza el pago",
      `${trasA}, autorizaciones=${autorizadoPorA}, foco en «${foco}»`,
    );
    await capturar(p, `${carpeta}/4c-atajo-a-en-dialogo-1440.webp`, { completa: false, conFoco: true });
    await dialogo.getByLabel("Motivo").fill("Falta la factura del servicio");
    await dialogo.getByRole("button", { name: "Rechazar", exact: true }).dblclick();
    await p.getByText("Decisión asentada").waitFor({ timeout: 15000 });
    await p.waitForTimeout(500);
    const rechazado = sql(`select estado || '|' || coalesce(motivo_resolucion, '') from supplier_payment_requests where id = '${rechazar}'`);
    const eventosR = sql(`select count(*) from audit_log where accion = 'rechazar_pago_proveedor' and identificador = '${rechazar}'`);
    anotar(rechazado === "rechazado|Falta la factura del servicio" && eventosR === "1", "4 rechazar (atajo R + doble clic): rechazado con su motivo y un solo evento", `${rechazado}, eventos=${eventosR}`);
    await capturar(p, `${carpeta}/4d-rosa-despues-1440.webp`);
    anotar(errores.length === 0, "4 Rosa: sin errores de consola", errores.join(" | "));
    await nav.close();

    // Quien pidió los pagos (Gil, también liberador) no los ve para decidir.
    const gil = await abrir({ quien: "gil" });
    await gil.p.goto(`${BASE}${TALLER}/consola/aprobaciones`, { waitUntil: "networkidle" });
    anotar((await gil.p.locator("li.decision", { hasText: "Pago a proveedor" }).count()) === 0, "4 Gil pidió los pagos: no se le ofrecen para autorizar");
    await gil.nav.close();

    // Preparar el lote de nómina con doble clic: un lote y un evento; Aprobaciones lo quita y el contador baja.
    const ana = await abrir({ quien: "ana" });
    await ana.p.goto(`${BASE}${TALLER}/consola/aprobaciones`, { waitUntil: "networkidle" });
    const contadorAntes = await ana.p.evaluate(() => document.querySelector('nav.secciones a.seccion[aria-current="page"] .seccion-contador')?.firstChild?.textContent?.trim() ?? null);
    const segmentoAntes = await ana.p.evaluate(() => document.querySelector(".aprobaciones-vistas a")?.textContent.match(/· (\d+)/)?.[1] ?? null);
    anotar(contadorAntes === segmentoAntes, "4 el contador del lateral es el mismo número que «Pendientes · N»", `lateral=${contadorAntes} pestaña=${segmentoAntes}`);
    const fecha = sql(`select to_char(min(p.proximo_pago_en), 'YYYY-MM-DD') from employee_payroll_profiles p where p.company_id = '${ENTORNO.EMPRESA_TALLER}' and p.activa and not exists (select 1 from payroll_batches b where b.company_id = p.company_id and b.fecha_pago = p.proximo_pago_en)`);
    await ana.p.getByRole("button", { name: /^Preparar nómina del/ }).dblclick();
    await ana.p.waitForURL(/\/consola\/personas\/nomina\/[0-9a-f-]{36}$/, { timeout: 20000 });
    await capturar(ana.p, `${carpeta}/4e-lote-preparado-1440.webp`, { completa: false });
    const lotes = sql(`select count(*) from payroll_batches where company_id = '${ENTORNO.EMPRESA_TALLER}' and fecha_pago = '${fecha}'`);
    const eventosN = sql(`select count(*) from audit_log where accion = 'preparar_nomina' and company_id = '${ENTORNO.EMPRESA_TALLER}'`);
    anotar(lotes === "1" && eventosN === "1", "4 preparar nómina (doble clic): un lote y un evento, y abre el lote", `fecha=${fecha} lotes=${lotes} eventos=${eventosN}`);
    await ana.p.goto(`${BASE}${TALLER}/consola/aprobaciones`, { waitUntil: "networkidle" });
    const segmentoDespues = await ana.p.evaluate(() => document.querySelector(".aprobaciones-vistas a")?.textContent.match(/· (\d+)/)?.[1] ?? null);
    anotar(Number(segmentoDespues) === Number(segmentoAntes) - 1, "4 tras preparar, Aprobaciones tiene un pendiente menos", `${segmentoAntes}→${segmentoDespues}`);
    // Historial: la autorización, el rechazo y el lote quedan a la vista.
    await ana.p.getByRole("link", { name: "Historial" }).click();
    await ana.p.waitForURL(/vista=historial/);
    const historial = await ana.p.evaluate(() => document.querySelector("main").innerText);
    anotar(/Autorizado para pagar/.test(historial) && /Rechazado/.test(historial) && /Lotes de nómina preparados/.test(historial), "4 Historial: muestra la autorización, el rechazo y el lote", "");
    await capturar(ana.p, `${carpeta}/4f-historial-1440.webp`);
    // Pendientes se unió con Aprobaciones: la dirección vieja llega aquí con los mismos pendientes.
    const vieja = await fetch(`${BASE}${TALLER}/consola/pendientes`, { headers: { cookie: `__Host-sesion=${SESIONES.ana}` }, redirect: "manual" });
    anotar(vieja.status === 307 && vieja.headers.get("location") === `${TALLER}/consola/aprobaciones`, "4 /consola/pendientes redirige (307) a Aprobaciones", `${vieja.status} → ${vieja.headers.get("location")}`);
    await ana.p.goto(`${BASE}${TALLER}/consola/pendientes`, { waitUntil: "networkidle" });
    const resumen = await ana.p.evaluate(() => document.querySelector(".aprobaciones-vistas a")?.textContent.match(/· (\d+)/)?.[1] ?? null);
    const marcado = (await leerLateral(ana.p)).find((l) => l.actual)?.texto;
    anotar(new URL(ana.p.url()).pathname === `${TALLER}/consola/aprobaciones` && resumen === segmentoDespues && marcado === "Aprobaciones", "4 entrando por /consola/pendientes se llega a Aprobaciones con el mismo número", `${new URL(ana.p.url()).pathname} pendientes=${resumen} lateral=${marcado}`);
    // La alerta de faltante tampoco se pierde: con poco saldo declarado (con clics), aparece al entrar por la dirección vieja.
    await ana.p.goto(`${BASE}${TALLER}/consola/flujo`, { waitUntil: "networkidle" });
    const formaSaldo = ana.p.locator('form[data-formulario="saldo"]');
    await formaSaldo.locator("#saldo").fill("1000.00");
    await formaSaldo.locator("#alDia").fill(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date()));
    await formaSaldo.getByRole("button", { name: "Declarar el saldo" }).click();
    await formaSaldo.locator(".alerta-asentado").waitFor({ timeout: 15000 });
    await ana.p.goto(`${BASE}${TALLER}/consola/pendientes`, { waitUntil: "networkidle" });
    const faltante = ana.p.locator('[data-alerta="faltante"]');
    const conFaltante = await faltante.waitFor({ timeout: 10000 }).then(() => true, () => false);
    anotar(conFaltante && new URL(ana.p.url()).pathname === `${TALLER}/consola/aprobaciones`, "4 con poco saldo, la alerta de faltante aparece en Aprobaciones al entrar por /consola/pendientes", conFaltante ? (await faltante.innerText()).replace(/\s+/g, " ").slice(0, 90) : "sin alerta");
    await capturar(ana.p, `${carpeta}/4g-faltante-en-aprobaciones-1440.webp`);
    await faltante.getByRole("link").first().click();
    await ana.p.waitForURL(/\/consola(#proyeccion-titulo)?$|\/consola\/flujo$/, { timeout: 15000 }).catch(() => {});
    anotar(/\/consola(\/flujo)?$/.test(new URL(ana.p.url()).pathname), "4 el enlace de la alerta lleva a la proyección", ana.p.url().replace(BASE, ""));
    anotar(ana.errores.length === 0, "4 Ana: sin errores de consola", ana.errores.join(" | "));
    await ana.nav.close();

    // Vacío: quien no tiene nada que decidir.
    const sergio = await abrir({ quien: "sergio" });
    await sergio.p.goto(`${BASE}${TALLER}/consola/aprobaciones`, { waitUntil: "networkidle" });
    anotar(await sergio.p.getByRole("heading", { name: "Estás al corriente" }).isVisible(), "4 vacío: el solicitante ve «Estás al corriente» con sus atajos");
    await sergio.nav.close();
  }

  // Flujo 5: rutas viejas siguen vivas y se marcan en su sección nueva.
  {
    const viejas = [
      ["ana", "/consola/pendientes", "Aprobaciones"],
      ["ana", "/consola/lista-69b", "Fiscal"],
      ["ana", "/consola/poliza", "Fiscal"],
      ["ana", "/consola/personas", "Nómina"],
      ["ana", "/consola/personas/nomina", "Nómina"],
      ["ana", "/consola/flujo", "Saldo y alertas"],
      ["ana", "/consola/cobros", "Cobros"],
      ["ana", "/consola/proveedores", "Proveedores"],
      ["ana", "/consola", "Resumen"],
      ["ana", "/consola/politica", null],
      ["ana", "/consola/configuracion", null],
      ["ana", "/consola/apariencia", null],
    ];
    const { nav, p, errores } = await abrir({ quien: "ana" });
    for (const [, ruta, seccion] of viejas) {
      const r = await p.goto(`${BASE}${TALLER}${ruta}`, { waitUntil: "networkidle" });
      const marcado = (await leerLateral(p)).find((l) => l.actual)?.texto ?? null;
      const llega = new URL(p.url()).pathname.replace(TALLER, "");
      const destino = ruta === "/consola/pendientes" ? "/consola/aprobaciones" : ruta;
      anotar(r?.status() === 200 && llega === destino && marcado === seccion, `5 ${ruta}: ${destino === ruta ? "responde 200" : `redirige a ${destino}`} y el lateral marca ${seccion ?? "nada (vive en «Más»)"}`, `${r?.status()} ${llega} ${marcado}`);
    }
    anotar(errores.length === 0, "5 rutas viejas: sin errores de consola", errores.join(" | "));
    await nav.close();
    // Sin Resumen (contadora), /consola lleva a Aprobaciones.
    const carla = await abrir({ quien: "carla" });
    await carla.p.goto(`${BASE}${TALLER}/consola`, { waitUntil: "networkidle" });
    anotar(new URL(carla.p.url()).pathname === `${TALLER}/consola/aprobaciones`, "5 /consola sin Resumen (contadora) lleva a Aprobaciones", new URL(carla.p.url()).pathname);
    // Una sección que el rol no abre da 404 aunque se escriba la dirección.
    const r = await carla.p.goto(`${BASE}${TALLER}/consola/tarjetas`, { waitUntil: "networkidle" });
    anotar(r?.status() === 404, "5 sin permiso: la contadora no abre Tarjetas escribiendo la dirección (404)", `${r?.status()}`);
    await capturar(carla.p, `${carpeta}/5-sin-permiso-tarjetas-1440.webp`, { completa: false });
    await carla.nav.close();
  }

  // Flujo 6: «Más» en la tarjeta de la empresa y Perfil.
  {
    const { nav, p, errores } = await abrir({ quien: "ana" });
    await p.goto(`${BASE}${TALLER}/consola/aprobaciones`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: /Más: tu perfil y tu empresa/ }).click();
    const menuMas = p.getByRole("menu", { name: "Más: tu perfil y tu empresa" });
    await menuMas.getByRole("menuitem", { name: "Mi perfil" }).waitFor({ state: "visible" });
    const opciones = await menuMas.getByRole("menuitem").allInnerTexts();
    const esperadas = ["Mi perfil", "Apariencia", "Teléfono", "Configuración", "Políticas", "Integraciones"];
    anotar(esperadas.every((o) => opciones.some((t) => t.trim() === o)), "6 «Más»: Tú (Mi perfil, Apariencia, Teléfono) y Empresa (Configuración, Políticas, Integraciones)", opciones.map((o) => o.trim()).join(", "));
    await capturar(p, `${carpeta}/6a-mas-1440.webp`, { completa: false, conFoco: true });
    await p.getByRole("menuitem", { name: "Mi perfil" }).click();
    await p.waitForURL(/\/consola\/perfil$/);
    const perfil = await p.evaluate(() => document.querySelector("main").innerText);
    anotar(/Ana Administradora/.test(perfil) && /ana-2b@lever\.test/.test(perfil) && /Taller del Cierre/.test(perfil), "6 Mi perfil: nombre, correo y empresa de quien entra", perfil.replace(/\s+/g, " ").slice(0, 160));
    await capturar(p, `${carpeta}/6b-perfil-1440.webp`);
    await p.getByRole("link", { name: "Abrir seguridad" }).click();
    await p.waitForURL(/\/entrar\/seguridad/);
    anotar(new URL(p.url()).pathname === "/entrar/seguridad", "6 Perfil → «Abrir seguridad» abre /entrar/seguridad");
    await p.goBack({ waitUntil: "networkidle" });
    await p.getByRole("link", { name: "Abrir apariencia" }).click();
    await p.waitForURL(/\/consola\/apariencia$/);
    anotar(new URL(p.url()).pathname === `${TALLER}/consola/apariencia`, "6 Perfil → «Abrir apariencia» abre Apariencia");
    await p.getByRole("button", { name: /Más: tu perfil y tu empresa/ }).click();
    await p.getByRole("menuitem", { name: "Integraciones" }).click();
    await p.waitForURL(/\/consola\/integraciones$/);
    anotar(await p.getByText("Disponible pronto").isVisible(), "6 «Más» → Integraciones en la empresa real: «Disponible pronto»");
    anotar(errores.length === 0, "6 sin errores de consola", errores.join(" | "));
    await nav.close();
  }
}

// ---------- Los 16 módulos de Altamar junto a su captura ----------
const LADO = [
  ["plat-00-resumen.png", "/consola", "Resumen"],
  ["plat-01-conciliacio-n.png", "/consola/conciliacion", "Conciliación"],
  // Las solicitudes del diseño (saldo con crédito, aumento de límite, reembolsos) no existen como acciones:
  // se compara con la bandeja real de Taller del Cierre que ve la liberadora (corre antes de los flujos).
  ["plat-02-aprobaciones.png", "/consola/aprobaciones", "Aprobaciones", "rosa", "taller"],
  ["plat-03-gastos.png", "/consola/gastos", "Gastos"],
  ["plat-04-tarjetas.png", "/consola/tarjetas", "Tarjetas"],
  ["plat-05-movimientos.png", "/consola/movimientos", "Movimientos"],
  ["plat-06-fiscal.png", "/consola/fiscal", "Fiscal"],
  ["plat-07-cuenta.png", "/consola/cuenta", "Cuenta"],
  ["plat-08-pagos-internacionales.png", "/consola/internacional", "Pagos internacionales"],
  ["plat-09-proveedores.png", "/consola/proveedores", "Proveedores"],
  ["plat-10-no-mina.png", "/consola/personas/nomina", "Nómina"],
  ["plat-11-cre-dito.png", "/consola/credito", "Crédito"],
  ["plat-12-inversio-n.png", "/consola/inversion", "Inversión"],
  ["plat-13-viajes-y-proyectos.png", "/consola/viajes", "Viajes y proyectos"],
  ["plat-14-gasolina.png", "/consola/gasolina", "Gasolina"],
  ["plat-15-ahorro.png", "/consola/ahorro", "Ahorro"],
];

async function lado() {
  if (!DISENO) throw new Error("DISENO tiene que apuntar a la carpeta de capturas del diseño.");
  const carpeta = `${DIR}/lado-a-lado`;
  mkdirSync(carpeta, { recursive: true });
  for (const [archivo, ruta, titulo, quien = "laura", empresa = "altamar"] of LADO) {
    const { nav, p, errores } = await abrir({ quien, tema: "oscuro" });
    const respuesta = await p.goto(`${BASE}${empresa === "taller" ? TALLER : ALTAMAR}${ruta}`, { waitUntil: "networkidle" });
    await p.waitForFunction(() => ["quieto", "lento", "sin-motor"].includes(document.querySelector(".escena-fondo canvas")?.dataset.estado ?? ""), null, { timeout: 20000 }).catch(() => {});
    await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await p.waitForTimeout(600);
    const nuestra = await p.screenshot({ fullPage: false });
    const diseno = await sharp(`${DISENO}/${archivo}`).resize(1440, 900, { fit: "contain" }).png().toBuffer();
    const margen = 24;
    await sharp({ create: { width: 1440 * 2 + margen, height: 900, channels: 3, background: { r: 20, g: 18, b: 17 } } })
      .composite([{ input: diseno, left: 0, top: 0 }, { input: nuestra, left: 1440 + margen, top: 0 }])
      .webp({ quality: 80 })
      .toFile(`${carpeta}/${archivo.replace(".png", "")}.webp`);
    const tituloBarra = await p.evaluate(() => document.querySelector(".barra-titulo")?.textContent?.trim() ?? "");
    anotar(respuesta?.status() === 200 && tituloBarra === titulo, `lado ${archivo}: ${titulo} abre en ${empresa === "taller" ? "Taller del Cierre" : "Altamar"} con su título en la barra`, `${respuesta?.status()} «${tituloBarra}»`);
    anotar(errores.length === 0, `lado ${archivo}: sin errores de consola`, errores.join(" | "));
    await nav.close();
  }
  await diotContraLaFuente(carpeta);
}

/** Columnas de la DIOT, si su primera columna se corta y si su caja se desplaza, en el diseño o en la app. */
function medirDiot(enApp) {
  const tarjeta = enApp
    ? document.querySelector('section[aria-labelledby="fiscal-diot"]')
    : [...document.querySelectorAll("h3")].find((h) => /DIOT/.test(h.textContent ?? ""))?.closest(".card");
  const caja = tarjeta?.querySelector(enApp ? ".tabla-contenedor" : ".tblWrap");
  if (!tarjeta || !caja) return null;
  const nombres = [...tarjeta.querySelectorAll("tbody td:first-child b")];
  const cabeceras = [...tarjeta.querySelectorAll("thead th")];
  return {
    columnas: cabeceras.map((th) => th.textContent?.trim() ?? ""),
    aireAntesDeTabla: Math.round(cabeceras[0].getBoundingClientRect().top - tarjeta.querySelector("p").getBoundingClientRect().bottom),
    altoCabecera: Math.round(cabeceras[0].getBoundingClientRect().height),
    renglones: nombres.length,
    primeraSinCorte: nombres.length > 0 && nombres.every((b) => b.getClientRects().length === 1),
    desplaza: getComputedStyle(caja).overflowX === "auto",
    desborda: caja.scrollWidth > caja.clientWidth,
  };
}

/**
 * La DIOT se mide contra la fuente del diseño (fPlat.html, junto a la carpeta de capturas) y no solo contra su
 * captura: ahí la primera columna no se corta y la columna IVA queda tras un desplazamiento horizontal, así que
 * la imagen no la enseña. Deja las dos tarjetas desplazadas hasta el final, lado a lado, para que se vea IVA.
 */
async function diotContraLaFuente(carpeta) {
  const fuente = `file://${resolve(DISENO, "..", "fPlat.html")}#fiscal`;
  for (const ancho of [1440, 390]) {
    const tomas = [];
    const medidas = [];
    for (const enApp of [false, true]) {
      const { nav, p, errores } = await abrir({ quien: enApp ? "laura" : null, ancho });
      await p.goto(enApp ? `${BASE}${ALTAMAR}/consola/fiscal` : fuente, { waitUntil: "networkidle" });
      await p.waitForTimeout(enApp ? 600 : 1500);
      const medida = await p.evaluate(medirDiot, enApp);
      medidas.push(medida);
      const tarjeta = enApp ? p.locator('section[aria-labelledby="fiscal-diot"]') : p.locator(".card").filter({ has: p.locator("h3", { hasText: "DIOT" }) });
      await tarjeta.evaluate((nodo) => {
        const caja = nodo.querySelector(".tabla-contenedor, .tblWrap");
        if (caja) caja.scrollLeft = caja.scrollWidth;
      });
      await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
      tomas.push(await tarjeta.screenshot());
      if (enApp) anotar(errores.length === 0, `lado DIOT ${ancho}: sin errores de consola`, errores.join(" | "));
      await nav.close();
    }
    const [diseno, app] = medidas;
    const detalle = `diseño ${JSON.stringify(diseno)} · app ${JSON.stringify(app)}`;
    anotar(Boolean(diseno && app) && JSON.stringify(app.columnas) === JSON.stringify(diseno.columnas), `lado DIOT ${ancho}: las columnas son las de la fuente del diseño (${diseno?.columnas.join(", ")})`, detalle);
    anotar(Boolean(app?.primeraSinCorte && diseno?.primeraSinCorte), `lado DIOT ${ancho}: el proveedor no se corta, como en el diseño`, detalle);
    anotar(Boolean(app?.desplaza && diseno?.desplaza), `lado DIOT ${ancho}: la tabla se desplaza a lo ancho, como en el diseño`, detalle);
    anotar(
      app?.aireAntesDeTabla === diseno?.aireAntesDeTabla && app?.altoCabecera === diseno?.altoCabecera,
      `lado DIOT ${ancho}: el aire entre la nota y la tabla y el alto de la cabecera son los del diseño`,
      detalle,
    );
    const [a, b] = await Promise.all(tomas.map((toma) => sharp(toma).metadata()));
    const margen = 24;
    await sharp({ create: { width: a.width + margen + b.width, height: Math.max(a.height, b.height), channels: 3, background: { r: 20, g: 18, b: 17 } } })
      .composite([{ input: tomas[0], left: 0, top: 0 }, { input: tomas[1], left: a.width + margen, top: 0 }])
      .webp({ quality: 80 })
      .toFile(`${carpeta}/plat-06-fiscal-diot-${ancho}.webp`);
  }
}

// ---------- Movimientos y Fiscal clicados en 3 temas × 1440/390 ----------
async function modulos() {
  const carpeta = `${DIR}/modulos`;
  mkdirSync(carpeta, { recursive: true });
  for (const tema of TEMAS) {
    for (const ancho of ANCHOS) {
      const etiqueta = `modulos ${tema} ${ancho}`;
      const { nav, p, errores } = await abrir({ quien: "laura", tema, ancho });
      // Navegaciones del formulario: las precargas de los enlaces de periodo llevan los mismos filtros y no cuentan.
      const navegaciones = [];
      p.on("request", (r) => {
        if (!r.headers()["next-router-prefetch"] && /\/consola\/movimientos\?/.test(r.url())) navegaciones.push(r.url());
      });
      const compras = () => p.evaluate(() => document.querySelector("main").innerText.match(/(\d+) compras? con los filtros/)?.[1] ?? null);
      const limpiar = p.getByRole("link", { name: "Limpiar filtros" });
      await p.goto(`${BASE}${ALTAMAR}/consola/movimientos`, { waitUntil: "networkidle" });
      anotar((await compras()) === "34" && (await limpiar.count()) === 0, `${etiqueta} Movimientos: abre con las 34 compras y sin «Limpiar filtros»`);
      await p.getByLabel("Persona", { exact: true }).selectOption("Carlos Méndez");
      await p.waitForURL(/persona=Carlos/);
      await p.waitForFunction(() => !/\b34 compras con los filtros/.test(document.querySelector("main")?.innerText ?? ""));
      const deCarlos = await compras();
      anotar(Number(deCarlos) < 34 && navegaciones.length === 1, `${etiqueta} Movimientos: elegir a Carlos Méndez filtra solo, con una navegación`, `${deCarlos} de 34 · ${navegaciones.length} navegación(es)`);
      navegaciones.length = 0;
      await p.locator("#movimientos-desde").click();
      await p.keyboard.type("1000");
      await p.keyboard.press("Enter");
      await p.waitForURL(/desde=1000/);
      await p.waitForTimeout(800);
      const conMonto = await compras();
      anotar(navegaciones.length === 1 && Number(conMonto) <= Number(deCarlos), `${etiqueta} Movimientos: Enter en «Monto desde» filtra con una sola navegación`, `${conMonto} compras · ${navegaciones.length} navegación(es)`);
      await capturar(p, `${carpeta}/movimientos-filtrado-${tema}-${ancho}.webp`);
      await limpiar.click();
      await p.waitForURL((url) => url.pathname.endsWith("/consola/movimientos") && url.search === "");
      anotar((await compras()) === "34" && (await limpiar.count()) === 0, `${etiqueta} Movimientos: «Limpiar filtros» vuelve a las 34 compras`);

      await p.goto(`${BASE}${ALTAMAR}/consola/fiscal`, { waitUntil: "networkidle" });
      const caja = p.locator('section[aria-labelledby="fiscal-diot"] .tabla-contenedor');
      await caja.scrollIntoViewIfNeeded();
      await caja.evaluate((nodo) => {
        nodo.scrollLeft = nodo.scrollWidth;
      });
      const iva = await caja.evaluate((nodo) => {
        const ultima = [...nodo.querySelectorAll("thead th")].at(-1);
        const a = nodo.getBoundingClientRect();
        const b = ultima.getBoundingClientRect();
        return { texto: ultima.textContent.trim(), adentro: b.left >= a.left - 1 && b.right <= a.right + 1, desplazado: nodo.scrollLeft };
      });
      anotar(iva.texto === "IVA" && iva.adentro, `${etiqueta} Fiscal: al desplazar la DIOT a lo ancho se ve la columna IVA`, JSON.stringify(iva));
      // La captura de página completa sale descuadrada si la ventana está desplazada; la tabla conserva su desplazamiento.
      await p.evaluate(() => window.scrollTo(0, 0));
      await capturar(p, `${carpeta}/fiscal-diot-${tema}-${ancho}.webp`);
      await p.getByRole("link", { name: "Lista 69-B" }).click();
      await p.waitForURL(/\/consola\/lista-69b/);
      const marcado = (await leerLateral(p)).find((l) => l.actual)?.texto;
      anotar(marcado === "Fiscal", `${etiqueta} Fiscal: «Lista 69-B» abre la lista real y el lateral sigue en Fiscal`, marcado);
      await p.goBack();
      await p.waitForURL(/\/consola\/fiscal$/);
      anotar(await p.getByRole("columnheader", { name: "IVA", exact: true }).count() === 1, `${etiqueta} Fiscal: al volver, la DIOT sigue con sus tres columnas`);
      anotar(errores.length === 0, `${etiqueta}: sin errores de consola`, errores.join(" | "));
      await nav.close();
    }
  }
}

// ---------- Pantallas nuevas en 3 temas × 1440/390 ----------
const PANTALLAS = [
  { clave: "10-aprobaciones-liberador", quien: "rosa", ruta: `${TALLER}/consola/aprobaciones` },
  { clave: "11-aprobaciones-administrador", quien: "ana", ruta: `${TALLER}/consola/aprobaciones` },
  { clave: "12-aprobaciones-vacio", quien: "sergio", ruta: `${TALLER}/consola/aprobaciones` },
  { clave: "13-aprobaciones-historial", quien: "ana", ruta: `${TALLER}/consola/aprobaciones?vista=historial` },
  { clave: "14-aprobaciones-altamar", quien: "laura", ruta: `${ALTAMAR}/consola/aprobaciones` },
  { clave: "15-perfil", quien: "ana", ruta: `${TALLER}/consola/perfil` },
  ...MODULOS_DEMO.map(([modulo], i) => ({ clave: `${20 + i}-demo-${modulo}`, quien: "laura", ruta: `${ALTAMAR}/consola/${modulo}` })),
  { clave: "34-demo-tarjetas-presupuestos", quien: "laura", ruta: `${ALTAMAR}/consola/tarjetas?vista=presupuestos` },
  { clave: "40-pronto-gastos", quien: "ana", ruta: `${TALLER}/consola/gastos` },
  { clave: "41-pronto-fiscal", quien: "ana", ruta: `${TALLER}/consola/fiscal` },
  { clave: "42-pronto-cuenta", quien: "ana", ruta: `${TALLER}/consola/cuenta` },
];

/** Un solo h1, ningún campo sin nombre accesible y los errores ligados a su campo. */
async function revisarAccesibilidad(p) {
  return p.evaluate(() => {
    const h1 = document.querySelectorAll("h1").length;
    const sinNombre = [];
    for (const campo of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
      if (campo.closest("[hidden], dialog:not([open])")) continue;
      const id = campo.id;
      const etiqueta = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || campo.closest("label");
      const nombre = campo.getAttribute("aria-label") || campo.getAttribute("aria-labelledby") || etiqueta;
      if (!nombre) sinNombre.push(campo.name || campo.id || campo.type);
    }
    const erroresSueltos = [];
    for (const error of document.querySelectorAll(".error-campo[id]")) {
      if (!document.querySelector(`[aria-describedby~="${CSS.escape(error.id)}"]`)) erroresSueltos.push(error.id);
    }
    const botonesSinNombre = [...document.querySelectorAll("button, a[href]")].filter((b) => !b.closest("dialog:not([open]), [hidden]") && !(b.getAttribute("aria-label") || b.textContent.trim() || b.getAttribute("title"))).map((b) => b.outerHTML.slice(0, 60));
    return { h1, sinNombre, erroresSueltos, botonesSinNombre };
  });
}

/** Tab por toda la página: orden del documento y un cambio visible en cada parada. */
async function revisarFoco(p) {
  await p.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
    window.__previo = null;
    window.__primero = null;
  });
  const sinIndicador = [];
  const fueraDeOrden = [];
  let paradas = 0;
  for (let i = 0; i < 120; i += 1) {
    await p.keyboard.press("Tab");
    const parada = await p.evaluate(async () => {
      const cuadro = () => new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(listo, 60))));
      const el = document.activeElement;
      if (!el || el === document.body) return { cuerpo: true };
      if (el === window.__primero) return { fin: true };
      if (el === window.__previo) return { mismo: true };
      window.__primero ??= el;
      const previo = window.__previo;
      const vuelta = previo && previo.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING;
      window.__previo = el;
      const cadena = [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean);
      const foto = () => cadena.map((n) => { const e = getComputedStyle(n); return [e.outlineStyle, e.outlineWidth, e.outlineColor, e.boxShadow, e.borderTopColor, e.borderBottomColor, e.backgroundColor, e.color, e.textDecorationLine].join("|"); }).join("#");
      await cuadro();
      const enfocado = foto();
      const ancla = document.createElement("span");
      ancla.tabIndex = -1;
      (el.closest("dialog[open]") ?? document.body).append(ancla);
      ancla.focus({ preventScroll: true });
      await cuadro();
      const suelto = foto();
      ancla.remove();
      el.focus({ preventScroll: true });
      const nombre = `${el.tagName.toLowerCase()}«${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}»`;
      return { vuelta: Boolean(vuelta), nombre, indicador: enfocado !== suelto };
    });
    if (parada.cuerpo) {
      if (paradas > 0) break;
      continue;
    }
    if (parada.fin) break;
    if (parada.mismo) continue;
    paradas += 1;
    if (parada.vuelta) fueraDeOrden.push(parada.nombre);
    if (!parada.indicador) sinIndicador.push(parada.nombre);
  }
  return { paradas, sinIndicador, fueraDeOrden };
}

async function pantallas() {
  const carpeta = `${DIR}/pantallas`;
  const solo = process.env.SOLO ? process.env.SOLO.split(",") : null;
  for (const tema of TEMAS) {
    for (const ancho of ANCHOS) {
      renovarSesiones();
      for (const pantalla of PANTALLAS) {
        if (solo && !solo.some((s) => pantalla.clave.startsWith(s))) continue;
        const { nav, p, errores } = await abrir({ quien: pantalla.quien, tema, ancho });
        const respuesta = await p.goto(`${BASE}${pantalla.ruta}`, { waitUntil: "networkidle" });
        await capturar(p, `${carpeta}/${pantalla.clave}-${tema}-${ancho}.webp`);
        const a11y = await revisarAccesibilidad(p);
        const desborda = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        const etiqueta = `${pantalla.clave} ${tema} ${ancho}`;
        anotar(respuesta?.status() === 200, `${etiqueta}: responde 200`, `${respuesta?.status()}`);
        anotar(a11y.h1 === 1, `${etiqueta}: un solo h1`, `h1=${a11y.h1}`);
        anotar(a11y.sinNombre.length === 0 && a11y.botonesSinNombre.length === 0, `${etiqueta}: campos, botones y enlaces con nombre`, [...a11y.sinNombre, ...a11y.botonesSinNombre].join(","));
        anotar(a11y.erroresSueltos.length === 0, `${etiqueta}: errores ligados a su campo`, a11y.erroresSueltos.join(","));
        anotar(!desborda, `${etiqueta}: sin desplazamiento horizontal`);
        if (tema === "oscuro" && ancho === 1440) {
          const foco = await revisarFoco(p);
          anotar(foco.sinIndicador.length === 0 && foco.fueraDeOrden.length === 0, `${etiqueta}: ${foco.paradas} paradas de Tab en orden y con foco visible`, [...foco.sinIndicador, ...foco.fueraDeOrden].join(","));
        }
        anotar(errores.length === 0, `${etiqueta}: sin errores de consola`, errores.join(" | "));
        await nav.close();
      }
    }
  }
}

// ---------- Contraste AA contra la escena real (método del #50) ----------
const lineal = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminancia = ([r, g, b]) => 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
const razon = (a, b) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mezcla = (frente, fondo, a) => frente.map((v, i) => v * a + fondo[i] * (1 - a));

async function contraste() {
  const informe = {};
  const solo = process.env.SOLO ? process.env.SOLO.split(",") : null;
  for (const tema of TEMAS) {
    for (const ancho of ANCHOS) {
      renovarSesiones();
      const fallas = [];
      let medidos = 0;
      let minimo = Infinity;
      for (const pantalla of PANTALLAS) {
        if (solo && !solo.some((s) => pantalla.clave.startsWith(s))) continue;
        const { nav, p } = await abrir({ quien: pantalla.quien, tema, ancho });
        await p.goto(`${BASE}${pantalla.ruta}`, { waitUntil: "networkidle" });
        await p.waitForFunction(() => ["quieto", "lento", "sin-motor"].includes(document.querySelector(".escena-fondo canvas")?.dataset.estado ?? ""), null, { timeout: 20000 }).catch(() => {});
        await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        const alto = await p.evaluate(() => document.documentElement.scrollHeight);
        // Se mide pantalla por pantalla bajando por la página: cada texto contra lo que tiene detrás.
        // El paso es menor que la ventana menos la barra fija de arriba: ningún texto queda sin medir.
        for (let y = 0; y < alto; y += ancho < 600 ? 640 : 760) {
          await p.evaluate((destino) => window.scrollTo(0, destino), y);
          await p.waitForTimeout(250);
          // Si algo se movió entre la medición y la captura (una imagen que termina de cargar, la barra
          // que cambia al desplazarse), cada texto quedaría contra un fondo ajeno: se repite el paso.
          let textos;
          let png;
          let pngNormal;
          for (let intento = 1; ; intento += 1) {
          textos = await p.evaluate(() => {
            const salida = [];
            window.__medidos = [];
            const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            const vistos = new Set();
            while (recorrido.nextNode()) {
              const nodo = recorrido.currentNode;
              if (!nodo.textContent.trim()) continue;
              const el = nodo.parentElement;
              if (!el || vistos.has(el)) continue;
              vistos.add(el);
              // Los controles apagados («Demostración») quedan fuera de 1.4.3 de WCAG; se cuentan aparte.
              if (el.closest("[aria-hidden=true], .logotipo, .solo-lector, script, style, noscript, option, [disabled], fieldset[disabled], .saltar, svg, dialog:not([open])")) continue;
              const estilo = getComputedStyle(el);
              if (estilo.visibility === "hidden" || Number(estilo.opacity) === 0) continue;
              const rango = document.createRange();
              rango.selectNodeContents(nodo);
              const r = rango.getBoundingClientRect();
              if (r.width < 2 || r.height < 2 || r.top < 0 || r.bottom > innerHeight || r.right < 0 || r.left > innerWidth) continue;
              let recortado = false;
              for (let a = el; a && !recortado; a = a.parentElement) {
                const caja = a.getBoundingClientRect();
                recortado = (caja.width < 2 || caja.height < 2) && getComputedStyle(a).overflow !== "visible";
              }
              if (recortado) continue;
              // Solo cuenta la parte que se ve: una tabla que se desplaza de lado recorta lo que queda fuera de su caja.
              let vis = { l: r.left, t: r.top, r: r.right, b: r.bottom };
              for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
                const e = getComputedStyle(a);
                if (e.overflowX === "visible" && e.overflowY === "visible") continue;
                const c = a.getBoundingClientRect();
                vis = { l: Math.max(vis.l, c.left), t: Math.max(vis.t, c.top), r: Math.min(vis.r, c.right), b: Math.min(vis.b, c.bottom) };
              }
              if (vis.r - vis.l < 2 || vis.b - vis.t < 2) continue;
              // Lo que pasa por debajo de la barra superior (fija al desplazarse) no se ve: no se mide contra ella.
              const medio = (vis.t + vis.b) / 2;
              const tapado = [(vis.l + vis.r) / 2, vis.l + 1, vis.r - 1].every((px) => {
                const encima = document.elementFromPoint(px, medio);
                return encima && !el.contains(encima) && !encima.contains(el);
              });
              if (tapado) {
                const encima = document.elementFromPoint((vis.l + vis.r) / 2, medio);
                (window.__tapados ??= []).push(`${nodo.textContent.trim().slice(0, 24)} ⟵ ${encima.tagName.toLowerCase()}.${String(encima.className).trim().split(/\s+/).join(".")}`);
                continue;
              }
              let opacidad = 1;
              for (let a = el; a; a = a.parentElement) opacidad *= Number(getComputedStyle(a).opacity);
              const n = estilo.color.match(/[\d.]+/g).map(Number);
              const color = estilo.color.startsWith("color(") ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : [n[0], n[1], n[2], n[3] ?? 1];
              const donde = [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean).map((n) => `${n.tagName.toLowerCase()}${typeof n.className === "string" && n.className ? `.${n.className.trim().split(/\s+/).join(".")}` : ""}`).join(" < ");
              salida.push({ donde, texto: nodo.textContent.trim().slice(0, 40), color, opacidad, tamano: parseFloat(estilo.fontSize), peso: Number(estilo.fontWeight), caja: { x: Math.max(0, vis.l), y: Math.max(0, vis.t), w: vis.r - vis.l, h: vis.b - vis.t }, origen: [r.x, r.y] });
              window.__medidos.push(nodo);
            }
            return salida;
          });
          const oculto = await p.addStyleTag({ content: "html body *, html body *::before, html body *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } svg text { fill: transparent !important; }" });
          await p.waitForTimeout(150);
          await p.evaluate(() => new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(listo))));
          png = PNG.sync.read(await p.screenshot());
          const despues = await p.evaluate(() => window.__medidos.map((n) => {
            const g = document.createRange();
            g.selectNodeContents(n);
            const r = g.getBoundingClientRect();
            return [r.x, r.y];
          }));
          await oculto.evaluate((n) => n.remove());
          if (process.env.DEPURAR) {
            pngNormal = PNG.sync.read(await p.screenshot());
            const tapados = await p.evaluate(() => window.__tapados?.splice(0) ?? []);
            if (tapados.length) console.log(`TAPADOS ${pantalla.clave} ${ancho} y=${y}: ${tapados.join(" | ")}`);
          }
          const quieto = despues.length === textos.length && despues.every(([dx, dy], i) => Math.abs(dx - textos[i].origen[0]) <= 1 && Math.abs(dy - textos[i].origen[1]) <= 1);
          // Con el equipo cargado la captura a veces sale antes de pintar el texto transparente: si en el
          // centro de varios textos aparece su propio color, la captura todavía tiene letras y se repite.
          const conLetras = textos.filter((t) => {
            const k = (Math.min(png.height - 1, Math.round(t.caja.y + t.caja.h / 2)) * png.width + Math.min(png.width - 1, Math.round(t.caja.x + t.caja.w / 2))) * 4;
            return Math.abs(png.data[k] - t.color[0]) + Math.abs(png.data[k + 1] - t.color[1]) + Math.abs(png.data[k + 2] - t.color[2]) < 12;
          }).length;
          if (quieto && conLetras <= 3) break;
          if (intento === 3) throw new Error(`${pantalla.clave} ${tema} ${ancho}: la captura no se estabilizó en y=${y} (quieto=${quieto}, con letras=${conLetras})`);
          await p.waitForTimeout(500);
          }
          for (const t of textos) {
            const alfa = t.color[3] * t.opacidad;
            let peor = Infinity;
            let fondoPeor = null;
            const { x, y: arriba, w, h } = t.caja;
            for (let i = 0; i <= 6; i += 1) {
              for (let j = 0; j <= 4; j += 1) {
                const px = Math.min(png.width - 1, Math.round(x + (w * i) / 6));
                const py = Math.min(png.height - 1, Math.round(arriba + (h * j) / 4));
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
            if (peor < umbral && process.env.DEPURAR) {
              const recorte = new PNG({ width: Math.round(w) + 40, height: Math.round(h) + 40 });
              PNG.bitblt(png, recorte, Math.max(0, Math.round(x) - 20), Math.max(0, Math.round(arriba) - 20), Math.min(Math.round(w) + 40, png.width - Math.max(0, Math.round(x) - 20)), Math.min(Math.round(h) + 40, png.height - Math.max(0, Math.round(arriba) - 20)), 0, 0);
              mkdirSync(process.env.DEPURAR, { recursive: true });
              writeFileSync(`${process.env.DEPURAR}/${pantalla.clave}-${ancho}-${Math.round(arriba + y)}.png`, PNG.sync.write(recorte));
              const normal = new PNG({ width: recorte.width, height: recorte.height });
              PNG.bitblt(pngNormal, normal, Math.max(0, Math.round(x) - 20), Math.max(0, Math.round(arriba) - 20), Math.min(Math.round(w) + 40, png.width - Math.max(0, Math.round(x) - 20)), Math.min(Math.round(h) + 40, png.height - Math.max(0, Math.round(arriba) - 20)), 0, 0);
              writeFileSync(`${process.env.DEPURAR}/${pantalla.clave}-${ancho}-${Math.round(arriba + y)}-normal.png`, PNG.sync.write(normal));
            }
            if (peor < umbral) fallas.push({ pantalla: pantalla.clave, donde: t.donde, y: Math.round(t.caja.y + y), texto: t.texto, color: hex(t.color), alfa: Number(alfa.toFixed(2)), fondo: hex(fondoPeor), contraste: Number(peor.toFixed(2)), umbral });
          }
        }
        await nav.close();
      }
      informe[`${tema}-${ancho}`] = { medidos, minimo: Number(minimo.toFixed(2)), fallas };
      anotar(fallas.length === 0, `contraste ${tema} ${ancho}: ${medidos} textos, mínimo ${minimo.toFixed(2)}`, fallas.slice(0, 10).map((f) => `${f.contraste}<${f.umbral} ${f.pantalla} «${f.texto}» ${f.color} sobre ${f.fondo}`).join(" | "));
    }
  }
  mkdirSync(`${DIR}/datos`, { recursive: true });
  writeFileSync(`${DIR}/datos/contraste-informe${process.env.SUFIJO ?? ""}.json`, JSON.stringify(informe, null, 2));
}

// ---------- Cargando: la sección nueva dice «Cargando…» y el marco se queda ----------
async function cargando() {
  const carpeta = `${DIR}/pantallas`;
  for (const tema of TEMAS) {
    const { nav, p, errores } = await abrir({ quien: "laura", tema });
    let soltar;
    const espera = new Promise((listo) => {
      soltar = listo;
    });
    await p.route((url) => url.pathname.endsWith("/consola/gastos"), async (ruta) => {
      await espera;
      await ruta.continue().catch(() => {});
    });
    await p.goto(`${BASE}${ALTAMAR}/consola/aprobaciones`, { waitUntil: "load" });
    await p.waitForTimeout(800);
    await p.locator("a.seccion", { hasText: "Gastos" }).click();
    const visto = await p.locator(".seccion-lectura", { hasText: "Cargando…" }).waitFor({ timeout: 8000 }).then(() => true, () => false);
    await capturar(p, `${carpeta}/95-cargando-gastos-${tema}-1440.webp`, { completa: false, espera: 100 });
    anotar(visto, `95-cargando ${tema}: «Gastos» dice «Cargando…» y el marco se queda`);
    soltar();
    const llego = await p.locator(".demo-aviso", { hasText: "Datos de ejemplo de Altamar Logística" }).waitFor({ timeout: 15000 }).then(() => true, () => false);
    anotar(llego, `95-cargando ${tema}: al llegar, se pinta Gastos`);
    anotar(errores.length === 0, `95-cargando ${tema}: sin errores de consola`, errores.join(" | "));
    await nav.close();
  }
}

// ---------- Con la base apagada: cada pantalla nueva dice que no se pudo, dentro del marco ----------
async function caida() {
  let arriba = true;
  try {
    sql("select 1");
  } catch {
    arriba = false;
  }
  if (arriba) throw new Error("El modo caida necesita el Postgres local apagado.");
  const carpeta = `${DIR}/pantallas`;
  for (const tema of TEMAS) {
    for (const ancho of ANCHOS) {
      for (const [clave, ruta, texto] of [
        ["90-error-aprobaciones", `${TALLER}/consola/aprobaciones`, /No se pud/],
        ["91-error-perfil", `${TALLER}/consola/perfil`, /No se pud/],
        // Sin base no se sabe si la empresa es de demostración: el módulo no pinta datos de ejemplo.
        ["92-error-gastos", `${ALTAMAR}/consola/gastos`, /Disponible pronto/i],
      ]) {
        const { nav, p, errores } = await abrir({ quien: "ana", tema, ancho });
        const respuesta = await p.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
        await capturar(p, `${carpeta}/${clave}-${tema}-${ancho}.webp`);
        const main = await p.evaluate(() => document.querySelector("main")?.innerText ?? "");
        const a11y = await revisarAccesibilidad(p);
        const etiqueta = `${clave} ${tema} ${ancho}`;
        anotar(respuesta?.status() === 200 && texto.test(main) && !/Altamar|1,284,560|98,422/.test(main), `${etiqueta}: dice que no se pudo (o «Disponible pronto»), sin datos`, main.replace(/\s+/g, " ").slice(0, 100));
        anotar(a11y.h1 === 1, `${etiqueta}: un solo h1`, `h1=${a11y.h1}`);
        anotar(errores.length === 0, `${etiqueta}: sin errores de consola`, errores.join(" | "));
        await nav.close();
      }
    }
  }
}

const modo = process.argv[2] ?? "flujos";
if (modo !== "caida") sesionesFrescas();
if (modo === "flujos") await flujos();
else if (modo === "lado") await lado();
else if (modo === "pantallas") await pantallas();
else if (modo === "modulos") await modulos();
else if (modo === "contraste") await contraste();
else if (modo === "cargando") await cargando();
else if (modo === "caida") {
  Object.assign(SESIONES, JSON.parse(readFileSync(SESIONES_CAIDA, "utf8")));
  await caida();
} else if (modo === "sesiones") {
  // Para el modo caida: deja sesiones listas antes de apagar el Postgres (fuera del repositorio: son credenciales).
  writeFileSync(SESIONES_CAIDA, JSON.stringify(SESIONES));
} else throw new Error(`Modo desconocido: ${modo}`);

const fallas = resultados.filter((r) => !r.ok);
mkdirSync(`${DIR}/datos`, { recursive: true });
if (modo !== "sesiones") writeFileSync(`${DIR}/datos/${modo}${process.env.SUFIJO ?? ""}.json`, JSON.stringify(resultados, null, 2));
console.log(`\n${resultados.length - fallas.length} de ${resultados.length} comprobaciones en verde.`);
if (fallas.length > 0) process.exitCode = 1;
