import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { esDescarga } from "../../src/nucleo/csp";
import { RUTAS } from "../../src/nucleo/rutas";
import { altamar, ORIGEN, sesionDe } from "./apoyo";
import { CORREOS } from "./siembra";

/**
 * La política de contenido (src/nucleo/csp.ts) no bloquea nada de la aplicación: cada ruta del registro,
 * en su superficie y con una persona que la abre, se pinta con 0 violaciones y con todos sus scripts
 * firmados con el nonce de la petición. Las entradas con TOTP, los formularios con doble clic y las
 * descargas los recorren los demás specs, que exigen la consola limpia: una violación ahí también falla.
 */

// Fuera del árbol versionado (test-results está en .gitignore); E2E_CAPTURAS la cambia, como en los demás specs.
const EVIDENCIA = process.env.E2E_CAPTURAS ?? "test-results/csp";
const SIN_CAPTURAS = process.env.E2E_SIN_CAPTURAS === "1";
const UUID = "00000000-0000-4000-8000-000000000000";
// WebKit corre por el origen https local de la evidencia (certificado autofirmado de un día).
test.use({ ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
// Cada prueba abre su propio contexto o su sesión y no comparte estado: «parallel» solo para que el reparto de la e2e pueda
// partir el archivo (con workers: 1 corren una tras otra). Entero, sumaba unos 338 s en la parte 1 del CI del #61.
test.describe.configure({ mode: "parallel" });

type Violacion = { directiva: string; bloqueado: string; muestra: string; disposicion: string };
declare global {
  interface Window {
    __csp?: Violacion[];
  }
}

async function vigilarCsp(contexto: BrowserContext): Promise<void> {
  await contexto.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__csp!.push({ directiva: e.effectiveDirective, bloqueado: e.blockedURI, muestra: e.sample, disposicion: e.disposition });
    });
  });
}

/**
 * Abre la ruta y devuelve las violaciones que vio el navegador y las etiquetas <script> o <style> del HTML que no
 * traen el nonce de esa misma respuesta. Los chunks que cargan después no necesitan nonce ('strict-dynamic'): si
 * algo se bloqueara, lo diría el evento securitypolicyviolation.
 */
async function revisar(pagina: Page, ruta: string): Promise<{ status: number; politica: string; violaciones: Violacion[]; sinNonce: string[] }> {
  const respuesta = await pagina.goto(ruta);
  await pagina.waitForLoadState("networkidle");
  const politica = (await respuesta?.headerValue("content-security-policy")) ?? (await respuesta?.headerValue("content-security-policy-report-only")) ?? "";
  const nonce = nonceDeLaPolitica(politica);
  const html = (await respuesta?.headerValue("content-type"))?.includes("text/html") ? await respuesta!.text() : "";
  const sinNonce = [...html.matchAll(/<(?:script|style)\b[^>]*>/g)].map((m) => m[0]).filter((etiqueta) => !etiqueta.includes(`nonce="${nonce}"`));
  const violaciones = await pagina.evaluate(() => window.__csp ?? []);
  return { status: respuesta?.status() ?? 0, politica, violaciones, sinNonce };
}

function nonceDeLaPolitica(politica: string): string {
  return politica.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1] ?? "sin-nonce";
}

function concreta(patron: string, ids: Record<string, string> = {}): string {
  return patron.replace(/\[([A-Za-z]+)\]/g, (_, nombre: string) => ids[nombre] ?? UUID);
}

async function recorrer(pagina: Page, rutas: string[], etiqueta: string): Promise<void> {
  if (!SIN_CAPTURAS) mkdirSync(EVIDENCIA, { recursive: true });
  const fallas: string[] = [];
  for (const ruta of rutas) {
    const { status, politica, violaciones, sinNonce } = await revisar(pagina, ruta);
    if (status >= 500) fallas.push(`${ruta}: ${status}`);
    if (!/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/.test(politica)) fallas.push(`${ruta}: sin política con nonce («${politica}»)`);
    if (violaciones.length) fallas.push(`${ruta}: ${JSON.stringify(violaciones).slice(0, 400)}`);
    if (sinNonce.length) fallas.push(`${ruta}: etiquetas sin el nonce de la respuesta ${sinNonce.join(" ").slice(0, 300)}`);
  }
  if (!SIN_CAPTURAS) await pagina.screenshot({ path: `${EVIDENCIA}/csp-${etiqueta}.png`, fullPage: true });
  expect(fallas, `${etiqueta}: ${rutas.length} rutas`).toEqual([]);
}

// Las descargas no son páginas: responden el archivo con su propia política aislada (sandbox).
const DE = (superficie: string, ...tipos: string[]) =>
  RUTAS.filter((r) => r.superficie === superficie && tipos.includes(r.acceso.tipo) && !esDescarga(r.patron)).map((r) => r.patron);

test("públicas: cada ruta sin sesión se pinta con su nonce y sin violaciones", async ({ page, context }) => {
  await vigilarCsp(context);
  // /salud responde texto y /tareas/correo-semanal es el cron: no son páginas.
  const rutas = DE("cliente", "publica").filter((p) => !["/salud", "/tareas/correo-semanal"].includes(p)).map((p) => concreta(p, { token: "token-falso-de-la-prueba-csp" }));
  await recorrer(page, [...rutas, ...DE("sofipo", "publica"), "/no-existe-csp"], "publicas");
});

// Las pantallas de la consola y de Operación van en varias pruebas, en orden del registro, para que el reparto de la e2e
// no las junte en una sola parte (la de la consola tardaba 2.3 min en el CI del #61). La prueba de abajo afirma que entre
// todas recorren el registro completo, sin repetir.
const RUTAS_CLIENTE = DE("cliente", "sesion", "capacidad").filter((p) => p !== "/entrar/destino");
const RUTAS_OPERACION = DE("sofipo", "sesion", "capacidad");
function partir(rutas: string[], partes: number): string[][] {
  const tamano = Math.ceil(rutas.length / partes);
  return Array.from({ length: partes }, (_, i) => rutas.slice(i * tamano, (i + 1) * tamano));
}
const PARTES_CLIENTE = partir(RUTAS_CLIENTE, 3);
const PARTES_OPERACION = partir(RUTAS_OPERACION, 2);

test("las partes de la consola y de Operación recorren el registro completo, sin repetir rutas", () => {
  for (const [nombre, partes, registro] of [["consola", PARTES_CLIENTE, RUTAS_CLIENTE], ["Operación", PARTES_OPERACION, RUTAS_OPERACION]] as const) {
    const recorridas = partes.flat();
    expect(partes.every((parte) => parte.length > 0), `${nombre}: ninguna parte vacía`).toBe(true);
    expect(new Set(recorridas).size, `${nombre}: sin repetir`).toBe(recorridas.length);
    expect([...recorridas].sort(), `${nombre}: la unión es el registro`).toEqual([...registro].sort());
  }
  expect(RUTAS_CLIENTE.length).toBeGreaterThan(30);
  expect(RUTAS_OPERACION.length).toBeGreaterThan(10);
});

PARTES_CLIENTE.forEach((rutas, i) => {
  test(`cliente: cada pantalla de la consola, con la administradora de Altamar (${i + 1} de ${PARTES_CLIENTE.length}: ${rutas[0]} a ${rutas.at(-1)})`, async ({ page, context }) => {
    await vigilarCsp(context);
    await sesionDe(context, CORREOS.laura);
    // La consola de la empresa por su dirección con /c/, en la primera parte.
    await recorrer(page, [...rutas.map((p) => concreta(p)), ...(i === 0 ? [`/c/${altamar()}/consola`] : [])], `consola-${i + 1}`);
  });
});

test("teléfono: cada pantalla, con una persona tarjetahabiente", async ({ page, context }) => {
  await vigilarCsp(context);
  await sesionDe(context, CORREOS.ernesto);
  await recorrer(page, DE("telefono", "sesion", "capacidad"), "telefono");
});

PARTES_OPERACION.forEach((rutas, i) => {
  test(`Operación: cada pantalla del personal SOFIPO (${i + 1} de ${PARTES_OPERACION.length}: ${rutas[0]} a ${rutas.at(-1)})`, async ({ page, context }) => {
    await vigilarCsp(context);
    await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
    await recorrer(page, rutas.map((p) => concreta(p, { id: altamar() })), `operacion-${i + 1}`);
  });
});

test("navegación del cliente: los enlaces del menú no traen un <style> con el nonce de otra petición", async ({ page, context }) => {
  await vigilarCsp(context);
  await sesionDe(context, CORREOS.laura);
  await page.goto("/consola");
  await page.waitForLoadState("networkidle");
  // AparienciaViva ya guardó el acento en su cookie: desde aquí cada petición lo podría pintar en el servidor.
  expect((await context.cookies()).some((c) => c.name === "acento")).toBe(true);
  await page.evaluate(() => Object.assign(window, { __mismoDocumento: true }));
  const secciones = page.getByRole("navigation", { name: "Secciones" });
  // El menú de la ola 2b (#60) para Laura en Altamar: Pendientes vive en «Aprobaciones» (con su contador en el nombre) y
  // Política no está en su menú; Calendario sí.
  for (const [enlace, destino] of [["Proveedores", /\/consola\/proveedores$/], ["Calendario", /\/consola\/calendario$/], [/^Aprobaciones/, /\/consola\/aprobaciones$/]] as const) {
    await secciones.getByRole("link", { name: enlace, exact: typeof enlace === "string" }).click();
    await page.waitForURL(destino);
    await page.waitForLoadState("networkidle");
  }
  // Sin recarga: el documento (y su nonce) es el mismo de la primera carga.
  expect(await page.evaluate(() => "__mismoDocumento" in window)).toBe(true);
  expect(await page.evaluate(() => window.__csp ?? [])).toEqual([]);
});

test("lo que solo se parece a _next o a un archivo que no existe responde la 404 con su nonce; _next/static sigue fuera del proxy", async ({ page, context }) => {
  await vigilarCsp(context);
  const rutas = ["/_nextfoo", "/__nextfoo", "/_next-algo/consola", "/__next/consola", "/favicon.ico"];
  for (const ruta of rutas) expect((await page.request.get(ruta)).status(), ruta).toBe(404);
  // Política con nonce, todas las etiquetas firmadas y 0 violaciones en cada una.
  await recorrer(page, rutas, "fuera-del-matcher");
  const html = await (await page.request.get("/entrar")).text();
  const chunk = html.match(/\/_next\/static\/[^"']+\.js/)?.[0];
  expect(chunk, "la entrada carga al menos un chunk de _next/static").toBeTruthy();
  const estatico = await page.request.get(chunk!);
  expect(estatico.status()).toBe(200);
  expect(estatico.headers()["content-type"]).toContain("javascript");
  expect(estatico.headers()["content-security-policy"]).toBeUndefined();
});

test("Safari anterior a 16.4 (sin Sec-Fetch-*): la navegación del cliente no trae el <style> del acento y el documento sí, con su nonce", async ({ page, context }) => {
  await sesionDe(context, CORREOS.laura);
  await page.goto("/consola");
  await page.waitForLoadState("networkidle");
  expect((await context.cookies()).some((c) => c.name === "acento")).toBe(true);
  // La petición de Playwright no agrega Sec-Fetch-*: así llegan las de un Safari viejo. Usa las cookies del contexto.
  const acento = /<style\b[^>]*>:root\[data-tema=[^<]*--acc:/;
  const rsc = await context.request.get("/consola/politica", { headers: { RSC: "1", Accept: "*/*" } });
  expect(rsc.status()).toBe(200);
  expect(rsc.headers()["content-type"]).toContain("text/x-component");
  expect(await rsc.text()).not.toMatch(/--acc:/);
  const documento = await context.request.get("/consola/politica", { headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } });
  const nonce = nonceDeLaPolitica(documento.headers()["content-security-policy"] ?? "");
  const etiqueta = (await documento.text()).match(acento)?.[0] ?? "";
  expect(etiqueta, "el documento pinta el acento").not.toBe("");
  expect(etiqueta).toContain(`nonce="${nonce}"`);
});

test("sin JavaScript: el formulario de entrada se envía (form-action 'self') y el navegador no anota violaciones", async ({ browser }) => {
  const contexto = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
  const pagina = await contexto.newPage();
  const anotadas: string[] = [];
  pagina.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) anotadas.push(m.text().slice(0, 300));
  });
  await pagina.goto("/entrar");
  // Un correo que no existe: el rechazo no cambia el estado de ninguna persona sembrada.
  await pagina.getByLabel("Correo").fill(`csp-${randomUUID().slice(0, 8)}@ejemplo.mx`);
  await pagina.getByLabel("Contraseña", { exact: true }).fill("no-es-la-clave-12");
  await Promise.all([pagina.waitForLoadState("load"), pagina.getByRole("button", { name: "Continuar" }).click()]);
  await expect(pagina.getByRole("alert")).toBeVisible();
  // Se mide antes de la captura: al capturar, el inspector de WebKit inserta un <style> y la política lo rechaza.
  expect(anotadas).toEqual([]);
  if (!SIN_CAPTURAS) await pagina.screenshot({ path: `${EVIDENCIA}/csp-sin-js-entrada.png`, fullPage: true });
  await contexto.close();
});
