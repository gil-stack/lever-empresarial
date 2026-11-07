import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { contieneMaterialProhibido, rechazarSiHayMaterial } from "./material";

/** Sus dígitos «784-02462039186» forman 14 seguidos que pasan Luhn si se ignoran los guiones. */
const UUID_QUE_PARECIA_TARJETA = "cbf4fb03-faca-4f2c-a784-02462039186d";

describe("un UUID no es una tarjeta", () => {
  it("el UUID que juntaba 14 dígitos con Luhn ya no se rechaza, como identificador ni dentro de un texto", () => {
    assert.equal(contieneMaterialProhibido(UUID_QUE_PARECIA_TARJETA), false);
    assert.equal(contieneMaterialProhibido(`Se revisó la solicitud ${UUID_QUE_PARECIA_TARJETA}.`), false);
    assert.doesNotThrow(() =>
      rechazarSiHayMaterial({
        companyId: null,
        actorId: UUID_QUE_PARECIA_TARJETA,
        accion: "entrada_contrasena",
        entidad: "auth_entradas",
        identificador: UUID_QUE_PARECIA_TARJETA,
        ocurridoEn: new Date(),
      }),
    );
  });

  it("ningún UUID aleatorio se toma por tarjeta (antes, 2 de cada 1,000)", () => {
    let rechazados = 0;
    for (let i = 0; i < 200_000; i += 1) if (contieneMaterialProhibido(randomUUID())) rechazados += 1;
    assert.equal(rechazados, 0);
  });

  it("una tarjeta real se sigue rechazando: sola, con espacios, con guiones o junto a un UUID", () => {
    for (const texto of [
      "4111111111111111",
      "4111 1111 1111 1111",
      "4111-1111-1111-1111",
      `Pago ${UUID_QUE_PARECIA_TARJETA} con 4111 1111 1111 1111`,
      // Antes, la racha se comía los dígitos del UUID de junto y la tarjeta pasaba.
      "4111111111111111 92305b18-5ef4-43d2-ae6f-ef0851f67624",
    ]) {
      assert.equal(contieneMaterialProhibido(texto), true, texto);
    }
    assert.throws(() =>
      rechazarSiHayMaterial({ companyId: null, actorId: null, accion: "x", entidad: "y", identificador: "4111111111111111", ocurridoEn: "" }),
      /evento_con_secreto/,
    );
  });
});
