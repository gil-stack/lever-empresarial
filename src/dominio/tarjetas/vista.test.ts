import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cifrasTarjetas, leerMontoTarjeta, operable, terminacionSegura, type TarjetaEmpresa } from "./vista.ts";

const tarjeta = (parcial: Partial<TarjetaEmpresa>): TarjetaEmpresa => ({
  id: "t", terminacion: "1234", nombre: "Viáticos", titular: null, estado: "activa", saldoCentavos: 0, ...parcial,
});

describe("Tarjetas con Efevoo: la vista", () => {
  it("el monto se lee en centavos exactos, mayor que cero", () => {
    assert.deepEqual(leerMontoTarjeta("100", null), { tipo: "valido", centavos: 10_000 });
    assert.deepEqual(leerMontoTarjeta("25.50", null), { tipo: "valido", centavos: 2_550 });
    assert.deepEqual(leerMontoTarjeta("0.01", null), { tipo: "valido", centavos: 1 });
    assert.deepEqual(leerMontoTarjeta("$1,234.56", null), { tipo: "valido", centavos: 123_456 });
    for (const malo of ["", "0", "0.00", "-5", "1.2.3", "abc", "1e3", null]) {
      assert.deepEqual(leerMontoTarjeta(malo, null), { tipo: "invalido", motivo: "monto_invalido" }, String(malo));
    }
  });

  it("si no alcanza el saldo, lo dice antes de intentarlo; si el saldo no se conoce, deja pasar", () => {
    assert.deepEqual(leerMontoTarjeta("100.01", 10_000), { tipo: "invalido", motivo: "saldo_insuficiente" });
    assert.deepEqual(leerMontoTarjeta("100.00", 10_000), { tipo: "valido", centavos: 10_000 });
    assert.deepEqual(leerMontoTarjeta("100.01", null), { tipo: "valido", centavos: 10_001 });
  });

  it("solo se pinta una terminación de 4 dígitos, nunca un número más largo", () => {
    assert.equal(terminacionSegura("6767"), "6767");
    assert.equal(terminacionSegura("4111111111111111"), "····");
    assert.equal(terminacionSegura("12a4"), "····");
  });

  it("cifras: activas, bloqueadas, saldo de la empresa y repartido; las canceladas no cuentan", () => {
    const cifras = cifrasTarjetas({
      saldo: { tipo: "listo", centavos: 50_000 },
      tarjetas: [
        tarjeta({ estado: "activa", saldoCentavos: 1_000 }),
        tarjeta({ estado: "bloqueada", saldoCentavos: 250 }),
        tarjeta({ estado: "cancelada", saldoCentavos: 9_999 }),
      ],
    });
    assert.deepEqual(cifras, { activas: 1, bloqueadas: 1, saldoEmpresaCentavos: 50_000, repartidoCentavos: 1_250 });
    const sinSaldo = cifrasTarjetas({ saldo: { tipo: "no_disponible" }, tarjetas: [tarjeta({ saldoCentavos: null })] });
    assert.deepEqual(sinSaldo, { activas: 1, bloqueadas: 0, saldoEmpresaCentavos: null, repartidoCentavos: null });
  });

  it("se operan las activas y las bloqueadas; ni las por activar ni las canceladas", () => {
    assert.deepEqual(["asignada", "activa", "bloqueada", "cancelada"].map((estado) => operable({ estado: estado as TarjetaEmpresa["estado"] })), [false, true, true, false]);
  });
});
