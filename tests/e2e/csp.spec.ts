import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { esDescarga } from "../../src/nucleo/csp";
import { RUTAS } from "../../src/nucleo/rutas";
import { altamar, sesionDe } from "./apoyo";
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

test("cliente: cada pantalla de la consola, con la administradora de Altamar", async ({ page, context }) => {
  await vigilarCsp(context);
  await sesionDe(context, CORREOS.laura);
  const rutas = DE("cliente", "sesion", "capacidad").filter((p) => p !== "/entrar/destino").map((p) => concreta(p));
  await recorrer(page, [...rutas, `/c/${altamar()}/consola`], "consola");
});

test("teléfono: cada pantalla, con una persona tarjetahabiente", async ({ page, context }) => {
  await vigilarCsp(context);
  await sesionDe(context, CORREOS.ernesto);
  await recorrer(page, DE("telefono", "sesion", "capacidad"), "telefono");
});

test("Operación: cada pantalla del personal SOFIPO", async ({ page, context }) => {
  await vigilarCsp(context);
  await sesionDe(context, CORREOS.op1, { superficie: "sofipo" });
  await recorrer(page, DE("sofipo", "sesion", "capacidad").map((p) => concreta(p, { id: altamar() })), "operacion");
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
  for (const [enlace, destino] of [["Proveedores", /\/consola\/proveedores$/], ["Política", /\/consola\/politica$/], [/^Pendientes/, /\/consola\/pendientes$/]] as const) {
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
  const contexto = await browser.newContext({ javaScriptEnabled: false });
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
  if (!SIN_CAPTURAS) await pagina.screenshot({ path: `${EVIDENCIA}/csp-sin-js-entrada.png`, fullPage: true });
  expect(anotadas).toEqual([]);
  await contexto.close();
});
