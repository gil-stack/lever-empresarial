import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clabeValida, digitoClabe } from "../clabe.ts";
import { cubetaDe, dso, rangoDeCubeta } from "./antiguedad.ts";
import { conciliar, referenciaABuscar, saldoAFavor } from "./conciliacion.ts";
import { leerCorreos, validarAlta, validarConfiguracion, validarPagoManual } from "./entradas.ts";
import { calendario, etiquetaPeriodo, periodosPorGenerar, vencimientoDe } from "./periodos.ts";
import { correoDeHoy, CALENDARIO_POR_OMISION, type CorreoPrevio } from "./recordatorios.ts";
import { digitoLuhn, normalizarReferencia, referenciaDe, referenciaValida } from "./referencia.ts";

const HOY = "2026-11-10";

describe("periodos y regla de fin de mes", () => {
  it("mensual desde el 31 de enero: 28 de febrero, vuelve al 31 y respeta los meses de 30", () => {
    const plan = { primerVencimiento: "2027-01-31", periodicidad: "mensual" as const, fin: null };
    assert.deepEqual(
      calendario(plan, 12).map((p) => p.vencimiento),
      ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31", "2027-06-30",
        "2027-07-31", "2027-08-31", "2027-09-30", "2027-10-31", "2027-11-30", "2027-12-31"],
    );
  });

  it("en bisiesto febrero es 29 y el 29, 30 y 31 se recuperan después", () => {
    assert.equal(vencimientoDe({ primerVencimiento: "2028-01-31", periodicidad: "mensual" }, 1), "2028-02-29");
    assert.equal(vencimientoDe({ primerVencimiento: "2028-01-30", periodicidad: "mensual" }, 1), "2028-02-29");
    assert.equal(vencimientoDe({ primerVencimiento: "2028-01-30", periodicidad: "mensual" }, 2), "2028-03-30");
    assert.equal(vencimientoDe({ primerVencimiento: "2027-01-29", periodicidad: "mensual" }, 1), "2027-02-28");
  });

  it("anual desde el 29 de febrero cae en el 28 y vuelve al 29 en el siguiente bisiesto", () => {
    const plan = { primerVencimiento: "2028-02-29", periodicidad: "anual" as const, fin: null };
    assert.deepEqual(calendario(plan, 5).map((p) => p.vencimiento), ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  });

  it("bimestral, trimestral y semestral saltan 2, 3 y 6 meses con el mismo ancla", () => {
    assert.deepEqual(calendario({ primerVencimiento: "2026-12-31", periodicidad: "bimestral", fin: null }, 4).map((p) => p.vencimiento),
      ["2026-12-31", "2027-02-28", "2027-04-30", "2027-06-30"]);
    assert.deepEqual(calendario({ primerVencimiento: "2026-11-30", periodicidad: "trimestral", fin: null }, 4).map((p) => p.vencimiento),
      ["2026-11-30", "2027-02-28", "2027-05-30", "2027-08-30"]);
    assert.deepEqual(calendario({ primerVencimiento: "2026-08-31", periodicidad: "semestral", fin: null }, 3).map((p) => p.vencimiento),
      ["2026-08-31", "2027-02-28", "2027-08-31"]);
  });

  it("el fin del plan corta el calendario", () => {
    const plan = { primerVencimiento: "2026-12-15", periodicidad: "mensual" as const, fin: "2027-03-15" };
    assert.deepEqual(calendario(plan, 12).map((p) => p.vencimiento), ["2026-12-15", "2027-01-15", "2027-02-15", "2027-03-15"]);
  });

  it("genera solo lo que entra al horizonte, desde el siguiente periodo, y omite lo que venció en pausa", () => {
    const plan = { primerVencimiento: "2026-09-05", periodicidad: "mensual" as const, fin: null, reanudadoEl: null };
    // Horizonte: hoy + 7 = 17 de noviembre. El 5 de diciembre todavía no entra.
    assert.deepEqual(periodosPorGenerar(plan, 0, HOY, 7).map((p) => [p.periodo, p.vencimiento, p.omitido]),
      [[0, "2026-09-05", false], [1, "2026-10-05", false], [2, "2026-11-05", false]]);
    // Con reanudación el 8 de noviembre: septiembre, octubre y el 5 de noviembre vencieron en pausa.
    const reanudado = { ...plan, reanudadoEl: "2026-11-08" };
    assert.deepEqual(periodosPorGenerar(reanudado, 1, HOY, 30).map((p) => [p.periodo, p.omitido]), [[1, true], [2, true], [3, false]]);
    // Ya generados todos los de la ventana: nada nuevo (la tarea repetida no duplica).
    assert.deepEqual(periodosPorGenerar(plan, 3, HOY, 7), []);
  });

  it("nombra el periodo de cada cargo", () => {
    assert.equal(etiquetaPeriodo("2026-11-30", "mensual"), "noviembre 2026");
    assert.equal(etiquetaPeriodo("2026-11-30", "bimestral"), "nov – dic 2026");
    assert.equal(etiquetaPeriodo("2026-12-31", "trimestral"), "dic 2026 – feb 2027");
    assert.equal(etiquetaPeriodo("2027-01-15", "anual"), "ene – dic 2027");
    assert.equal(etiquetaPeriodo("2027-01-15", null), "enero 2027");
  });
});

describe("referencia de 7 dígitos", () => {
  it("el consecutivo empieza en 100000: siete dígitos sin ceros a la izquierda, con el de Luhn (r63-N2)", () => {
    assert.equal(referenciaDe(100_000), "1000009");
    assert.equal(referenciaDe(100_001), "1000017");
    assert.equal(referenciaDe(123456), "1234566");
    assert.equal(referenciaDe(999_999), "9999996");
    assert.equal(digitoLuhn("000001"), 8);
    assert.throws(() => referenciaDe(99_999), /referencia_agotada/);
    assert.throws(() => referenciaDe(1_000_000), /referencia_agotada/);
    for (let n = 100_000; n < 102_000; n += 37) {
      assert.match(referenciaDe(n), /^[1-9][0-9]{6}$/);
      assert.equal(referenciaValida(referenciaDe(n)), true);
    }
  });

  it("un dígito cambiado ya no es referencia, ni una que empieza con cero", () => {
    assert.equal(referenciaValida("1000008"), false);
    assert.equal(referenciaValida("1234565"), false);
    assert.equal(referenciaValida("123456"), false);
    // Cierra por Luhn, pero ninguna referencia de Lever empieza con cero: lo que un banco recortó no se completa.
    assert.equal(referenciaValida("0000018"), false);
  });

  it("solo los 7 dígitos exactos: no rellena con ceros lo que llegó corto (r63-N2)", () => {
    assert.equal(normalizarReferencia(" 1000009 "), "1000009");
    assert.equal(normalizarReferencia("18"), null);
    assert.equal(normalizarReferencia("000018"), null);
    assert.equal(normalizarReferencia("0000018"), null);
    assert.equal(normalizarReferencia("ABC"), null);
    assert.equal(normalizarReferencia("12345678"), null);
  });
});

describe("conciliación", () => {
  const sinDatos = { rastreoYaRegistrado: false, clienteDeLaCuenta: null, cargoDeLaReferencia: null, clientesDeLaClabe: [], cargosAbiertosDelCliente: [] };
  const emitido = { id: "c1", clienteId: "k1", estado: "emitido" as const, saldoCentavos: 100_000 };

  it("referencia exacta: aplica el monto completo", () => {
    const d = conciliar({ montoCentavos: 100_000, referencia: "0000018", clabeOrdenante: null }, { ...sinDatos, cargoDeLaReferencia: emitido });
    assert.deepEqual(d, { clienteId: "k1", aplicacion: { cargoId: "c1", montoCentavos: 100_000, regla: "referencia" }, posibleDuplicado: false, deOtroCliente: false, motivo: "referencia" });
  });

  it("pago parcial: aplica lo que llegó y el cargo queda con saldo", () => {
    const d = conciliar({ montoCentavos: 40_000, referencia: "0000018", clabeOrdenante: null }, { ...sinDatos, cargoDeLaReferencia: emitido });
    assert.equal(d.aplicacion?.montoCentavos, 40_000);
  });

  it("pago de más: aplica hasta el saldo; el resto queda como saldo a favor", () => {
    const d = conciliar({ montoCentavos: 130_000, referencia: "0000018", clabeOrdenante: null }, { ...sinDatos, cargoDeLaReferencia: emitido });
    assert.equal(d.aplicacion?.montoCentavos, 100_000);
    assert.equal(saldoAFavor({ montoCentavos: 130_000, aplicadoCentavos: 100_000, estado: "abierto" }), 30_000);
  });

  it("otra transferencia con la referencia de un cargo ya pagado: posible duplicado, nada aplicado", () => {
    const d = conciliar({ montoCentavos: 100_000, referencia: "0000018", clabeOrdenante: null },
      { ...sinDatos, cargoDeLaReferencia: { ...emitido, estado: "pagado", saldoCentavos: 0 } });
    assert.deepEqual(d, { clienteId: "k1", aplicacion: null, posibleDuplicado: true, deOtroCliente: false, motivo: "referencia_pagada" });
  });

  it("referencia de un cargo cancelado: sabe el cliente y no toca el cargo", () => {
    const d = conciliar({ montoCentavos: 100_000, referencia: "18", clabeOrdenante: null },
      { ...sinDatos, cargoDeLaReferencia: { ...emitido, estado: "cancelado", saldoCentavos: 0 } });
    assert.equal(d.aplicacion, null);
    assert.equal(d.motivo, "referencia_sin_cargo_abierto");
  });

  it("sin referencia: CLABE de un solo cliente y monto igual al saldo de un solo cargo", () => {
    const d = conciliar({ montoCentavos: 50_000, referencia: null, clabeOrdenante: "002180701150123452" }, {
      ...sinDatos,
      clientesDeLaClabe: ["k2"],
      cargosAbiertosDelCliente: [{ id: "a", saldoCentavos: 50_000, vencimiento: "2026-11-01" }, { id: "b", saldoCentavos: 70_000, vencimiento: "2026-12-01" }],
    });
    assert.deepEqual(d.aplicacion, { cargoId: "a", montoCentavos: 50_000, regla: "clabe_y_monto" });
  });

  it("nunca adivina: dos cargos con el mismo saldo, o la CLABE de dos clientes, queda abierto", () => {
    const dos = conciliar({ montoCentavos: 50_000, referencia: null, clabeOrdenante: "x" }, {
      ...sinDatos,
      clientesDeLaClabe: ["k2"],
      cargosAbiertosDelCliente: [{ id: "a", saldoCentavos: 50_000, vencimiento: "2026-11-01" }, { id: "b", saldoCentavos: 50_000, vencimiento: "2026-12-01" }],
    });
    assert.deepEqual(dos, { clienteId: "k2", aplicacion: null, posibleDuplicado: false, deOtroCliente: false, motivo: "cliente_sin_coincidencia" });
    const ambigua = conciliar({ montoCentavos: 50_000, referencia: null, clabeOrdenante: "x" }, { ...sinDatos, clientesDeLaClabe: ["k1", "k2"] });
    assert.deepEqual(ambigua, { clienteId: null, aplicacion: null, posibleDuplicado: false, deOtroCliente: false, motivo: "sin_identificar" });
    assert.equal(conciliar({ montoCentavos: 1, referencia: null, clabeOrdenante: null }, sinDatos).motivo, "sin_identificar");
  });

  it("CLABE propia del cliente: el monto exacto de un solo cargo se aplica; si no, queda abierto con el cliente", () => {
    const cargos = [{ id: "a", saldoCentavos: 50_000, vencimiento: "2026-11-01" }, { id: "b", saldoCentavos: 70_000, vencimiento: "2026-12-01" }];
    const exacto = conciliar({ montoCentavos: 70_000, referencia: null, clabeOrdenante: null },
      { ...sinDatos, clienteDeLaCuenta: "k3", cargosAbiertosDelCliente: cargos });
    assert.deepEqual(exacto, { clienteId: "k3", aplicacion: { cargoId: "b", montoCentavos: 70_000, regla: "clabe_y_monto" }, posibleDuplicado: false, deOtroCliente: false, motivo: "cuenta_y_monto" });
    const otro = conciliar({ montoCentavos: 60_000, referencia: null, clabeOrdenante: null },
      { ...sinDatos, clienteDeLaCuenta: "k3", cargosAbiertosDelCliente: cargos });
    assert.deepEqual(otro, { clienteId: "k3", aplicacion: null, posibleDuplicado: false, deOtroCliente: false, motivo: "cliente_sin_coincidencia" });
  });

  it("CLABE propia de un cliente con la referencia de otro cliente: no aplica nada", () => {
    const d = conciliar({ montoCentavos: 100_000, referencia: "0000018", clabeOrdenante: null },
      { ...sinDatos, clienteDeLaCuenta: "k9", cargoDeLaReferencia: emitido });
    assert.deepEqual(d, { clienteId: "k9", aplicacion: null, posibleDuplicado: false, deOtroCliente: false, motivo: "referencia_de_otro_cliente" });
    const mismo = conciliar({ montoCentavos: 100_000, referencia: "0000018", clabeOrdenante: null },
      { ...sinDatos, clienteDeLaCuenta: "k1", cargoDeLaReferencia: emitido });
    assert.equal(mismo.motivo, "referencia");
  });

  it("la misma clave de rastreo ya registrada en otro pago: posible duplicado, nada aplicado", () => {
    const d = conciliar({ montoCentavos: 100_000, referencia: "0000018", clabeOrdenante: null },
      { ...sinDatos, rastreoYaRegistrado: true, cargoDeLaReferencia: emitido });
    assert.deepEqual(d, { clienteId: "k1", aplicacion: null, posibleDuplicado: true, deOtroCliente: false, motivo: "rastreo_ya_registrado" });
  });

  it("un número de menos de 7 dígitos nunca se aplica solo: queda en «Por conciliar» (r63-N2)", () => {
    assert.equal(referenciaABuscar({ montoCentavos: 100, referencia: "18", clabeOrdenante: null }), null);
    assert.equal(referenciaABuscar({ montoCentavos: 100, referencia: "0000018", clabeOrdenante: null }), null);
    assert.equal(referenciaABuscar({ montoCentavos: 100, referencia: "1000009", clabeOrdenante: null }), "1000009");
    // El depósito ajeno del revisor: «18» por $1.00 a la cuenta de la empresa.
    const ajeno = conciliar({ montoCentavos: 100, referencia: "18", clabeOrdenante: null }, sinDatos);
    assert.deepEqual(ajeno, { clienteId: null, aplicacion: null, posibleDuplicado: false, deOtroCliente: false, motivo: "referencia_incompleta" });
    // Otra señal sí basta: la CLABE propia del cliente y el monto exacto de un solo cargo (no el número).
    const conCuenta = conciliar({ montoCentavos: 70_000, referencia: "18", clabeOrdenante: null },
      { ...sinDatos, clienteDeLaCuenta: "k3", cargosAbiertosDelCliente: [{ id: "b", saldoCentavos: 70_000, vencimiento: "2026-12-01" }] });
    assert.equal(conCuenta.aplicacion?.regla, "clabe_y_monto");
    const sinCoincidir = conciliar({ montoCentavos: 60_000, referencia: "18", clabeOrdenante: null },
      { ...sinDatos, clienteDeLaCuenta: "k3", cargosAbiertosDelCliente: [{ id: "b", saldoCentavos: 70_000, vencimiento: "2026-12-01" }] });
    assert.deepEqual(sinCoincidir, { clienteId: "k3", aplicacion: null, posibleDuplicado: false, deOtroCliente: false, motivo: "referencia_incompleta" });
  });

  it("la referencia de un cliente desde la CLABE que ya pagó por otro: se aplica con la marca (r63-N4)", () => {
    const desdeUno = conciliar({ montoCentavos: 7_000, referencia: "1000009", clabeOrdenante: "002180701150123452" },
      { ...sinDatos, cargoDeLaReferencia: emitido, clientesDeLaClabe: ["k-uno"] });
    assert.deepEqual(desdeUno, { clienteId: "k1", aplicacion: { cargoId: "c1", montoCentavos: 7_000, regla: "referencia" }, posibleDuplicado: false, deOtroCliente: true, motivo: "referencia" });
    // Esa CLABE ya había pagado también por este cliente (un corporativo que paga por sus filiales): sin marca.
    const corporativo = conciliar({ montoCentavos: 7_000, referencia: "1000009", clabeOrdenante: "002180701150123452" },
      { ...sinDatos, cargoDeLaReferencia: emitido, clientesDeLaClabe: ["k-uno", "k1"] });
    assert.equal(corporativo.deOtroCliente, false);
    // Una CLABE que nunca había pagado: sin marca.
    assert.equal(conciliar({ montoCentavos: 7_000, referencia: "1000009", clabeOrdenante: "002180701150123452" }, { ...sinDatos, cargoDeLaReferencia: emitido }).deOtroCliente, false);
  });

  it("un pago anulado o devuelto no deja saldo a favor", () => {
    assert.equal(saldoAFavor({ montoCentavos: 10, aplicadoCentavos: 0, estado: "anulado" }), 0);
    assert.equal(saldoAFavor({ montoCentavos: 10, aplicadoCentavos: 0, estado: "devuelto" }), 0);
  });
});

describe("recordatorios", () => {
  const cal = { ...CALENDARIO_POR_OMISION };
  const cargo = { estado: "emitido", vencimiento: "2026-11-20", recordatorios: true };
  const cobro: CorreoPrevio = { tipo: "cobro", secuencia: 1, dia: "2026-11-13" };

  it("el cobro sale primero si el envío es automático", () => {
    assert.deepEqual(correoDeHoy(cargo, [], cal, "2026-11-13"), { tipo: "cobro", secuencia: 1 });
    assert.equal(correoDeHoy(cargo, [], { ...cal, envioAutomatico: false }, "2026-11-13"), null);
  });

  it("antes, el día y después, cada uno una vez y a lo más uno por día", () => {
    assert.equal(correoDeHoy(cargo, [cobro], cal, "2026-11-13"), null, "mismo día del cobro");
    assert.equal(correoDeHoy(cargo, [cobro], cal, "2026-11-16"), null, "todavía no entra a los 3 días");
    assert.deepEqual(correoDeHoy(cargo, [cobro], cal, "2026-11-17"), { tipo: "antes", secuencia: 1 });
    const antes: CorreoPrevio = { tipo: "antes", secuencia: 1, dia: "2026-11-17" };
    assert.equal(correoDeHoy(cargo, [cobro, antes], cal, "2026-11-18"), null);
    assert.deepEqual(correoDeHoy(cargo, [cobro, antes], cal, "2026-11-20"), { tipo: "dia", secuencia: 1 });
    const dia: CorreoPrevio = { tipo: "dia", secuencia: 1, dia: "2026-11-20" };
    assert.equal(correoDeHoy(cargo, [cobro, antes, dia], cal, "2026-11-26"), null);
    assert.deepEqual(correoDeHoy(cargo, [cobro, antes, dia], cal, "2026-11-27"), { tipo: "despues", secuencia: 1 });
    const d1: CorreoPrevio = { tipo: "despues", secuencia: 1, dia: "2026-11-27" };
    assert.deepEqual(correoDeHoy(cargo, [cobro, antes, dia, d1], cal, "2026-12-04"), { tipo: "despues", secuencia: 2 });
  });

  it("respeta el tope y no manda nada a un cargo pagado o a quien pidió no recibir recordatorios", () => {
    const tres: CorreoPrevio[] = [cobro, { tipo: "despues", secuencia: 3, dia: "2026-12-11" }];
    assert.equal(correoDeHoy(cargo, tres, cal, "2027-02-01"), null);
    assert.equal(correoDeHoy({ ...cargo, estado: "pagado" }, [cobro], cal, "2026-11-20"), null);
    assert.equal(correoDeHoy({ ...cargo, recordatorios: false }, [cobro], cal, "2026-11-20"), null);
    assert.deepEqual(correoDeHoy({ ...cargo, recordatorios: false }, [], cal, "2026-11-20"), { tipo: "cobro", secuencia: 1 });
  });

  it("un aviso del día que se pasó no se manda tarde", () => {
    assert.deepEqual(correoDeHoy(cargo, [cobro], cal, "2026-11-21"), null);
  });
});

describe("antigüedad y DSO", () => {
  it("cubetas por días de atraso", () => {
    assert.equal(cubetaDe("2026-11-10", HOY), "por_vencer");
    assert.equal(cubetaDe("2026-11-09", HOY), "d1_30");
    assert.equal(cubetaDe("2026-10-11", HOY), "d1_30");
    assert.equal(cubetaDe("2026-10-10", HOY), "d31_60");
    assert.equal(cubetaDe("2026-08-12", HOY), "d61_90");
    assert.equal(cubetaDe("2026-08-11", HOY), "d90_mas");
    const r = rangoDeCubeta("d1_30", HOY);
    assert.deepEqual(r, { desde: "2026-10-11", hasta: "2026-11-09" });
  });

  it("DSO simple a 90 días; sin emitido no hay DSO", () => {
    assert.equal(dso(300_000, 900_000), 30);
    assert.equal(dso(0, 900_000), 0);
    assert.equal(dso(10, 0), null);
  });
});

describe("entradas", () => {
  it("alta válida de un plan fijo mensual", () => {
    const r = validarAlta({
      nombre: "Abarrotes del Puerto", rfc: "", correos: "Pagos@Ejemplo.mx, cxp@ejemplo.mx",
      concepto: "Renta de bodega", tipo: "fijo", monto: "12,500.00", periodicidad: "mensual", primerVencimiento: "2027-01-31", fin: "",
    }, HOY);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.valor.cliente.correos, ["pagos@ejemplo.mx", "cxp@ejemplo.mx"]);
      assert.equal(r.valor.plan.montoCentavos, 1_250_000);
    }
  });

  it("rechazos con su campo", () => {
    const r = validarAlta({ nombre: "", correos: "no-es-correo", concepto: "", tipo: "variable", monto: "10", periodicidad: "quincenal", primerVencimiento: "2026-11-01" }, HOY);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.deepEqual(r.errores.map((e) => e.campo).sort(), ["concepto", "correos", "monto", "nombre", "periodicidad", "primerVencimiento"]);
    }
  });

  it("los correos no aceptan saltos de línea ni encabezados escondidos", () => {
    assert.notEqual(leerCorreos("a@b.mx\r\nbcc: c@d.mx").error, null);
    assert.notEqual(leerCorreos("a@b.mx,b@b.mx,c@b.mx,d@b.mx").error, null);
    assert.deepEqual(leerCorreos("a@b.mx a@b.mx").correos, ["a@b.mx"]);
  });

  it("configuración: CLABE con dígito verificador y contacto sin inyección", () => {
    const base = { clabe: "002180701150123452", beneficiario: "Altamar Logística", correoContacto: "", emitirDiasAntes: "7", antesDias: "3", avisoElDia: "si", despuesCadaDias: "7", despuesTope: "3", envioAutomatico: "si" };
    assert.equal(validarConfiguracion(base).ok, true);
    assert.equal(validarConfiguracion({ ...base, clabe: "002180701150123453" }).ok, false);
    const inyeccion = validarConfiguracion({ ...base, correoContacto: "cobranza@empresa.mx\r\nBcc: todos@victima.mx" });
    assert.equal(inyeccion.ok, false);
    if (!inyeccion.ok) assert.equal(inyeccion.errores[0]?.campo, "correoContacto");
    assert.equal(validarConfiguracion({ ...base, antesDias: "7" }).ok, false, "el previo después del cobro");
    const dig = digitoClabe("00218070115012345");
    assert.equal(dig, 2);
    assert.equal(clabeValida("002 180 70115012345 2").ok, true);
  });

  it("pago manual: no acepta fecha futura ni clave de rastreo con espacios", () => {
    assert.equal(validarPagoManual({ monto: "100", recibidoEl: "2026-11-11", claveRastreo: "" }, HOY).ok, false);
    assert.equal(validarPagoManual({ monto: "100", recibidoEl: "2026-11-10", claveRastreo: "MBAN 0101" }, HOY).ok, false);
    const ok = validarPagoManual({ monto: "100.5", recibidoEl: "2026-11-10", claveRastreo: "mban01002611100001" }, HOY);
    assert.deepEqual(ok, { ok: true, valor: { montoCentavos: 10_050, recibidoEl: "2026-11-10", claveRastreo: "MBAN01002611100001" } });
  });
});
