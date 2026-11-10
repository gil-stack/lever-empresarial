// Revisión con axe de dos reglas en Operación (décima revisión del #59), con los 5 roles a 1440 y 390:
//   aria-prohibited-attr          el contador de la bandeja era un <span> sin rol con aria-label
//   label-content-name-mismatch   el nombre del logotipo no contenía su texto visible (WCAG 2.5.3)
// Además imprime lo que oye un lector (el árbol de accesibilidad de Playwright) del enlace del logotipo y del
// título de la bandeja. Corre contra el next start del recorrido, con la base y las sesiones que deja ESTADO:
//   ESTADO=… BASE=http://localhost:4811 node scripts/evidencia/ola-r-alta/axe.mjs
// axe-core llega con eslint-config-next (eslint-plugin-jsx-a11y); el script lo inyecta en cada página.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const requerir = createRequire(`${process.cwd()}/package.json`);
const { chromium } = requerir("playwright");
const AXE = readFileSync(requerir.resolve("axe-core/axe.min.js"), "utf8");
const AXE_VERSION = requerir("axe-core/package.json").version;
if (!process.env.ESTADO) throw new Error("Falta ESTADO: el archivo fuera del repositorio que dejó preparar.ts.");
const E = JSON.parse(readFileSync(process.env.ESTADO, "utf8"));
const BASE = process.env.BASE ?? "http://localhost:4811";
const REGLAS = ["aria-prohibited-attr", "label-content-name-mismatch"];
const ROLES = { ofelia: "Administración", omar: "Originación", ana: "Aprobación", celia: "Cumplimiento", aurelio: "Auditoría" };
const sql = (consulta) => execFileSync("psql", [E.DUENO_URL, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8" }).trim();

sql("update sessions set ultimo_uso = now() where expires_at > now()");
const ebano = sql("select id from companies where rfc = 'GEI150301AB1'");
const RUTAS = [
  "/operacion", "/operacion/clientes", `/operacion/clientes/${ebano}`, `/operacion/clientes/${ebano}/expediente`,
  "/operacion/aprobaciones", "/operacion/cumplimiento", "/operacion/lpb", "/operacion/alertas", "/operacion/comisiones",
  "/operacion/recuperaciones", "/operacion/precios", "/operacion/personal", "/operacion/bitacora",
];
const corta = (ruta) => ruta.replace(ebano, "<ébano>");

console.log(`axe-core ${AXE_VERSION} · reglas: ${REGLAS.join(", ")} · ${Object.keys(ROLES).length} roles × 2 anchos × ${RUTAS.length} pantallas`);
const totales = Object.fromEntries(REGLAS.map((regla) => [regla, 0]));
// La consulta exacta de Playwright para los dos nombres: sin espacio antes de la coma ni coma suelta.
const LOGOTIPO = "Lever Operación SOFIPO, ir al resumen";
const BANDEJA = /^Necesita tu decisión \d+ pendientes?$/;
let logotiposExactos = 0;
let bandejas = 0;
let bandejasExactas = 0;
const oidos = new Map();
const navegador = await chromium.launch();
try {
  for (const [quien, rol] of Object.entries(ROLES)) {
    for (const ancho of [1440, 390]) {
      const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 }, isMobile: ancho < 600, locale: "es-MX" });
      await contexto.addCookies([{ name: "__Host-sesion", value: E.SESIONES[quien], domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
      const p = await contexto.newPage();
      for (const ruta of RUTAS) {
        await p.goto(`${BASE}${ruta}`, { waitUntil: "networkidle" });
        await p.addScriptTag({ content: AXE });
        const resultado = await p.evaluate((reglas) => globalThis.axe.run(document, { runOnly: { type: "rule", values: reglas } }), REGLAS);
        const hallazgos = resultado.violations.map((v) => `${v.id} ×${v.nodes.length} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
        for (const v of resultado.violations) totales[v.id] += v.nodes.length;
        console.log(`${rol.padEnd(15)} ${String(ancho).padEnd(4)} ${corta(ruta).padEnd(38)} ${hallazgos.length ? hallazgos.join(" · ") : "0"}`);
        // Lo que oye un lector: el enlace del logotipo que se ve en este ancho y el título de la bandeja.
        logotiposExactos += await p.getByRole("link", { name: LOGOTIPO, exact: true }).filter({ visible: true }).count();
        const titulos = await p.locator("#bandeja-titulo").count();
        bandejas += titulos;
        if (titulos) bandejasExactas += await p.getByRole("heading", { name: BANDEJA }).count();
        const marca = p.locator(ancho < 600 ? ".barra-movil a.marca" : ".lateral-cabeza a.marca");
        if (await marca.count()) oidos.set(`logotipo ${ancho}`, (await marca.first().ariaSnapshot()).trim());
        const bandeja = p.locator("#bandeja-titulo");
        if (await bandeja.count()) oidos.set(`bandeja ${corta(ruta)} ${rol}`, (await bandeja.first().ariaSnapshot()).trim().replace(/\n\s*/g, " "));
      }
      await contexto.close();
    }
  }
} finally {
  await navegador.close();
}
console.log("\nLo que oye un lector (árbol de accesibilidad):");
for (const [donde, oido] of oidos) console.log(`  ${donde}: ${oido}`);
const vistas = Object.keys(ROLES).length * 2 * RUTAS.length;
console.log(`\nEnlace del logotipo con el nombre exacto «${LOGOTIPO}» (y visible): ${logotiposExactos} de ${vistas} vistas`);
console.log(`Títulos de la bandeja con el nombre exacto «Necesita tu decisión N pendiente(s)»: ${bandejasExactas} de ${bandejas}`);
console.log(`\nTotal: ${REGLAS.map((regla) => `${regla} ${totales[regla]}`).join(" · ")}`);
process.exitCode = Object.values(totales).some((n) => n > 0) || logotiposExactos !== vistas || bandejasExactas !== bandejas ? 1 : 0;
