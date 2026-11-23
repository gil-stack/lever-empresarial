import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tarjetasDelFiltro } from "../../components/operacion/inventario-tarjetas.tsx";
import type { TarjetaEfevoo } from "./cliente";
import { armarInventario, type FilaLever } from "./inventario";

function efevoo(id: number, estado: TarjetaEfevoo["estado"], extra: Partial<TarjetaEfevoo> = {}): TarjetaEfevoo {
  return { id, terminacion: String(1000 + id), estado, saldoCentavos: 0, idepCliente: 0, producto: 16, subproducto: 19, conTitular: false, ...extra };
}

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const lever: FilaLever = {
  id: "22222222-2222-4222-8222-222222222222",
  idEfevoo: 3,
  terminacion: "1003",
  nombreTarjeta: "ANA LOPEZ",
  estado: "activa",
  companyId: EMPRESA,
  razonSocial: "Ejemplo SA",
  creadaEn: "2026-11-20T10:00:00.000Z",
};

describe("inventario de tarjetas", () => {
  it("cuenta stock, sin asignar, activas con y sin saldo, por activar, bloqueadas y canceladas con lo de Efevoo", () => {
    const inv = armarInventario({
      efevoo: [
        efevoo(1, "inStock"),
        efevoo(2, "inStock"),
        efevoo(3, "active", { saldoCentavos: 150_00, idepCliente: 77, conTitular: true }),
        efevoo(4, "active", { idepCliente: 77, conTitular: true }),
        efevoo(5, "inStock", { conTitular: true, idepCliente: 900 }),
        efevoo(6, "blocked", { saldoCentavos: 20_00 }),
        efevoo(7, "cancelled"),
      ],
      lever: [lever],
      vinculos: [{ idepCliente: 77, companyId: EMPRESA, razonSocial: "Ejemplo SA" }],
      ambiente: "sandbox",
      errorEfevoo: null,
      incompleto: false,
    });
    assert.equal(inv.fuente, "efevoo");
    assert.deepEqual(inv.conteos, {
      stock: 6,
      sinAsignar: 2,
      asignadas: 1,
      activas: 2,
      conSaldo: 1,
      sinSaldo: 1,
      bloqueadas: 1,
      canceladas: 1,
      saldoTotalCentavos: 170_00,
    });
    const tres = inv.tarjetas.find((t) => t.idEfevoo === 3)!;
    assert.equal(tres.nombreTarjeta, "ANA LOPEZ");
    assert.equal(tres.empresa?.razonSocial, "Ejemplo SA");
    // La del cliente 77 que Lever no registró va con su empresa por el vínculo; la del 900 es de otro cliente del sandbox.
    assert.equal(inv.tarjetas.find((t) => t.idEfevoo === 4)!.empresa?.id, EMPRESA);
    assert.equal(inv.tarjetas.find((t) => t.idEfevoo === 5)!.idepClienteAjeno, 900);
  });

  it("una «inactive» de Efevoo (asignada sin activar) cuenta como por activar, no como libre", () => {
    const inv = armarInventario({ efevoo: [efevoo(1, "inactive", { conTitular: true }), efevoo(2, "inStock")], lever: [], vinculos: [], ambiente: "sandbox", errorEfevoo: null, incompleto: false });
    assert.equal(inv.conteos.asignadas, 1);
    assert.equal(inv.conteos.sinAsignar, 1);
  });

  it("una tarjeta en inventario que Lever ya entregó no cuenta como libre", () => {
    const inv = armarInventario({
      efevoo: [efevoo(3, "inStock")],
      lever: [{ ...lever, estado: "asignada" }],
      vinculos: [],
      ambiente: "sandbox",
      errorEfevoo: null,
      incompleto: false,
    });
    assert.equal(inv.conteos.sinAsignar, 0);
    assert.equal(inv.conteos.asignadas, 1);
  });

  it("sin Efevoo pinta lo de Lever, sin saldos", () => {
    const inv = armarInventario({ efevoo: null, lever: [lever], vinculos: [], ambiente: null, errorEfevoo: null, incompleto: false });
    assert.equal(inv.fuente, "lever");
    assert.equal(inv.conteos.stock, 1);
    assert.equal(inv.conteos.activas, 1);
    assert.equal(inv.conteos.saldoTotalCentavos, null);
    assert.equal(inv.tarjetas[0].saldoCentavos, null);
  });

  it("cada filtro trae solo sus tarjetas y «todas» deja fuera las canceladas", () => {
    const inv = armarInventario({
      efevoo: [efevoo(1, "inStock"), efevoo(3, "active", { saldoCentavos: 1 }), efevoo(4, "active"), efevoo(7, "cancelled")],
      lever: [],
      vinculos: [],
      ambiente: "sandbox",
      errorEfevoo: null,
      incompleto: false,
    });
    assert.deepEqual(tarjetasDelFiltro(inv.tarjetas, "todas").map((t) => t.idEfevoo), [1, 3, 4]);
    assert.deepEqual(tarjetasDelFiltro(inv.tarjetas, "activa").map((t) => t.idEfevoo), [3, 4]);
    assert.deepEqual(tarjetasDelFiltro(inv.tarjetas, "con_saldo").map((t) => t.idEfevoo), [3]);
    assert.deepEqual(tarjetasDelFiltro(inv.tarjetas, "sin_saldo").map((t) => t.idEfevoo), [4]);
    assert.deepEqual(tarjetasDelFiltro(inv.tarjetas, "cancelada").map((t) => t.idEfevoo), [7]);
  });
});
