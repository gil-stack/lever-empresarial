// Recorrido de Ola 1B (consola) con Playwright headless propio, contra `next start`
// y la base que deja scripts/evidencia/ola1b-consola/preparar.ts. Pasos y
// variables en docs/evidencia/ola1b-consola/README.md.
//
//   node scripts/evidencia/ola1b-consola.mjs pantallas [carpeta]  capturas 3 temas × 1440/390 + h1, etiquetas y consola
//   node scripts/evidencia/ola1b-consola.mjs flujos                 los 11 flujos clicados, doble clic y verificación en la base
//   node scripts/evidencia/ola1b-consola.mjs contraste              AA de cada texto contra la escena real
//
// Solo corre contra un Postgres local (DUENO_URL en 127.0.0.1 o localhost).
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const requerir = createRequire(`${process.cwd()}/package.json`);
const { chromium } = requerir("playwright");
const sharp = requerir("sharp");
const { PNG } = requerir("pngjs");

const ENTORNO = JSON.parse(readFileSync(process.env.ENTORNO ?? "test-results/ola1b-consola/entorno.json", "utf8"));
const BASE = process.env.BASE ?? "http://localhost:4807";
const DIR = process.env.DIR ?? "docs/evidencia/ola1b-consola";
const DUENO = ENTORNO.DUENO_URL;
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) throw new Error("DUENO_URL tiene que ser un Postgres local.");
const TALLER = `/c/${ENTORNO.EMPRESA_TALLER}`;
const ALTAMAR = `/c/${ENTORNO.EMPRESA_ALTAMAR}`;
const TEMAS = (process.env.TEMAS ?? "oscuro,claro,lever").split(",");
const ANCHOS = (process.env.ANCHOS ?? "1440,390").split(",").map(Number);
const SESIONES = { gil: ENTORNO.SESION_GIL, rosa: ENTORNO.SESION_ROSA, laura: ENTORNO.SESION_LAURA, ofelia: ENTORNO.SESION_OFELIA };

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

async function abrir({ quien, tema = "oscuro", ancho = 1440 }) {
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
  await p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()).catch(() => {});
  await p.waitForTimeout(opciones.espera ?? 500);
  await sharp(await p.screenshot({ fullPage: opciones.completa ?? true })).webp({ quality: 78 }).toFile(ruta);
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
    return { h1, sinNombre, erroresSueltos };
  });
}

const PANTALLAS = [
  { clave: "10-pendientes", quien: "gil", ruta: `${TALLER}/consola/pendientes` },
  { clave: "11-pendientes-altamar", quien: "laura", ruta: `${ALTAMAR}/consola/pendientes` },
  { clave: "20-proveedores-pagos", quien: "gil", ruta: `${TALLER}/consola/proveedores` },
  { clave: "21-proveedores-directorio", quien: "gil", ruta: `${TALLER}/consola/proveedores?vista=proveedores` },
  { clave: "22-proveedores-agenda", quien: "gil", ruta: `${TALLER}/consola/proveedores?vista=agenda` },
  { clave: "23-proveedores-detalle-pago", quien: "rosa", ruta: `${TALLER}/consola/proveedores?pago=88888888-8888-4888-8888-888888888882` },
  { clave: "24-proveedores-expediente", quien: "gil", ruta: `${TALLER}/consola/proveedores?vista=proveedores&proveedor=44444444-4444-4444-8444-444444444441` },
  { clave: "25-proveedores-alta", quien: "gil", ruta: `${TALLER}/consola/proveedores/nuevo-proveedor` },
  { clave: "26-proveedores-nuevo-pago", quien: "gil", ruta: `${TALLER}/consola/proveedores/nuevo` },
  { clave: "27-proveedores-vacio", quien: "laura", ruta: `${ALTAMAR}/consola/proveedores` },
  { clave: "30-personas-directorio", quien: "laura", ruta: `${ALTAMAR}/consola/personas` },
  { clave: "31-personas-alta", quien: "laura", ruta: `${ALTAMAR}/consola/personas/nueva` },
  { clave: "32-personas-areas", quien: "laura", ruta: `${ALTAMAR}/consola/personas/areas` },
  { clave: "33-personas-nomina", quien: "laura", ruta: `${ALTAMAR}/consola/personas/nomina` },
  { clave: "34-personas-sin-permiso", quien: "rosa", ruta: `${TALLER}/consola/personas` },
  { clave: "40-politica", quien: "gil", ruta: `${TALLER}/consola/politica` },
  { clave: "41-politica-altamar", quien: "laura", ruta: `${ALTAMAR}/consola/politica` },
  { clave: "50-lista-69b", quien: "gil", ruta: `${TALLER}/consola/lista-69b` },
  { clave: "51-lista-69b-sofipo", quien: "ofelia", ruta: "/consola/lista-69b" },
  { clave: "60-configuracion", quien: "gil", ruta: `${TALLER}/consola/configuracion` },
  { clave: "61-configuracion-plan", quien: "gil", ruta: `${TALLER}/consola/configuracion/plan` },
  { clave: "70-poliza", quien: "gil", ruta: `${TALLER}/consola/poliza` },
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
        await capturar(p, `${carpeta}/${pantalla.clave}-${tema}-${ancho}.webp`);
        const a11y = await revisarAccesibilidad(p);
        const desborda = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        const etiqueta = `${pantalla.clave} ${tema} ${ancho}`;
        anotar(respuesta?.status() === 200 || respuesta?.status() === 404, `${etiqueta}: responde`, String(respuesta?.status()));
        anotar(a11y.h1 === 1, `${etiqueta}: un solo h1`, `h1=${a11y.h1}`);
        anotar(a11y.sinNombre.length === 0, `${etiqueta}: campos con etiqueta`, a11y.sinNombre.join(","));
        anotar(a11y.erroresSueltos.length === 0, `${etiqueta}: errores ligados a su campo`, a11y.erroresSueltos.join(","));
        anotar(!desborda, `${etiqueta}: sin desplazamiento horizontal`);
        anotar(errores.length === 0, `${etiqueta}: sin errores de consola`, errores.join(" | "));
        await nav.close();
      }
    }
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
      for (const pantalla of PANTALLAS) {
        const { nav, p } = await abrir({ quien: pantalla.quien, tema, ancho });
        await p.goto(`${BASE}${pantalla.ruta}`, { waitUntil: "networkidle" });
        await p.waitForFunction(() => ["quieto", "lento", "sin-motor"].includes(document.querySelector(".escena-fondo canvas")?.dataset.estado ?? ""), null, { timeout: 20000 }).catch(() => {});
        await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await p.waitForTimeout(400);
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

const modo = process.argv[2] ?? "pantallas";
if (modo === "pantallas") await pantallas(process.argv[3] ?? `${DIR}/pantallas`);
else if (modo === "contraste") await contraste();
else if (modo === "flujos") await (await import("./ola1b-consola/flujos.mjs")).flujos({ abrir, capturar, anotar, sql, renovarSesiones, codigoTotp, BASE, DIR, TALLER, ALTAMAR, ENTORNO });
else throw new Error(`Modo desconocido: ${modo}`);

const fallas = resultados.filter((r) => !r.ok);
mkdirSync(`${DIR}/datos`, { recursive: true });
writeFileSync(`${DIR}/datos/${modo}${process.env.SUFIJO ?? ""}.json`, JSON.stringify(resultados, null, 2));
console.log(`\n${resultados.length - fallas.length} de ${resultados.length} comprobaciones en verde.`);
if (fallas.length > 0) process.exitCode = 1;
