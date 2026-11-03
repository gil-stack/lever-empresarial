import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const RAIZ = path.resolve(import.meta.dirname, "..");

describe("la puerta llama al alta de src/server", () => {
  it("declara pg y bcryptjs, y la acción guarda con darDeAltaEmpresa", () => {
    const paquete = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    assert.equal(typeof paquete.dependencies.pg, "string");
    assert.equal(typeof paquete.dependencies.bcryptjs, "string");

    const accion = readFileSync(path.join(RAIZ, "src/app/alta/acciones.ts"), "utf8");
    const completar = readFileSync(path.join(RAIZ, "src/server/alta/completar.ts"), "utf8");
    assert.match(accion, /completarAlta/);
    assert.match(completar, /darDeAltaEmpresa/);
    assert.match(completar, /abrirCuenta/);
    assert.match(completar, /descartarCuentaSinEmpresa/);
    assert.match(completar, /rfc_duplicado/);
    assert.match(accion, /segunda_razon_social/);
    assert.doesNotMatch(accion, /postgres(?:ql)?:\/\//);
    assert.doesNotMatch(accion, /DATABASE_URL/);
    assert.doesNotMatch(completar, /DATABASE_URL/);
    assert.doesNotMatch(accion, /pendiente_de_libro/);
  });

  it("el código que pinta el navegador no nombra el connection string", () => {
    const archivos = [
      ...archivosEn(path.join(RAIZ, "src/components")),
      ...archivosEn(path.join(RAIZ, "src/dominio")),
      ...archivosEn(path.join(RAIZ, "src/app")),
    ];
    assert.ok(archivos.length > 8);
    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, "utf8");
      assert.doesNotMatch(fuente, /DATABASE_URL/, path.relative(RAIZ, archivo));
      assert.doesNotMatch(fuente, /postgres(?:ql)?:\/\/\S+/, path.relative(RAIZ, archivo));
    }
  });
});

function archivosEn(directorio: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(directorio)) {
    const ruta = path.join(directorio, nombre);
    const info = statSync(ruta);
    if (info.isDirectory()) salida.push(...archivosEn(ruta));
    else if (/\.(ts|tsx|js|jsx|css)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}
