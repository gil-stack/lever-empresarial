import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { clienteHttpEfevoo, type ClienteEfevoo } from "../../src/server/efevoo/cliente.ts";
import { leerConfigEfevoo } from "../../src/server/efevoo/config.ts";
import { ErrorEfevoo } from "../../src/server/efevoo/errores.ts";
import { iniciarEfevooFalso, ultimos8De, type EfevooFalso } from "./servidor-falso.ts";

/** El cliente real contra el Efevoo falso, por HTTP: el ciclo completo y cada falla. */

let falso: EfevooFalso;
let efevoo: ClienteEfevoo;
const titular = {
  nombre: "PRUEBA", primerApellido: "LEVER", segundoApellido: "UNO", nombreEmbozar: "PRUEBA LEVER",
  telefono: "5500000001", correo: "titular-uno@lever.test", paisNacimiento: "México", domicilio: "Calle Prueba 1",
};

async function falla(p: Promise<unknown>): Promise<ErrorEfevoo> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ErrorEfevoo, String(e));
    return e;
  }
  assert.fail("debía fallar");
}

describe("Efevoo falso", () => {
  before(async () => {
    falso = await iniciarEfevooFalso(0);
    const leida = leerConfigEfevoo({ EFEVOO_URL: falso.url, EFEVOO_API_USER: falso.usuario, EFEVOO_API_KEY: falso.llave, EFEVOO_AMBIENTE: "sandbox" });
    assert.ok(leida.config);
    efevoo = clienteHttpEfevoo(leida.config, fetch, 300);
  });
  after(() => falso.cerrar());
  beforeEach(() => falso.reiniciar());

  it("el ciclo completo: alta, depósito, asignar, activar, cargar, retirar, bloquear y cancelar", async () => {
    const { idepCliente } = await efevoo.crearCliente({ correo: "empresa@lever.test", razonSocial: "Empresa de prueba" });
    const deposito = await efevoo.moverSaldoCliente(idepCliente, 100_000, "deposit");
    assert.deepEqual(deposito, { saldoPrevioCentavos: 0, saldoNuevoCentavos: 100_000 });
    const [mov] = await efevoo.movimientosCliente(idepCliente, 1, 50);
    assert.equal(mov!.centavos, 100_000);
    assert.match(mov!.registradoEn, /^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} (AM|PM)$/);

    const inventario = await efevoo.listarTarjetas({ estados: ["inStock"], pagina: 1, tamano: 50 });
    assert.deepEqual(inventario.tarjetas.map((t) => t.id), [557, 563, 564, 567, 568]);
    const asignada = await efevoo.asignarTarjeta({ producto: 16, subproducto: 19, idepCliente, ultimos8: ultimos8De("1363"), titular });
    assert.deepEqual(asignada, { id: 557, terminacion: "1363" });
    await efevoo.activarTarjeta(557, titular.correo);
    assert.equal(await efevoo.correoDeTarjeta(557), titular.correo);

    const carga = await efevoo.cargarTarjeta(557, titular.correo, 12_345, "1000001", "carga");
    assert.equal(carga.saldoFinalCentavos, 12_345);
    const retiro = await efevoo.retirarTarjeta(557, titular.correo, 45, "1000002", "retiro");
    assert.equal(retiro.saldoFinalCentavos, 12_300);
    const movs = await efevoo.movimientosDeTarjeta(557, titular.correo);
    // Como en el sandbox: la carga es Abono «PAGO A TARJETA», el retiro Cargo «DEVOLUCIÓN PAGO A TARJETA»,
    // y el IDMovimiento es de otra serie que el id que respondieron fundCard y unfundCard.
    assert.deepEqual(movs.map((m) => [m.referencia, m.centavos, m.tipo, m.concepto]), [
      ["1000002", 45, "cargo", "DEVOLUCIÓN PAGO A TARJETA"],
      ["1000001", 12_345, "abono", "PAGO A TARJETA"],
    ]);
    assert.equal(movs[0]!.saldoDespuesCentavos, 12_300);
    assert.notEqual(movs[1]!.idMovimiento, String(carga.id));
    assert.notEqual(movs[0]!.idMovimiento, String(retiro.id));
    assert.match(movs[0]!.fechaHora, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // Solo pruebas: un movimiento con concepto a medida, sin tocar el saldo.
    falso.inyectarMovimiento({ idCard: 557, concepto: "COMPRA 4495830012349476", importe: 1.5, tipo: "Cargo" });
    const r = await fetch(`${falso.url}/simular`, { method: "POST", body: JSON.stringify({ metodo: "movimiento", idCard: 557, concepto: "OTRO", importe: 2, tipo: "Abono" }) });
    assert.equal(r.status, 200);
    const conInyectados = await efevoo.movimientosDeTarjeta(557, titular.correo);
    assert.deepEqual(conInyectados.slice(0, 2).map((m) => [m.concepto, m.centavos, m.tipo]), [["OTRO", 200, "abono"], ["COMPRA 4495830012349476", 150, "cargo"]]);
    assert.equal(falso.estado().tarjetas.find((t) => t.id === 557)!.saldoCentavos, 12_300, "inyectar no toca el saldo");

    await efevoo.bloquearTarjeta(557, titular.correo, "block");
    assert.equal((await efevoo.listarTarjetas({ estados: ["blocked"], pagina: 1, tamano: 10 })).tarjetas[0]?.id, 557);
    await efevoo.bloquearTarjeta(557, titular.correo, "unblock");
    await efevoo.cancelarTarjeta(557, titular.correo);
    assert.equal((await efevoo.listarTarjetas({ estados: "todas", pagina: 1, tamano: 50 })).tarjetas.find((t) => t.id === 557)?.estado, "cancelled");
  });

  it("las rarezas medidas: alta repetida, falso éxito con id 0, referencia mal formada, método inexistente", async () => {
    await efevoo.crearCliente({ correo: "dup@lever.test", razonSocial: "Dup" });
    assert.equal((await falla(efevoo.crearCliente({ correo: "dup@lever.test", razonSocial: "Dup" }))).codigoEfevoo, "1");
    const { idepCliente } = await efevoo.crearCliente({ correo: "otra@lever.test", razonSocial: "Otra" });
    await efevoo.asignarTarjeta({ producto: 16, subproducto: 19, idepCliente, ultimos8: ultimos8De("0168"), titular });
    assert.equal((await falla(efevoo.cargarTarjeta(563, "no-es@lever.test", 100, "1000003", "x"))).codigoEfevoo, "id_cero");
    assert.equal(falso.estado().tarjetas.find((t) => t.id === 563)?.saldoCentavos, 0, "el falso éxito no movió nada");
    assert.equal((await falla(efevoo.asignarTarjeta({ producto: 16, subproducto: 19, idepCliente, ultimos8: "99999999", titular }))).codigoEfevoo, "101");
    assert.equal((await falla(efevoo.asignarTarjeta({ producto: 16, subproducto: 19, idepCliente, ultimos8: ultimos8De("0168"), titular }))).codigoEfevoo, "163");
    const r = await fetch(`${falso.url}/v1/apiservice`, {
      method: "POST", headers: { "X-API-USER": falso.usuario, "X-API-KEY": falso.llave },
      body: JSON.stringify({ method: "getCardData", payload: { card: 563 } }),
    });
    assert.equal(r.status, 401, "getCardData no existe ni en el falso");
  });

  it("el sandbox no valida saldos y el falso tampoco: valida Lever", async () => {
    const { idepCliente } = await efevoo.crearCliente({ correo: "s@lever.test", razonSocial: "S" });
    await efevoo.asignarTarjeta({ producto: 16, subproducto: 19, idepCliente, ultimos8: ultimos8De("3474"), titular });
    const r = await efevoo.retirarTarjeta(564, titular.correo, 100, "1000004", "x");
    assert.equal(r.saldoFinalCentavos, -100);
  });

  it("credenciales equivocadas: 401", async () => {
    const otro = clienteHttpEfevoo({ url: `${falso.url}/v1/apiservice`, usuario: "otro", llave: "otra-llave-1", ambiente: "sandbox" });
    assert.equal((await falla(otro.listarClientes())).codigo, "efevoo_no_autorizado");
  });

  it("cada falla se pide una vez y solo para esa tarjeta: 901, 401, 5xx, ilegible y timeout", async () => {
    const { idepCliente } = await efevoo.crearCliente({ correo: "f@lever.test", razonSocial: "F" });
    await efevoo.asignarTarjeta({ producto: 16, subproducto: 19, idepCliente, ultimos8: ultimos8De("8182"), titular });
    await efevoo.activarTarjeta(568, titular.correo);
    for (const [f, codigo, esperado] of [["901", "efevoo_rechazo", "901"], ["401", "efevoo_no_autorizado", "401"], ["5xx", "efevoo_incierto", "http_502"]] as const) {
      falso.simular({ metodo: "fundCard", falla: f, idCard: 568 });
      const e = await falla(efevoo.cargarTarjeta(568, titular.correo, 100, "1000005", "x"));
      assert.deepEqual([e.codigo, e.codigoEfevoo], [codigo, esperado], f);
    }
    assert.equal(falso.estado().tarjetas.find((t) => t.id === 568)?.saldoCentavos, 0, "901, 401 y 5xx no movieron nada");

    // ilegible y timeout: Efevoo sí lo hizo; Lever queda incierto y lo encuentra por la referencia.
    falso.simular({ metodo: "fundCard", falla: "ilegible", idCard: 568 });
    assert.deepEqual([(await falla(efevoo.cargarTarjeta(568, titular.correo, 100, "1000006", "x"))).codigoEfevoo], ["ilegible"]);
    falso.simular({ metodo: "fundCard", falla: "timeout", idCard: 568 });
    assert.deepEqual([(await falla(efevoo.cargarTarjeta(568, titular.correo, 200, "1000007", "x"))).codigoEfevoo], ["timeout"]);
    const refs = (await efevoo.movimientosDeTarjeta(568, titular.correo)).map((m) => m.referencia);
    assert.deepEqual(refs.sort(), ["1000006", "1000007"]);

    // Y la siguiente llamada ya funciona: la falla fue de una sola vez.
    assert.equal((await efevoo.cargarTarjeta(568, titular.correo, 1, "1000008", "x")).saldoFinalCentavos, 301);
    // Una falla para otra tarjeta no toca a esta.
    falso.simular({ metodo: "fundCard", falla: "901", idCard: 557 });
    assert.equal((await efevoo.cargarTarjeta(568, titular.correo, 1, "1000009", "x")).saldoFinalCentavos, 302);
  });

  it("timeout sin efecto: no aparece la referencia", async () => {
    const { idepCliente } = await efevoo.crearCliente({ correo: "t@lever.test", razonSocial: "T" });
    await efevoo.asignarTarjeta({ producto: 16, subproducto: 19, idepCliente, ultimos8: ultimos8De("1363"), titular });
    falso.simular({ metodo: "fundCard", falla: "timeout_sin_efecto" });
    assert.equal((await falla(efevoo.cargarTarjeta(557, titular.correo, 100, "1000010", "x"))).codigoEfevoo, "timeout");
    assert.deepEqual(await efevoo.movimientosDeTarjeta(557, titular.correo), []);
  });
});
