import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registrarEfevoo, sinNumerosDeTarjeta } from "./registros";

describe("Efevoo: registros del servidor", () => {
  it("borra toda secuencia de 13 a 19 dígitos, con o sin separadores", () => {
    for (const pan of ["4495830012349476", "4495 8300 1234 9476", "4495-8300-1234-9476", "1234567890123", "1234567890123456789"]) {
      const salida = sinNumerosDeTarjeta(`tarjeta ${pan} fin`);
      assert.equal(/\d{13,19}/.test(salida.replace(/[\s-]/g, "")), false, pan);
      assert.match(salida, /\[redactado\]/);
    }
  });

  it("deja en paz lo que no es tarjeta: referencias de 7, ids y la terminación", () => {
    assert.equal(sinNumerosDeTarjeta("ref 9100002 id 560 ****6509 monto 1234567.89"), "ref 9100002 id 560 ****6509 monto 1234567.89");
    assert.equal(sinNumerosDeTarjeta("123456789012"), "123456789012");
  });

  it("solo escribe los campos permitidos: ni correos, ni nombres, ni la respuesta cruda", () => {
    const lineas: string[] = [];
    registrarEfevoo(
      "error",
      "efevoo_rechazo",
      {
        metodo: "fundCard",
        codigo: "101",
        http: 200,
        // Un llamador descuidado: nada de esto debe salir.
        ...({ correo: "titular@lever.test", nombre: "PRUEBA LEVER", cuerpo: { bin: "4495830012349476" }, llave: "secreta" } as object),
      },
      (l) => lineas.push(l),
    );
    assert.equal(lineas.length, 1);
    const salida = JSON.parse(lineas[0]!) as Record<string, unknown>;
    assert.deepEqual(Object.keys(salida).sort(), ["codigo", "evento", "http", "metodo", "nivel", "origen"]);
    assert.doesNotMatch(lineas[0]!, /lever\.test|PRUEBA|secreta|\d{13,19}/);
  });

  it("aunque un motivo traiga un número de tarjeta, no sale", () => {
    const lineas: string[] = [];
    registrarEfevoo("error", "x", { motivo: "falló 4495830012349476" }, (l) => lineas.push(l));
    assert.doesNotMatch(lineas[0]!, /\d{13,19}/);
  });
});
