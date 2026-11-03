import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import {
  CAJONES,
  DIAS_DEFAULT,
  VENCIDOS_DEFAULT,
  categoriaListaParaTarjeta,
  fraseEdadAsientos,
  frasePlazo,
  fraseTope,
  fraseUmbral,
  ledeCajones,
  presentarPolitica,
  puedeEscribirPolitica,
  saldoDeAsientos,
  validarNombreCategoria,
  leerEnteroEnRango,
  type DatosPolitica,
} from "./politica.ts";

const AHORA = new Date("2026-11-03T18:00:00.000Z");

describe("la política de comprobantes", () => {
  it("nace en cinco y cinco, y el vacío no alcanza para una tarjeta", () => {
    assert.equal(DIAS_DEFAULT, 5);
    assert.equal(VENCIDOS_DEFAULT, 5);
    assert.equal(categoriaListaParaTarjeta(null), false);
    assert.equal(categoriaListaParaTarjeta(0), true);
    assert.equal(categoriaListaParaTarjeta(1), true);
    assert.equal(saldoDeAsientos([]), 0);
    assert.equal(saldoDeAsientos([100, -40]), 60);
  });

  it("solo quien administra escribe", () => {
    assert.equal(puedeEscribirPolitica("administrador"), true);
    for (const rol of ["contador", "solicitante", "liberador", "tarjetahabiente", ""]) {
      assert.equal(puedeEscribirPolitica(rol), false);
    }
  });

  it("muestra los cuatro cajones en orden y el saldo que sale de los asientos", () => {
    const vista = presentar(datos());
    assert.deepEqual(
      vista.cajones.map((cajon) => cajon.nombre),
      ["Viáticos", "Proveedores", "Impuestos", "Nómina"],
    );
    assert.deepEqual(
      vista.cajones.map((cajon) => cajon.saldoCentavos),
      [0, 0, 0, 0],
    );
    assert.equal(vista.sinCajonCentavos, 0);
    assert.equal(vista.umbralCentavos, null);
    assert.equal(vista.diasComprobante, 5);
    assert.equal(vista.maxVencidos, 5);
    assert.match(vista.edad, /No es una consulta al participante/);
    assert.match(vista.edad, /hora del centro de México/);
    assert.match(fraseEdadAsientos(AHORA), /12:00/);
    assert.match(ledeCajones(), /Viáticos, Proveedores, Impuestos y Nómina/);
  });

  it("la persona sin fila usa el default, y la propia no", () => {
    const base = datos();
    const persona = base.personas[0];
    assert.ok(persona);
    persona.diasComprobante = 9;
    persona.maxVencidos = 2;
    const vista = presentar(base);
    assert.equal(vista.personas[0]?.propio, true);
    assert.equal(vista.personas[0]?.diasComprobante, 9);
    assert.equal(vista.personas[1]?.propio, false);
    assert.equal(vista.personas[1]?.diasComprobante, 5);
    assert.match(frasePlazo(5, 5), /5 días/);
    assert.match(frasePlazo(5, 5), /5 comprobantes vencidos/);
  });

  it("sin tope no es cero, y un cajón de más no se presenta", () => {
    const base = datos();
    base.categorias.push({ id: randomUUID(), nombre: "Comida", topeCentavos: null });
    base.categorias.push({ id: randomUUID(), nombre: "Peaje", topeCentavos: 0 });
    const vista = presentar(base);
    assert.equal(vista.categorias[0]?.listaParaTarjeta, false);
    assert.match(fraseTope(null), /Sin tope/);
    assert.equal(vista.categorias[1]?.listaParaTarjeta, true);
    assert.match(fraseTope(0), /\$0\.00/);
    assert.match(fraseUmbral(null), /todavía no escribe/);
    base.cajones.push({ codigo: "viaticos", nombre: "Viáticos", saldoCentavos: 0 });
    assert.equal(presentarPolitica(base, AHORA).ok, false);
  });

  it("el nombre de la categoría se recorta y no acepta un control", () => {
    const nombre = validarNombreCategoria("  Comida  rápida ");
    assert.equal(nombre.ok, true);
    if (nombre.ok) assert.equal(nombre.nombre, "Comida rápida");
    assert.equal(validarNombreCategoria("   ").ok, false);
    assert.equal(validarNombreCategoria("a\u0001b").ok, false);
    assert.equal(leerEnteroEnRango(" 5 ", 1, 365).tipo === "entero", true);
    assert.equal(leerEnteroEnRango("5.0", 1, 365).tipo, "invalido");
    assert.equal(leerEnteroEnRango("0", 1, 365).tipo, "invalido");
    assert.equal(leerEnteroEnRango("366", 1, 365).tipo, "invalido");
  });
});

function presentar(datosPolitica: DatosPolitica) {
  const resultado = presentarPolitica(datosPolitica, AHORA);
  assert.equal(resultado.ok, true);
  if (!resultado.ok) throw new Error("no presenta");
  return resultado.vista;
}

function datos(): DatosPolitica {
  return {
    companyId: randomUUID(),
    rol: "administrador",
    diasComprobante: DIAS_DEFAULT,
    maxVencidos: VENCIDOS_DEFAULT,
    umbralCentavos: null,
    personas: [
      persona("Ana Admin"),
      persona("Beto Contador", "contador"),
    ],
    categorias: [],
    cajones: [...CAJONES].reverse().map((cajon) => ({
      codigo: cajon.codigo,
      nombre: cajon.nombre,
      saldoCentavos: 0,
    })),
    sinCajonCentavos: 0,
  };
}

function persona(nombre: string, rol = "administrador") {
  return {
    userId: randomUUID(),
    nombre,
    correo: `${nombre.split(" ")[0]?.toLowerCase()}@ejemplo.mx`,
    rol,
    diasComprobante: null,
    maxVencidos: null,
  };
}
