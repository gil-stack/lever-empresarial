import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { siguientePago } from "../nomina.ts";
import { hoyEnMexico } from "../personas.ts";
import { siguienteDia17 } from "./entradas.ts";
import { adelantarObligacion, adelantarQuincenal, fechasDeSerie, lunesDe, siguienteObligacion } from "./fechas.ts";
import { calcularPresupuestos, estadoDe } from "./presupuestos.ts";
import { escenarioValido, proyectar, restantesDeObligacion, textoAlcance, ventanaDe, type FuentesFlujo } from "./proyeccion.ts";

/** Reloj fijo: viernes 6 de noviembre de 2026 en México. La ventana cruza el cambio de año. */
const HOY = "2026-11-06";

/** Programado el día del saldo (5 de noviembre) y sin autorizar. */
const FLETES_DEL_5 = { id: "p3", proveedor: "Fletes", referencia: "C-3", totalCentavos: 900_000, programadaEl: "2026-11-05", estado: "por_autorizar" as const };

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
      { id: "p1", proveedor: "Aceros", referencia: "A-1", totalCentavos: 5_000_000, programadaEl: "2026-11-10", estado: "listo_para_pagar" },
      { id: "p2", proveedor: "Papelería", referencia: "B-2", totalCentavos: 3_000_000, programadaEl: "2026-11-20", estado: "por_autorizar" },
    ],
    obligaciones: [
      { id: "renta", concepto: "Renta", montoCentavos: 2_500_000, frecuencia: "mensual", proximaFecha: "2026-11-01", anclaDia: 1 },
    ],
    cobros: [
      { id: "k1", cliente: "Cliente Uno", concepto: "Servicio", montoCentavos: 8_000_000, fechaProbable: "2026-11-25" },
      // Vencido: su fecha ya pasó, no se proyecta.
      { id: "k2", cliente: "Cliente Dos", concepto: "Anticipo", montoCentavos: 4_000_000, fechaProbable: "2026-11-03" },
    ],
    cobrados: [],
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
    // El cobro vencido no cuenta.
    const claves = p.semanas.flatMap((semana) => semana.movimientos.map((m) => m.clave));
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
    const p = proyectar(fuentes({ saldo: null, pagos: [...fuentes().pagos, FLETES_DEL_5] }));
    assert.equal(p.corte, "2026-11-01");
    assert.equal(p.semanas.every((semana) => semana.saldoFinal === null), true);
    assert.deepEqual(p.alcance, { tipo: "sin_saldo" });
    assert.equal(p.faltante, null);
    // Sin saldo, cuenta desde el lunes: el pago del 5 entra en su semana, sin marca de atrasado.
    assert.equal(p.semanas[0]?.salidas, 900_000);
    assert.deepEqual(p.atrasados, []);
  });

  it("hasta el corte, un cargo autorizado ya está pagado en el saldo; uno sin autorizar va vencido en la primera semana", () => {
    const viejo = { id: "p0", proveedor: "Aceros", referencia: "A-0", totalCentavos: 400_000, programadaEl: "2026-09-15", estado: "sin_solicitud" as const };
    const autorizado = { id: "p4", proveedor: "Aceros", referencia: "A-4", totalCentavos: 700_000, programadaEl: "2026-11-05", estado: "listo_para_pagar" as const };
    const p = proyectar(fuentes({ pagos: [...fuentes().pagos, FLETES_DEL_5, viejo, autorizado] }));
    assert.deepEqual(p.atrasados.map((m) => m.clave).sort(), ["cxp:p0", "cxp:p3"]);
    assert.equal(p.semanas[0]?.salidas, 1_300_000);
    assert.equal(p.semanas[0]?.saldoFinal, 8_700_000);
    assert.equal(p.semanas[0]?.movimientos.every((m) => m.atrasado && m.sinAutorizar), true);
    // El autorizado del día del saldo no está en ninguna semana.
    assert.equal(p.semanas.some((semana) => semana.movimientos.some((m) => m.clave === "cxp:p4")), false);
  });

  it("20 cargos autorizados viejos no cuentan; el único sin autorizar es todo lo de la primera semana", () => {
    const autorizados = Array.from({ length: 20 }, (_, i) => ({
      id: `a${i}`,
      proveedor: "Aceros",
      referencia: `A-${i}`,
      totalCentavos: 1_000_000,
      programadaEl: i % 2 === 0 ? "2026-10-15" : "2026-11-05",
      estado: "listo_para_pagar" as const,
    }));
    const porAutorizar = { id: "x1", proveedor: "Papelería", referencia: "B-9", totalCentavos: 250_000, programadaEl: "2026-10-20", estado: "por_autorizar" as const };
    const p = proyectar(fuentes({ nomina: [], obligaciones: [], cobros: [], pagos: [...autorizados, porAutorizar] }));
    assert.deepEqual(p.semanas[0]?.movimientos.map((m) => [m.clave, m.atrasado, m.sinAutorizar]), [["cxp:x1", true, true]]);
    assert.deepEqual(p.atrasados.map((m) => m.clave), ["cxp:x1"]);
    assert.equal(p.semanas[0]?.salidas, 250_000);
    assert.equal(p.semanas[12]?.saldoFinal, 9_750_000);
    assert.equal(p.salidas, 250_000);
    // Con saldo, el correo y la tarjeta no dicen «No alcanza» por los autorizados viejos (sumados darían -$100,000).
    assert.equal(p.faltante, null);
    assert.notEqual(textoAlcance(p), "No alcanza esta semana");
  });

  it("un vencido sin autorizar se mueve en el escenario: pierde la marca de atrasado y va a su fecha nueva", () => {
    const viejo = { id: "p0", proveedor: "Aceros", referencia: "A-0", totalCentavos: 400_000, programadaEl: "2026-09-15", estado: "por_autorizar" as const };
    const base = fuentes({ pagos: [...fuentes().pagos, viejo] });
    const real = proyectar(base);
    assert.equal(real.movibles.some((m) => m.clave === "cxp:p0"), true);
    assert.equal(real.semanas[0]?.salidas, 400_000);
    const escenario = escenarioValido(real, "cxp:p0", "2026-11-17");
    assert.deepEqual(escenario, { clave: "cxp:p0", fecha: "2026-11-17" });
    const movida = proyectar(base, escenario);
    assert.equal(movida.semanas[0]?.salidas, 0);
    assert.deepEqual(movida.atrasados, []);
    const movido = movida.semanas[2]?.movimientos.find((m) => m.clave === "cxp:p0");
    assert.equal(movido?.fecha, "2026-11-17");
    assert.equal(movido?.fechaOriginal, "2026-09-15");
    assert.equal(movido?.atrasado, undefined);
    assert.equal(movida.semanas[2]?.salidas, 3_400_000);
    // La proyección real no cambió.
    assert.equal(proyectar(base).semanas[0]?.salidas, 400_000);
  });

  it("la sonda del revisor: con el saldo declarado hoy, el cargo del 5 sin autorizar no desaparece; el autorizado ya está en el saldo", () => {
    const conPago = (estado: "por_autorizar" | "listo_para_pagar") =>
      proyectar({
        ...fuentes({ hoy: "2026-11-07", nomina: [], obligaciones: [], cobros: [] }),
        saldo: { centavos: 10_000_000, alDia: "2026-11-07", autor: "x", declaradoEn: "2026-11-07T18:00:00Z" },
        pagos: [{ id: "p1", proveedor: "Aceros", referencia: "A-1", totalCentavos: 8_000_000, programadaEl: "2026-11-05", estado }],
      });
    assert.equal(conPago("por_autorizar").semanas[0]?.salidas, 8_000_000);
    assert.equal(conPago("por_autorizar").semanas[12]?.saldoFinal, 2_000_000);
    assert.equal(conPago("listo_para_pagar").semanas[0]?.salidas, 0);
    assert.equal(conPago("listo_para_pagar").semanas[12]?.saldoFinal, 10_000_000);
  });

  it("lo cobrado después del saldo entra en la semana en que llegó; lo cobrado antes ya está en el saldo", () => {
    const p = proyectar(fuentes({
      cobrados: [
        { id: "k5", cliente: "Cliente Cinco", concepto: "Pago", montoCentavos: 1_000_000, cobradoEl: "2026-11-06" },
        { id: "k6", cliente: "Cliente Seis", concepto: "Pago", montoCentavos: 2_000_000, cobradoEl: "2026-11-05" },
      ],
    }));
    assert.equal(p.semanas[0]?.entradas, 1_000_000);
    const k5 = p.semanas[0]?.movimientos.find((m) => m.clave === "cob:k5");
    assert.equal(k5?.cobrado, true);
    assert.equal(k5?.atrasado, undefined);
    assert.equal(p.semanas.some((semana) => semana.movimientos.some((m) => m.clave === "cob:k6")), false);
    // Con un saldo viejo, lo cobrado entre el saldo y esta semana va a la primera semana, sin marca de atrasado.
    const viejo = proyectar(fuentes({
      saldo: { centavos: 10_000_000, alDia: "2026-10-28", autor: "Laura", declaradoEn: "2026-10-28T20:00:00.000Z" },
      cobrados: [{ id: "k7", cliente: "Cliente Siete", concepto: "Pago", montoCentavos: 300_000, cobradoEl: "2026-10-30" }],
      cobros: [],
      nomina: [],
      pagos: [],
      obligaciones: [],
    }));
    assert.equal(viejo.semanas[0]?.entradas, 300_000);
    assert.deepEqual(viejo.atrasados, []);
  });

  it("la sonda del revisor: marcar cobrado un cobro esperado no baja el saldo proyectado", () => {
    const saldo = { centavos: 10_000_000, alDia: "2026-11-02", autor: "x", declaradoEn: "2026-11-02T18:00:00Z" };
    const vacias = { nomina: [], pagos: [], obligaciones: [], hoy: "2026-11-07" };
    const esperado = proyectar(fuentes({ ...vacias, saldo, cobros: [{ id: "k", cliente: "C", concepto: "S", montoCentavos: 5_000_000, fechaProbable: "2026-11-10" }] }));
    const cobrado = proyectar(fuentes({ ...vacias, saldo, cobros: [], cobrados: [{ id: "k", cliente: "C", concepto: "S", montoCentavos: 5_000_000, cobradoEl: "2026-11-05" }] }));
    assert.equal(esperado.semanas[12]?.saldoFinal, 15_000_000);
    assert.equal(cobrado.semanas[12]?.saldoFinal, 15_000_000);
  });

  it("con un saldo viejo, una salida posterior al saldo y anterior a esta semana entra atrasada en la primera", () => {
    const p = proyectar(fuentes({
      saldo: { centavos: 10_000_000, alDia: "2026-10-28", autor: "Laura", declaradoEn: "2026-10-28T20:00:00.000Z" },
      // Autorizado pero posterior al saldo: el saldo no lo descontó, así que sí cuenta.
      pagos: [{ id: "viejo", proveedor: "Aceros", referencia: "A-0", totalCentavos: 700_000, programadaEl: "2026-10-30", estado: "listo_para_pagar" }],
      cobros: [{ id: "tarde", cliente: "Cliente", concepto: "Tarde", montoCentavos: 999_999, fechaProbable: "2026-10-30" }],
      nomina: [],
      obligaciones: [],
    }));
    assert.deepEqual(p.atrasados.map((m) => m.clave), ["cxp:viejo"]);
    assert.equal(p.atrasados[0]?.sinAutorizar, undefined);
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
    // Ni fuera de la ventana: el pago desaparecería de la proyección (sonda del revisor).
    assert.equal(real.fin, "2027-01-31");
    assert.deepEqual(escenarioValido(real, "cxp:p1", "2027-01-31"), { clave: "cxp:p1", fecha: "2027-01-31" });
    assert.equal(escenarioValido(real, "cxp:p1", "2027-02-01"), null);
    assert.equal(escenarioValido(real, "cxp:p1", "2027-03-15"), null);
    assert.equal(escenarioValido(real, "nom:2026-11-15", "2026-11-20"), null);
    assert.equal(escenarioValido(real, "cxp:otro", "2026-11-20"), null);
    assert.equal(escenarioValido(real, "cxp:p1", "2026-02-30"), null);
  });

  it("una obligación con su proveedor cuenta solo lo que falta después de las facturas vivas del mes", () => {
    const renta = { id: "renta", concepto: "Renta", montoCentavos: 3_000_000, frecuencia: "mensual" as const, proximaFecha: "2026-11-01", anclaDia: 1 };
    const obligaciones = (p: ReturnType<typeof proyectar>) =>
      p.semanas.flatMap((s) => s.movimientos).filter((m) => m.tipo === "obligacion").map((m) => [m.fecha, m.centavos, m.concepto, m.facturadoCentavos]);
    const sin = proyectar(fuentes({ obligaciones: [renta] }));
    assert.deepEqual(obligaciones(sin), [
      ["2026-12-01", 3_000_000, "Renta", undefined],
      ["2027-01-01", 3_000_000, "Renta", undefined],
    ]);
    // Una factura de $500 en diciembre: la renta de diciembre cuenta $29,500.
    const parcial = proyectar(fuentes({ obligaciones: [{ ...renta, cargosPorMes: { "2026-12": 50_000 } }] }));
    assert.deepEqual(obligaciones(parcial), [
      ["2026-12-01", 2_950_000, "Renta: $29,500.00 restantes (ya hay factura por $500.00)", 50_000],
      ["2027-01-01", 3_000_000, "Renta", undefined],
    ]);
    assert.equal(sin.salidas - parcial.salidas, 50_000);
    // La factura por el monto completo (o más): ese mes no se cuenta otra vez.
    const completa = proyectar(fuentes({ obligaciones: [{ ...renta, cargosPorMes: { "2026-12": 3_000_000 } }] }));
    assert.deepEqual(obligaciones(completa), [["2027-01-01", 3_000_000, "Renta", undefined]]);
    assert.equal(sin.salidas - completa.salidas, 3_000_000);
    const demasiado = proyectar(fuentes({ obligaciones: [{ ...renta, cargosPorMes: { "2026-12": 4_000_000 } }] }));
    assert.equal(demasiado.salidas, completa.salidas);
  });

  it("las facturas del mes se reparten entre las fechas de una obligación semanal sin contarse dos veces", () => {
    const fechas = ["2026-12-07", "2026-12-14", "2026-12-21", "2027-01-04"];
    assert.deepEqual(restantesDeObligacion(fechas, 100_000, { "2026-12": 150_000 }), [
      { fecha: "2026-12-07", centavos: 0, facturadoCentavos: 100_000 },
      { fecha: "2026-12-14", centavos: 50_000, facturadoCentavos: 50_000 },
      { fecha: "2026-12-21", centavos: 100_000, facturadoCentavos: 0 },
      { fecha: "2027-01-04", centavos: 100_000, facturadoCentavos: 0 },
    ]);
    assert.deepEqual(restantesDeObligacion(["2026-12-07"], 100_000), [{ fecha: "2026-12-07", centavos: 100_000, facturadoCentavos: 0 }]);
  });

  it("sin permiso de detalle, el neto de una sola persona no se desglosa: la semana junta su nómina en «Nómina»", () => {
    const nomina = [
      // Dos personas el 15 y una sola el 13 (semanal): la del 13 es el sueldo de alguien.
      { netoCentavos: 1_500_000, frecuencia: "quincenal" as const, proximoPagoEn: "2026-11-15", anclaDia: 15, altaEn: "2026-01-01", bajaEn: null },
      { netoCentavos: 1_000_000, frecuencia: "quincenal" as const, proximoPagoEn: "2026-11-15", anclaDia: 15, altaEn: "2026-01-01", bajaEn: null },
      { netoCentavos: 700_000, frecuencia: "semanal" as const, proximoPagoEn: "2026-11-13", anclaDia: 13, altaEn: "2026-01-01", bajaEn: null },
    ];
    const base = fuentes({ nomina, pagos: [], obligaciones: [], cobros: [] });
    const conDetalle = proyectar(base, null, { detalleNomina: true });
    const sinDetalle = proyectar(base);
    const semana = (p: ReturnType<typeof proyectar>) => p.semanas[1]!.movimientos.filter((m) => m.tipo === "nomina");
    assert.deepEqual(semana(conDetalle).map((m) => [m.concepto, m.centavos]), [
      ["Nómina semanal (1 persona)", 700_000],
      ["Nómina quincenal (2 personas)", 2_500_000],
    ]);
    assert.deepEqual(semana(sinDetalle).map((m) => [m.concepto, m.centavos]), [["Nómina", 3_200_000]]);
    // El total de la semana y el saldo no cambian.
    assert.equal(sinDetalle.semanas[1]?.salidas, conDetalle.semanas[1]?.salidas);
    assert.equal(sinDetalle.semanas[12]?.saldoFinal, conDetalle.semanas[12]?.saldoFinal);
    // Ninguna semana deja ver «(1 persona)».
    assert.equal(JSON.stringify(sinDetalle).includes("1 persona"), false);
    // Una semana donde todos los pagos son de grupos de 2 o más se ve igual.
    const soloGrupos = proyectar(fuentes({ nomina: nomina.slice(0, 2), pagos: [], obligaciones: [], cobros: [] }));
    assert.equal(soloGrupos.semanas[1]?.movimientos.find((m) => m.tipo === "nomina")?.concepto, "Nómina quincenal (2 personas)");
  });

  it("una obligación o una nómina con base de hace años no pierde ocurrencias (sonda del revisor)", () => {
    // Antes: 600 vueltas desde 2014 se acababan antes de llegar a la ventana y daban 0.
    const vigilancia = { id: "o", concepto: "Vigilancia", montoCentavos: 100_000, frecuencia: "semanal" as const, proximaFecha: "2014-01-06", anclaDia: 6 };
    const p = proyectar(fuentes({ nomina: [], pagos: [], cobros: [], obligaciones: [vigilancia] }));
    const fechas = p.semanas.flatMap((s) => s.movimientos).filter((m) => m.tipo === "obligacion").map((m) => m.fecha);
    // Los lunes del 9 de noviembre al 25 de enero: el del 2 ya está dentro del saldo del 5.
    assert.equal(fechas.length, 12);
    assert.equal(fechas[0], "2026-11-09");
    assert.equal(fechas.every((f) => new Date(`${f}T00:00:00Z`).getUTCDay() === 1), true);
    // Mensual con ancla 31 desde 2010: cae en el último día de cada mes.
    const fin = proyectar(fuentes({ nomina: [], pagos: [], cobros: [], obligaciones: [{ ...vigilancia, frecuencia: "mensual", proximaFecha: "2010-01-31", anclaDia: 31 }] }));
    assert.deepEqual(fin.semanas.flatMap((s) => s.movimientos).map((m) => m.fecha), ["2026-11-30", "2026-12-31", "2027-01-31"]);
    // El salto cae en la serie: es la misma fecha que se obtiene recorriéndola una por una.
    assert.equal(adelantarObligacion("2026-01-31", "2026-06-10", "mensual", 31), "2026-05-31");
    assert.equal(adelantarQuincenal("2024-02-29", "2026-11-02"), "2026-10-15");
    // Nómina semanal sin avanzar desde 2015: sigue contando cada semana de la ventana.
    const nomina = proyectar(fuentes({
      nomina: [{ netoCentavos: 500_000, frecuencia: "semanal", proximoPagoEn: "2015-01-02", anclaDia: 2, altaEn: "2015-01-01", bajaEn: null }],
      pagos: [], cobros: [], obligaciones: [],
    }));
    assert.equal(nomina.salidas, 13 * 500_000);
  });

  it("la quincena del 31 de diciembre sigue el 15 de enero y la proyección cruza el año", () => {
    assert.equal(siguientePago("2026-12-31", "quincenal"), "2027-01-15");
    assert.equal(siguientePago("2027-01-15", "quincenal"), "2027-01-31");
    const p = proyectar(fuentes({
      hoy: "2026-12-21",
      saldo: { centavos: 10_000_000, alDia: "2026-12-20", autor: "Laura", declaradoEn: "2026-12-20T20:00:00.000Z" },
      nomina: [{ netoCentavos: 1_000_000, frecuencia: "quincenal", proximoPagoEn: "2026-12-31", anclaDia: 15, altaEn: "2026-01-01", bajaEn: null }],
      pagos: [], cobros: [], obligaciones: [],
    }));
    const fechas = p.semanas.flatMap((s) => s.movimientos).map((m) => m.fecha);
    assert.deepEqual(fechas.slice(0, 3), ["2026-12-31", "2027-01-15", "2027-01-31"]);
    // El 31 de diciembre (jueves) cae en la semana del 28; el 15 de enero (viernes), en la del 11.
    assert.equal(p.semanas.find((s) => s.inicio === "2026-12-28")?.salidas, 1_000_000);
    assert.equal(p.semanas.find((s) => s.inicio === "2027-01-11")?.salidas, 1_000_000);
  });

  it("la plantilla de impuestos toma el siguiente día 17, incluido el 17 mismo y el cambio de año", () => {
    assert.equal(siguienteDia17("2026-12-17"), "2026-12-17");
    assert.equal(siguienteDia17("2026-12-18"), "2027-01-17");
    assert.equal(siguienteDia17("2026-12-31"), "2027-01-17");
    assert.equal(siguienteDia17("2027-01-16"), "2027-01-17");
    assert.equal(siguienteDia17("2027-01-17"), "2027-01-17");
    assert.equal(siguienteDia17("2027-02-01"), "2027-02-17");
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
    assert.deepEqual(planta?.desglose, { nominaCentavos: 4_333_333, nominaPersonas: 1, proveedoresCentavos: 0, obligacionesCentavos: 666_667 });
    assert.equal(planta?.gastoCentavos, 5_000_000);
    assert.equal(planta?.estado, "excedido");
    assert.equal(resultado.areas.find((area) => area.id === "sin")?.estado, "sin_presupuesto");
    assert.deepEqual(resultado.alertas.map((linea) => [linea.nombre, linea.estado]), [["Planta", "excedido"], ["Ventas", "atencion"]]);
  });

  it("la obligación cuyo proveedor ya trae cargo en el mes suma al área solo lo que falta", () => {
    const base = {
      hoy: "2026-11-06",
      areas: [{ id: "planta", nombre: "Planta", presupuestoCentavos: 5_000_000 }],
      nomina: [],
      pagosPorArea: [{ areaId: "planta", centavos: 3_000_000 }],
      personas: [],
    };
    const renta = { areaId: "planta", montoCentavos: 3_000_000, frecuencia: "mensual" as const, proximaFecha: "2026-11-15", anclaDia: 15 };
    assert.equal(calcularPresupuestos({ ...base, obligaciones: [renta] }).areas[0]?.gastoCentavos, 6_000_000);
    // Factura completa: la obligación ya está en lo pagado al proveedor.
    assert.equal(calcularPresupuestos({ ...base, obligaciones: [{ ...renta, cargosPorMes: { "2026-11": 3_000_000 } }] }).areas[0]?.gastoCentavos, 3_000_000);
    // Factura de $500: faltan $29,500 de la renta.
    assert.equal(calcularPresupuestos({ ...base, obligaciones: [{ ...renta, cargosPorMes: { "2026-11": 50_000 } }] }).areas[0]?.gastoCentavos, 5_950_000);
  });
});
