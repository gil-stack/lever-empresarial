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

  it("abre el segundo factor SOFIPO con su propia cookie de entrada", () => {
    for (const cookie of ["entrada_operacion", "portal_operacion"]) {
      const pantalla = proxy(
        new NextRequest("http://localhost/operacion/continuar", { headers: { cookie: `${cookie}=${"a".repeat(43)}` } }),
      );
      assert.equal(pantalla.status, 200, cookie);
      const accion = proxy(
        new NextRequest("http://localhost/operacion/continuar", {
          method: "POST",
          headers: { cookie: `${cookie}=${"a".repeat(43)}` },
        }),
      );
      assert.equal(accion.status, 200, cookie);
    }
  });

  it("no cruza las cookies de entrada entre superficies", () => {
    const conCliente = proxy(
      new NextRequest("http://localhost/operacion/continuar", { headers: { cookie: `entrada=${"a".repeat(43)}` } }),
    );
    assert.equal(conCliente.status, 307);
    assert.equal(conCliente.headers.get("location"), "http://localhost/operacion/entrar?siguiente=%2Foperacion");
    const conOperacion = proxy(
      new NextRequest("http://localhost/entrar/continuar", { headers: { cookie: `entrada_operacion=${"a".repeat(43)}` } }),
    );
    assert.equal(conOperacion.status, 307);
    assert.equal(conOperacion.headers.get("location"), "http://localhost/entrar?siguiente=%2Fconsola");
  });

  it("no devuelve HTML ni redirect cuando una acción SOFIPO no tiene sesión", () => {
    const respuesta = proxy(new NextRequest("http://localhost/operacion/clientes", { method: "POST" }));
    assert.equal(respuesta.status, 401);
  });
});
