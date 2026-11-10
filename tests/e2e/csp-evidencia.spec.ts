import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { CLAVE, codigoTotp, consultar, ORIGEN, sesionDe } from "./apoyo";
import { CORREOS, DUNA } from "./siembra";

/**
 * Evidencia del #62 (solo con E2E_CAPTURAS; en CI se omite): con la CSP estricta, las entradas con TOTP del cliente
 * y de Operación clicadas, la descarga del expediente clicada con su política aislada (sandbox) y una página de cada
 * superficie sin JavaScript, en Chromium y en WebKit (por el origen https local). Cada paso mide 0 anotaciones de la
 * política en la consola y, con JavaScript, 0 eventos securitypolicyviolation. Se mide antes de cada captura: el
 * inspector de WebKit inserta un <style> al capturar y la política lo rechaza (es de la herramienta, no de la app).
 */

const EVIDENCIA = process.env.E2E_CAPTURAS;
test.skip(!EVIDENCIA, "Solo para la evidencia del PR (E2E_CAPTURAS)");
test.use({ ignoreHTTPSErrors: ORIGEN.startsWith("https:") });

const ESTRICTA = /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/;
const AISLADA = "sandbox; default-src 'none'; frame-ancestors 'none'";

declare global {
  interface Window {
    __csp?: string[];
  }
}

/** Anotaciones de la política en la consola (con y sin JavaScript) y, con JavaScript, los eventos de violación. */
async function vigilar(contexto: BrowserContext, pagina: Page, conJs = true): Promise<() => Promise<string[]>> {
  const consola: string[] = [];
  pagina.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) consola.push(m.text().slice(0, 300));
  });
  if (conJs) {
    await contexto.addInitScript(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__csp!.push(`${e.effectiveDirective} ${e.blockedURI}`));
    });
  }
  return async () => [...consola, ...(conJs ? await pagina.evaluate(() => window.__csp ?? []).catch(() => []) : [])];
}

async function capturar(pagina: Page, nombre: string, navegador: string): Promise<void> {
  mkdirSync(EVIDENCIA!, { recursive: true });
  await pagina.screenshot({ path: `${EVIDENCIA}/${navegador}-${nombre}.png`, fullPage: true });
}

async function entrarConTotp(pagina: Page, desde: string, correo: string, destino: RegExp): Promise<void> {
  const respuesta = await pagina.goto(desde);
  expect(respuesta?.headers()["content-security-policy"]).toMatch(ESTRICTA);
  await pagina.getByLabel("Correo").fill(correo);
  await pagina.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await pagina.getByRole("button", { name: "Continuar" }).click();
  await pagina.getByLabel("Código de la app autenticadora").fill(await codigoTotp(correo));
  await pagina.getByRole("button", { name: "Entrar con el código" }).click();
  await pagina.waitForURL(destino);
  await pagina.waitForLoadState("networkidle");
}

test("entrada del cliente con TOTP, clicada: 0 anotaciones de la política", async ({ page, context, browserName }) => {
  const anotaciones = await vigilar(context, page);
  await entrarConTotp(page, "/entrar", CORREOS.entrada, /\/(consola|c\/[0-9a-f-]{36}\/consola|empresas)/);
  await expect(page.getByRole("navigation", { name: "Secciones" })).toBeVisible();
  expect(await anotaciones()).toEqual([]);
  await capturar(page, "01-entrada-cliente-totp", browserName);
});

test("entrada de Operación con TOTP, clicada: 0 anotaciones de la política", async ({ page, context, browserName }) => {
  const anotaciones = await vigilar(context, page);
  await entrarConTotp(page, "/operacion/entrar", CORREOS.op1, /\/operacion$/);
  expect(await anotaciones()).toEqual([]);
  await capturar(page, "02-entrada-operacion-totp", browserName);
});

test("descarga del expediente clicada: llega con su política aislada y la pantalla con la estricta", async ({ page, context, browserName }) => {
  const anotaciones = await vigilar(context, page);
  await entrarConTotp(page, "/operacion/entrar", CORREOS.op1, /\/operacion$/);
  const [duna] = await consultar<{ id: string }>("select id from companies where rfc = $1", [DUNA.rfc]);
  const pantalla = await page.goto(`/operacion/clientes/${duna!.id}/expediente`);
  expect(pantalla?.headers()["content-security-policy"]).toMatch(ESTRICTA);
  const nombre = `acta-csp-${browserName}.pdf`;
  await page.locator("#doc-tipo").selectOption("acta_constitutiva");
  await page.locator("#doc-emitido").fill("2015-03-01");
  await page.locator("#doc-detalle").fill("Escritura 1,204, Notaría 9 de Monterrey");
  await page.locator("#doc-archivo").setInputFiles({ name: nombre, mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2048, 32)]) });
  await page.getByRole("button", { name: "Guardar documento" }).click();
  const enlace = page.locator("li").filter({ hasText: nombre }).locator('a[download][href*="/expediente/documento/"]').first();
  await expect(enlace).toBeVisible();
  const descarga = page.waitForEvent("download");
  await enlace.click();
  const d = await descarga;
  expect(d.suggestedFilename()).toBe(nombre);
  expect((await readFile((await d.path())!)).subarray(0, 5).toString()).toBe("%PDF-");
  // El navegador no entrega la respuesta de una descarga a la página: la misma dirección, con la misma sesión.
  const r = await page.request.get((await enlace.getAttribute("href"))!);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-security-policy"]).toBe(AISLADA);
  expect(r.headers()["content-disposition"]).toContain("attachment");
  expect(await anotaciones()).toEqual([]);
  await capturar(page, "03-expediente-descarga", browserName);
});

test("sin JavaScript: una página de cada superficie con la política estricta y 0 anotaciones", async ({ browser, browserName }) => {
  const casos: { nombre: string; ruta: string; correo?: string; superficie?: "sofipo" }[] = [
    { nombre: "04-sin-js-publica", ruta: "/entrar" },
    { nombre: "05-sin-js-consola", ruta: "/consola", correo: CORREOS.laura },
    { nombre: "06-sin-js-telefono", ruta: "/telefono", correo: CORREOS.ernesto },
    { nombre: "07-sin-js-operacion", ruta: "/operacion", correo: CORREOS.op1, superficie: "sofipo" },
  ];
  for (const caso of casos) {
    const contexto = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: ORIGEN.startsWith("https:") });
    const pagina = await contexto.newPage();
    if (caso.correo) await sesionDe(contexto, caso.correo, caso.superficie ? { superficie: caso.superficie } : undefined);
    const anotaciones = await vigilar(contexto, pagina, false);
    const respuesta = await pagina.goto(caso.ruta);
    expect(respuesta?.status(), caso.ruta).toBe(200);
    expect(respuesta?.headers()["content-security-policy"], caso.ruta).toMatch(ESTRICTA);
    if (caso.correo) expect(new URL(pagina.url()).pathname, caso.ruta).not.toContain("/entrar");
    expect(await anotaciones(), caso.ruta).toEqual([]);
    await capturar(pagina, caso.nombre, browserName);
    await contexto.close();
  }
});
