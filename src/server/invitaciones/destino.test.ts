import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NOMBRE_COOKIE_ENTRADA } from "../autenticacion/cookie.ts";
import { NOMBRE_COOKIE_ENTRADA_OPERACION } from "../operacion/acceso.ts";
import { resolverDestinoInvitacion } from "./destino.ts";

describe("destino después de aceptar una invitación", () => {
  it("el personal sin empresa continúa con cookie y segundo factor SOFIPO", () => {
    assert.deepEqual(resolverDestinoInvitacion(null), {
      superficie: "sofipo",
      cookieEntrada: NOMBRE_COOKIE_ENTRADA_OPERACION,
      ruta: "/operacion/continuar",
    });
  });

  it("una invitación de empresa conserva el flujo cliente", () => {
    const destino = resolverDestinoInvitacion("6f0d1c2a-7b3e-4d5f-8a91-0c2b4e6d8f10");
    assert.equal(destino.superficie, "cliente");
    assert.equal(destino.cookieEntrada, NOMBRE_COOKIE_ENTRADA);
    assert.equal(destino.ruta, "/entrar/continuar");
  });
});
