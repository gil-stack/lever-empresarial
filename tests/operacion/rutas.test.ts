import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";

import { rutaDe } from "../../src/nucleo/rutas.ts";
import { proxy } from "../../src/proxy.ts";

const PROTEGIDAS = [
  "/operacion",
  "/operacion/clientes",
  "/operacion/clientes/123",
  "/operacion/aprobaciones",
  "/operacion/alertas",
  "/operacion/comisiones",
  "/operacion/bitacora",
] as const;

describe("guardia central del portal SOFIPO", () => {
  it("exige sesión completa en todas las rutas del portal", () => {
    for (const patron of PROTEGIDAS) {
      const ruta = rutaDe(patron);
      assert.equal(ruta?.superficie, "sofipo");
      assert.equal(ruta?.acceso.tipo, "sesion", patron);
    }
  });

  it("deja la entrada pública y el segundo factor acotado a su cookie", () => {
    assert.equal(rutaDe("/operacion/entrar")?.acceso.tipo, "publica");
    assert.equal(rutaDe("/operacion/continuar")?.acceso.tipo, "segundo_factor");
  });

  it("lleva a la entrada SOFIPO y nunca a la de clientes cuando falta sesión", () => {
    const respuesta = proxy(new NextRequest("http://localhost/operacion/clientes"));
    assert.equal(respuesta.status, 307);
    assert.equal(respuesta.headers.get("location"), "http://localhost/operacion/entrar?siguiente=%2Foperacion");
  });

  it("no devuelve HTML ni redirect cuando una acción SOFIPO no tiene sesión", () => {
    const respuesta = proxy(new NextRequest("http://localhost/operacion/clientes", { method: "POST" }));
    assert.equal(respuesta.status, 401);
  });
});
