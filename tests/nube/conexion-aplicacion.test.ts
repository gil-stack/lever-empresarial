import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { connectionStringDeAplicacion, ROL_DE_APLICACION } from "../../src/nucleo/db";
import { prepararRolDeAplicacion, tocaRolDeAplicacion } from "../../scripts/migrar.mjs";

const DUENA = "postgresql://duena:clave-duena@ep-algo-123-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const CLAVE = "a".repeat(20) + "B9_-" + "z".repeat(20);
const OTRA_BASE = "mysql://x@y/z";

describe("conexión de la aplicación", () => {
  it("sin PLATAFORMA_APP_CLAVE usa DATABASE_URL tal cual", () => {
    assert.equal(connectionStringDeAplicacion({ DATABASE_URL: DUENA }), DUENA);
    assert.equal(connectionStringDeAplicacion({ DATABASE_URL: DUENA, PLATAFORMA_APP_CLAVE: "  " }), DUENA);
  });

  it("con PLATAFORMA_APP_CLAVE conserva host, base y parámetros y entra como plataforma_app", () => {
    const url = new URL(connectionStringDeAplicacion({ DATABASE_URL: DUENA, PLATAFORMA_APP_CLAVE: CLAVE }));
    assert.equal(url.username, ROL_DE_APLICACION);
    assert.equal(decodeURIComponent(url.password), CLAVE);
    assert.equal(url.hostname, "ep-algo-123-pooler.us-east-1.aws.neon.tech");
    assert.equal(url.pathname, "/neondb");
    assert.equal(url.searchParams.get("sslmode"), "require");
    assert.equal(url.searchParams.get("channel_binding"), "require");
    assert.doesNotMatch(url.toString(), /duena/);
  });

  it("sin DATABASE_URL o con otra cosa, base_no_configurada", () => {
    assert.throws(() => connectionStringDeAplicacion({ PLATAFORMA_APP_CLAVE: CLAVE }), /base_no_configurada/);
    assert.throws(() => connectionStringDeAplicacion({ DATABASE_URL: OTRA_BASE, PLATAFORMA_APP_CLAVE: CLAVE }), /base_no_configurada/);
  });
});

describe("migrar: entrada de plataforma_app", () => {
  it("solo con la clave puesta", () => {
    assert.equal(tocaRolDeAplicacion({}), false);
    assert.equal(tocaRolDeAplicacion({ PLATAFORMA_APP_CLAVE: " " }), false);
    assert.equal(tocaRolDeAplicacion({ PLATAFORMA_APP_CLAVE: CLAVE }), true);
  });

  it("da LOGIN con la clave escapada y CONNECT sobre la base actual", async () => {
    const sentencias: string[] = [];
    const cliente = {
      escapeLiteral: (v: string) => `'${v.replace(/'/g, "''")}'`,
      escapeIdentifier: (v: string) => `"${v.replace(/"/g, '""')}"`,
      query: async (sql: string) => {
        sentencias.push(sql);
        return { rows: [{ base: "neondb" }] };
      },
    };
    await prepararRolDeAplicacion(cliente, CLAVE);
    assert.deepEqual(sentencias, [
      `ALTER ROLE plataforma_app WITH LOGIN PASSWORD '${CLAVE}'`,
      "SELECT current_database() AS base",
      'GRANT CONNECT ON DATABASE "neondb" TO plataforma_app',
    ]);
  });

  it("rechaza una clave corta o con caracteres raros sin tocar la base", async () => {
    let llamadas = 0;
    const cliente = { escapeLiteral: String, escapeIdentifier: String, query: async () => { llamadas += 1; return { rows: [] }; } };
    await assert.rejects(prepararRolDeAplicacion(cliente, "corta"), /al menos 32/);
    await assert.rejects(prepararRolDeAplicacion(cliente, "x".repeat(40) + "'; drop"), /al menos 32/);
    assert.equal(llamadas, 0);
  });
});
