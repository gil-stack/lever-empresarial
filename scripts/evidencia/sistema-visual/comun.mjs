// Ayudas compartidas por los recorridos del sistema visual (Playwright headless propio).
// Variables y pasos previos en docs/evidencia/sistema-visual/README.md.
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const requerir = createRequire(`${process.cwd()}/package.json`);
export const { chromium } = requerir("playwright");
const sharp = requerir("sharp");
export const BASE = process.env.BASE ?? "http://localhost:4802";
/** Carpeta de trabajo (semillas TOTP, pasos usados, resultados). Fuera del repositorio. */
export const SV = process.env.SV ?? "test-results/sistema-visual";
export const EVIDENCIA = process.env.DIR ?? "docs/evidencia/sistema-visual";
export const ALTAMAR_ID = process.env.EMPRESA_ALTAMAR ?? "";
export const CLAVE = "Altamar-Lever-2026!";
mkdirSync(SV, { recursive: true });
const PASOS = `${SV}/pasos-totp.json`;

function codigo(semilla, paso) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of semilla.replace(/\s+/g, "").toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, "0");
  const llave = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(paso));
  const h = createHmac("sha1", llave).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

/** Código TOTP de un paso que esa semilla no haya usado (el servidor rechaza pasos repetidos). */
export async function totp(semilla) {
  const usados = existsSync(PASOS) ? JSON.parse(readFileSync(PASOS, "utf8")) : {};
  for (;;) {
    const paso = Math.floor(Date.now() / 30000);
    const restante = 30000 - (Date.now() % 30000);
    if ((usados[semilla] ?? 0) < paso && restante > 4000) {
      usados[semilla] = paso;
      writeFileSync(PASOS, JSON.stringify(usados));
      return codigo(semilla, paso);
    }
    await new Promise((r) => setTimeout(r, restante + 300));
  }
}

export async function abrir({ tema = "oscuro", ancho = 1440, alto = 900, movil = false } = {}) {
  const nav = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, isMobile: movil, hasTouch: movil, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: "tema", value: tema, url: BASE }]);
  const p = await ctx.newPage();
  const errores = [];
  p.on("pageerror", (e) => errores.push(`pageerror ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Download the React DevTools|favicon/.test(m.text())) errores.push(`consola ${m.text().slice(0, 240)}`);
  });
  return { nav, ctx, p, errores };
}

export function capturador(p, dir, sufijo) {
  mkdirSync(dir, { recursive: true });
  return async (nombre, opciones = {}) => {
    await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
    await p.waitForTimeout(opciones.espera ?? 700);
    // WebP: la evidencia pesa ~50 KB por pantalla en lugar de ~500 KB en PNG.
    const ruta = `${dir}/${nombre}-${sufijo}.webp`;
    await sharp(await p.screenshot({ fullPage: opciones.completa ?? false })).webp({ quality: 80 }).toFile(ruta);
    return ruta;
  };
}
