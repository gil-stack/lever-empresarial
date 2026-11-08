import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * El reloj fijo de PLD solo carga en el servidor de una prueba local, igual que
 * los desvíos de Blob y de correo. Cada caso lo carga en un Node nuevo con un
 * entorno armado desde cero e imprime lo que devuelve el reloj.
 */

const RELOJ = join(process.cwd(), "tests/pld/reloj-preload.mjs");
// URL de una base sin contraseña en ese host (la revisión de secretos no acepta DATABASE_URL literales).
const base = (host: string) => `postgres://aplicacion@${host}/e2e`;
const BUENO = { NODE_ENV: "production", E2E_SERVER_ACTIONS: "1", DATABASE_URL: base("127.0.0.1:5553") };
const LEER = "console.log(globalThis.__relojPldE2E ? globalThis.__relojPldE2E().toISOString() : 'sin reloj')";

function cargar(entorno: Record<string, string | undefined>) {
  const env = Object.fromEntries(Object.entries(entorno).filter(([, valor]) => valor !== undefined)) as Record<string, string>;
  const proceso = spawnSync(process.execPath, [`--import=${RELOJ}`, "-e", LEER], { env, encoding: "utf8" });
  return { estado: proceso.status, salida: proceso.stdout.trim(), error: proceso.stderr };
}

test("sin E2E_RELOJ_PLD carga sin reloj", () => {
  const { estado, salida, error } = cargar(BUENO);
  assert.equal(estado, 0, error);
  assert.equal(salida, "sin reloj");
});

test("con el archivo, el reloj devuelve su fecha; vacío o sin archivo, la hora real", () => {
  const carpeta = mkdtempSync(join(tmpdir(), "reloj-pld-"));
  const archivo = join(carpeta, "reloj.txt");
  writeFileSync(archivo, "2027-01-04T16:00:00.000Z\n");
  assert.equal(cargar({ ...BUENO, E2E_RELOJ_PLD: archivo }).salida, "2027-01-04T16:00:00.000Z");
  writeFileSync(archivo, "");
  const vacio = Date.parse(cargar({ ...BUENO, E2E_RELOJ_PLD: archivo }).salida);
  assert.ok(Math.abs(vacio - Date.now()) < 60_000);
  const ausente = Date.parse(cargar({ ...BUENO, E2E_RELOJ_PLD: join(carpeta, "no-existe.txt") }).salida);
  assert.ok(Math.abs(ausente - Date.now()) < 60_000);
  writeFileSync(archivo, "mañana");
  const malo = cargar({ ...BUENO, E2E_RELOJ_PLD: archivo });
  assert.notEqual(malo.estado, 0);
  assert.match(malo.error, /no entiende/);
});

for (const [caso, entorno] of [
  ["en un despliegue de Vercel", { ...BUENO, VERCEL_ENV: "production" }],
  ["en producción sin E2E_SERVER_ACTIONS", { ...BUENO, E2E_SERVER_ACTIONS: undefined }],
  ["con una base remota", { ...BUENO, DATABASE_URL: base("base.ejemplo.com") }],
] as const) {
  test(`truena ${caso}, aunque falte E2E_RELOJ_PLD`, () => {
    const { estado, error } = cargar(entorno);
    assert.notEqual(estado, 0);
    assert.match(error, /El reloj fijo de PLD se niega a cargar/);
  });
}
