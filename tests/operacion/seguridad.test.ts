import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { exigirOtraPersona, transicionDeActivacion } from "../../src/dominio/operacion/estados.ts";
import { exigirAutenticacionReciente, VIGENCIA_AUTORIZACION_MS } from "../../src/server/autenticacion/reautenticacion.ts";
import { mapearSesion } from "../../src/server/session/repositorio.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";

const AHORA = new Date("2026-11-04T12:00:00Z");
const migration = readFileSync(new URL("../../db/migrations/0021_portal_sofipo.sql", import.meta.url), "utf8");

describe("separación de actores y superficie", () => {
  it("recorre prospecto, en_alta y activa; el rechazo vuelve a prospecto", () => {
    assert.equal(transicionDeActivacion("prospecto", "solicitar"), "en_alta");
    assert.equal(transicionDeActivacion("en_alta", "aprobar"), "activa");
    assert.equal(transicionDeActivacion("en_alta", "rechazar"), "prospecto");
    assert.throws(() => transicionDeActivacion("prospecto", "aprobar"), /activacion_transicion_invalida/);
    assert.throws(() => exigirOtraPersona("misma", "misma"), /misma_persona_en_autorizacion/);
    assert.doesNotThrow(() => exigirOtraPersona("una", "otra"));
  });

  it("una aprobación exige factor SOFIPO reciente y no una sesión cliente", () => {
    const segundoFactor = { metodo: "totp" as const, en: new Date(AHORA.getTime() - VIGENCIA_AUTORIZACION_MS) };
    assert.doesNotThrow(() => exigirAutenticacionReciente({ superficie: "sofipo", segundoFactor }, AHORA));
    assert.throws(() => exigirAutenticacionReciente({ superficie: "cliente", segundoFactor }, AHORA), /reautenticacion_requerida/);
    assert.throws(
      () => exigirAutenticacionReciente({ superficie: "sofipo", segundoFactor: { ...segundoFactor, en: new Date(0) } }, AHORA),
      /reautenticacion_requerida/,
    );
    assert.throws(() => exigirAutenticacionReciente({ superficie: "sofipo", segundoFactor: null }, AHORA), /reautenticacion_requerida/);
  });

  it("la lectura de sesión conserva la superficie y no agrega material secreto", () => {
    const sesion = mapearSesion({
      id: randomUUID(),
      expires_at: AHORA,
      user_id: randomUUID(),
      nombre: "Operadora",
      correo: "operadora@ejemplo.mx",
      superficie: "sofipo",
      segundo_factor_en: AHORA,
      segundo_factor_metodo: "passkey",
      password_hash: "no-debe-salir",
    });
    assert.equal(sesion.superficie, "sofipo");
    assert.equal(JSON.stringify(sesion).includes("no-debe-salir"), false);
    assert.throws(() => mapearSesion({
      id: randomUUID(), expires_at: AHORA, user_id: randomUUID(), nombre: "X", correo: "x@x.mx",
      superficie: "desconocida", segundo_factor_en: null, segundo_factor_metodo: null,
    }), ErrorDeDominio);
  });
});

describe("contrato de la migración 0021", () => {
  it("fuerza RLS, separa actores y prohíbe solapes y dinero no entero", () => {
    for (const tabla of ["company_activation_requests", "company_state_history", "invitation_deliveries", "operational_alerts", "company_commissions"]) {
      assert.match(migration, new RegExp(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`));
      assert.match(migration, new RegExp(`ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY`));
    }
    assert.match(migration, /decided_by IS NULL OR decided_by <> requested_by/);
    assert.match(migration, /decidida_por IS NULL OR decidida_por <> solicitada_por/);
    assert.match(migration, /company_commissions_sin_solape EXCLUDE USING gist/);
    assert.match(migration, /valor bigint NOT NULL/);
    assert.match(migration, /tipo = 'fondeo' AND moneda IS NULL AND valor BETWEEN 0 AND 10000/);
    assert.match(migration, /tipo = 'spei' AND moneda = 'MXN'/);
    assert.match(migration, /REVOKE DELETE, TRUNCATE/);
  });

  it("no altera precios, suscripciones ni introduce cargos o movimientos", () => {
    assert.doesNotMatch(migration, /ALTER TABLE (?:platform_pricing|subscriptions)/i);
    assert.doesNotMatch(migration, /INSERT INTO (?:platform_pricing|subscriptions)/i);
    assert.doesNotMatch(migration, /CREATE TABLE .*?(?:charges|postings|invoices|transfers)/i);
    assert.doesNotMatch(migration, /token text|token_hash|password_hash/i);
  });
});
