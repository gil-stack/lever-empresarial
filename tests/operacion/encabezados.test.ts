import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";

import configuracion from "../../next.config.ts";
import { CABECERA_CSP, CABECERA_NONCE, esDescarga, nonceNuevo, politicaDeContenido } from "../../src/nucleo/csp.ts";
import { RUTAS } from "../../src/nucleo/rutas.ts";
import { proxy } from "../../src/proxy.ts";
import { POLITICA_DESCARGA } from "../../src/server/pagos-proveedores/descarga.ts";

const SESION = `sesion=${"a".repeat(43)}`;
const directivas = (politica: string) =>
  new Map(politica.split(";").map((d) => d.trim().split(/\s+/)).map(([nombre, ...fuentes]) => [nombre, fuentes]));
const nonceDe = (politica: string | null) => politica?.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1] ?? null;

describe("política de contenido (CSP)", () => {
  it("en producción: nonce y strict-dynamic, sin unsafe-inline ni unsafe-eval en scripts ni en <style>", () => {
    const d = directivas(politicaDeContenido("abc123==", false));
    assert.deepEqual(d.get("script-src"), ["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
    assert.deepEqual(d.get("style-src"), ["'self'", "'nonce-abc123=='"]);
    assert.deepEqual(d.get("style-src-attr"), ["'unsafe-inline'"]);
    assert.deepEqual(d.get("default-src"), ["'self'"]);
    assert.deepEqual(d.get("img-src"), ["'self'", "data:", "blob:"]);
    assert.deepEqual(d.get("font-src"), ["'self'"]);
    assert.deepEqual(d.get("connect-src"), ["'self'"]);
    assert.deepEqual(d.get("object-src"), ["'none'"]);
    assert.deepEqual(d.get("base-uri"), ["'none'"]);
    assert.deepEqual(d.get("form-action"), ["'self'"]);
    assert.deepEqual(d.get("frame-ancestors"), ["'none'"]);
  });

  it("en desarrollo agrega solo lo que pide Next (eval de React y estilos sin nonce)", () => {
    const d = directivas(politicaDeContenido("abc123==", true));
    assert.ok(d.get("script-src")?.includes("'unsafe-eval'"));
    assert.ok(d.get("style-src")?.includes("'unsafe-inline'"));
  });

  it("el nonce es de 128 bits y no se repite", () => {
    const nonces = new Set(Array.from({ length: 200 }, () => nonceNuevo()));
    assert.equal(nonces.size, 200);
    for (const n of nonces) assert.equal(Buffer.from(n, "base64").length, 16);
  });
});

describe("el proxy pone la política en cada respuesta", () => {
  it("página pública: la misma política en la respuesta y en la petición que pinta Next, con un nonce nuevo cada vez", () => {
    const una = proxy(new NextRequest("http://localhost/entrar"));
    const otra = proxy(new NextRequest("http://localhost/entrar"));
    const politica = una.headers.get(CABECERA_CSP);
    assert.ok(politica && nonceDe(politica));
    assert.equal(una.headers.get(`x-middleware-request-${CABECERA_CSP.toLowerCase()}`), politica);
    assert.notEqual(nonceDe(politica), nonceDe(otra.headers.get(CABECERA_CSP)));
  });

  it("con sesión y con el prefijo de empresa, también", () => {
    const respuesta = proxy(new NextRequest("http://localhost/c/11111111-1111-4111-8111-111111111111/consola", { headers: { cookie: SESION } }));
    assert.ok(nonceDe(respuesta.headers.get(CABECERA_CSP)));
    assert.equal(respuesta.headers.get(`x-middleware-request-${CABECERA_CSP.toLowerCase()}`), respuesta.headers.get(CABECERA_CSP));
  });

  it("la 404 se pinta con el nonce y la redirección a la entrada lleva la política", () => {
    const noExiste = proxy(new NextRequest("http://localhost/no-existe"));
    assert.equal(noExiste.status, 404);
    assert.equal(noExiste.headers.get(`x-middleware-request-${CABECERA_CSP.toLowerCase()}`), noExiste.headers.get(CABECERA_CSP));
    const redireccion = proxy(new NextRequest("http://localhost/operacion"));
    assert.equal(redireccion.status, 307);
    assert.ok(nonceDe(redireccion.headers.get(CABECERA_CSP)));
  });

  it("la descarga de un documento no recibe la política del proxy: conserva la suya (sandbox)", () => {
    const respuesta = proxy(new NextRequest("http://localhost/consola/proveedores/documento/abc", { headers: { cookie: SESION } }));
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get(CABECERA_CSP), null);
    assert.equal(respuesta.headers.get(`x-middleware-request-${CABECERA_CSP.toLowerCase()}`), null);
    assert.equal(respuesta.headers.get(`x-middleware-request-${CABECERA_NONCE}`), null);
  });

  it("la petición que pinta Next lleva el nonce de la política, no el que mande el navegador", () => {
    const falsos = { "x-nonce": "nonce-del-atacante", "content-security-policy": "script-src *", "content-security-policy-report-only": "script-src *" };
    for (const ruta of ["/entrar", "/no-existe"]) {
      const respuesta = proxy(new NextRequest(`http://localhost${ruta}`, { headers: falsos }));
      const politica = respuesta.headers.get(CABECERA_CSP);
      assert.equal(respuesta.headers.get(`x-middleware-request-${CABECERA_NONCE}`), nonceDe(politica), ruta);
      assert.equal(respuesta.headers.get(`x-middleware-request-${CABECERA_CSP.toLowerCase()}`), politica, ruta);
      const otra = CABECERA_CSP === "Content-Security-Policy" ? "content-security-policy-report-only" : "content-security-policy";
      assert.equal(respuesta.headers.get(`x-middleware-request-${otra}`), null, ruta);
    }
    const descarga = proxy(new NextRequest("http://localhost/consola/proveedores/documento/abc", { headers: { cookie: SESION, ...falsos } }));
    assert.equal(descarga.headers.get(`x-middleware-request-${CABECERA_NONCE}`), null);
    assert.equal(descarga.headers.get("x-middleware-request-content-security-policy"), null);
  });
});

describe("descargas y encabezados de next.config", () => {
  it("cada ruta de descarga del registro tiene su política aislada en next.config, con y sin empresa", async () => {
    const reglas = await configuracion.headers!();
    const conSandbox = new Set(
      reglas.filter((r) => r.headers.some((h) => h.key === "Content-Security-Policy" && h.value === POLITICA_DESCARGA)).map((r) => r.source),
    );
    const descargas = RUTAS.filter((r) => esDescarga(r.patron));
    assert.ok(descargas.length > 0);
    for (const { patron, conEmpresa } of descargas) {
      const fuente = patron.replace(/\[([A-Za-z]+)\]/g, ":$1");
      assert.ok(conSandbox.has(fuente), fuente);
      if (conEmpresa) assert.ok(conSandbox.has(`/c/:empresa${fuente}`), `/c/:empresa${fuente}`);
    }
  });

  it("ninguna página del registro pasa por esDescarga por accidente", () => {
    for (const { patron } of RUTAS) if (esDescarga(patron)) assert.match(patron, /\/documento\/\[[A-Za-z]+\]$/);
    assert.equal(esDescarga("/consola/proveedores"), false);
  });

  it("HSTS de dos años con includeSubDomains y sin preload; la regla general ya no trae otra CSP", async () => {
    const general = (await configuracion.headers!()).find((r) => r.source === "/:path*");
    const hsts = general?.headers.find((h) => h.key === "Strict-Transport-Security")?.value;
    assert.equal(hsts, "max-age=63072000; includeSubDomains");
    assert.equal(general?.headers.some((h) => h.key === "Content-Security-Policy"), false);
    assert.equal(general?.headers.find((h) => h.key === "X-Frame-Options")?.value, "DENY");
  });
});
