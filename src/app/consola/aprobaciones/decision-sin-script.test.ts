import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { aDecisionSinScript } from "./decision-sin-script.ts";

function datos(campos: Record<string, string>): FormData {
  const forma = new FormData();
  for (const [clave, valor] of Object.entries(campos)) forma.set(clave, valor);
  return forma;
}

describe("la decisión de la bandeja sin JavaScript", () => {
  it("la acción solo adapta lo que devuelve decidirPago: ninguna regla propia", () => {
    const fuente = readFileSync(path.join(import.meta.dirname, "acciones.ts"), "utf8");
    const cuerpo = fuente.slice(fuente.indexOf("export async function decidirPagoSinScript"));
    assert.match(cuerpo, /^export async function decidirPagoSinScript\([^)]*\): Promise<DecisionSinScript> \{\n  return aDecisionSinScript\(await decidirPago\(ESTADO_PAGO_INICIAL, datos\), datos\);\n\}\n$/);
    assert.equal([...fuente.matchAll(/^import /gm)].length, 3, "solo decidirPago, su estado inicial y el adaptador");
  });

  it("«listo» enciende el aviso; el estado inicial pasa igual", () => {
    assert.deepEqual(aDecisionSinScript({ tipo: "listo", mensaje: "Quedó listo para pagar.", requestId: "x" }, datos({})), {
      tipo: "listo",
      mensaje: "Quedó listo para pagar.",
    });
    assert.deepEqual(aDecisionSinScript({ tipo: "inicial" }, datos({})), { tipo: "inicial" });
  });

  it("«invalido» vuelve con el pago, la decisión, lo escrito (a lo más 500) y el código del error", () => {
    const motivo = "m".repeat(600);
    const resultado = aDecisionSinScript(
      { tipo: "invalido", mensaje: "Ese código no coincide.", campo: "codigo", codigo: "segundo_factor_invalido" },
      datos({ requestId: "88888888-8888-4888-8888-88888888888a", decision: "rechazar", motivo }),
    );
    assert.deepEqual(resultado, {
      tipo: "invalido",
      mensaje: "Ese código no coincide.",
      campo: "codigo",
      codigo: "segundo_factor_invalido",
      requestId: "88888888-8888-4888-8888-88888888888a",
      decision: "rechazar",
      motivo: "m".repeat(500),
    });
    // Una decisión que no es «autorizar» se pinta como rechazo: nunca abre una autorización que nadie pidió.
    const otra = aDecisionSinScript({ tipo: "invalido", mensaje: "x" }, datos({ decision: "otra" }));
    assert.equal(otra.tipo === "invalido" ? otra.decision : null, "rechazar");
  });
});
