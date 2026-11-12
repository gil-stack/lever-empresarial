import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * r71-2: las dos partes de test:db y la e2e levantan su propio contenedor de Postgres, con nombre y puerto distintos.
 * Todas empiezan con `docker rm -f` de su contenedor: con el mismo nombre, dos en la misma máquina se borrarían entre
 * ellas. Con un `docker` falso que registra las llamadas y `TSX=true` (las pruebas no corren).
 */

const RAIZ = join(import.meta.dirname, "../..");

function arranqueDe(parte: string): { nombre: string; puerto: string; borrados: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "docker-falso-"));
  try {
    writeFileSync(join(dir, "docker"), `#!/bin/sh\necho "$*" >> "${dir}/llamadas"\nexit 0\n`);
    chmodSync(join(dir, "docker"), 0o755);
    const r = spawnSync("sh", [join(RAIZ, "scripts/ci/pruebas-postgres.sh")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PARTE_POSTGRES: parte, TSX: "true", DESCARGA_ESPERAS: "0 0 0 0" },
    });
    assert.equal(r.status, 0, r.stderr);
    const llamadas = readFileSync(join(dir, "llamadas"), "utf8").split("\n");
    const run = llamadas.find((l) => l.startsWith("run "));
    assert.ok(run, llamadas.join("\n"));
    return {
      nombre: /--name (\S+)/.exec(run)![1]!,
      puerto: /-p 127\.0\.0\.1:(\d+):/.exec(run)![1]!,
      borrados: llamadas.filter((l) => l.startsWith("rm -f ")).map((l) => l.slice(6).trim()),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("contenedores del CI", () => {
  it("test:db:1 y test:db:2 usan contenedor y puerto propios y solo borran el suyo", () => {
    const uno = arranqueDe("1");
    const dos = arranqueDe("2");
    assert.notEqual(uno.nombre, dos.nombre);
    assert.notEqual(uno.puerto, dos.puerto);
    assert.deepEqual([...new Set(uno.borrados)], [uno.nombre]);
    assert.deepEqual([...new Set(dos.borrados)], [dos.nombre]);
  });

  it("la e2e usa otro contenedor y otro puerto que las dos partes de test:db", () => {
    const e2e = readFileSync(join(RAIZ, "scripts/ci/pruebas-e2e.sh"), "utf8");
    const nombre = /^pg=(\S+)$/m.exec(e2e)?.[1];
    const puerto = /^puerto_pg=(\d+)$/m.exec(e2e)?.[1];
    for (const parte of [arranqueDe("1"), arranqueDe("2")]) {
      assert.notEqual(nombre, parte.nombre);
      assert.notEqual(puerto, parte.puerto);
    }
  });

  it("los puertos del modo ci de la e2e no son los de ningún laboratorio asignado (HANDOFF y relevo-2026-11-12)", () => {
    // Laboratorios: -06 (5553, 4813, 3153, 4896, 4897), -4e (5581, 5583, 3181, 3183, 3184, 4881, 4882), revisores (5552, 3152,
    // 4895, 4812, 5563, 3163, 4823, 5591, 3191, 4891, 3192, 5571), los del HANDOFF (5551, 4811, 4894, 3151, 5561, 5562, 3161,
    // 4821) y el Postgres de la máquina (5432). Los Efevoo falsos son 4896, 4897, 4882 y 4812.
    const ASIGNADOS = new Set(["5553", "4813", "3153", "4896", "4897", "5581", "5583", "3181", "3183", "3184", "4881", "4882", "5552", "3152", "4895", "4812", "5563", "3163", "4823", "5591", "3191", "4891", "3192", "5571", "5551", "4811", "4894", "3151", "5561", "5562", "3161", "4821", "5432"]);
    const e2e = readFileSync(join(RAIZ, "scripts/ci/pruebas-e2e.sh"), "utf8");
    const puertos = {
      postgres: /^puerto_pg=(\d+)$/m.exec(e2e)?.[1],
      navegador: /^puerto_navegador=(\d+)$/m.exec(e2e)?.[1],
      next: /E2E_PUERTO="\$\{E2E_PUERTO:-(\d+)\}"/.exec(e2e)?.[1],
      blob: /E2E_BLOB_PUERTO="\$\{E2E_BLOB_PUERTO:-(\d+)\}"/.exec(e2e)?.[1],
      efevoo: /E2E_EFEVOO_PUERTO="\$\{E2E_EFEVOO_PUERTO:-(\d+)\}"/.exec(e2e)?.[1],
    };
    for (const [nombre, puerto] of Object.entries(puertos)) {
      assert.ok(puerto, `no se encontró el puerto de ${nombre}`);
      assert.equal(ASIGNADOS.has(puerto), false, `el puerto de ${nombre} (${puerto}) es de un laboratorio asignado`);
    }
  });
});
