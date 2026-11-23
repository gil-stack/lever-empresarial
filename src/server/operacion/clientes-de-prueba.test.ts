import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validarRfcDeAlta } from "../../domain/rfc.ts";
import { altaRapidaDisponible, rfcDePrueba } from "./clientes-de-prueba.ts";

const SANDBOX = {
  EFEVOO_URL: "https://test-intgapi.efevoopay.com",
  EFEVOO_API_USER: "usuario-prueba",
  EFEVOO_API_KEY: "llave-de-prueba-123",
  EFEVOO_AMBIENTE: "sandbox",
};

describe("alta rápida de clientes de prueba", () => {
  it("solo existe con el procesador en su ambiente de pruebas", () => {
    assert.equal(altaRapidaDisponible({}), false);
    assert.equal(altaRapidaDisponible(SANDBOX), true);
    // Producción con el sandbox temporal (decisión del 23/11): sí; con las llaves reales: no.
    assert.equal(altaRapidaDisponible({ ...SANDBOX, VERCEL_ENV: "production", EFEVOO_SANDBOX_EN_PRODUCCION: "si" }), true);
    assert.equal(altaRapidaDisponible({ ...SANDBOX, VERCEL_ENV: "production" }), false);
    assert.equal(
      altaRapidaDisponible({ ...SANDBOX, EFEVOO_URL: "https://intgapi.efevoopay.com", EFEVOO_AMBIENTE: "produccion", VERCEL_ENV: "production" }),
      false,
    );
  });

  it("inventa un RFC de persona moral con el patrón del SAT y la fecha de hoy en México", () => {
    const ahora = new Date("2026-11-24T03:00:00Z"); // 23 de noviembre en México
    for (let i = 0; i < 200; i += 1) {
      const rfc = rfcDePrueba(ahora);
      assert.match(rfc, /^P[A-Z]{2}261123[A-Z0-9]{2}[0-9]$/);
      const validado = validarRfcDeAlta(rfc);
      assert.equal(validado.ok, true, rfc);
      assert.equal(validado.ok && validado.tipo, "moral");
    }
    assert.equal(rfcDePrueba(ahora, () => 0), "PAA261123AA0");
  });
});
