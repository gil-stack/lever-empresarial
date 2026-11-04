import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";

import { CABECERA_EMPRESA, rutaDe } from "../../src/nucleo/rutas.ts";
import { proxy } from "../../src/proxy.ts";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const SESION = `sesion=${"a".repeat(43)}`;
const RAIZ = new URL("../../", import.meta.url);

/** Recorridos HTTP del guardia real, sin sustituirlo por una regla de prueba. */
describe("recorridos de entrada y superficie", () => {
  it("teléfono sin sesión vuelve a entrar conservando la superficie", () => {
    const respuesta = proxy(new NextRequest("http://localhost/telefono"));
    assert.equal(respuesta.status, 307);
    assert.equal(respuesta.headers.get("location"), "http://localhost/entrar?siguiente=%2Ftelefono");
  });

  it("una petición sin sesión que escribe no recibe HTML ni un redirect", () => {
    const respuesta = proxy(new NextRequest("http://localhost/telefono", { method: "POST" }));
    assert.equal(respuesta.status, 401);
  });

  it("la empresa viaja por el prefijo y la ruta interna conserva Topes", () => {
    const respuesta = proxy(new NextRequest(`http://localhost/c/${EMPRESA}/telefono/topes`, { headers: { cookie: SESION } }));
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get("x-middleware-rewrite"), `http://localhost/telefono/topes`);
    assert.equal(respuesta.headers.get(`x-middleware-request-${CABECERA_EMPRESA}`), EMPRESA);
  });

  it("una empresa no puede prefijar una ruta pública y el segundo factor vuelve al resolvedor", () => {
    assert.equal(proxy(new NextRequest(`http://localhost/c/${EMPRESA}/entrar`)).status, 404);
    const respuesta = proxy(new NextRequest("http://localhost/entrar/continuar", { headers: { cookie: SESION } }));
    assert.equal(respuesta.status, 307);
    assert.match(respuesta.headers.get("location") ?? "", /\/entrar\/destino\?siguiente=/);
  });

  it("las tres pantallas del teléfono y Plan exigen capacidad y empresa", () => {
    for (const ruta of ["/telefono", "/telefono/topes", "/telefono/facturacion", "/consola/configuracion/plan"]) {
      const declarada = rutaDe(ruta);
      assert.equal(declarada?.conEmpresa, true, ruta);
      assert.equal(declarada?.acceso.tipo, "capacidad", ruta);
    }
  });

  it("la portada no consulta tesorería y el teléfono no llama a la política completa", () => {
    const consola = readFileSync(new URL("src/app/consola/page.tsx", RAIZ), "utf8");
    const telefono = [
      "src/app/telefono/page.tsx",
      "src/app/telefono/topes/page.tsx",
      "src/app/telefono/facturacion/page.tsx",
      "src/server/telefono/servicio.ts",
      "src/server/telefono/repositorio.ts",
    ].map((archivo) => readFileSync(new URL(archivo, RAIZ), "utf8")).join("\n");
    assert.doesNotMatch(consola, /leerCajones|leerPolitica|leerTarifa|postings|saldo/i);
    assert.match(consola, /sin_permiso\"\) notFound/);
    assert.doesNotMatch(telefono, /leerPolitica|postings|drawers|password_hash/i);
    const visibles = [
      "src/components/telefono/inicio.tsx",
      "src/components/telefono/topes.tsx",
      "src/components/telefono/facturacion.tsx",
      "src/server/telefono/datos.ts",
    ].map((archivo) => readFileSync(new URL(archivo, RAIZ), "utf8")).join("\n");
    assert.doesNotMatch(visibles, /cfdi|timbre/i);
  });

  it("mantiene puntos de ajuste responsive para el teléfono y las tarjetas", () => {
    const telefono = readFileSync(new URL("src/estilo/telefono.css", RAIZ), "utf8");
    const componentes = readFileSync(new URL("src/estilo/componentes.css", RAIZ), "utf8");
    assert.match(telefono, /@media \(max-width: 560px\)/);
    assert.match(telefono, /width: min\(240px, 100%\)/);
    assert.match(componentes, /@container \(max-width: 560px\)/);
  });
});
