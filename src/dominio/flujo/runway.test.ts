import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { desplazar, diasEntre, lunesDe } from "./fechas.ts";
import { proyectar, type EstadoPagoFlujo, type FuentesFlujo } from "./proyeccion.ts";
import {
  calcularRunway,
  entradasEstimadas,
  estadoMostrado,
  fotosDeEjemplo,
  horizonteDe,
  mesesDeSemanas,
  runwayBajo,
  semanasDe,
  textoAlcanceConRunway,
  textoRunway,
  transicion,
  type AlcanceRunway,
  type PlanFuente,
} from "./runway.ts";

/** El ejemplo del RFC: lunes 4 de enero de 2027. */
const HOY = "2027-01-04";

function base(cambios: Partial<FuentesFlujo> = {}): FuentesFlujo {
  return {
    hoy: HOY,
    saldo: { centavos: 30_000_000, alDia: "2027-01-03", autor: "Laura Méndez", declaradoEn: "2027-01-04T01:00:00.000Z" },
    colchonCentavos: 0,
    nomina: [
      { netoCentavos: 4_000_000, frecuencia: "mensual", proximoPagoEn: "2027-01-05", anclaDia: 5, altaEn: "2026-01-01", bajaEn: null },
      { netoCentavos: 4_000_000, frecuencia: "mensual", proximoPagoEn: "2027-01-05", anclaDia: 5, altaEn: "2026-01-01", bajaEn: null },
    ],
    lotes: [],
    pagos: [],
    obligaciones: [{ id: "renta", concepto: "Renta", montoCentavos: 2_000_000, frecuencia: "mensual", proximaFecha: "2027-01-05", anclaDia: 5 }],
    cobros: [{ id: "k1", cliente: "Cliente Uno", concepto: "Proyecto", montoCentavos: 5_000_000, fechaProbable: "2027-01-20" }],
    cobrados: [],
    ...cambios,
  };
}

function plan(cambios: Partial<PlanFuente> = {}): PlanFuente {
  return {
    id: "plan-fijo",
    cliente: "Distribuidora Norte",
    concepto: "Mantenimiento",
    tipo: "fijo",
    montoCentavos: 6_000_000,
    periodicidad: "mensual",
    primerVencimiento: "2027-01-10",
    fin: null,
    siguiente: 0,
    porEmitir: [],
    ultimosMontos: [],
    ...cambios,
  };
}

/** Para comparar: semanas hasta agotarse; el horizonte completo si alcanza 12 meses. */
function rango(alcance: AlcanceRunway, horizonte: number): number {
  if (alcance.tipo === "sin_saldo") throw new Error("sin saldo");
  return alcance.tipo === "agota" ? alcance.semanas : horizonte;
}

describe("horizonte de 12 meses en semanas de lunes a domingo", () => {
  it("cubre al menos hasta hoy + 12 meses y empieza el lunes de esta semana", () => {
    for (const hoy of ["2027-01-04", "2027-01-10", "2028-02-29", "2026-11-10", "2026-12-31"]) {
      const h = horizonteDe(hoy);
      assert.equal(h.inicio, lunesDe(hoy));
      assert.ok(h.fin >= h.limite, `${hoy}: ${h.fin} < ${h.limite}`);
      assert.ok(desplazar(h.fin, -7) < h.limite, `${hoy}: sobra una semana`);
      assert.ok(h.semanas >= 53 && h.semanas <= 54, `${hoy}: ${h.semanas}`);
    }
    // Bisiesto: 29 feb + 12 meses = 28 feb.
    assert.equal(horizonteDe("2028-02-29").limite, "2029-02-28");
  });
});

describe("el ejemplo del RFC", () => {
  const runway = calcularRunway(base(), [plan()], { detalleNomina: true });

  it("conservador: sin la entrada estimada, la semana del 5 de abril cierra negativa → 2.9 meses", () => {
    assert.deepEqual(runway.conservador, { tipo: "agota", semanas: 13, meses: 2.9, hasta: "2027-04-04" });
    assert.equal(runway.semanas[13]!.conservador, -5_000_000);
    assert.equal(textoRunway(runway.conservador), "2.9 meses (alcanza hasta el 4 de abril de 2027)");
  });

  it("esperado: con el plan fijo cada día 10, la semana del 2 de agosto cierra negativa → 6.8 meses", () => {
    assert.deepEqual(runway.esperado, { tipo: "agota", semanas: 30, meses: 6.8, hasta: "2027-08-01" });
    assert.equal(runway.semanas[30]!.esperado, -3_000_000);
  });

  it("con mínimo de 3 meses avisa por el conservador aunque el esperado alcance más", () => {
    assert.equal(runwayBajo(runway.conservador, 3), true);
    assert.equal(runwayBajo(runway.esperado, 3), false);
  });

  it("los 12 meses calendario cuadran con el saldo y separan lo estimado", () => {
    assert.equal(runway.meses.length, 12);
    const enero = runway.meses[0]!;
    assert.equal(enero.mes, "2027-01-01");
    assert.equal(enero.salidas, 10_000_000);
    assert.equal(enero.entradas, 5_000_000);
    assert.equal(enero.estimadas, 6_000_000);
    assert.equal(enero.cierre, 25_000_000);
    assert.equal(enero.cierreEsperado, 31_000_000);
    const diciembre = runway.meses[11]!;
    assert.equal(diciembre.mes, "2027-12-01");
    assert.equal(diciembre.cierre, 30_000_000 + 5_000_000 - 12 * 10_000_000);
    assert.equal(diciembre.cierreEsperado, 30_000_000 + 5_000_000 - 12 * 10_000_000 + 12 * 6_000_000);
  });

  it("el resumen dice qué cuenta en los 12 meses, por tipo", () => {
    const porTipo = Object.fromEntries(runway.resumen.map((l) => [l.tipo, l]));
    // Del 5 de enero de 2027 al 4 de enero de 2028: 12 nóminas, 12 rentas, 12 periodos del plan.
    assert.equal(porTipo.nomina?.movimientos, 12);
    assert.equal(porTipo.nomina?.centavos, 96_000_000);
    assert.equal(porTipo.obligacion?.centavos, 24_000_000);
    assert.equal(porTipo.cobro?.centavos, 5_000_000);
    assert.equal(porTipo.plan_fijo?.centavos, 72_000_000);
    assert.equal(porTipo.plan_fijo?.estimado, true);
    assert.equal(porTipo.cobro?.estimado, false);
  });
});

describe("la tabla «Mes por mes» y el resumen cubren el mismo periodo (r64-N2)", () => {
  it("lo del 1 al 10 del mes 13 no entra a ninguno: las sumas de la tabla y del resumen cuadran", () => {
    // Martes 10 de noviembre de 2026: la tabla va de noviembre de 2026 a octubre de 2027. Una renta cada día 5 y un
    // seguro anual el 5 de noviembre de 2027 (dentro de hoy + 12 meses, fuera del último mes de la tabla).
    const fuentes = base({
      hoy: "2026-11-10",
      saldo: { centavos: 100_000_000, alDia: "2026-11-09", autor: "Laura Méndez", declaradoEn: "2026-11-10T01:00:00.000Z" },
      nomina: [],
      obligaciones: [
        { id: "renta", concepto: "Renta", montoCentavos: 2_000_000, frecuencia: "mensual", proximaFecha: "2026-12-05", anclaDia: 5 },
        { id: "seguro", concepto: "Seguro", montoCentavos: 1_200_000, frecuencia: "anual", proximaFecha: "2027-11-05", anclaDia: 5 },
      ],
      cobros: [{ id: "k1", cliente: "Cliente Uno", concepto: "Proyecto", montoCentavos: 5_000_000, fechaProbable: "2026-11-20" }],
    });
    const runway = calcularRunway(fuentes, [plan({ primerVencimiento: "2026-11-15" })], { detalleNomina: true });
    assert.equal(runway.meses[0]!.mes, "2026-11-01");
    assert.equal(runway.meses.at(-1)!.mes, "2027-10-01");
    const suma = (tipos: string[]) => runway.resumen.filter((l) => tipos.includes(l.tipo)).reduce((s, l) => s + l.centavos, 0);
    const tabla = (campo: "salidas" | "entradas" | "estimadas") => runway.meses.reduce((s, m) => s + m[campo], 0);
    assert.equal(suma(["nomina", "proveedor", "obligacion"]), tabla("salidas"));
    assert.equal(suma(["cobro", "cobrado"]), tabla("entradas"));
    assert.equal(suma(["plan_fijo", "plan_variable"]), tabla("estimadas"));
    // 11 rentas (diciembre a octubre) y ningún seguro.
    assert.equal(tabla("salidas"), 11 * 2_000_000);
    assert.equal(runway.resumen.find((l) => l.tipo === "obligacion")?.movimientos, 11);
  });
});

describe("nómina de una sola persona en «Mes por mes» (r64-N3)", () => {
  const unaPersona = base({ nomina: [{ netoCentavos: 4_000_000, frecuencia: "mensual", proximoPagoEn: "2027-01-05", anclaDia: 5, altaEn: "2026-01-01", bajaEn: null }] });

  it("sin el detalle de nómina, cada mes con su pago dice reservado y el total del mes se sigue viendo", () => {
    const runway = calcularRunway(unaPersona, [], { detalleNomina: false });
    assert.deepEqual(runway.meses.map((m) => m.nominaReservada), Array.from({ length: 12 }, () => true));
    assert.equal(runway.meses[0]!.salidas, 4_000_000 + 2_000_000);
    assert.equal(runway.resumen.find((l) => l.tipo === "nomina")?.reservado, true);
  });

  it("con el detalle, o con dos personas, ningún mes dice reservado", () => {
    assert.ok(calcularRunway(unaPersona, [], { detalleNomina: true }).meses.every((m) => !m.nominaReservada));
    assert.ok(calcularRunway(base(), [], { detalleNomina: false }).meses.every((m) => !m.nominaReservada));
  });
});

describe("conservador = proyección de Inicio en las primeras 13 semanas", () => {
  it("coincide semana por semana con proyectar en 300 casos al azar", () => {
    const azar = generador(20261110);
    for (let caso = 0; caso < 300; caso += 1) {
      const fuentes = fuentesAlAzar(azar);
      const proyeccion = proyectar(fuentes, null, { detalleNomina: true });
      const runway = calcularRunway(fuentes, planesAlAzar(azar, fuentes.hoy), { detalleNomina: true });
      for (let k = 0; k < 13; k += 1) {
        assert.equal(runway.semanas[k]!.conservador, proyeccion.semanas[k]!.saldoFinal, `caso ${caso}, semana ${k}`);
        assert.equal(runway.semanas[k]!.inicio, proyeccion.semanas[k]!.inicio);
      }
      // Si Inicio dice que se agota en k semanas, el conservador también.
      if (proyeccion.alcance.tipo === "semanas") {
        const r = runway.conservador;
        assert.equal(r.tipo, "agota", `caso ${caso}`);
        if (r.tipo === "agota") assert.equal(r.semanas, proyeccion.alcance.semanas, `caso ${caso}`);
      }
    }
  });
});

describe("propiedades", () => {
  it("agregar solo una salida nunca sube ninguno de los dos runways", () => {
    const azar = generador(7);
    for (let caso = 0; caso < 300; caso += 1) {
      const fuentes = fuentesAlAzar(azar, true);
      const planes = planesAlAzar(azar, fuentes.hoy);
      const antes = calcularRunway(fuentes, planes);
      const pago = {
        id: `extra-${caso}`,
        proveedor: "Extra",
        referencia: "X",
        totalCentavos: entero(azar, 1, 50_000_000),
        programadaEl: desplazar(fuentes.hoy, entero(azar, -20, 380)),
        estado: (["por_autorizar", "listo_para_pagar", "sin_solicitud"] as const)[entero(azar, 0, 2)]!,
      };
      const despues = calcularRunway({ ...fuentes, pagos: [...fuentes.pagos, pago] }, planes);
      const k = antes.horizonte.semanas;
      assert.ok(rango(despues.conservador, k) <= rango(antes.conservador, k), `caso ${caso} conservador`);
      assert.ok(rango(despues.esperado, k) <= rango(antes.esperado, k), `caso ${caso} esperado`);
    }
  });

  it("agregar una entrada estimada nunca cambia el conservador, y el esperado nunca queda abajo del conservador", () => {
    const azar = generador(11);
    for (let caso = 0; caso < 300; caso += 1) {
      const fuentes = fuentesAlAzar(azar, true);
      const planes = planesAlAzar(azar, fuentes.hoy);
      const antes = calcularRunway(fuentes, planes);
      const despues = calcularRunway(fuentes, [...planes, ...planesAlAzar(azar, fuentes.hoy, `extra${caso}`)]);
      assert.deepEqual(despues.conservador, antes.conservador, `caso ${caso}`);
      assert.deepEqual(
        despues.semanas.map((s) => s.conservador),
        antes.semanas.map((s) => s.conservador),
        `caso ${caso}`,
      );
      const k = despues.horizonte.semanas;
      assert.ok(rango(despues.esperado, k) >= rango(despues.conservador, k), `caso ${caso}`);
      assert.ok(rango(despues.esperado, k) >= rango(antes.esperado, k), `caso ${caso}: una entrada bajó el esperado`);
    }
  });
});

describe("planes de cobranza estimados", () => {
  it("un plan fijo cuenta desde el siguiente periodo sin cargo y hasta su fin", () => {
    const { movimientos, incluidos } = entradasEstimadas([plan({ siguiente: 2, fin: "2027-06-30" })], HOY, "2028-01-09");
    assert.deepEqual(
      movimientos.map((m) => m.fecha),
      ["2027-03-10", "2027-04-10", "2027-05-10", "2027-06-10"],
    );
    assert.equal(incluidos[0]?.periodos, 4);
  });

  it("un periodo vencido que nunca se generó no se proyecta", () => {
    const { movimientos } = entradasEstimadas([plan({ primerVencimiento: "2026-12-10" })], HOY, "2027-02-28");
    assert.deepEqual(movimientos.map((m) => m.fecha), ["2027-01-10", "2027-02-10"]);
  });

  it("fin de mes: ancla 31 cae en el último día de los meses cortos y vuelve al 31", () => {
    const { movimientos } = entradasEstimadas([plan({ primerVencimiento: "2027-01-31" })], HOY, "2027-05-31");
    assert.deepEqual(movimientos.map((m) => m.fecha), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  });

  it("un variable usa el promedio de sus últimos 3 cargos con monto, incluidos los cargos por emitir", () => {
    const variable = plan({
      id: "plan-var",
      tipo: "variable",
      montoCentavos: null,
      periodicidad: "trimestral",
      primerVencimiento: "2026-10-15",
      siguiente: 2,
      porEmitir: ["2027-01-15"],
      ultimosMontos: [300_000, 600_000, 900_000, 9_999_999],
    });
    const { movimientos, incluidos, sinHistorial } = entradasEstimadas([variable], HOY, "2027-12-31");
    assert.deepEqual(movimientos.map((m) => [m.fecha, m.centavos]), [
      ["2027-01-15", 600_000],
      ["2027-04-15", 600_000],
      ["2027-07-15", 600_000],
      ["2027-10-15", 600_000],
    ]);
    assert.deepEqual(incluidos, [{ id: "plan-var", cliente: "Distribuidora Norte", concepto: "Mantenimiento", tipo: "variable", montoCentavos: 600_000, periodos: 4 }]);
    assert.deepEqual(sinHistorial, []);
  });

  it("un variable sin ningún cargo con monto se excluye y se lista", () => {
    const { movimientos, sinHistorial } = entradasEstimadas([plan({ tipo: "variable", montoCentavos: null })], HOY, "2027-12-31");
    assert.equal(movimientos.length, 0);
    assert.deepEqual(sinHistorial, [{ id: "plan-fijo", cliente: "Distribuidora Norte", concepto: "Mantenimiento" }]);
  });
});

describe("sin saldo declarado", () => {
  it("no hay runway ni cierres, pero sí lo comprometido de los 12 meses", () => {
    const runway = calcularRunway(base({ saldo: null }), [plan()]);
    assert.deepEqual(runway.conservador, { tipo: "sin_saldo" });
    assert.deepEqual(runway.esperado, { tipo: "sin_saldo" });
    assert.equal(semanasDe(runway.conservador, runway.horizonte), null);
    assert.ok(runway.meses.every((m) => m.cierre === null && m.cierreEsperado === null));
    assert.equal(runway.meses[1]!.salidas, 10_000_000);
    assert.equal(textoRunway(runway.conservador), "Sin saldo declarado");
    assert.equal(runwayBajo(runway.conservador, 12), false);
  });
});

describe("nómina de una sola persona", () => {
  it("sin el permiso de detalle, su total de 12 meses va reservado; con el permiso, no", () => {
    const una = base({ nomina: [{ netoCentavos: 2_500_000, frecuencia: "quincenal", proximoPagoEn: "2027-01-15", anclaDia: 15, altaEn: "2026-01-01", bajaEn: null }] });
    const sin = calcularRunway(una, []).resumen.find((l) => l.tipo === "nomina");
    const con = calcularRunway(una, [], { detalleNomina: true }).resumen.find((l) => l.tipo === "nomina");
    assert.equal(sin?.reservado, true);
    assert.equal(con?.reservado, false);
    // Dos personas en cada fecha: no se reserva.
    assert.equal(calcularRunway(base(), []).resumen.find((l) => l.tipo === "nomina")?.reservado, false);
  });
});

describe("12 meses o más y no alcanza esta semana", () => {
  it("sin semanas negativas es «12 meses o más» y cuenta el horizonte completo", () => {
    const runway = calcularRunway(base({ saldo: { centavos: 900_000_000, alDia: "2027-01-03", autor: "L", declaradoEn: "2027-01-04T01:00:00.000Z" } }), []);
    assert.deepEqual(runway.conservador, { tipo: "holgado" });
    assert.equal(semanasDe(runway.conservador, runway.horizonte), runway.horizonte.semanas);
    assert.equal(textoRunway(runway.conservador), "12 meses o más");
    assert.equal(runwayBajo(runway.conservador, 12), false);
  });

  it("si esta semana cierra negativa, el runway es 0 y avisa con cualquier mínimo", () => {
    const runway = calcularRunway(base({ saldo: { centavos: 100_000, alDia: "2027-01-03", autor: "L", declaradoEn: "2027-01-04T01:00:00.000Z" } }), []);
    assert.deepEqual(runway.conservador, { tipo: "agota", semanas: 0, meses: 0, hasta: "2027-01-03" });
    assert.equal(textoRunway(runway.conservador), "No alcanza esta semana");
    assert.equal(runwayBajo(runway.conservador, 1), true);
  });

  it("el alcance de Inicio usa el runway conservador más allá de 13 semanas", () => {
    const fuentes = base({ saldo: { centavos: 60_000_000, alDia: "2027-01-03", autor: "L", declaradoEn: "2027-01-04T01:00:00.000Z" } });
    const proyeccion = proyectar(fuentes, null);
    const runway = calcularRunway(fuentes, []);
    assert.equal(proyeccion.alcance.tipo, "holgado");
    assert.equal(textoAlcanceConRunway(proyeccion, runway), "Más de 13 semanas (runway de 5.9 meses, hasta el 4 jul)");
    // Dentro de 13 semanas, el texto de hoy.
    const apretada = base({ saldo: { centavos: 15_000_000, alDia: "2027-01-03", autor: "L", declaradoEn: "2027-01-04T01:00:00.000Z" } });
    assert.equal(textoAlcanceConRunway(proyectar(apretada, null), calcularRunway(apretada, [])), "8 semanas");
    // Justo en la semana 13: Inicio no lo ve negativo y el runway sí lo dice.
    assert.equal(textoAlcanceConRunway(proyectar(base(), null), calcularRunway(base(), [])), "Más de 13 semanas (runway de 2.9 meses, hasta el 4 abr)");
  });
});

describe("alertas: un aviso por cruce", () => {
  const casos: [string, Parameters<typeof transicion>[0], Parameters<typeof transicion>[1], boolean, { colchon: boolean; runway: boolean } | null][] = [
    ["primera vez, todo bien", null, { bajoColchon: false, runwayBajo: false }, false, null],
    ["primera vez, cruza el colchón", null, { bajoColchon: true, runwayBajo: false }, true, { colchon: true, runway: false }],
    ["cruzan los dos en la misma corrida: un solo aviso", { bajoColchon: false, runwayBajo: false }, { bajoColchon: true, runwayBajo: true }, true, { colchon: true, runway: true }],
    ["sigue abajo: no se repite", { bajoColchon: true, runwayBajo: true }, { bajoColchon: true, runwayBajo: true }, false, null],
    ["sube el colchón, sigue bajo el runway: sin aviso", { bajoColchon: true, runwayBajo: true }, { bajoColchon: false, runwayBajo: true }, true, null],
    ["vuelve a cruzar el colchón: avisa otra vez", { bajoColchon: false, runwayBajo: true }, { bajoColchon: true, runwayBajo: true }, true, { colchon: true, runway: false }],
    ["sube todo: sin aviso", { bajoColchon: true, runwayBajo: true }, { bajoColchon: false, runwayBajo: false }, true, null],
  ];
  for (const [nombre, antes, ahora, cambia, avisar] of casos) {
    it(nombre, () => assert.deepEqual(transicion(antes, ahora), { cambia, avisar }));
  }

  it("el estado mostrado: colchón primero, luego runway", () => {
    assert.equal(estadoMostrado({ bajoColchon: true, runwayBajo: true }), "bajo_colchon");
    assert.equal(estadoMostrado({ bajoColchon: false, runwayBajo: true }), "runway_bajo");
    assert.equal(estadoMostrado({ bajoColchon: false, runwayBajo: false }), "ok");
  });
});

describe("tendencia", () => {
  it("las semanas de una foto se leen en meses con tope de 12", () => {
    assert.equal(mesesDeSemanas(13, 53), 2.9);
    assert.equal(mesesDeSemanas(52, 53), 11.9);
    assert.equal(mesesDeSemanas(53, 53), 12);
    assert.equal(mesesDeSemanas(0, 54), 0);
  });

  it("el ejemplo de demostración termina en el runway de hoy, en lunes consecutivos", () => {
    const fotos = fotosDeEjemplo("2027-01-06", 20, 53, 1);
    assert.equal(fotos.length, 8);
    assert.equal(fotos.at(-1)!.semana, "2027-01-04");
    assert.equal(fotos.at(-1)!.semanasConservador, 20);
    for (const [i, foto] of fotos.entries()) {
      if (i > 0) assert.equal(diasEntre(fotos[i - 1]!.semana, foto.semana), 7);
      assert.ok(foto.semanasEsperado >= foto.semanasConservador);
    }
  });
});

// Generador al azar con semilla --------------------------------------------------------

function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function entero(azar: () => number, min: number, max: number): number {
  return min + Math.floor(azar() * (max - min + 1));
}

function fuentesAlAzar(azar: () => number, conSaldo = azar() < 0.9): FuentesFlujo {
  const hoy = desplazar("2026-11-02", entero(azar, 0, 500));
  const alDia = desplazar(hoy, -entero(azar, 0, 20));
  const estados: EstadoPagoFlujo[] = ["por_autorizar", "listo_para_pagar", "sin_solicitud"];
  const frecuencias = ["semanal", "mensual", "bimestral", "trimestral", "anual"] as const;
  const nominas = ["semanal", "quincenal", "mensual"] as const;
  return {
    hoy,
    saldo: conSaldo ? { centavos: entero(azar, 0, 200_000_000), alDia, autor: "Azar", declaradoEn: `${alDia}T12:00:00.000Z` } : null,
    colchonCentavos: entero(azar, 0, 10_000_000),
    nomina: Array.from({ length: entero(azar, 0, 4) }, () => {
      const frecuencia = nominas[entero(azar, 0, 2)]!;
      const proximo = desplazar(hoy, entero(azar, -10, 30));
      return {
        netoCentavos: entero(azar, 100_000, 3_000_000),
        frecuencia,
        proximoPagoEn: proximo,
        anclaDia: Number(proximo.slice(8, 10)),
        altaEn: desplazar(hoy, -entero(azar, 0, 400)),
        bajaEn: azar() < 0.2 ? desplazar(hoy, entero(azar, 0, 300)) : null,
      };
    }),
    lotes: Array.from({ length: entero(azar, 0, 2) }, (_, i) => ({ id: `lote${i}`, fechaPago: desplazar(alDia, entero(azar, 1, 60)), totalCentavos: entero(azar, 100_000, 5_000_000), personas: entero(azar, 1, 5) })),
    pagos: Array.from({ length: entero(azar, 0, 6) }, (_, i) => ({
      id: `p${i}`,
      proveedor: "Proveedor",
      referencia: `R-${i}`,
      totalCentavos: entero(azar, 10_000, 20_000_000),
      programadaEl: desplazar(hoy, entero(azar, -40, 120)),
      estado: estados[entero(azar, 0, 2)]!,
    })),
    obligaciones: Array.from({ length: entero(azar, 0, 3) }, (_, i) => {
      const proxima = desplazar(hoy, entero(azar, -20, 60));
      return {
        id: `o${i}`,
        concepto: "Obligación",
        montoCentavos: entero(azar, 10_000, 5_000_000),
        frecuencia: frecuencias[entero(azar, 0, 4)]!,
        proximaFecha: proxima,
        anclaDia: Number(proxima.slice(8, 10)),
        ...(azar() < 0.3 ? { cargosPorMes: { [proxima.slice(0, 7)]: entero(azar, 0, 3_000_000) } } : {}),
      };
    }),
    cobros: Array.from({ length: entero(azar, 0, 4) }, (_, i) => ({
      id: `k${i}`,
      cliente: "Cliente",
      concepto: "Cobro",
      montoCentavos: entero(azar, 10_000, 30_000_000),
      fechaProbable: desplazar(hoy, entero(azar, -15, 200)),
    })),
    cobrados: Array.from({ length: entero(azar, 0, 2) }, (_, i) => ({
      id: `c${i}`,
      cliente: "Cliente",
      concepto: "Cobrado",
      montoCentavos: entero(azar, 10_000, 10_000_000),
      cobradoEl: desplazar(alDia, entero(azar, 1, Math.max(1, diasEntre(alDia, hoy)))),
    })),
  };
}

function planesAlAzar(azar: () => number, hoy: string, prefijo = "plan"): PlanFuente[] {
  const periodicidades = ["mensual", "bimestral", "trimestral", "semestral", "anual"] as const;
  return Array.from({ length: entero(azar, 0, 3) }, (_, i) => {
    const fijo = azar() < 0.6;
    return {
      id: `${prefijo}${i}`,
      cliente: "Cliente",
      concepto: "Plan",
      tipo: fijo ? ("fijo" as const) : ("variable" as const),
      montoCentavos: fijo ? entero(azar, 10_000, 20_000_000) : null,
      periodicidad: periodicidades[entero(azar, 0, 4)]!,
      primerVencimiento: desplazar(hoy, entero(azar, -200, 100)),
      fin: azar() < 0.3 ? desplazar(hoy, entero(azar, 0, 400)) : null,
      siguiente: entero(azar, 0, 3),
      porEmitir: !fijo && azar() < 0.5 ? [desplazar(hoy, entero(azar, -5, 30))] : [],
      ultimosMontos: fijo ? [] : Array.from({ length: entero(azar, 0, 4) }, () => entero(azar, 10_000, 5_000_000)),
    };
  });
}
