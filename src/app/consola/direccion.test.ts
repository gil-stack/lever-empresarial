import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { soloTexto } from "./direccion.ts";

describe("parámetros de la dirección del portal", () => {
  it("una clave repetida se descarta y las demás llegan como texto", async () => {
    const params = await soloTexto(Promise.resolve({ q: ["a", "b"], vista: "proveedores", pago: undefined, pagina: "" }));
    assert.deepEqual(params, { vista: "proveedores", pagina: "" });
  });
});
