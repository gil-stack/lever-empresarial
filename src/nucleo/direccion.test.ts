import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { soloTexto } from "./direccion.ts";

describe("los parámetros de la dirección (portal y Operación, N28 y base-N28)", () => {
  it("una clave repetida llega como lista y se descarta; las demás quedan como texto", async () => {
    const parametros = await soloTexto<"aviso" | "en" | "faltan">(
      Promise.resolve({ aviso: ["a", "b"], en: "datos-titulo", faltan: ["giro", "domicilio"] }),
    );
    assert.deepEqual(parametros, { en: "datos-titulo" });
  });

  it("sin claves declaradas también: una lista o un undefined no llegan, un texto vacío sí", async () => {
    const parametros = await soloTexto(Promise.resolve({ q: ["a", "b"], vista: "proveedores", pago: undefined, pagina: "" }));
    assert.deepEqual(parametros, { vista: "proveedores", pagina: "" });
  });

  it("una clave ausente no aparece", async () => {
    assert.deepEqual(await soloTexto<"aviso">(Promise.resolve({})), {});
  });
});
