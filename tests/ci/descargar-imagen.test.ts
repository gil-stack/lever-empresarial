import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Las imágenes de docker del CI (postgres:17 y la de Playwright) se descargan con reintentos: el registro de
 * mcr.microsoft.com respondió EOF dos veces el 2026-11-12 (#66 y #71) y tumbó partes enteras de la e2e sin correr una
 * prueba. Con un `docker` falso en el PATH que falla los primeros pulls.
 */

const RAIZ = join(import.meta.dirname, "../..");
const SCRIPT = join(RAIZ, "scripts/ci/descargar-imagen.sh");

const EOF = 'Error response from daemon: Head "https://mcr.microsoft.com/v2/": EOF';

function conDockerFalso(fallas: number, fn: (dir: string) => void, error = EOF) {
  const dir = mkdtempSync(join(tmpdir(), "docker-falso-"));
  try {
    writeFileSync(join(dir, "docker"), `#!/bin/sh
echo "$*" >> "${dir}/llamadas"
if [ "$1" = pull ]; then
  n=$(grep -c '^pull' "${dir}/llamadas")
  if [ "$n" -le ${fallas} ]; then echo '${error}' >&2; exit 1; fi
fi
exit 0
`);
    chmodSync(join(dir, "docker"), 0o755);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function descargar(dir: string, imagen: string) {
  return spawnSync("sh", [SCRIPT, imagen], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DESCARGA_ESPERAS: "0 0 0 0" },
  });
}

describe("descarga de imágenes con reintentos", () => {
  it("el script existe y los dos scripts del CI descargan con él, no con un docker pull suelto", () => {
    assert.ok(existsSync(SCRIPT), "falta scripts/ci/descargar-imagen.sh");
    for (const s of ["scripts/ci/pruebas-e2e.sh", "scripts/ci/pruebas-postgres.sh"]) {
      const fuente = readFileSync(join(RAIZ, s), "utf8");
      assert.equal(/^\s*docker pull/m.test(fuente), false, `${s} hace un docker pull sin reintentos`);
      assert.match(fuente, /descargar-imagen\.sh/, `${s} no usa descargar-imagen.sh`);
    }
  });

  it("dos fallas del registro y luego bien: descarga al tercer intento y registra los intentos", () => {
    conDockerFalso(2, (dir) => {
      const r = descargar(dir, "mcr.microsoft.com/playwright:v1.64.1-noble");
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(join(dir, "llamadas"), "utf8").split("\n").filter((l) => l.startsWith("pull")).length, 3);
      assert.match(r.stderr, /intento 1 de 5 falló/);
      assert.match(r.stderr, /intento 2 de 5 falló/);
      assert.match(r.stderr, /descargada al intento 3/);
    });
  });

  it("un 5xx del registro también es pasajero: se reintenta", () => {
    conDockerFalso(2, (dir) => {
      const r = descargar(dir, "postgres:17");
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /intento 2 de 5 falló: .*503 Service Unavailable/);
    }, "Error response from daemon: received unexpected HTTP status: 503 Service Unavailable");
  });

  it("r71-1: lo permanente (manifest unknown, not found, denied, unauthorized) no se reintenta y el motivo de docker va en el mensaje", () => {
    for (const motivo of [
      "Error response from daemon: manifest unknown",
      "Error response from daemon: pull access denied for x, repository does not exist",
      "Error response from daemon: unauthorized: authentication required",
      "Error response from daemon: not found",
    ]) {
      conDockerFalso(99, (dir) => {
        const r = descargar(dir, "mcr.microsoft.com/playwright:v0.0.0-noble");
        assert.notEqual(r.status, 0, motivo);
        assert.equal(readFileSync(join(dir, "llamadas"), "utf8").split("\n").filter((l) => l.startsWith("pull")).length, 1, motivo);
        assert.ok(r.stderr.includes(motivo), `el motivo en el mensaje: ${r.stderr}`);
        assert.match(r.stderr, /No se pudo descargar la imagen mcr\.microsoft\.com\/playwright:v0\.0\.0-noble/);
      }, motivo);
    }
  });

  it("cinco fallas: sale con error y un mensaje que nombra la imagen", () => {
    conDockerFalso(99, (dir) => {
      const r = descargar(dir, "postgres:17");
      assert.notEqual(r.status, 0);
      assert.equal(readFileSync(join(dir, "llamadas"), "utf8").split("\n").filter((l) => l.startsWith("pull")).length, 5);
      assert.match(r.stderr, /No se pudo descargar la imagen postgres:17 después de 5 intentos/);
      assert.ok(r.stderr.includes(EOF), "el último motivo de docker va en el mensaje");
    });
  });
});
