import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { mapearResumen, SQL_RESUMEN } from "../../src/server/inicio/resumen-repositorio.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";

const RAIZ = new URL("../../", import.meta.url);
const leer = (archivo: string) => readFileSync(new URL(archivo, RAIZ), "utf8");

describe("lecturas de Inicio y Pendientes por petición", () => {
  it("Pendientes y el contador del lateral comparten una sola lectura de la bandeja", () => {
    const peticion = leer("src/server/inicio/peticion.ts");
    assert.match(peticion, /import "server-only"/);
    assert.match(peticion, /export const bandejaDeLaPeticion = cache\(\(ctx: ContextoDeTenant\) => leerBandejaInicio\(ctx\)\)/);
    const marco = leer("src/components/cromo/estado-marco.ts");
    const pagina = leer("src/app/consola/pendientes/page.tsx");
    assert.match(marco, /bandejaDeLaPeticion\(ctx\)/);
    assert.match(pagina, /bandejaDeLaPeticion\(apertura\.ctx\)/);
    assert.doesNotMatch(marco, /leerPendientesInicio|leerBandejaInicio/);
    assert.doesNotMatch(pagina, /leerPendientesInicio|leerBandejaInicio/);
  });

  it("el contador que falla queda registrado sin el mensaje crudo ni datos de la empresa", () => {
    const marco = leer("src/components/cromo/estado-marco.ts");
    assert.match(marco, /registrarFallo\("pendientes", ctx, error\)/);
    assert.match(marco, /registrarFallo\("liberadores", ctx, error\)/);
    const cuerpo = marco.slice(marco.indexOf("function registrarFallo"));
    assert.match(cuerpo, /console\.error\(\s*JSON\.stringify\(/);
    assert.match(cuerpo, /peticionId: ctx\.peticionId/);
    assert.doesNotMatch(cuerpo, /error\.message|String\(error\)|empresa|persona|correo|rfc/);
  });

  it("el resumen es una sola consulta con ventanas de mes cerradas en hora de México", () => {
    assert.equal((SQL_RESUMEN.match(/\$2::date::timestamp/g) ?? []).length, 3);
    assert.doesNotMatch(SQL_RESUMEN, /date_trunc\('month', \$2::date\)/);
    assert.match(SQL_RESUMEN, /p\.ocurrido_en < l\.hasta/);
    assert.equal((SQL_RESUMEN.match(/< l\.hasta/g) ?? []).length, 2);
    const repositorio = leer("src/server/inicio/resumen-repositorio.ts");
    assert.equal((repositorio.match(/consulta\.query\(/g) ?? []).length, 1);
  });

  it("la prueba Postgres del resumen no depende del día en que corre", () => {
    const prueba = leer("tests/inicio/resumen-postgres.test.ts");
    const llamadas = [...prueba.matchAll(/leerResumenInicio\(([^)]*)\)/g)].map((coincidencia) => coincidencia[1] ?? "");
    assert.ok(llamadas.length >= 4);
    for (const argumentos of llamadas) assert.match(argumentos, /, AHORA$/, argumentos);
    assert.match(prueba, /const AHORA = \{ ahora: \(\) => new Date\("2026-11-05T18:00:00Z"\) \}/);
  });

  it("mapea la fila única y rechaza una fila incompleta", () => {
    const datos = mapearResumen({
      saldo: "100000",
      mensuales: [{ mes: "2026-11", entradas: "123456", salidas: "23456" }],
      categorias: [{ codigo: "operacion", nombre: "Operación", salidas: "23456" }],
      recientes: [{ id: "11111111-1111-4111-8111-111111111111", motivo: "Proveedor", centavos: "-23456", ocurrido_en: "2026-11-05T06:00:00-06:00", categoria: "Operación" }],
    });
    assert.equal(datos.saldoCentavos, 100000);
    assert.deepEqual(datos.mensuales, [{ clave: "2026-11", entradasCentavos: 123456, salidasCentavos: 23456 }]);
    assert.equal(datos.recientes[0]?.ocurridoEn, "2026-11-05T12:00:00.000Z");
    assert.throws(() => mapearResumen({ saldo: "0", mensuales: null, categorias: [], recientes: [] }), ErrorDeDominio);
    assert.throws(
      () => mapearResumen({ saldo: "9007199254740993", mensuales: [], categorias: [], recientes: [] }),
      ErrorDeDominio,
    );
  });
});
