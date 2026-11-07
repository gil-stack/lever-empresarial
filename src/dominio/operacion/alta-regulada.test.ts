import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  curpValida,
  pesosACentavos,
  porcentajeAPuntosBase,
  puntosBaseATexto,
  rfcFisicaValido,
  rfcMoralValido,
  vigenciaDeComprobante,
} from "./expediente";
import { leerListaBloqueadas, MAXIMO_RENGLONES_LPB } from "./lpb";
import { documentoExtranjeroNormalizado, nombreDePais, PAISES, paisesExtranjeros, paisExtranjeroValido } from "./paises";
import { calificarRiesgo, gradoDePuntaje, mesesCompletos, revisionVencida, sumarMeses, type EntradaRiesgo } from "./riesgo";

const BASE: EntradaRiesgo = {
  actividad: "baja",
  zona: "baja",
  fechaConstitucion: "2015-03-01",
  hoy: "2026-11-07",
  capas: 1,
  pep: "no",
  volumenMensualCentavos: 10_000_000,
  coincidencias: "ninguna",
};

describe("matriz de grado de riesgo (23ª y 27ª)", () => {
  it("sin factores es bajo y la revisión vence a los seis meses", () => {
    const calificacion = calificarRiesgo(BASE);
    assert.equal(calificacion.puntaje, 0);
    assert.equal(calificacion.grado, "bajo");
    assert.equal(calificacion.revisarAntesDe, "2027-05-07");
  });

  it("los cortes son ≤ 3 bajo, 4-7 medio y ≥ 8 alto, igual que la base", () => {
    assert.deepEqual([0, 3, 4, 7, 8, 20].map(gradoDePuntaje), ["bajo", "bajo", "medio", "medio", "alto", "alto"]);
    assert.equal(calificarRiesgo({ ...BASE, actividad: "alta", zona: "media" }).grado, "medio");
    assert.equal(calificarRiesgo({ ...BASE, actividad: "alta", zona: "alta" }).grado, "alto");
  });

  it("cada factor suma lo que dice la matriz", () => {
    const todo = calificarRiesgo({
      ...BASE, fechaConstitucion: "2026-06-01", capas: 3, pep: "nacional", volumenMensualCentavos: 1_000_000_000, coincidencias: "posible",
    });
    assert.deepEqual(
      Object.fromEntries(Object.entries(todo.factores).map(([clave, factor]) => [clave, factor.puntos])),
      { actividad: 0, zona: 0, antiguedad_meses: 2, capas: 2, pep: 3, volumen_mensual_centavos: 2, coincidencias: 3 },
    );
    assert.equal(calificarRiesgo({ ...BASE, fechaConstitucion: "2024-01-01" }).factores.antiguedad_meses.puntos, 1);
    assert.equal(calificarRiesgo({ ...BASE, capas: 2 }).factores.capas.puntos, 1);
    assert.equal(calificarRiesgo({ ...BASE, volumenMensualCentavos: 100_000_000 }).factores.volumen_mensual_centavos.puntos, 1);
  });

  it("PEP extranjera (30ª) o coincidencia exacta dejan el grado en alto con cualquier puntaje", () => {
    assert.equal(calificarRiesgo({ ...BASE, pep: "extranjera" }).grado, "alto");
    assert.equal(calificarRiesgo({ ...BASE, coincidencias: "exacta" }).grado, "alto");
    assert.equal(calificarRiesgo({ ...BASE, pep: "nacional" }).grado, "bajo");
  });

  it("la revisión vencida se calcula con la fecha de hoy, no se guarda", () => {
    assert.equal(revisionVencida("2027-05-07", "2027-05-07"), false);
    assert.equal(revisionVencida("2027-05-07", "2027-05-08"), true);
  });

  it("sumar meses ajusta al último día como Postgres y los meses completos no cuentan el incompleto", () => {
    assert.equal(sumarMeses("2026-08-31", 6), "2027-02-28");
    assert.equal(sumarMeses("2027-08-31", 6), "2028-02-29");
    assert.equal(sumarMeses("2026-12-15", 1), "2027-01-15");
    assert.equal(mesesCompletos("2025-11-08", "2026-11-07"), 11);
    assert.equal(mesesCompletos("2025-11-07", "2026-11-07"), 12);
    assert.equal(mesesCompletos("2027-01-01", "2026-11-07"), 0);
  });
});

describe("CSV de la Lista de Personas Bloqueadas", () => {
  it("lee el formato documentado, con comillas, BOM y acentos en el tipo", () => {
    const lectura = leerListaBloqueadas(
      "﻿nombre,rfc,curp,tipo,fecha\r\n\"López, Mario\",,lopm700101hdfpzr01,física,2026-11-01\nEmpresa Fantasma SA,efa101010ab1,,moral,\n\n",
    );
    assert.equal(lectura.ok, true);
    if (!lectura.ok) return;
    assert.deepEqual(lectura.renglones, [
      { nombre: "López, Mario", rfc: null, curp: "LOPM700101HDFPZR01", tipo: "fisica", fecha: "2026-11-01" },
      { nombre: "Empresa Fantasma SA", rfc: "EFA101010AB1", curp: null, tipo: "moral", fecha: null },
    ]);
  });

  it("rechaza encabezado distinto, archivo vacío y renglones mal formados con su línea", () => {
    assert.deepEqual(leerListaBloqueadas("nombre;rfc;curp;tipo;fecha\nx;;;fisica;"), { ok: false, codigo: "lpb_encabezado_invalido" });
    assert.deepEqual(leerListaBloqueadas("nombre,rfc,curp,tipo,fecha\n"), { ok: false, codigo: "lpb_vacia" });
    const casos = [
      "Persona,,,otro,",
      "Persona,ABC,,fisica,",
      "Empresa SA,,LOPM700101HDFPZR01,moral,",
      "Persona,,,fisica,2026-02-30",
      ",,,fisica,",
      "\"Sin cerrar,,,fisica,",
      "Persona,,,fisica",
    ];
    for (const renglon of casos) {
      assert.deepEqual(leerListaBloqueadas(`nombre,rfc,curp,tipo,fecha\nBien,,,fisica,\n${renglon}`), {
        ok: false, codigo: "lpb_renglon_invalido", linea: 3,
      }, renglon);
    }
  });

  it("no acepta más renglones que el tope", () => {
    const texto = `nombre,rfc,curp,tipo,fecha\n${"Persona,,,fisica,\n".repeat(MAXIMO_RENGLONES_LPB + 1)}`;
    assert.deepEqual(leerListaBloqueadas(texto), { ok: false, codigo: "lpb_demasiado_grande" });
  });
});

describe("validaciones del expediente (4ª fr. II)", () => {
  it("RFC de persona moral y física, CURP y porcentajes en puntos base", () => {
    assert.equal(rfcMoralValido("ALF150301AB1"), true);
    assert.equal(rfcMoralValido("ALFA150301AB1"), false);
    assert.equal(rfcFisicaValido("PERR800101AB1"), true);
    assert.equal(curpValida("PERR800101MDFRSS09"), true);
    assert.equal(curpValida("PERR800101ZDFRSS09"), false);
    assert.deepEqual(["100", "33.33", "25,5", "60 %", "0"].map(porcentajeAPuntosBase), [10000, 3333, 2550, 6000, 0]);
    assert.deepEqual(["100.001", "101", "-1", "abc"].map(porcentajeAPuntosBase), [null, null, null, null]);
    assert.equal(puntosBaseATexto(3333), "33.33 %");
    assert.equal(puntosBaseATexto(6000), "60 %");
  });

  it("montos en centavos sin flotantes y comprobante vigente tres meses", () => {
    assert.equal(pesosACentavos("$1,250,000.50"), 125_000_050);
    assert.equal(pesosACentavos("12.345"), null);
    assert.equal(vigenciaDeComprobante("2026-11-30"), "2027-02-28");
    assert.equal(vigenciaDeComprobante("2026-08-15"), "2026-11-15");
  });
});

describe("socio extranjero sin CURP", () => {
  it("México no es país extranjero y el país se nombra en español", () => {
    assert.equal(paisExtranjeroValido("MX"), false);
    assert.equal(paisExtranjeroValido("US"), true);
    assert.equal(paisExtranjeroValido("XX"), false);
    assert.equal(nombreDePais("US"), "Estados Unidos");
    const extranjeros = paisesExtranjeros();
    assert.equal(extranjeros.some((pais) => pais.codigo === "MX"), false);
    assert.equal(extranjeros.length, PAISES.length - 1);
  });

  it("el documento se compara sin espacios, guiones ni puntos y en mayúsculas", () => {
    assert.equal(documentoExtranjeroNormalizado("x12-345 678"), "X12345678");
    assert.equal(documentoExtranjeroNormalizado("AB.12/34"), "AB1234");
    assert.equal(documentoExtranjeroNormalizado("A1"), null);
    assert.equal(documentoExtranjeroNormalizado("Ñ1234567"), null);
  });
});
