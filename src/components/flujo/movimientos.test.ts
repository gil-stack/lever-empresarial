import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import { proyectar, type FuentesFlujo } from "../../dominio/flujo/proyeccion.ts";
import { Movimientos } from "./movimientos.tsx";

/** Viernes 6 de noviembre de 2026: saldo de $20,000 y una sola persona con $18,500 semanales. */
const FUENTES: FuentesFlujo = {
  hoy: "2026-11-06",
  saldo: { centavos: 2_000_000, alDia: "2026-11-06", autor: "Gil", declaradoEn: "2026-11-06T17:00:00.000Z" },
  colchonCentavos: 0,
  nomina: [{ netoCentavos: 1_850_000, frecuencia: "semanal", proximoPagoEn: "2026-11-13", anclaDia: 13, altaEn: "2026-01-01", bajaEn: null }],
  lotes: [],
  pagos: [{ id: "p1", proveedor: "Proveedor Uno", referencia: "A-81", totalCentavos: 4_821_500, programadaEl: "2026-11-12", estado: "listo_para_pagar" }],
  obligaciones: [],
  cobros: [],
  cobrados: [],
};

function semanaDel9(detalleNomina: boolean): string {
  const p = proyectar(FUENTES, null, { detalleNomina });
  return renderToStaticMarkup(createElement(Movimientos, { semanas: p.semanas.slice(1, 2) }));
}

describe("movimientos de la proyección de Inicio", () => {
  it("sin detalle de nómina (finanzas), el renglón de nómina dice «Monto reservado» y no lleva la cifra", () => {
    const html = semanaDel9(false);
    assert.match(html, /13 nov · Nómina<\/span><strong data-reservado="true">Monto reservado<\/strong>/);
    assert.equal(/18,500|1 persona/.test(html), false);
    // El resto de la semana sigue con su cifra.
    assert.match(html, /Proveedor Uno · A-81<\/span><strong class="cifra-gasto">−\$48,215\.00<\/strong>/);
  });

  it("con detalle (administrador), la nómina se desglosa con su monto", () => {
    const html = semanaDel9(true);
    assert.match(html, /13 nov · Nómina semanal \(1 persona\)<\/span><strong class="cifra-gasto">−\$18,500\.00<\/strong>/);
    assert.equal(html.includes("Monto reservado"), false);
  });
});
