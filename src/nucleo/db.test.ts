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

  it("una auditoría rechazada antes de escribir queda con su clase y su código, sin el resto", () => {
    const traducido = traducirErrorDeBase(new Error("Auditoría rechazada: evento_con_secreto"));
    traducirErrorDeBase(new Error("Auditoría rechazada: laura@altamar.mx 4111111111111111"));
    assert.equal(traducido.message, "base_no_disponible");
    const registro = JSON.parse(registros[0] ?? "{}");
    assert.equal(registro.clase, "auditoria_rechazada");
    assert.equal(registro.raise, "evento_con_secreto");
    assert.equal(registro.codigo, null);
    const conDatos = JSON.parse(registros[1] ?? "{}");
    assert.equal(conDatos.clase, "auditoria_rechazada");
    assert.equal(conDatos.raise, null);
    assert.doesNotMatch(registros[1] ?? "", /laura|4111/);
  });

  // base-N20: si la base rechaza el mínimo de 10 del motivo, la persona ve «motivo_corto», no «la base no respondió».
  it("los CHECK del motivo regulado se traducen a motivo_corto", () => {
    for (const [constraint, table] of [
      ["company_suspensions_textos", "company_suspensions"],
      ["lpb_coincidencias_textos", "lpb_coincidencias"],
      ["kyb_dictamenes_motivo", "kyb_dictamenes"],
    ]) {
      const traducido = traducirErrorDeBase(errorPg({ code: "23514", constraint, table }));
      assert.ok(traducido instanceof ErrorDeDominio);
      assert.equal(traducido.message, "motivo_corto");
    }
    assert.equal(registros.length, 0);
  });

  // serv-nuevo-6d: enviar una versión sin todos los datos generales daba 23514 sin traducir («La base no respondió»).
  // El servidor lo revisa antes; si aun así llega a la base, se avisa que faltan datos.
  it("el CHECK de la forma de la versión se traduce a expediente_datos_incompletos", () => {
    const traducido = traducirErrorDeBase(errorPg({ code: "23514", constraint: "kyb_versiones_forma", table: "kyb_versiones" }));
    assert.ok(traducido instanceof ErrorDeDominio);
    assert.equal(traducido.message, "expediente_datos_incompletos");
    assert.equal(registros.length, 0);
  });

  it("lo que sí se traduce no deja registro", () => {
    assert.equal(traducirErrorDeBase(errorPg({ code: "42501" })).message, "sin_permiso");
    const propio = new ErrorDeDominio("entrada_vencida");
    assert.equal(traducirErrorDeBase(propio), propio);
    assert.equal(traducirErrorDeBase(traducirErrorDeBase(new Error("x"))).message, "base_no_disponible");
    assert.equal(registros.length, 1);
  });
});
