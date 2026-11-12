import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * La guarda del reparto de test:db en dos partes (scripts/ci/pruebas-postgres.partes): ninguna prueba de Postgres se
 * queda fuera en silencio ni corre dos veces. Una prueba es de Postgres si es *-postgres.test.ts o si usa la base
 * desechable (AISLAMIENTO_DATABASE_URL o conBaseDesechable).
 */

const RAIZ = join(import.meta.dirname, "../..");

function archivos(dir: string): string[] {
  return readdirSync(join(RAIZ, dir)).flatMap((nombre) => {
    const ruta = `${dir}/${nombre}`;
    if (nombre === "node_modules") return [];
    return statSync(join(RAIZ, ruta)).isDirectory() ? archivos(ruta) : nombre.endsWith(".test.ts") ? [ruta] : [];
  });
}

export function leerPartes(texto: string): { parte: string; archivo: string }[] {
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => {
      const m = /^([12]) (tests\/\S+\.test\.ts)$/.exec(l);
      if (!m) throw new Error(`línea no válida en pruebas-postgres.partes: «${l}»`);
      return { parte: m[1]!, archivo: m[2]! };
    });
}

describe("test:db en dos partes", () => {
  const partes = leerPartes(readFileSync(join(RAIZ, "scripts/ci/pruebas-postgres.partes"), "utf8"));

  it("cada prueba de Postgres está en exactamente una parte, y cada archivo del reparto existe y es de Postgres", () => {
    const dePostgres = [...archivos("tests"), ...archivos("src")]
      // Esta misma guarda nombra las marcas que busca: no cuenta.
      .filter((a) => a !== "tests/ci/partes-postgres.test.ts")
      .filter((a) => a.endsWith("-postgres.test.ts") || /AISLAMIENTO_DATABASE_URL|conBaseDesechable/.test(readFileSync(join(RAIZ, a), "utf8")))
      .sort();
    const veces = new Map<string, number>();
    for (const { archivo } of partes) veces.set(archivo, (veces.get(archivo) ?? 0) + 1);
    assert.deepEqual(dePostgres.filter((a) => veces.get(a) !== 1), [], "pruebas de Postgres fuera del reparto o repetidas");
    assert.deepEqual([...veces].filter(([, n]) => n !== 1).map(([a]) => a), [], "archivos repetidos en el reparto");
    assert.deepEqual(partes.map((p) => p.archivo).filter((a) => !existsSync(join(RAIZ, a)) || !dePostgres.includes(a)), [], "archivos del reparto que no existen o no usan Postgres");
  });

  it("las dos partes tienen pruebas", () => {
    for (const parte of ["1", "2"]) assert.ok(partes.some((p) => p.parte === parte), `la parte ${parte} está vacía`);
  });
});
