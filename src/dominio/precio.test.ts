import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CIFRA_NO_PUBLICADA,
  DIAS_DE_RECORRIDO,
  centavosDesdePesos,
  existePasoPublicar,
  finDeRecorrido,
  formatoPesos,
  notaDeLosTreintaDias,
  presentarSuscripcion,
  relatoAceptada,
  relatoRecorrido,
} from "./precio.ts";

const INICIO = new Date("2026-11-03T15:00:00.000Z");

describe("la suscripción vacía no es un monto", () => {
  it("el campo vacío se dice con la frase, y el cero con pesos", () => {
    assert.equal(presentarSuscripcion(null), CIFRA_NO_PUBLICADA);
    assert.equal(presentarSuscripcion(null), "cifra no publicada");
    assert.equal(formatoPesos(0n), "$0.00");
    assert.equal(presentarSuscripcion(0n), "$0.00");
    assert.notEqual(presentarSuscripcion(null), presentarSuscripcion(0n));
  });

  it("formatea pesos mexicanos con centavos", () => {
    assert.equal(formatoPesos(1n), "$0.01");
    assert.equal(formatoPesos(100n), "$1.00");
    assert.equal(formatoPesos(125050n), "$1,250.50");
    assert.equal(formatoPesos(123456789n), "$1,234,567.89");
  });

  it("no acepta un precio inventado ni el cero como publicación", () => {
    assert.deepEqual(centavosDesdePesos("1,250.50"), { ok: true, centavos: 125050n });
    assert.deepEqual(centavosDesdePesos("$1,250.50"), { ok: true, centavos: 125050n });
    assert.deepEqual(centavosDesdePesos("0.01"), { ok: true, centavos: 1n });
    assert.equal(resultado("0"), "monto_en_cero");
    assert.equal(resultado("0.00"), "monto_en_cero");
    assert.equal(resultado("$0.00"), "monto_en_cero");
    assert.equal(resultado(""), "monto_invalido");
    assert.equal(resultado("gratis"), "monto_invalido");
    assert.equal(resultado("5000 MXN"), "monto_invalido");
    assert.equal(resultado("1.234"), "monto_invalido");
    assert.equal(resultado("1,25"), "monto_invalido");
    assert.equal(resultado("-10"), "monto_invalido");
    assert.equal(resultado("1 250.00"), "monto_invalido");
    assert.equal(centavosDesdePesos("1.2").ok && (centavosDesdePesos("1.2") as { centavos: bigint }).centavos, 120n);
  });
});

describe("el paso a publicar", () => {
  it("solo existe si el monto no está publicado y quien actúa es el personal", () => {
    assert.equal(
      existePasoPublicar({ esOperador: true, montoPublicado: false, disponible: true }),
      true,
    );
    assert.equal(
      existePasoPublicar({ esOperador: true, montoPublicado: true, disponible: true }),
      false,
    );
    assert.equal(
      existePasoPublicar({ esOperador: false, montoPublicado: false, disponible: true }),
      false,
    );
    assert.equal(
      existePasoPublicar({ esOperador: true, montoPublicado: false, disponible: false }),
      false,
    );
  });
});

describe("treinta días de recorrido", () => {
  it("cuenta treinta días exactos desde el alta y no lo llama un plan en cero con la palabra prohibida", () => {
    assert.equal(DIAS_DE_RECORRIDO, 30);
    const fin = finDeRecorrido(INICIO);
    assert.equal(fin.getTime() - INICIO.getTime(), 30 * 24 * 60 * 60 * 1000);
    const vigente = relatoRecorrido(INICIO, new Date(fin.getTime() - 1));
    assert.equal(vigente.vigente, true);
    assert.match(vigente.texto, /30 días/);
    assert.match(vigente.texto, /noviembre de 2026/);
    assert.match(vigente.texto, /diciembre de 2026/);
    const vencido = relatoRecorrido(INICIO, fin);
    assert.equal(vencido.vigente, false);
    assert.match(vencido.texto, /sigue en recorrido/);
    const nota = notaDeLosTreintaDias();
    assert.match(nota, /30 días/);
    assert.match(nota, /No es un plan en cero/);
    assert.equal(nota.toLowerCase().includes("gratis"), false);
    assert.equal(relatoAceptada(INICIO, "Ana Pérez").includes("Ana Pérez"), true);
    assert.equal(relatoAceptada(INICIO, "  ").includes("La registró"), false);
  });
});

function resultado(texto: string): string {
  const monto = centavosDesdePesos(texto);
  return monto.ok ? "ok" : monto.codigo;
}
