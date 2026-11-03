import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { ErrorDeDominio } from "../session/error-de-dominio.ts";
import { mapearPolitica } from "./mapear.ts";

describe("el JSON de la política", () => {
  it("no copia un hash ni un connection string que viniera de más", () => {
    const companyId = randomUUID();
    const userId = randomUUID();
    const vista = mapearPolitica({
      companyId,
      rol: "administrador",
      plazo: { dias: 5, vencidos: 5 },
      umbral: null,
      personas: [
        {
          personaId: userId,
          nombre: "Ana",
          correo: "ana@ejemplo.mx",
          rol: "administrador",
          dias: null,
          vencidos: null,
          password_hash: "secreto",
          database_url: "postgres://no",
        },
      ],
      categorias: [],
      cajones: [
        { codigo: "viaticos", nombre: "Viáticos", saldo: "0" },
        { codigo: "proveedores", nombre: "Proveedores", saldo: "0" },
        { codigo: "impuestos", nombre: "Impuestos", saldo: "0" },
        { codigo: "nomina", nombre: "Nómina", saldo: "0" },
      ],
      sinCajon: "0",
      password_hash: "secreto",
    });
    const texto = JSON.stringify(vista);
    assert.equal(texto.includes("secreto"), false);
    assert.equal(texto.includes("postgres"), false);
    assert.equal(vista.companyId, companyId);
    assert.equal(vista.personas[0]?.personaId, userId);
    assert.equal(vista.cajones[0]?.saldoCentavos, 0);
    assert.equal(vista.umbralCentavos, null);
  });

  it("sin fila de política no inventa el cinco", () => {
    assert.throws(
      () =>
        mapearPolitica({
          companyId: randomUUID(),
          rol: "administrador",
          plazo: null,
          umbral: null,
          personas: [],
          categorias: [],
          cajones: [],
          sinCajon: "0",
        }),
      (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "politica_ausente",
    );
  });
});
