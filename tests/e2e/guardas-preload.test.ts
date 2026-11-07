import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Los preloads de los recorridos (desvío de Blob y correo falso) solo cargan en
 * el servidor de una prueba local. Cada caso carga el preload en un proceso de
 * Node nuevo con un entorno armado desde cero y revisa el código de salida.
 */

const BLOB = join(process.cwd(), "tests/e2e/blob-local/preload.mjs");
const CORREO = join(process.cwd(), "tests/e2e/correo-local/preload.mjs");
const PRELOADS = { blob: BLOB, correo: CORREO };
// URL de una base sin contraseña en ese host (la revisión de secretos no acepta DATABASE_URL literales).
const base = (host: string) => `postgres://aplicacion@${host}/e2e`;

// El mismo entorno que tests/e2e/entorno.ts arma para `next start`.
const BUENO = {
  NODE_ENV: "production",
  E2E_SERVER_ACTIONS: "1",
  DATABASE_URL: base("127.0.0.1:5553"),
};

function cargar(preload: string, entorno: Record<string, string | undefined>) {
  const env = Object.fromEntries(Object.entries(entorno).filter(([, valor]) => valor !== undefined)) as Record<string, string>;
  const proceso = spawnSync(process.execPath, [`--import=${preload}`, "-e", ""], { env, encoding: "utf8" });
  return { estado: proceso.status, error: proceso.stderr };
}

test("con el entorno de la prueba, los dos preloads cargan (inactivos y el correo activo)", () => {
  const archivo = join(mkdtempSync(join(tmpdir(), "correo-e2e-")), "correos.jsonl");
  for (const [nombre, preload] of Object.entries(PRELOADS)) {
    const { estado, error } = cargar(preload, BUENO);
    assert.equal(estado, 0, `${nombre}: ${error}`);
  }
  const { estado, error } = cargar(CORREO, { ...BUENO, E2E_CORREO_ARCHIVO: archivo });
  assert.equal(estado, 0, error);
  const otro = cargar(CORREO, { ...BUENO, DATABASE_URL: base("localhost") });
  assert.equal(otro.estado, 0, otro.error);
});

const MALOS: Array<{ caso: string; entorno: Record<string, string | undefined>; motivo: RegExp }> = [
  { caso: "en un despliegue de Vercel", entorno: { ...BUENO, VERCEL_ENV: "preview" }, motivo: /VERCEL_ENV está definido/ },
  { caso: "con VERCEL_ENV vacío", entorno: { ...BUENO, VERCEL_ENV: "" }, motivo: /VERCEL_ENV está definido/ },
  { caso: "en producción sin E2E_SERVER_ACTIONS", entorno: { ...BUENO, E2E_SERVER_ACTIONS: undefined }, motivo: /NODE_ENV=production sin E2E_SERVER_ACTIONS=1/ },
  { caso: "con una base remota", entorno: { ...BUENO, DATABASE_URL: base("base.ejemplo.com") }, motivo: /DATABASE_URL no apunta/ },
  { caso: "con un host que solo empieza como local", entorno: { ...BUENO, DATABASE_URL: base("localhost.ejemplo.com") }, motivo: /DATABASE_URL no apunta/ },
  { caso: "sin DATABASE_URL", entorno: { ...BUENO, DATABASE_URL: undefined }, motivo: /DATABASE_URL no apunta/ },
];

for (const { caso, entorno, motivo } of MALOS) {
  for (const [nombre, preload] of Object.entries(PRELOADS)) {
    test(`${nombre} truena ${caso}, aunque falte su propia variable`, () => {
      const { estado, error } = cargar(preload, entorno);
      assert.notEqual(estado, 0);
      assert.match(error, /se niega a cargar/);
      assert.match(error, motivo);
    });
  }
}

test("el desvío de Blob exige E2E_BLOB_LOCAL=1 y ningún token de un almacén real", () => {
  const activo = { ...BUENO, E2E_BLOB_LOCAL_URL: "http://127.0.0.1:4896", E2E_BLOB_LOCAL: "1" };
  const tokenLocal = ["vercel", "blob", "rw", "e2elocal", "emulador"].join("_");
  const tokenReal = ["vercel", "blob", "rw", "AlmacenReal9", "claveReal9"].join("_");

  const sinInterruptor = cargar(BLOB, { ...activo, E2E_BLOB_LOCAL: undefined, BLOB_READ_WRITE_TOKEN: tokenLocal });
  assert.notEqual(sinInterruptor.estado, 0);
  assert.match(sinInterruptor.error, /falta E2E_BLOB_LOCAL=1/);

  const conReal = cargar(BLOB, { ...activo, BLOB_READ_WRITE_TOKEN: tokenReal });
  assert.notEqual(conReal.estado, 0);
  assert.match(conReal.error, /BLOB_READ_WRITE_TOKEN parece una credencial real/);

  const realEnOtraVariable = cargar(BLOB, { ...activo, BLOB_READ_WRITE_TOKEN: tokenLocal, OTRO_TOKEN: tokenReal });
  assert.notEqual(realEnOtraVariable.estado, 0);
  assert.match(realEnOtraVariable.error, /OTRO_TOKEN parece una credencial real/);

  const conOidc = cargar(BLOB, { ...activo, BLOB_READ_WRITE_TOKEN: tokenLocal, VERCEL_OIDC_TOKEN: "x" });
  assert.notEqual(conOidc.estado, 0);
  assert.match(conOidc.error, /VERCEL_OIDC_TOKEN parece una credencial real/);
});
