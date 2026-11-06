import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hoyEnMexico } from "../personas.ts";
import { fechasDeSerie, lunesDe, siguienteObligacion } from "./fechas.ts";
import { calcularPresupuestos, estadoDe } from "./presupuestos.ts";
import { escenarioValido, proyectar, ventanaDe, type FuentesFlujo } from "./proyeccion.ts";

/** Reloj fijo: viernes 6 de noviembre de 2026 en México. La ventana cruza el cambio de año. */
const HOY = "2026-11-06";

function fuentes(cambios: Partial<FuentesFlujo> = {}): FuentesFlujo {
  return {
    hoy: HOY,
    saldo: { centavos: 10_000_000, alDia: "2026-11-05", autor: "Laura Méndez", declaradoEn: "2026-11-05T22:00:00.000Z" },
    colchonCentavos: 0,
    nomina: [
      { netoCentavos: 1_500_000, frecuencia: "quincenal", proximoPagoEn: "2026-11-15", anclaDia: 15, altaEn: "2026-01-01", bajaEn: null },
      { netoCentavos: 1_000_000, frecuencia: "quincenal", proximoPagoEn: "2026-11-15", anclaDia: 15, altaEn: "2026-01-01", bajaEn: null },
      { netoCentavos: 2_000_000, frecuencia: "mensual", proximoPagoEn: "2026-11-30", anclaDia: 30, altaEn: "2026-01-01", bajaEn: null },
    ],
    lotes: [],
    pagos: [
      { id: "p1", proveedor: "Aceros", referencia: "A-1", totalCentavos: 5_000_000, programadaEl: "2026-11-10" },
      { id: "p2", proveedor: "Papelería", referencia: "B-2", totalCentavos: 3_000_000, programadaEl: "2026-11-20" },
      // Programado el día del saldo: ya está dentro del saldo declarado.
      { id: "p3", proveedor: "Fletes", referencia: "C-3", totalCentavos: 900_000, programadaEl: "2026-11-05" },
    ],
    obligaciones: [
      { id: "renta", concepto: "Renta", montoCentavos: 2_500_000, frecuencia: "mensual", proximaFecha: "2026-11-01", anclaDia: 1 },
    ],
    cobros: [
      { id: "k1", cliente: "Cliente Uno", concepto: "Servicio", montoCentavos: 8_000_000, fechaProbable: "2026-11-25" },
      // Vencido: su fecha ya pasó, no se proyecta.
      { id: "k2", cliente: "Cliente Dos", concepto: "Anticipo", montoCentavos: 4_000_000, fechaProbable: "2026-11-03" },
    ],
    ...cambios,
  };
}

describe("semana de lunes a domingo en hora de México", () => {
  it("el domingo pertenece a la semana que empezó el lunes anterior; el lunes abre otra", () => {
    assert.equal(lunesDe("2026-11-08"), "2026-11-02");
    assert.equal(lunesDe("2026-11-09"), "2026-11-09");
    assert.equal(lunesDe("2026-11-02"), "2026-11-02");
  });

  it("el corte del domingo al lunes se decide con la hora de México, no con UTC", () => {
    // 23:30 del domingo en México: en UTC ya es lunes.
    const domingoNoche = hoyEnMexico(new Date("2026-11-09T05:30:00Z"));
    assert.equal(domingoNoche, "2026-11-08");
    assert.equal(ventanaDe(domingoNoche).inicio, "2026-11-02");
    // 00:30 del lunes en México.
    const lunesTemprano = hoyEnMexico(new Date("2026-11-09T06:30:00Z"));
    assert.equal(lunesTemprano, "2026-11-09");
    assert.equal(ventanaDe(lunesTemprano).inicio, "2026-11-09");
  });

  it("cruza el cambio de año y el fin de mes sin perder días", () => {
    assert.equal(lunesDe("2027-01-01"), "2026-12-28");
    assert.deepEqual(ventanaDe("2026-12-31"), { inicio: "2026-12-28", fin: "2027-03-28" });
    assert.equal(siguienteObligacion("2027-01-31", "mensual", 31), "2027-02-28");
    assert.equal(siguienteObligacion("2027-02-28", "mensual", 31), "2027-03-31");
    assert.equal(siguienteObligacion("2026-12-15", "trimestral", 15), "2027-03-15");
    assert.equal(siguienteObligacion("2026-12-28", "semanal", 28), "2027-01-04");
    assert.deepEqual(
      fechasDeSerie("2026-12-31", (fecha) => siguienteObligacion(fecha, "mensual", 31), "2027-01-01", "2027-04-30"),
      ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"],
    );
  });
});

describe("proyección de 13 semanas", () => {
  it("cuadra semana por semana con el cálculo a mano", () => {
    const p = proyectar(fuentes());
    assert.equal(p.inicio, "2026-11-02");
    assert.equal(p.fin, "2027-01-31");
    assert.equal(p.corte, "2026-11-05");
    const esperado: [string, number, number, number][] = [
      // inicio de semana, entradas, salidas, saldo final
      ["2026-11-02", 0, 0, 10_000_000],
      ["2026-11-09", 0, 7_500_000, 2_500_000], // Aceros 50,000 + nómina del 15 (25,000)
      ["2026-11-16", 0, 3_000_000, -500_000], // Papelería
      ["2026-11-23", 8_000_000, 0, 7_500_000], // Cliente Uno
      ["2026-11-30", 0, 7_000_000, 500_000], // nómina del 30 (45,000) + renta de diciembre
      ["2026-12-07", 0, 0, 500_000],
      ["2026-12-14", 0, 2_500_000, -2_000_000],
      ["2026-12-21", 0, 0, -2_000_000],
      ["2026-12-28", 0, 7_000_000, -9_000_000], // mensual del 30, quincena del 31, renta de enero
      ["2027-01-04", 0, 0, -9_000_000],
      ["2027-01-11", 0, 2_500_000, -11_500_000],
      ["2027-01-18", 0, 0, -11_500_000],
      ["2027-01-25", 0, 4_500_000, -16_000_000],
    ];
    assert.deepEqual(
      p.semanas.map((semana) => [semana.inicio, semana.entradas, semana.salidas, semana.saldoFinal]),
      esperado,
    );
    assert.equal(p.semanas[0]?.saldoInicial, 10_000_000);
    assert.equal(p.entradas, 8_000_000);
    assert.equal(p.salidas, 34_000_000);
    assert.equal(p.comprometido4, 10_500_000);
    assert.equal(p.gastoNetoMensual, 8_666_667);
    assert.deepEqual(p.alcance, { tipo: "semanas", semanas: 2 });
    // La nómina se suma por fecha: no expone el neto de cada persona.
    const nomina30 = p.semanas[4]?.movimientos.find((m) => m.clave === "nom:2026-11-30");
    assert.equal(nomina30?.centavos, 4_500_000);
    assert.equal(nomina30?.concepto, "Nómina mensual y quincenal (3 personas)");
    // Lo del día del saldo y el cobro vencido no cuentan.
    const claves = p.semanas.flatMap((semana) => semana.movimientos.map((m) => m.clave));
    assert.equal(claves.includes("cxp:p3"), false);
    assert.equal(claves.includes("cob:k2"), false);
  });

  it("la alerta de faltante cae en la primera semana negativa y dice qué la provoca", () => {
    const p = proyectar(fuentes());
    assert.equal(p.faltante?.semana, 2);
    assert.equal(p.faltante?.inicio, "2026-11-16");
    assert.equal(p.faltante?.saldoFinal, -500_000);
    assert.equal(p.faltante?.motivo, "negativo");
    assert.deepEqual(p.faltante?.causas.map((m) => m.clave), ["cxp:p2"]);
  });

  it("un cobro nuevo antes del faltante lo quita; sin él, regresa", () => {
    const cobro = { id: "k3", cliente: "Cliente Tres", concepto: "Venta", montoCentavos: 600_000, fechaProbable: "2026-11-18" };
    const conCobro = proyectar(fuentes({ cobros: [...fuentes().cobros, cobro] }));
    assert.equal(conCobro.semanas[2]?.saldoFinal, 100_000);
    assert.equal(conCobro.faltante?.semana, 6);
    assert.equal(proyectar(fuentes()).faltante?.semana, 2);
  });

  it("el colchón adelanta la alerta aunque el saldo siga positivo", () => {
    const p = proyectar(fuentes({ colchonCentavos: 3_000_000 }));
    assert.equal(p.faltante?.semana, 1);
    assert.equal(p.faltante?.motivo, "colchon");
    assert.deepEqual(p.faltante?.causas.map((m) => m.clave), ["cxp:p1", "nom:2026-11-15"]);
  });

  it("sin saldo declarado muestra lo comprometido sin saldo ni alerta", () => {
    const p = proyectar(fuentes({ saldo: null }));
    assert.equal(p.corte, "2026-11-01");
    assert.equal(p.semanas.every((semana) => semana.saldoFinal === null), true);
    assert.deepEqual(p.alcance, { tipo: "sin_saldo" });
    assert.equal(p.faltante, null);
    // Sin saldo, cuenta desde el lunes: el pago del 5 sí entra.
    assert.equal(p.semanas[0]?.salidas, 900_000);
  });

  it("con un saldo viejo, una salida posterior al saldo y anterior a esta semana entra atrasada en la primera", () => {
    const p = proyectar(fuentes({
      saldo: { centavos: 10_000_000, alDia: "2026-10-28", autor: "Laura", declaradoEn: "2026-10-28T20:00:00.000Z" },
      pagos: [{ id: "viejo", proveedor: "Aceros", referencia: "A-0", totalCentavos: 700_000, programadaEl: "2026-10-30" }],
      cobros: [{ id: "tarde", cliente: "Cliente", concepto: "Tarde", montoCentavos: 999_999, fechaProbable: "2026-10-30" }],
      nomina: [],
      obligaciones: [],
    }));
    assert.deepEqual(p.atrasados.map((m) => m.clave), ["cxp:viejo"]);
    assert.equal(p.semanas[0]?.salidas, 700_000);
    assert.equal(p.semanas[0]?.entradas, 0);
  });

  it("el escenario mueve un pago a otra semana sin tocar la proyección real", () => {
    const base = fuentes();
    const real = proyectar(base);
    const escenario = escenarioValido(real, "cxp:p1", "2026-11-17");
    assert.deepEqual(escenario, { clave: "cxp:p1", fecha: "2026-11-17" });
    const movida = proyectar(base, escenario);
    assert.equal(movida.semanas[1]?.salidas, 2_500_000);
    assert.equal(movida.semanas[2]?.salidas, 8_000_000);
    assert.equal(movida.semanas[1]?.saldoFinal, 7_500_000);
    assert.equal(movida.escenario?.concepto, "Aceros · A-1");
    // La entrada no cambió: la fecha real sigue en las fuentes.
    assert.equal(base.pagos[0]?.programadaEl, "2026-11-10");
    assert.equal(proyectar(base).semanas[1]?.salidas, 7_500_000);
    // Ni una fecha pasada ni algo que no se puede mover.
    assert.equal(escenarioValido(real, "cxp:p1", "2026-11-01"), null);
    assert.equal(escenarioValido(real, "nom:2026-11-15", "2026-11-20"), null);
    assert.equal(escenarioValido(real, "cxp:otro", "2026-11-20"), null);
    assert.equal(escenarioValido(real, "cxp:p1", "2026-02-30"), null);
  });

  it("una baja corta la nómina en su fecha", () => {
    const p = proyectar(fuentes({
      nomina: [{ netoCentavos: 1_000_000, frecuencia: "quincenal", proximoPagoEn: "2026-11-15", anclaDia: 15, altaEn: "2026-01-01", bajaEn: "2026-11-30" }],
      pagos: [],
      obligaciones: [],
      cobros: [],
    }));
    assert.equal(p.salidas, 2_000_000);
  });
});

describe("presupuestos vivos", () => {
  it("80 % exacto es atención, 100 % es excedido y debajo del 80 % está en rango", () => {
    assert.equal(estadoDe(8_000_000, 10_000_000), "atencion");
    assert.equal(estadoDe(7_999_999, 10_000_000), "en_rango");
    assert.equal(estadoDe(10_000_000, 10_000_000), "excedido");
    assert.equal(estadoDe(1, null), "sin_presupuesto");
    assert.equal(estadoDe(1, 0), "excedido");
  });

  it("suma nómina prorrateada, pagos del área y obligaciones del mes", () => {
    const resultado = calcularPresupuestos({
      hoy: "2026-11-06",
      areas: [
        { id: "ventas", nombre: "Ventas", presupuestoCentavos: 10_000_000 },
        { id: "planta", nombre: "Planta", presupuestoCentavos: 5_000_000 },
        { id: "sin", nombre: "Sin tope", presupuestoCentavos: null },
      ],
      nomina: [
        { areaId: "ventas", netoCentavos: 3_000_000, frecuencia: "quincenal" },
        // 10,000 semanales: 10,000 × 52 / 12 = 43,333.33
        { areaId: "planta", netoCentavos: 1_000_000, frecuencia: "semanal" },
      ],
      pagosPorArea: [{ areaId: "ventas", centavos: 2_000_000 }],
      obligaciones: [
        { areaId: "planta", montoCentavos: 666_667, frecuencia: "mensual", proximaFecha: "2026-10-17", anclaDia: 17 },
        // Trimestral que no cae en noviembre.
        { areaId: "planta", montoCentavos: 9_999_999, frecuencia: "trimestral", proximaFecha: "2026-12-01", anclaDia: 1 },
      ],
      personas: [{ id: "ana", nombre: "Ana", areaNombre: "Ventas", presupuestoCentavos: 100_000, pagosCentavos: 0 }],
    });
    assert.deepEqual(resultado.mes, { desde: "2026-11-01", hasta: "2026-11-30" });
    const ventas = resultado.areas.find((area) => area.id === "ventas");
    const planta = resultado.areas.find((area) => area.id === "planta");
    assert.equal(ventas?.gastoCentavos, 8_000_000);
    assert.equal(ventas?.estado, "atencion");
    assert.deepEqual(planta?.desglose, { nominaCentavos: 4_333_333, proveedoresCentavos: 0, obligacionesCentavos: 666_667 });
    assert.equal(planta?.gastoCentavos, 5_000_000);
    assert.equal(planta?.estado, "excedido");
    assert.equal(resultado.areas.find((area) => area.id === "sin")?.estado, "sin_presupuesto");
    assert.deepEqual(resultado.alertas.map((linea) => [linea.nombre, linea.estado]), [["Planta", "excedido"], ["Ventas", "atencion"]]);
  });
});
