import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fechaDelProcesador } from "../../components/operacion/detalle-tarjeta.tsx";
import { empresaDe, enlaceTablero, porEmpresa, SIN_EMPRESA, tarjetasDeEmpresa, tarjetasDelFiltro } from "../../components/operacion/inventario-tarjetas.tsx";
import type { TarjetaEfevoo } from "./cliente";
import { idDeTarjeta, ordenarMovimientos, resumirMovimientos } from "./detalle-tarjeta";
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

describe("tarjetas por empresa", () => {
  const inv = armarInventario({
    efevoo: [
      efevoo(1, "inStock"),
      efevoo(3, "active", { saldoCentavos: 150_00, idepCliente: 77, conTitular: true }),
      efevoo(4, "active", { idepCliente: 77, conTitular: true }),
      efevoo(5, "active", { saldoCentavos: 10_00, idepCliente: 900, conTitular: true }),
      efevoo(6, "cancelled", { idepCliente: 900 }),
    ],
    lever: [lever],
    vinculos: [{ idepCliente: 77, companyId: EMPRESA, razonSocial: "Ejemplo SA" }],
    ambiente: "sandbox",
    errorEfevoo: null,
    incompleto: false,
    nombresAjenos: new Map([[900, "Otra Empresa"]]),
  });

  it("cada tarjeta lleva la empresa por la que se afilió: la de Lever, la del procesador o ninguna", () => {
    const de = (id: number) => inv.tarjetas.find((t) => t.idEfevoo === id)!.afiliacion;
    assert.deepEqual(de(3), { clave: EMPRESA, nombre: "Ejemplo SA", enLever: true, companyId: EMPRESA });
    assert.deepEqual(de(5), { clave: "p900", nombre: "Otra Empresa", enLever: false, companyId: null });
    assert.equal(de(1), null);
  });

  it("agrupa sin canceladas, de la empresa con más tarjetas a la de menos, con el stock libre al final", () => {
    assert.deepEqual(
      porEmpresa(inv).map((f) => [f.clave, f.tarjetas, f.activas, f.conSaldo, f.saldoCentavos]),
      [[EMPRESA, 2, 2, 1, 150_00], ["p900", 1, 1, 1, 10_00], [SIN_EMPRESA, 1, 0, 0, 0]],
    );
  });

  it("filtra por empresa y lee la empresa de la dirección solo si tiene forma válida", () => {
    assert.deepEqual(tarjetasDeEmpresa(inv.tarjetas, "p900").map((t) => t.idEfevoo), [5, 6]);
    assert.deepEqual(tarjetasDeEmpresa(inv.tarjetas, SIN_EMPRESA).map((t) => t.idEfevoo), [1]);
    assert.equal(tarjetasDeEmpresa(inv.tarjetas, null).length, 5);
    assert.equal(empresaDe(EMPRESA.toUpperCase()), EMPRESA);
    assert.equal(empresaDe("p900"), "p900");
    assert.equal(empresaDe("ninguna"), "ninguna");
    assert.equal(empresaDe("p0"), null);
    assert.equal(empresaDe("'; drop"), null);
    assert.equal(enlaceTablero("con_saldo", "p900"), "/operacion/tarjetas?ver=con_saldo&empresa=p900");
    assert.equal(enlaceTablero("todas", null), "/operacion/tarjetas");
  });
});

describe("detalle de una tarjeta", () => {
  it("resume lo que entró y salió, y la fecha del último movimiento", () => {
    const m = (centavos: number | null, tipo: "abono" | "cargo" | null, fechaHora: string) =>
      ({ idMovimiento: fechaHora, referencia: null, centavos, tipo, concepto: "", fechaHora, saldoDespuesCentavos: null });
    assert.deepEqual(
      resumirMovimientos([m(100_00, "abono", "2026-11-20 10:00:00"), m(12_34, "cargo", "2026-11-22 09:00:00"), m(5_00, null, "2026-11-21 08:00:00"), m(null, "abono", "")]),
      { cuantos: 4, abonadoCentavos: 100_00, cargadoCentavos: 12_34, ultimo: "2026-11-22 09:00:00" },
    );
    assert.deepEqual(resumirMovimientos([]), { cuantos: 0, abonadoCentavos: 0, cargadoCentavos: 0, ultimo: null });
  });

  it("solo acepta un id entero positivo en la dirección", () => {
    assert.equal(idDeTarjeta("557"), 557);
    for (const malo of ["0", "-1", "1.5", "abc", "", "12345678901", undefined]) assert.equal(idDeTarjeta(malo), null, String(malo));
  });

  it("pinta la fecha del procesador sin cambiarla de zona", () => {
    assert.equal(fechaDelProcesador("2026-11-23 12:34:56"), "23 nov 2026, 12:34");
    assert.equal(fechaDelProcesador("2026-01-05T08:09:00"), "5 ene 2026, 08:09");
    assert.equal(fechaDelProcesador("ayer"), "ayer");
  });
});

describe("orden de los movimientos", () => {
  it("van del más nuevo al más viejo y los que no traen fecha al final", () => {
    const m = (fechaHora: string, id: string) => ({ idMovimiento: id, referencia: null, centavos: 1, tipo: null, concepto: "", fechaHora, saldoDespuesCentavos: null });
    assert.deepEqual(
      ordenarMovimientos([m("2026-11-23 14:50:00", "a"), m("", "b"), m("2026-11-23 15:52:00", "c"), m("2026-11-23 15:51:00", "d")]).map((x) => x.idMovimiento),
      ["c", "d", "a", "b"],
    );
  });
});
