import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fechaDelProcesador } from "../../components/operacion/detalle-tarjeta.tsx";
import {
  busquedaDe,
  claseDeTarjeta,
  empresaDe,
  enlaceTarjetas,
  estadoDe,
  haceCuanto,
  paginaDe,
  SIN_EMPRESA,
} from "../../dominio/tarjetas/inventario.ts";
import { idDeTarjeta, ordenarMovimientos, resumirMovimientos } from "./detalle-tarjeta";
import { parametrosDeBusqueda } from "./inventario";
import { haceFaltaLeer, type EstadoLectura } from "./inventario-copia";

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const t = (estado: Parameters<typeof claseDeTarjeta>[0]["estado"], extra: Partial<Parameters<typeof claseDeTarjeta>[0]> = {}) =>
  ({ estado, saldoCentavos: 0, conTitular: false, idepCliente: 0, ...extra });

describe("clase de una tarjeta", () => {
  it("parte las activas por saldo y deja canceladas, bloqueadas y por activar aparte", () => {
    assert.equal(claseDeTarjeta(t("active", { saldoCentavos: 1 }), false), "activa_con_saldo");
    assert.equal(claseDeTarjeta(t("active", { saldoCentavos: null }), false), "activa_sin_saldo");
    assert.equal(claseDeTarjeta(t("inactive"), false), "asignada");
    assert.equal(claseDeTarjeta(t("blocked"), false), "bloqueada");
    assert.equal(claseDeTarjeta(t("cancelled"), true), "cancelada");
  });

  it("un plástico en inventario solo está disponible si nadie lo tiene", () => {
    assert.equal(claseDeTarjeta(t("inStock"), false), "sin_asignar");
    assert.equal(claseDeTarjeta(t("inStock"), true), "asignada");
    assert.equal(claseDeTarjeta(t("inStock", { idepCliente: 7 }), false), "asignada");
    assert.equal(claseDeTarjeta(t("inStock", { conTitular: true }), false), "asignada");
  });
});

describe("buscador de tarjetas", () => {
  it("lee dígitos como terminación o número, y lo demás como nombre", () => {
    assert.deepEqual(busquedaDe("  "), { tipo: "ninguna" });
    assert.deepEqual(busquedaDe("1234"), { tipo: "terminacion", digitos: "1234" });
    assert.deepEqual(busquedaDe("•••• 1234"), { tipo: "terminacion", digitos: "1234" });
    assert.deepEqual(busquedaDe("34"), { tipo: "terminacion", digitos: "34" });
    assert.deepEqual(busquedaDe("4111 1111 1111 1234"), { tipo: "terminacion", digitos: "1234" });
    assert.deepEqual(busquedaDe("00557"), { tipo: "numero", digitos: "557" });
    assert.deepEqual(busquedaDe("Escuela  Alfa"), { tipo: "texto", texto: "Escuela Alfa" });
  });

  it("pasa la búsqueda como parámetros fijos, sin meter el texto en la sentencia", () => {
    assert.deepEqual(parametrosDeBusqueda({ q: "", empresa: null }), [null, null, null]);
    assert.deepEqual(parametrosDeBusqueda({ q: "1234", empresa: EMPRESA }), ["terminacion", "1234", EMPRESA]);
    assert.deepEqual(parametrosDeBusqueda({ q: "00557", empresa: null }), ["numero", "557", null]);
    assert.deepEqual(parametrosDeBusqueda({ q: "50%_o'; drop", empresa: "p4" }), ["texto", "%50\\%\\_o'; drop%", "p4"]);
  });

  it("lee los filtros de la dirección solo si tienen forma válida", () => {
    assert.equal(estadoDe("con_saldo"), "con_saldo");
    assert.equal(estadoDe("x"), "todas");
    assert.equal(empresaDe(EMPRESA.toUpperCase()), EMPRESA);
    assert.equal(empresaDe("p42"), "p42");
    assert.equal(empresaDe(SIN_EMPRESA), SIN_EMPRESA);
    for (const malo of ["p0", "abc", "", undefined]) assert.equal(empresaDe(malo), null, String(malo));
    assert.equal(paginaDe("3"), 3);
    for (const malo of ["0", "-2", "x", "1234567", undefined]) assert.equal(paginaDe(malo), 1, String(malo));
  });

  it("la dirección lleva solo los filtros que no están en su valor de siempre", () => {
    assert.equal(enlaceTarjetas({}), "/operacion/tarjetas");
    assert.equal(enlaceTarjetas({ q: " 1234 ", estado: "todas", pagina: 1 }), "/operacion/tarjetas?q=1234");
    assert.equal(enlaceTarjetas({ estado: "disponibles", empresa: "p4", pagina: 2, tarjeta: 9 }), "/operacion/tarjetas?estado=disponibles&empresa=p4&pagina=2&tarjeta=9");
  });
});

describe("copia del inventario", () => {
  const ahora = new Date("2026-11-23T20:00:00.000Z");
  const estado = (e: Partial<EstadoLectura>): EstadoLectura => ({
    completaEn: null, paginaSiguiente: null, paginas: null, total: null, error: null, errorEn: null, ocupadaHasta: null, ...e,
  });

  it("se lee si nunca se completó, si va a medias o si tiene más de 10 minutos", () => {
    assert.equal(haceFaltaLeer(null, ahora), true);
    assert.equal(haceFaltaLeer(estado({}), ahora), true);
    assert.equal(haceFaltaLeer(estado({ completaEn: "2026-11-23T19:55:00.000Z" }), ahora), false);
    assert.equal(haceFaltaLeer(estado({ completaEn: "2026-11-23T19:49:00.000Z" }), ahora), true);
    assert.equal(haceFaltaLeer(estado({ completaEn: "2026-11-23T19:59:00.000Z", paginaSiguiente: 3 }), ahora), true);
  });

  it("si el procesador acaba de fallar, espera un minuto", () => {
    assert.equal(haceFaltaLeer(estado({ error: "efevoo_incierto", errorEn: "2026-11-23T19:59:30.000Z" }), ahora), false);
    assert.equal(haceFaltaLeer(estado({ error: "efevoo_incierto", errorEn: "2026-11-23T19:58:00.000Z" }), ahora), true);
  });

  it("dice qué tan fresca es en palabras", () => {
    assert.equal(haceCuanto(new Date("2026-11-23T19:59:40.000Z"), ahora), "hace un momento");
    assert.equal(haceCuanto(new Date("2026-11-23T19:57:00.000Z"), ahora), "hace 3 min");
    assert.equal(haceCuanto(new Date("2026-11-23T17:00:00.000Z"), ahora), "hace 3 h");
    assert.equal(haceCuanto(new Date("2026-11-22T19:00:00.000Z"), ahora), "hace 1 día");
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
