import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { leerModulosDesde, revisarSql } from "../../scripts/ci/seguridad.mjs";

/**
 * La regla de SQL interpolado del gate de seguridad (scripts/ci/seguridad.mjs)
 * con entradas sintéticas. Antes solo revisaba `.query(...)`: el SQL que se
 * entregaba con `aplicarSentencia(consulta, sql, params)` no se revisaba, ni el
 * de los objetos `SQL = { ... } as const`. Decisión del líder (2026-11-12): se
 * puede interpolar una constante cuyo inicializador sea a su vez SQL verificable.
 */

const SERVIDOR = "src/server/x/repositorio.ts";
const revisar = (fuente: string, ruta = SERVIDOR) => revisarSql(ruta, fuente) as string[];
const con = (hallazgos: string[], texto: string) => hallazgos.some((h) => h.includes(texto));

describe("regla de SQL: aplicarSentencia", () => {
  after(() => leerModulosDesde(() => null));

  test("un valor no constante interpolado en aplicarSentencia no pasa", () => {
    const hallazgos = revisar(`
      export function buscar(consulta: Consulta, rfc: string) {
        return aplicarSentencia(consulta, \`select id from t where rfc = '\${rfc}'\`, []);
      }`);
    assert.deepEqual(hallazgos, [`${SERVIDOR}:3 SQL con un valor interpolado que no es un placeholder $n ni una constante verificable`]);
  });

  test("un SQL recibido como parámetro no pasa", () => {
    const hallazgos = revisar(`
      export function ejecutar(consulta: Consulta, sql: string) {
        return aplicarSentencia(consulta, sql, []);
      }`);
    assert.deepEqual(hallazgos, [`${SERVIDOR}:3 SQL recibido como parámetro`]);
  });

  test("una concatenación no pasa", () => {
    const hallazgos = revisar(`
      export function buscar(consulta: Consulta, id: string) {
        return aplicarSentencia(consulta, "select * from t where id = " + id);
      }`);
    assert.ok(con(hallazgos, "SQL armado con concatenación"), hallazgos.join("\n"));
  });

  test("una constante que interpola algo no verificable no pasa", () => {
    const llamada = revisar(`
      const TABLA = nombreDeTabla();
      const SQL_BASE = \`select id from \${TABLA}\`;
      export function leer(consulta: Consulta) {
        return aplicarSentencia(consulta, \`\${SQL_BASE} where id = $1\`, [1]);
      }`);
    assert.deepEqual(llamada, [`${SERVIDOR}:5 SQL con un valor interpolado que no es un placeholder $n ni una constante verificable`]);
    // Una variable `let` no es una constante: se puede reasignar.
    const conLet = revisar(`
      let FILTRO = "where id = $1";
      export function leer(consulta: Consulta) {
        return aplicarSentencia(consulta, \`select id from t \${FILTRO}\`, [1]);
      }`);
    assert.equal(conLet.length, 1, conLet.join("\n"));
    // Una constante con una llamada en su inicializador tampoco.
    const conLlamada = revisar(`
      const ORDEN = ["id", "nombre"].join(", ");
      export function leer(consulta: Consulta) {
        return aplicarSentencia(consulta, \`select id from t order by \${ORDEN}\`, []);
      }`);
    assert.equal(conLlamada.length, 1, conLlamada.join("\n"));
  });

  test("dos constantes que se interpolan entre sí no pasan (y la regla termina)", () => {
    const hallazgos = revisar(`
      const A: string = \`select \${B}\`;
      const B: string = \`from t \${A}\`;
      export function leer(consulta: Consulta) {
        return aplicarSentencia(consulta, \`\${A} where id = $1\`, [1]);
      }`);
    assert.equal(hallazgos.length, 1, hallazgos.join("\n"));
  });

  test("una constante verificable interpolada pasa, con números y fragmentos anidados", () => {
    const hallazgos = revisar(`
      const POR_PAGINA = 50;
      const COLUMNAS = "k.id, k.nombre";
      const SQL_CLIENTES = \`select \${COLUMNAS} from collection_customers k where k.company_id = $1\`;
      export function leer(consulta: Consulta, id: string) {
        return aplicarSentencia(consulta, \`\${SQL_CLIENTES} and k.id = $2 limit \${POR_PAGINA}\`, ["e", id]);
      }`);
    assert.deepEqual(hallazgos, []);
  });

  test("solo placeholders $n pasa", () => {
    assert.deepEqual(revisar(`
      export function leer(consulta: Consulta, id: string) {
        return aplicarSentencia(consulta, "select id from t where id = $1 and company_id = $2", [id, "e"]);
      }`), []);
  });

  test("un objeto SQL con as const se revisa (antes se saltaba)", () => {
    const fuente = (sql: string) => `
      export const SQL = {
        leer: ${sql},
      } as const;
      export function leer(consulta: Consulta, id: string) {
        return aplicarSentencia(consulta, SQL.leer, [id]);
      }`;
    assert.equal(revisar(fuente("`select id from t where id = '${nombre()}'`")).length, 1);
    assert.deepEqual(revisar(fuente('"select id from t where id = $1"')), []);
  });

  test("una constante importada de un módulo del repo se revisa en su archivo", () => {
    leerModulosDesde((ruta: string) => {
      if (ruta === "src/server/x/sql.ts") return 'export const SQL_FUENTES = `select id from t where company_id = $1`;\nexport const SQL_MALO = `select ${tabla()}`;';
      return null;
    });
    const importa = (nombre: string) => revisar(`
      import { ${nombre} } from "./sql";
      export function leer(consulta: Consulta) {
        return aplicarSentencia(consulta, \`select f.* from (\${${nombre}}) f\`, ["e"]);
      }`);
    assert.deepEqual(importa("SQL_FUENTES"), []);
    assert.equal(importa("SQL_MALO").length, 1);
    // Directo como argumento también: antes, un identificador importado pasaba sin revisarse.
    const directo = revisar(`
      import { SQL_MALO } from "./sql";
      export function leer(consulta: Consulta) {
        return aplicarSentencia(consulta, SQL_MALO, []);
      }`);
    assert.ok(con(directo, "src/server/x/sql.ts:2"), directo.join("\n"));
    // De un paquete o de un módulo que no se puede leer: no comprobable.
    const deFuera = revisar(`
      import { SQL_X } from "paquete-externo";
      export function leer(consulta: Consulta) {
        return aplicarSentencia(consulta, SQL_X, []);
      }`);
    assert.ok(con(deFuera, "SQL de origen no comprobable"), deFuera.join("\n"));
  });

  test("el envoltorio mismo se exenta por nombre y archivo, no en general", () => {
    const envoltorio = `
      export function aplicarSentencia(consulta: Consulta, sentencia: string, params: readonly unknown[] = []) {
        return consulta.query(sentencia, params);
      }`;
    assert.deepEqual(revisar(envoltorio, "src/nucleo/db.ts"), []);
    assert.ok(con(revisar(envoltorio, "src/server/otro/db.ts"), "SQL recibido como parámetro"));
  });

  test("los envoltorios de autenticación se revisan en su primer argumento", () => {
    const ruta = "src/server/autenticacion/repositorio.ts";
    const fuente = (argumento: string) => `
      function consultar(sentencia: string, params: readonly unknown[], userId: string) {
        return conTransaccion(userId, (consulta) => aplicarSentencia(consulta, sentencia, params));
      }
      export function buscar(userId: string, correo: string) {
        return consultar(${argumento}, [userId], userId);
      }`;
    assert.deepEqual(revisar(fuente('"select id from users where id = $1"'), ruta), []);
    assert.equal(revisar(fuente("`select id from users where correo = '${correo}'`"), ruta).length, 1);
  });
});

test("constantes circulares como argumento directo: la regla termina y no pasa", () => {
  const hallazgos = revisarSql(SERVIDOR, `
    const X: string = Y;
    const Y: string = X;
    export function leer(consulta: Consulta) {
      return aplicarSentencia(consulta, X, []);
    }`) as string[];
  assert.ok(hallazgos.some((h) => h.includes("circulares")), hallazgos.join("\n"));
});
