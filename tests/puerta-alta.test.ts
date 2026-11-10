import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const RAIZ = path.resolve(import.meta.dirname, "..");

describe("la puerta pública está cerrada", () => {
  it("ninguna ruta de la aplicación crea una empresa ni abre una cuenta", () => {
    assert.equal(existsSync(path.join(RAIZ, "src/app/alta")), false);
    assert.equal(existsSync(path.join(RAIZ, "src/server/alta")), false);
    for (const archivo of archivosEn(path.join(RAIZ, "src/app"))) {
      const fuente = readFileSync(archivo, "utf8");
      const relativo = path.relative(RAIZ, archivo);
      assert.doesNotMatch(fuente, /darDeAltaEmpresa|insert into companies/i, relativo);
      assert.doesNotMatch(fuente, /abrirCuenta/, relativo);
    }
  });

  it("desde la aplicación una empresa solo nace prospecto y real", () => {
    // Llega a activa por el alta regulada; las de demostración las crea la dueña de la base (scripts/).
    const altas = archivosEn(path.join(RAIZ, "src")).filter((archivo) =>
      /insert into companies/i.test(readFileSync(archivo, "utf8")),
    );
    assert.deepEqual(altas.map((archivo) => path.relative(RAIZ, archivo)), ["src/server/operacion/clientes.ts"]);
    assert.match(readFileSync(altas[0] as string, "utf8"), /'prospecto', false/);
    const duena = readFileSync(path.join(RAIZ, "scripts/empresa-por-la-duena.ts"), "utf8");
    assert.match(duena, /exigirPersonal\(ctx, "plataforma\.empresa\.alta"\)/);
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
