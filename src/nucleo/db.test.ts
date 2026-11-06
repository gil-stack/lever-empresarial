import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { traducirErrorDeBase } from "./db.ts";
import { ErrorDeDominio } from "./error-de-dominio.ts";

function errorPg(campos: Record<string, string>, mensaje = "fallo"): Error {
  return Object.assign(new Error(mensaje), campos);
}

describe("error de base sin traducir", () => {
  let registros: string[] = [];

  beforeEach(() => {
    registros = [];
    mock.method(console, "error", (linea: string) => {
      registros.push(linea);
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("la espera agotada del pool queda con su clase y sin el texto", () => {
    const traducido = traducirErrorDeBase(new Error("timeout exceeded when trying to connect"));
    assert.equal(traducido.message, "base_no_disponible");
    assert.equal(registros.length, 1);
    const registro = JSON.parse(registros[0] ?? "{}");
    assert.equal(registro.evento, "error_de_base_sin_traducir");
    assert.equal(registro.clase, "espera_de_conexion_agotada");
    assert.equal(registro.codigo, null);
    assert.doesNotMatch(registros[0] ?? "", /timeout exceeded/);
  });

  it("un error de Postgres deja SQLSTATE, restricción, tabla y rutina, nunca el mensaje", () => {
    const error = errorPg(
      { code: "57P01", constraint: "", table: "sessions", routine: "ProcessInterrupts" },
      "terminating connection for laura@altamar.mx con CLABE 012180001234567891",
    );
    traducirErrorDeBase(error);
    const registro = JSON.parse(registros[0] ?? "{}");
    assert.equal(registro.clase, "postgres");
    assert.equal(registro.codigo, "57P01");
    assert.equal(registro.tabla, "sessions");
    assert.equal(registro.rutina, "ProcessInterrupts");
    assert.equal(registro.restriccion, null);
    assert.doesNotMatch(registros[0] ?? "", /laura|012180001234567891/);
  });

  it("un código de red se marca como red", () => {
    traducirErrorDeBase(errorPg({ code: "ECONNRESET" }, "read ECONNRESET 10.0.0.5:5432"));
    const registro = JSON.parse(registros[0] ?? "{}");
    assert.equal(registro.clase, "red");
    assert.equal(registro.codigo, "ECONNRESET");
    assert.doesNotMatch(registros[0] ?? "", /10\.0\.0\.5/);
  });

  it("el RAISE con forma de código se guarda; el que trae datos, no", () => {
    traducirErrorDeBase(errorPg({ code: "P0001" }, "sesion_sin_auditoria"));
    traducirErrorDeBase(errorPg({ code: "P0001" }, "monto 1500 de laura@altamar.mx"));
    assert.equal(JSON.parse(registros[0] ?? "{}").raise, "sesion_sin_auditoria");
    assert.equal(JSON.parse(registros[1] ?? "{}").raise, null);
    assert.doesNotMatch(registros[1] ?? "", /laura/);
  });

  it("lo que sí se traduce no deja registro", () => {
    assert.equal(traducirErrorDeBase(errorPg({ code: "42501" })).message, "sin_permiso");
    const propio = new ErrorDeDominio("entrada_vencida");
    assert.equal(traducirErrorDeBase(propio), propio);
    assert.equal(traducirErrorDeBase(traducirErrorDeBase(new Error("x"))).message, "base_no_disponible");
    assert.equal(registros.length, 1);
  });
});
