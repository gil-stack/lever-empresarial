// «Perdí el segundo factor»: el botón se ve como enlace (sin fondo, bordes ni fuente del navegador)
// y al clicarlo abre la recuperación. Uso: node perdi-factor.mjs <tema> <escritorio|movil>
import { writeFileSync } from "node:fs";
import { BASE, CLAVE, EVIDENCIA, SV, abrir, capturador } from "./comun.mjs";

const [tema = "oscuro", forma = "escritorio"] = process.argv.slice(2);
const movil = forma === "movil";
const [ancho, alto] = movil ? [390, 844] : [1440, 900];
const sufijo = `${tema}-${ancho}`;
const checks = [];
const comprobar = (nombre, ok, detalle = "") => {
  checks.push({ nombre, ok: Boolean(ok), detalle });
  console.log(`${ok ? "OK " : "MAL"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

const { nav, p, errores } = await abrir({ tema, ancho, alto, movil });
const foto = capturador(p, EVIDENCIA, sufijo);
await p.goto(`${BASE}/entrar`);
await p.getByLabel("Correo").fill("laura@lever.test");
await p.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
await p.locator("form button[type=submit]").first().click();
await p.waitForURL(/continuar/);
await p.waitForLoadState("networkidle");

const boton = p.getByRole("button", { name: "Perdí el segundo factor", exact: true });
const estilo = await boton.evaluate((el) => {
  const e = getComputedStyle(el);
  const cuerpo = getComputedStyle(document.body);
  return {
    fondo: e.backgroundColor,
    bordeArriba: e.borderTopWidth,
    bordeIzquierda: e.borderLeftWidth,
    bordeDerecha: e.borderRightWidth,
    bordeAbajo: e.borderBottomWidth,
    fuente: e.fontFamily === cuerpo.fontFamily,
    color: e.color,
    tinta: getComputedStyle(document.documentElement).getPropertyValue("--tx").trim(),
    cursor: e.cursor,
  };
});
comprobar("sin fondo del navegador", estilo.fondo === "rgba(0, 0, 0, 0)", estilo.fondo);
comprobar("solo la línea de abajo", estilo.bordeArriba === "0px" && estilo.bordeIzquierda === "0px" && estilo.bordeDerecha === "0px" && estilo.bordeAbajo === "1px", `${estilo.bordeArriba}/${estilo.bordeDerecha}/${estilo.bordeAbajo}/${estilo.bordeIzquierda}`);
comprobar("fuente del texto, no la del navegador", estilo.fuente);
comprobar("cursor de mano", estilo.cursor === "pointer");
await boton.scrollIntoViewIfNeeded();
await foto("95-perdi-factor-boton");
await boton.hover();
await foto("96-perdi-factor-hover", { espera: 400 });
await boton.click();
const motivo = p.locator("#motivo");
await motivo.waitFor({ timeout: 10000 });
comprobar("clic abre la recuperación", await motivo.isVisible());
await foto("97-perdi-factor-recuperacion");

const errs = errores.filter((e) => !/Failed to load resource.*404/.test(e));
comprobar("sin errores de consola", errs.length === 0, errs.slice(0, 3).join(" || "));
writeFileSync(`${SV}/checks-perdi-factor-${sufijo}.json`, JSON.stringify(checks, null, 2));
await nav.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
