import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ClienteEfevoo } from "../efevoo/cliente.ts";
import { ErrorEfevoo } from "../efevoo/errores.ts";
import { movimientosDe, saldoEmpresa, saldosDeTarjetas } from "./index.ts";

/** Un cliente de Efevoo que solo implementa lo que se le pide; lo demás truena. */
function cliente(parcial: Partial<ClienteEfevoo>): ClienteEfevoo {
  return new Proxy(parcial, { get: (t, k) => (t as Record<string | symbol, unknown>)[k] ?? (() => { throw new Error(`no esperado: ${String(k)}`); }) }) as ClienteEfevoo;
}
const fila = { id: "t1", id_efevoo: 560, terminacion: "6509", nombre_tarjeta: "TITO", estado: "activa", titular: null };

describe("Tarjetas: lecturas del emisor (r-e2-6)", () => {
  it("un error de Efevoo deja el saldo como desconocido; uno que no es de Efevoo se vuelve a lanzar", async () => {
    const efevoo = cliente({ saldoDeTarjetas: async () => { throw new ErrorEfevoo("efevoo_incierto", "timeout"); } });
    assert.deepEqual([...(await saldosDeTarjetas(efevoo, [fila]))], []);
    const roto = cliente({ saldoDeTarjetas: async () => { throw new TypeError("x is not a function"); } });
    await assert.rejects(saldosDeTarjetas(roto, [fila]), TypeError);
    await assert.rejects(saldoEmpresa(cliente({ leerCliente: async () => { throw new TypeError("roto"); } }), 19), TypeError);
    await assert.rejects(movimientosDe(cliente({ correoDeTarjeta: async () => { throw new TypeError("roto"); } }), 560), TypeError);
    assert.deepEqual(await saldoEmpresa(cliente({ leerCliente: async () => { throw new ErrorEfevoo("efevoo_incierto", "5xx"); } }), 19), { tipo: "no_disponible" });
  });

  it("sin correo del titular, los movimientos quedan sin leer y se registra el motivo", async () => {
    const lineas: string[] = [];
    const original = console.error;
    console.error = (linea: string) => lineas.push(linea);
    try {
      assert.equal(await movimientosDe(cliente({ correoDeTarjeta: async () => null }), 560), null);
    } finally {
      console.error = original;
    }
    assert.ok(lineas.some((l) => l.includes("tarjetas_movimientos_sin_correo")), lineas.join("\n"));
  });
});
