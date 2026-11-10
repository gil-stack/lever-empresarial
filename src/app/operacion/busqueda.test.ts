import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { soloTexto } from "./busqueda.ts";

describe("los parámetros de la dirección en Operación (base-N28)", () => {
  it("una clave repetida llega como lista y se descarta; las demás quedan como texto", async () => {
    const parametros = await soloTexto<"aviso" | "en" | "faltan">(
      Promise.resolve({ aviso: ["a", "b"], en: "datos-titulo", faltan: ["giro", "domicilio"] }),
    );
    assert.deepEqual(parametros, { en: "datos-titulo" });
  });

  it("un texto vacío sigue siendo texto y una clave ausente no aparece", async () => {
    assert.deepEqual(await soloTexto<"aviso" | "en">(Promise.resolve({ aviso: "" })), { aviso: "" });
    assert.deepEqual(await soloTexto<"aviso">(Promise.resolve({})), {});
  });
});
