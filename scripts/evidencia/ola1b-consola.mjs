// Recorrido de Ola 1B (consola) con Playwright headless propio, contra `next start`
// y la base que deja scripts/evidencia/ola1b-consola/preparar.ts. Pasos y
// variables en docs/evidencia/ola1b-consola/README.md.
//
//   node scripts/evidencia/ola1b-consola.mjs pantallas [carpeta]  capturas 3 temas × 1440/390 + h1, etiquetas y consola
//   node scripts/evidencia/ola1b-consola.mjs flujos                 los 11 flujos clicados, doble clic y verificación en la base
//   node scripts/evidencia/ola1b-consola.mjs contraste              AA de cada texto contra la escena real
//   node scripts/evidencia/ola1b-consola.mjs caida [carpeta]       con el Postgres apagado: el error de cada pantalla
//   node scripts/evidencia/ola1b-consola.mjs cargando [carpeta]    el «Cargando…» de la sección mientras llega la página
//   node scripts/evidencia/ola1b-consola.mjs tablas [carpeta]      tablas con texto oculto a 390: la página no se ensancha
//   node scripts/evidencia/ola1b-consola.mjs barra [carpeta]       barra a 390 con acción: título, acción y chip en una fila
//
// Solo corre contra un Postgres local (DUENO_URL en 127.0.0.1 o localhost).
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const requerir = createRequire(`${process.cwd()}/package.json`);
const { chromium } = requerir("playwright");
const sharp = requerir("sharp");
const { PNG } = requerir("pngjs");

// El entorno guarda sesiones y la cadena de la base con su clave: vive fuera del repositorio (dentro del árbol,
// `npm run security` lo marca aunque esté en .gitignore), como el de la ola 2b.
const ENTORNO = JSON.parse(readFileSync(process.env.ENTORNO ?? join(tmpdir(), "ola1b-consola-entorno.json"), "utf8"));
const BASE = process.env.BASE ?? "http://localhost:4807";
const DIR = process.env.DIR ?? "docs/evidencia/ola1b-consola";
const DUENO = ENTORNO.DUENO_URL;
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) throw new Error("DUENO_URL tiene que ser un Postgres local.");
const TALLER = `/c/${ENTORNO.EMPRESA_TALLER}`;
const ALTAMAR = `/c/${ENTORNO.EMPRESA_ALTAMAR}`;
const TEMAS = (process.env.TEMAS ?? "oscuro,claro,lever").split(",");
const ANCHOS = (process.env.ANCHOS ?? "1440,390").split(",").map(Number);
const SESIONES = { gil: ENTORNO.SESION_GIL, rosa: ENTORNO.SESION_ROSA, laura: ENTORNO.SESION_LAURA, ofelia: ENTORNO.SESION_OFELIA, fernanda: ENTORNO.SESION_FERNANDA };

const resultados = [];
function anotar(ok, texto, detalle = "") {
  resultados.push({ ok, texto, detalle });
  console.log(`${ok ? "OK   " : "FALLO"} ${texto}${detalle ? ` · ${detalle}` : ""}`);
}

export function sql(consulta) {
  return execFileSync("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8" }).trim();
}

/** Las sesiones sembradas no vencen por inactividad durante el recorrido. */
function renovarSesiones() {
  sql("update sessions set ultimo_uso = now() where expires_at > now()");
}

async function abrir({ quien, sesion = null, tema = "oscuro", ancho = 1440 }) {
  const nav = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const movil = ancho < 600;
  const ctx = await nav.newContext({
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
    // `sesion` es una cookie sembrada en el propio flujo (por ejemplo, la contadora del flujo 11).
    ...(quien || sesion ? [{ name: "__Host-sesion", value: sesion ?? SESIONES[quien], domain: host, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }] : []),
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
  await p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()).catch(() => {});
  await p.waitForTimeout(opciones.espera ?? 500);
  await sharp(await p.screenshot({ fullPage: opciones.completa ?? true })).webp({ quality: 78 }).toFile(ruta);
}

/**
 * Recorre la página con Tab (hasta 80 paradas): nadie usa tabindex positivo,
 * el foco avanza en el orden del documento, cada parada se ve en pantalla y
 * algo cambia a la vista al enfocarla (contorno, sombra, borde o fondo del
 * elemento o de su contenedor, como la línea del buscador).
 */
async function revisarFoco(p) {
  await p.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
    window.__previo = null;
    window.__primero = null;
  });
  const positivos = await p.evaluate(() => [...document.querySelectorAll("[tabindex]")].filter((el) => el.tabIndex > 0).map((el) => el.outerHTML.slice(0, 60)));
  const fueraDeOrden = [];
  const sinIndicador = [];
  const invisibles = [];
  let paradas = 0;
  for (let i = 0; i < 80; i += 1) {
    await p.keyboard.press("Tab");
    const parada = await p.evaluate(async () => {
      // Dos cuadros y 80 ms: el cambio de estilo (y su transición de 0.01 ms con movimiento reducido) ya terminó.
      const cuadro = () => new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(listo, 80))));
      const el = document.activeElement;
      if (!el || el === document.body) return { cuerpo: true };
      if (el === window.__primero) return { fin: true };
      // Un campo de fecha recibe varios Tab (día, mes, año): es la misma parada.
      if (el === window.__previo) return { mismo: true };
      window.__primero ??= el;
      const previo = window.__previo;
      const vuelta = previo && previo.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING;
      window.__previo = el;
      const cadena = [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean);
      const foto = () =>
        cadena
          .map((n) => {
            const e = getComputedStyle(n);
            return [e.outlineStyle, e.outlineWidth, e.outlineColor, e.boxShadow, e.borderTopColor, e.borderBottomColor, e.borderLeftColor, e.backgroundColor, e.color, e.textDecorationLine].join("|");
          })
          .join("#");
      await cuadro();
      const enfocado = foto();
      const r = el.getBoundingClientRect();
      // El foco pasa a un ancla sin estilo: blur() no suelta un campo de fecha en el emulador móvil.
      const ancla = document.createElement("span");
      ancla.tabIndex = -1;
      // Dentro de un diálogo modal, el resto de la página es inerte: el ancla va en el diálogo.
      (el.closest("dialog[open]") ?? document.body).append(ancla);
      ancla.focus({ preventScroll: true });
      await cuadro();
      const suelto = foto();
      ancla.remove();
      el.focus({ preventScroll: true });
      await cuadro();
      const nombre = `${el.tagName.toLowerCase()}«${(el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "").trim().slice(0, 30)}»`;
      const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      return { vuelta: Boolean(vuelta), nombre, indicador: enfocado !== suelto, visible };
    });
    // El cuerpo antes de la primera parada es el punto de partida; después, el final del recorrido.
    if (parada.cuerpo) {
      if (paradas > 0) break;
      continue;
    }
    if (parada.fin) break;
    if (parada.mismo) continue;
    if (parada.vuelta) fueraDeOrden.push(parada.nombre);
    paradas += 1;
    if (!parada.indicador) sinIndicador.push(`sin indicador ${parada.nombre}`);
    if (!parada.visible) invisibles.push(`fuera de vista ${parada.nombre}`);
  }
  return { paradas, positivos, fueraDeOrden, sinIndicador, invisibles };
}

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
      const ligado = document.querySelector(`[aria-describedby~="${CSS.escape(error.id)}"]`);
      if (!ligado) erroresSueltos.push(error.id);
    }
    // Una cifra que no cabe se monta sobre la celda vecina: el texto de cada métrica queda dentro de su caja.
    const cifrasEncimadas = [];
    for (const metrica of document.querySelectorAll(".metrica")) {
      const caja = metrica.getBoundingClientRect();
      const rango = document.createRange();
      rango.selectNodeContents(metrica);
      const texto = rango.getBoundingClientRect();
      if (texto.right > caja.right + 1 || texto.left < caja.left - 1) cifrasEncimadas.push((metrica.querySelector(".rotulo")?.textContent ?? "").trim());
    }
    return { h1, sinNombre, erroresSueltos, cifrasEncimadas };
  });
}

const PANTALLAS = [
  { clave: "10-pendientes", quien: "gil", ruta: `${TALLER}/consola/aprobaciones` },
  { clave: "11-pendientes-altamar", quien: "laura", ruta: `${ALTAMAR}/consola/aprobaciones` },
  // Inicio con su flujo: con el desglose de la nómina (administrador), sin él (finanzas) y sin saldo declarado.
  { clave: "12-inicio-administrador", quien: "gil", ruta: `${TALLER}/consola` },
  { clave: "13-inicio-finanzas", quien: "fernanda", ruta: `${TALLER}/consola` },
  { clave: "14-inicio-sin-saldo", quien: "laura", ruta: `${ALTAMAR}/consola` },
  { clave: "20-proveedores-pagos", quien: "gil", ruta: `${TALLER}/consola/proveedores` },
  { clave: "21-proveedores-directorio", quien: "gil", ruta: `${TALLER}/consola/proveedores?vista=proveedores` },
  { clave: "22-proveedores-agenda", quien: "gil", ruta: `${TALLER}/consola/proveedores?vista=agenda` },
  // En móvil el detalle se captura desplazado hasta sus botones de decisión.
  { clave: "23-proveedores-detalle-pago", quien: "rosa", ruta: `${TALLER}/consola/proveedores?pago=88888888-8888-4888-8888-888888888882`, enMovilHasta: "Autorizar para pagar" },
  { clave: "24-proveedores-expediente", quien: "gil", ruta: `${TALLER}/consola/proveedores?vista=proveedores&proveedor=44444444-4444-4444-8444-444444444441` },
  { clave: "25-proveedores-alta", quien: "gil", ruta: `${TALLER}/consola/proveedores/nuevo-proveedor` },
  { clave: "26-proveedores-nuevo-pago", quien: "gil", ruta: `${TALLER}/consola/proveedores/nuevo` },
  { clave: "27-proveedores-vacio", quien: "laura", ruta: `${ALTAMAR}/consola/proveedores` },
  { clave: "30-personas-directorio", quien: "laura", ruta: `${ALTAMAR}/consola/personas` },
  { clave: "31-personas-alta", quien: "laura", ruta: `${ALTAMAR}/consola/personas/nueva` },
  { clave: "32-personas-areas", quien: "laura", ruta: `${ALTAMAR}/consola/personas/areas` },
  { clave: "33-personas-nomina", quien: "laura", ruta: `${ALTAMAR}/consola/personas/nomina` },
  { clave: "34-personas-sin-permiso", quien: "rosa", ruta: `${TALLER}/consola/personas` },
  // Taller con datos (preparar.ts): expediente de una colaboradora, su lote y el alta con áreas.
  { clave: "35-personas-expediente", quien: "gil", ruta: `${TALLER}/consola/personas/${ENTORNO.PERSONA_TALLER}` },
  { clave: "36-personas-lote", quien: "gil", ruta: `${TALLER}/consola/personas/nomina/${ENTORNO.LOTE_TALLER}` },
  { clave: "37-personas-alta-con-areas", quien: "gil", ruta: `${TALLER}/consola/personas/nueva` },
  { clave: "40-politica", quien: "gil", ruta: `${TALLER}/consola/politica` },
  { clave: "41-politica-altamar", quien: "laura", ruta: `${ALTAMAR}/consola/politica` },
  { clave: "50-lista-69b", quien: "gil", ruta: `${TALLER}/consola/lista-69b` },
  { clave: "51-lista-69b-sofipo", quien: "ofelia", ruta: "/consola/lista-69b" },
  { clave: "60-configuracion", quien: "gil", ruta: `${TALLER}/consola/configuracion` },
  { clave: "61-configuracion-plan", quien: "gil", ruta: `${TALLER}/consola/configuracion/plan` },
  { clave: "70-poliza", quien: "gil", ruta: `${TALLER}/consola/poliza` },
  // Sin permiso: Fernanda solo tiene el rol de finanzas.
  { clave: "80-sin-permiso-proveedores", quien: "fernanda", ruta: `${TALLER}/consola/proveedores` },
  { clave: "81-sin-permiso-personas", quien: "fernanda", ruta: `${TALLER}/consola/personas` },
  { clave: "82-sin-permiso-politica", quien: "fernanda", ruta: `${TALLER}/consola/politica` },
  { clave: "83-sin-permiso-lista-69b", quien: "fernanda", ruta: `${TALLER}/consola/lista-69b` },
  { clave: "84-sin-permiso-configuracion", quien: "fernanda", ruta: `${TALLER}/consola/configuracion` },
  { clave: "85-sin-permiso-plan", quien: "fernanda", ruta: `${TALLER}/consola/configuracion/plan` },
  { clave: "86-sin-permiso-poliza", quien: "fernanda", ruta: `${TALLER}/consola/poliza` },
  { clave: "87-pendientes-finanzas", quien: "fernanda", ruta: `${TALLER}/consola/aprobaciones` },
  ...(process.env.EXTRA_PANTALLAS ? JSON.parse(process.env.EXTRA_PANTALLAS) : []),
];

async function pantallas(carpeta) {
  const solo = process.env.SOLO ? process.env.SOLO.split(",") : null;
  for (const tema of TEMAS) {
    for (const ancho of ANCHOS) {
      renovarSesiones();
      for (const pantalla of PANTALLAS) {
        if (solo && !solo.some((s) => pantalla.clave.startsWith(s))) continue;
        const { nav, p, errores } = await abrir({ quien: pantalla.quien, tema, ancho });
        const respuesta = await p.goto(`${BASE}${pantalla.ruta}`, { waitUntil: "networkidle" });
        if (pantalla.enMovilHasta && ancho < 600) {
          await p.getByRole("button", { name: pantalla.enMovilHasta }).scrollIntoViewIfNeeded();
          await capturar(p, `${carpeta}/${pantalla.clave}-${tema}-${ancho}.webp`, { completa: false });
        } else {
          await capturar(p, `${carpeta}/${pantalla.clave}-${tema}-${ancho}.webp`);
        }
        const a11y = await revisarAccesibilidad(p);
        // En móvil, innerWidth crece con el contenido que se sale; clientWidth es el ancho del dispositivo.
        const desborda = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        const etiqueta = `${pantalla.clave} ${tema} ${ancho}`;
        anotar(respuesta?.status() === 200 && new URL(p.url()).pathname === new URL(`${BASE}${pantalla.ruta}`).pathname, `${etiqueta}: responde en su ruta`, `${respuesta?.status()} ${new URL(p.url()).pathname}`);
        anotar(a11y.h1 === 1, `${etiqueta}: un solo h1`, `h1=${a11y.h1}`);
        anotar(a11y.sinNombre.length === 0, `${etiqueta}: campos con etiqueta`, a11y.sinNombre.join(","));
        anotar(a11y.erroresSueltos.length === 0, `${etiqueta}: errores ligados a su campo`, a11y.erroresSueltos.join(","));
        anotar(!desborda, `${etiqueta}: sin desplazamiento horizontal`);
        anotar(a11y.cifrasEncimadas.length === 0, `${etiqueta}: cada cifra cabe en su celda`, a11y.cifrasEncimadas.join(","));
        const foco = await revisarFoco(p);
        anotar(foco.positivos.length === 0 && foco.fueraDeOrden.length === 0, `${etiqueta}: tabulación en orden del documento`, `${foco.paradas} paradas ${[...foco.positivos, ...foco.fueraDeOrden].join(",")}`);
        anotar(foco.sinIndicador.length === 0 && foco.invisibles.length === 0, `${etiqueta}: foco visible en cada parada`, [...foco.sinIndicador, ...foco.invisibles].join(","));
        anotar(errores.length === 0, `${etiqueta}: sin errores de consola`, errores.join(" | "));
        await nav.close();
      }
    }
  }
}

// ---------- Estado de error: la base apagada ----------
const CAIDAS = ["pendientes", "proveedores", "personas", "personas/nomina", "politica", "lista-69b", "configuracion", "configuracion/plan", "poliza"];

/** Corre con el Postgres local apagado (pg_ctl stop): cada pantalla de la zona muestra su error dentro del marco. */
async function caida(carpeta) {
  let arriba = true;
  try {
    sql("select 1");
  } catch {
    arriba = false;
  }
  if (arriba) throw new Error("El modo caida necesita el Postgres local apagado.");
  for (const tema of TEMAS) {
    for (const ancho of ANCHOS) {
      for (const ruta of CAIDAS) {
        const { nav, p, errores } = await abrir({ quien: "gil", tema, ancho });
        const respuesta = await p.goto(`${BASE}${TALLER}/consola/${ruta}`, { waitUntil: "networkidle" });
        const clave = `90-error-${ruta.replace("/", "-")}`;
        await capturar(p, `${carpeta}/${clave}-${tema}-${ancho}.webp`);
        const a11y = await revisarAccesibilidad(p);
        const aviso = await p.evaluate(() => /No se pud/.test(document.querySelector("main")?.innerText ?? ""));
        const etiqueta = `${clave} ${tema} ${ancho}`;
        anotar(respuesta?.status() === 200 && new URL(p.url()).pathname === `${TALLER}/consola/${ruta}`, `${etiqueta}: responde en su ruta`, `${respuesta?.status()} ${new URL(p.url()).pathname}`);
        anotar(a11y.h1 === 1, `${etiqueta}: un solo h1`, `h1=${a11y.h1}`);
        anotar(aviso, `${etiqueta}: dice que no se pudo, sin cifras supuestas`);
        anotar(errores.length === 0, `${etiqueta}: sin errores de consola`, errores.join(" | "));
        await nav.close();
      }
    }
  }
}

// ---------- Estado de carga: la sección muestra «Cargando…» mientras llega la página ----------
async function cargando(carpeta) {
  for (const tema of TEMAS) {
    renovarSesiones();
    const { nav, p, errores } = await abrir({ quien: "gil", tema, ancho: 1440 });
    // Detiene la respuesta de Política (y su prefetch del lateral) hasta tomar la captura:
    // con el prefetch ya resuelto, la sección abre al instante y no hay estado de carga que ver.
    let soltar;
    const espera = new Promise((listo) => {
      soltar = listo;
    });
    // Ola 2b: Política vive en «Más»; la sección del lateral que se retiene es Proveedores.
    await p.route((url) => url.pathname.endsWith("/consola/proveedores"), async (ruta) => {
      await espera;
      await ruta.continue().catch(() => {});
    });
    await p.goto(`${BASE}${TALLER}/consola/aprobaciones`, { waitUntil: "load" });
    await p.getByRole("heading", { name: "Aprobaciones" }).waitFor({ state: "attached" });
    await p.waitForTimeout(800);
    await p.locator("a.seccion", { hasText: "Proveedores" }).click();
    const aviso = p.locator(".seccion-lectura", { hasText: "Cargando…" });
    const visto = await aviso.waitFor({ timeout: 8000 }).then(() => true, () => false);
    await capturar(p, `${carpeta}/95-cargando-${tema}-1440.webp`, { completa: false, espera: 100 });
    anotar(visto, `95-cargando ${tema} 1440: la sección dice «Cargando…» y el marco se queda`);
    const marco = await p.locator(".barra-superior").isVisible();
    anotar(marco, `95-cargando ${tema} 1440: la barra y el lateral siguen visibles`);
    soltar();
    const llego = await p.getByRole("heading", { name: "Pagos a proveedores" }).waitFor({ state: "attached", timeout: 15000 }).then(() => true, () => false);
    anotar(llego, `95-cargando ${tema} 1440: al llegar, se pinta Proveedores`);
    anotar(errores.length === 0, `95-cargando ${tema} 1440: sin errores de consola`, errores.join(" | "));
    await nav.close();

    // La mesa de proveedores: la pestaña y el filtro muestran su espera mientras llega la vista.
    const mesa = await abrir({ quien: "gil", tema, ancho: 1440 });
    let soltarMesa;
    const esperaMesa = new Promise((listo) => {
      soltarMesa = listo;
    });
    await mesa.p.route((url) => url.pathname.endsWith("/consola/proveedores") && (url.searchParams.get("vista") === "agenda" || url.searchParams.has("q")), async (ruta) => {
      await esperaMesa;
      await ruta.continue().catch(() => {});
    });
    await mesa.p.goto(`${BASE}${TALLER}/consola/proveedores`, { waitUntil: "load" });
    await mesa.p.getByRole("heading", { name: "Facturas y obligaciones" }).waitFor();
    await mesa.p.locator(".mesa-vistas").getByRole("link", { name: /^Agenda/ }).click();
    const giraPestana = await mesa.p.locator(".mesa-vistas .seccion-spinner").waitFor({ timeout: 8000 }).then(() => true, () => false);
    await capturar(mesa.p, `${carpeta}/96-mesa-pestana-cargando-${tema}-1440.webp`, { completa: false, espera: 100 });
    anotar(giraPestana, `96-mesa ${tema} 1440: la pestaña «Agenda» muestra su espera mientras llega la vista`);
    soltarMesa();
    await mesa.p.getByRole("heading", { name: "Agenda de pagos" }).waitFor({ timeout: 15000 });
    let soltarFiltro;
    const esperaFiltro = new Promise((listo) => {
      soltarFiltro = listo;
    });
    await mesa.p.unroute(() => true).catch(() => {});
    await mesa.p.route((url) => url.pathname.endsWith("/consola/proveedores") && url.searchParams.has("q"), async (ruta) => {
      await esperaFiltro;
      await ruta.continue().catch(() => {});
    });
    await mesa.p.locator(".mesa-vistas").getByRole("link", { name: /^Pagos/ }).click();
    await mesa.p.getByRole("heading", { name: "Facturas y obligaciones" }).waitFor({ timeout: 15000 });
    // El marco también tiene un buscador («Buscar persona»): se usa el de la mesa.
    await mesa.p.locator(".buscador-pagos").getByRole("searchbox").fill("Servicios");
    await mesa.p.getByRole("button", { name: "Filtrar" }).click();
    const filtrando = await mesa.p.getByRole("button", { name: "Filtrando…" }).waitFor({ timeout: 8000 }).then(() => true, () => false);
    await capturar(mesa.p, `${carpeta}/96-mesa-filtrar-cargando-${tema}-1440.webp`, { completa: false, espera: 100 });
    anotar(filtrando, `96-mesa ${tema} 1440: «Filtrar» dice «Filtrando…» mientras llega la búsqueda`);
    soltarFiltro();
    const filtro = await mesa.p.waitForURL(/q=Servicios/, { timeout: 15000 }).then(() => true, () => false);
    anotar(filtro, `96-mesa ${tema} 1440: al llegar, la mesa queda filtrada`, mesa.p.url().replace(BASE, ""));
    anotar(mesa.errores.length === 0, `96-mesa ${tema} 1440: sin errores de consola`, mesa.errores.join(" | "));
    await mesa.nav.close();
  }
}

// ---------- Tablas con texto oculto a 390: la página no se ensancha ----------
// `.tabla-contenedor` está posicionada (componentes.css): el `.solo-lector` absoluto de una
// cabecera se queda en la caja que se desplaza. Cada medida se repite quitando esa regla
// para mostrar qué corrige.
async function tablas(carpeta) {
  const medir = (p) => p.evaluate(() => {
    const raiz = document.documentElement;
    const desborde = () => Math.max(0, raiz.scrollWidth - raiz.clientWidth);
    const con = desborde();
    const prueba = document.createElement("style");
    prueba.textContent = ".tabla-contenedor { position: static !important; }";
    document.head.append(prueba);
    const sin = desborde();
    prueba.remove();
    const cajas = [...document.querySelectorAll(".tabla-contenedor")];
    for (const caja of cajas) caja.scrollLeft = caja.scrollWidth;
    const alFinal = desborde();
    for (const caja of cajas) caja.scrollLeft = 0;
    return { con, sin, alFinal, tablas: cajas.length };
  });
  for (const tema of TEMAS) {
    renovarSesiones();
    const revisar = async (p, clave, texto) => {
      const m = await medir(p);
      await capturar(p, `${carpeta}/${clave}-${tema}-390.webp`, { completa: false });
      anotar(m.tablas > 0 && m.con === 0 && m.alFinal === 0, `${clave} ${tema} 390: ${texto} sin ensanchar la página`, `tablas=${m.tablas} desborde=${m.con}px · con la tabla desplazada=${m.alFinal}px · sin position:relative=${m.sin}px`);
    };
    {
      const { nav, p, errores } = await abrir({ quien: "gil", tema, ancho: 390 });
      await p.goto(`${BASE}${TALLER}/consola/proveedores`, { waitUntil: "networkidle" });
      await revisar(p, "tablas-proveedores-pagos", "la mesa de pagos");
      await p.locator(".abrir-fila").first().click();
      await p.getByRole("dialog").waitFor();
      await revisar(p, "tablas-proveedores-detalle", "el detalle del pago abierto sobre la mesa");
      await p.getByRole("dialog").getByRole("button", { name: "Cerrar" }).click();
      await p.locator(".mesa-vistas").getByRole("link", { name: /^Proveedores/ }).click();
      await p.waitForURL(/vista=proveedores/);
      await revisar(p, "tablas-proveedores-directorio", "el directorio de proveedores");
      await p.locator(".abrir-fila").first().click();
      await p.getByRole("dialog").waitFor();
      await revisar(p, "tablas-proveedores-expediente", "el expediente abierto sobre el directorio");
      anotar(errores.length === 0, `tablas proveedores ${tema} 390: sin errores de consola`, errores.join(" | "));
      await nav.close();
    }
    {
      const { nav, p, errores } = await abrir({ quien: null, tema, ancho: 390 });
      await p.goto(`${BASE}/muestrario`, { waitUntil: "networkidle" });
      await p.locator(".tabla-contenedor").first().scrollIntoViewIfNeeded();
      await revisar(p, "tablas-muestrario", "la tabla del muestrario");
      anotar(errores.length === 0, `tablas muestrario ${tema} 390: sin errores de consola`, errores.join(" | "));
      await nav.close();
    }
  }
}

// ---------- Barra superior a 390 con acción: título, acción y chip en una fila ----------
// Las pantallas cuyo Marco lleva acción (Proveedores en sus tres vistas y Personas). Se mide
// que el chip de la persona quede en la misma fila que la acción, que la página no se
// ensanche y se clican el chip (abre y cierra su menú) y la acción (lleva a su alta).
async function barra(carpeta) {
  const medir = (p) => p.evaluate(() => {
    const caja = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const titulo = document.querySelector(".barra-titulo");
    const accion = caja(".barra-superior > .boton");
    const chip = caja(".barra-superior .cuenta .menu-desplegable-boton");
    const centro = (r) => r.top + r.height / 2;
    return {
      titulo: titulo?.textContent ?? "",
      tituloCompleto: titulo ? titulo.scrollWidth <= titulo.clientWidth : false,
      unaFila: Boolean(accion && chip) && Math.abs(centro(accion) - centro(chip)) < 4,
      chipDentro: Boolean(chip) && chip.right <= window.innerWidth,
      desborde: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      alto: Math.round(caja(".barra-superior")?.height ?? 0),
    };
  });
  const VISTAS = [
    { clave: "proveedores-pagos", ruta: `${TALLER}/consola/proveedores`, accion: "Nuevo pago", destino: /\/consola\/proveedores\/nuevo/ },
    { clave: "proveedores-directorio", ruta: `${TALLER}/consola/proveedores`, pestana: /^Proveedores/, espera: /vista=proveedores/, accion: "Nuevo pago", destino: /\/consola\/proveedores\/nuevo/ },
    { clave: "proveedores-agenda", ruta: `${TALLER}/consola/proveedores`, pestana: /^Agenda/, espera: /vista=agenda/, accion: "Nuevo pago", destino: /\/consola\/proveedores\/nuevo/ },
    { clave: "personas-directorio", ruta: `${TALLER}/consola/personas`, accion: "Dar de alta", destino: /\/consola\/personas\/nueva/ },
  ];
  for (const tema of TEMAS) {
    renovarSesiones();
    const { nav, p, errores } = await abrir({ quien: "gil", tema, ancho: 390 });
    for (const vista of VISTAS) {
      await p.goto(`${BASE}${vista.ruta}`, { waitUntil: "networkidle" });
      if (vista.pestana) {
        await p.locator(".mesa-vistas").getByRole("link", { name: vista.pestana }).click();
        await p.waitForURL(vista.espera);
        await p.waitForLoadState("networkidle");
      }
      const m = await medir(p);
      await capturar(p, `${carpeta}/barra-${vista.clave}-${tema}-390.webp`, { completa: false });
      anotar(m.unaFila && m.chipDentro && m.desborde === 0, `barra ${vista.clave} ${tema} 390: «${m.titulo}», acción y chip en una fila`, `título completo=${m.tituloCompleto ? "sí" : "no (puntos suspensivos)"} · alto de la barra=${m.alto}px · desborde=${m.desborde}px`);
      // El chip conserva su nombre accesible (el de la persona) aunque a 390 solo se vean las iniciales.
      const chip = p.locator(".cuenta .menu-desplegable-boton");
      const nombre = (await chip.locator(".persona-nombre").textContent()) ?? "";
      const conNombre = nombre.length > 2 && (await p.getByRole("button", { name: nombre }).and(chip).count()) === 1;
      await chip.click();
      const abierto = await p.getByRole("menu", { name: "Tu cuenta" }).isVisible();
      await p.keyboard.press("Escape");
      const cerrado = (await chip.getAttribute("aria-expanded")) === "false";
      anotar(conNombre && abierto && cerrado, `barra ${vista.clave} ${tema} 390: el chip «${nombre}» abre su menú y Escape lo cierra`);
      await Promise.all([p.waitForURL(vista.destino), p.locator(".barra-superior > .boton", { hasText: vista.accion }).click()]);
      anotar(true, `barra ${vista.clave} ${tema} 390: «${vista.accion}» lleva a ${new URL(p.url()).pathname.replace(/\/c\/[^/]+/, "")}`);
    }
    anotar(errores.length === 0, `barra ${tema} 390: sin errores de consola`, errores.join(" | "));
    await nav.close();
  }
}

// ---------- Contraste AA contra la escena (método de docs/evidencia/sistema-visual) ----------
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
  for (const tema of TEMAS) {
    for (const ancho of ANCHOS) {
      renovarSesiones();
      const fallas = [];
      let medidos = 0;
      let minimo = Infinity;
      const solo = process.env.SOLO ? process.env.SOLO.split(",") : null;
      for (const pantalla of PANTALLAS) {
        if (solo && !solo.some((s) => pantalla.clave.startsWith(s))) continue;
        const { nav, p } = await abrir({ quien: pantalla.quien, tema, ancho });
        await p.goto(`${BASE}${pantalla.ruta}`, { waitUntil: "networkidle" });
        await p.waitForFunction(() => ["quieto", "lento", "sin-motor"].includes(document.querySelector(".escena-fondo canvas")?.dataset.estado ?? ""), null, { timeout: 20000 }).catch(() => {});
        await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await p.waitForTimeout(400);
        const textos = await p.evaluate(() => {
          const salida = [];
          const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const vistos = new Set();
          // Con un diálogo modal abierto, lo de atrás queda inerte bajo el velo: solo se mide el diálogo.
          const modal = document.querySelector("dialog:modal");
          while (recorrido.nextNode()) {
            const nodo = recorrido.currentNode;
            if (!nodo.textContent.trim()) continue;
            const el = nodo.parentElement;
            if (!el || vistos.has(el)) continue;
            vistos.add(el);
            if (modal && !modal.contains(el)) continue;
            if (el.closest("[aria-hidden=true], .logotipo, .solo-lector, script, style, noscript, option, [disabled], .saltar, svg, dialog:not([open])")) continue;
            const estilo = getComputedStyle(el);
            if (estilo.visibility === "hidden" || Number(estilo.opacity) === 0) continue;
            const rango = document.createRange();
            rango.selectNodeContents(nodo);
            const r = rango.getBoundingClientRect();
            if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
            // Oculto solo a la vista (caja de 1 px que recorta, como el nombre del chip a 390): no se pinta.
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
        await oculto.evaluate((n) => n.remove());
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
          if (peor < umbral) fallas.push({ pantalla: pantalla.clave, texto: t.texto, color: hex(t.color), alfa: Number(alfa.toFixed(2)), fondo: hex(fondoPeor), contraste: Number(peor.toFixed(2)), umbral });
        }
        await nav.close();
      }
      informe[`${tema}-${ancho}`] = { medidos, minimo: Number(minimo.toFixed(2)), fallas };
      anotar(fallas.length === 0, `contraste ${tema} ${ancho}: ${medidos} textos, mínimo ${minimo.toFixed(2)}`, fallas.slice(0, 8).map((f) => `${f.contraste}<${f.umbral} ${f.pantalla} «${f.texto}» ${f.color} sobre ${f.fondo}`).join(" | "));
    }
  }
  mkdirSync(`${DIR}/datos`, { recursive: true });
  writeFileSync(`${DIR}/datos/contraste.json`, JSON.stringify(informe, null, 2));
}

// ---------- TOTP (para la reautenticación del flujo 6) ----------
export function codigoTotp(semilla, paso = Math.floor(Date.now() / 30000)) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const letra of semilla.replace(/\s+/g, "").toUpperCase()) bits += alfabeto.indexOf(letra).toString(2).padStart(5, "0");
  const llave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const hmac = createHmac("sha1", llave).update(contador).digest();
  const desplazamiento = hmac[hmac.length - 1] & 15;
  return String((hmac.readUInt32BE(desplazamiento) & 0x7fffffff) % 1e6).padStart(6, "0");
}

// ---------- Correo de los lunes (proveedor falso: scripts/evidencia/flujo-de-caja-correo-falso.mjs) ----------
// Corre la tarea real del correo semanal y guarda el correo de Taller: el faltante lo provoca, entre otras
// salidas, la nómina de una sola persona, y ningún destinatario debe recibir su neto.
async function correo() {
  const archivo = process.env.CORREO_FALSO_ARCHIVO ?? "";
  const secreto = process.env.CRON_SECRET ?? "";
  if (!archivo || !secreto) throw new Error("El modo correo pide CORREO_FALSO_ARCHIVO y CRON_SECRET, los mismos del servidor.");
  const leidos = () => {
    try {
      return readFileSync(archivo, "utf8").split("\n").filter(Boolean).map((linea) => JSON.parse(linea));
    } catch {
      return [];
    }
  };
  const antes = leidos().length;
  const respuesta = await fetch(`${BASE}/tareas/correo-semanal`, { headers: { authorization: `Bearer ${secreto}` } });
  const resultado = await respuesta.json();
  anotar(respuesta.status === 200 && resultado.fallidos === 0, "correo: la tarea del lunes responde 200 sin envíos fallidos", JSON.stringify(resultado));
  // Taller y Altamar son de demostración y no reciben el resumen; Bahía Comercial (CORREO_SEMANAL=1 en preparar.ts) es real.
  const recibidos = leidos().slice(antes);
  const bahia = recibidos.filter((m) => /Bahía Comercial/.test(m.asunto));
  anotar(bahia.length === 2 && recibidos.length === 2, "correo: solo Bahía Comercial recibe el resumen, a administración y finanzas; las empresas de demostración no", recibidos.map((m) => `${m.para} · ${m.asunto}`).join(" | "));
  mkdirSync(`${DIR}/correo`, { recursive: true });
  const nav = await chromium.launch();
  for (const m of bahia) {
    const quien = String(m.para).split("@")[0].replace(/[^a-z0-9-]/gi, "-");
    writeFileSync(`${DIR}/correo/resumen-semanal-${quien}.html`, m.html);
    const lineaFaltante = m.texto.split("\n").find((l) => l.startsWith("Atención:")) ?? "";
    anotar(
      /Lo provoca: .*Nómina \(monto reservado\)/.test(lineaFaltante) && !/18,500|1 persona/.test(m.texto + m.html),
      `correo ${quien}: el faltante nombra «Nómina (monto reservado)» y el correo no dice 18,500 ni «1 persona»`,
      lineaFaltante,
    );
    const p = await nav.newPage({ viewport: { width: 640, height: 900 }, deviceScaleFactor: 1 });
    await p.setContent(m.html, { waitUntil: "load" });
    await capturar(p, `${DIR}/correo/resumen-semanal-${quien}.webp`);
    await p.close();
  }
  await nav.close();
}

const modo = process.argv[2] ?? "pantallas";
if (modo === "pantallas") await pantallas(process.argv[3] ?? `${DIR}/pantallas`);
else if (modo === "contraste") await contraste();
else if (modo === "caida") await caida(process.argv[3] ?? `${DIR}/pantallas`);
else if (modo === "cargando") await cargando(process.argv[3] ?? `${DIR}/pantallas`);
else if (modo === "tablas") await tablas(process.argv[3] ?? `${DIR}/tablas`);
else if (modo === "barra") await barra(process.argv[3] ?? `${DIR}/barra`);
else if (modo === "correo") await correo();
else if (modo === "flujos") await (await import("./ola1b-consola/flujos.mjs")).flujos({ abrir, capturar, anotar, sql, renovarSesiones, codigoTotp, BASE, DIR, TALLER, ALTAMAR, ENTORNO });
else throw new Error(`Modo desconocido: ${modo}`);

const fallas = resultados.filter((r) => !r.ok);
mkdirSync(`${DIR}/datos`, { recursive: true });
writeFileSync(`${DIR}/datos/${modo}${process.env.SUFIJO ?? ""}.json`, JSON.stringify(resultados, null, 2));
console.log(`\n${resultados.length - fallas.length} de ${resultados.length} comprobaciones en verde.`);
if (fallas.length > 0) process.exitCode = 1;
