import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { esServidor, leerModulosDesde, revisarSql } from "../../scripts/ci/seguridad.mjs";

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

/**
 * Los caminos que encontró la revisión del #70 (-06, M5 a M14 y C4). Alcance
 * de la regla (decisión del líder): errores accidentales, no código malicioso.
 */
describe("regla de SQL: caminos de la revisión del #70", () => {
  const cae = (fuente: string, ruta = SERVIDOR) => {
    const hallazgos = revisarSql(ruta, fuente) as string[];
    assert.ok(hallazgos.length > 0, `debía caer:\n${fuente}`);
    return hallazgos;
  };
  const pasa = (fuente: string, ruta = SERVIDOR) => assert.deepEqual(revisarSql(ruta, fuente), []);
  const valor = "`select * from t where a = '${x}'`";

  test("R70-1: aplicarSentencia por alias, espacio de nombres, otra variable o .call (M7 a M10)", () => {
    cae(`import { aplicarSentencia as ejecutar } from "../../nucleo/db";
      export async function f(c: Consulta, x: string) { return ejecutar(c, ${valor}, []); }`);
    cae(`import * as db from "@/nucleo/db";
      export async function f(c: Consulta, x: string) { return db.aplicarSentencia(c, ${valor}, []); }`);
    assert.ok(cae(`const correr = aplicarSentencia;
      export async function f(c: Consulta, x: string) { return correr(c, ${valor}, []); }`).some((h) => h.includes("sin llamada directa")));
    assert.ok(cae(`export async function f(c: Consulta, x: string) { return aplicarSentencia.call(null, c, ${valor}, []); }`)
      .some((h) => h.includes("sin llamada directa")));
    cae(`export function g(f: (...a: unknown[]) => unknown) { return f(aplicarSentencia); }`);
    // El alias con SQL literal pasa: se revisa como el llamado directo.
    pasa(`import { aplicarSentencia as ejecutar } from "../../nucleo/db";
      export async function f(c: Consulta, id: string) { return ejecutar(c, "select * from t where id = $1", [id]); }`);
    // En su propio archivo, db.ts puede exportarla y referirla.
    pasa(`export function aplicarSentencia(consulta: Consulta, sentencia: string) { return consulta.query(sentencia, []); }
      export const alias = aplicarSentencia;`, "src/nucleo/db.ts");
  });

  test("R70-2: sombreado por bloques y for…of (M6 y M14)", () => {
    cae(`export async function f(c: Consulta, x: string) {
      { const q = "select 1"; void q; }
      { const q = ${valor}; return aplicarSentencia(c, q, []); }
    }`);
    cae(`export async function f(c: Consulta, entradas: string[]) {
      { const q = "select 1"; void q; }
      for (const q of entradas) await aplicarSentencia(c, q, []);
    }`);
    // La const del mismo bloque, la que de verdad se usa, pasa.
    pasa(`export async function f(c: Consulta, x: string) {
      { const q = ${valor}; void q; }
      { const q = "select * from t where id = $1"; return aplicarSentencia(c, q, [x]); }
    }`);
  });

  test("R70-3: el .join de placeholders exige un arreglo que nace vacío y solo recibe push (M5)", () => {
    const con = (antes: string) => `export async function f(c: Consulta, x: string) {
      ${antes}
      partes.push(\`b = $1\`);
      return aplicarSentencia(c, \`select * from t where \${partes.join(" and ")}\`, [1]);
    }`;
    cae(con("const partes = [`a = '${x}'`];"));
    cae(con("const partes: string[] = []; partes.unshift(`a = '${x}'`);"));
    cae(con("const partes: string[] = []; partes[1] = `a = '${x}'`;"));
    cae(con("const partes: string[] = []; partes.splice(0, 0, `a = '${x}'`);"));
    cae(con("const partes: string[] = []; meter(partes, x);"));
    pasa(con("const partes: string[] = []; if (partes.length > 3) return null;"));
  });

  test("R70-4: la propiedad de un objeto const mutado no cuenta como constante (M11)", () => {
    cae(`const SQL = { lista: "select 1" };
      export async function f(c: Consulta, x: string) { SQL.lista = ${valor}; return aplicarSentencia(c, SQL.lista, []); }`);
    cae(`const SQL = { lista: "select 1" };
      Object.assign(SQL, { lista: "otro" });
      export async function f(c: Consulta) { return aplicarSentencia(c, SQL.lista, []); }`);
    // Sin mutaciones, o con as const, pasa.
    pasa(`const SQL = { lista: "select * from t where id = $1" };
      export async function f(c: Consulta, id: string) { return aplicarSentencia(c, SQL.lista, [id]); }`);
    pasa(`const SQL = { lista: "select * from t where id = $1" } as const;
      export async function f(c: Consulta, id: string) { return aplicarSentencia(c, SQL.lista, [id]); }`);
  });

  test("R70-5: consultar y consultarDefinidor se revisan también importados desde otro archivo (C4)", () => {
    cae(`import { consultar } from "../autenticacion/repositorio";
      export async function f(x: string) { return consultar(${valor}, [], "u"); }`);
    cae(`import { consultarDefinidor as leer } from "@/server/autenticacion/repositorio";
      export async function f(x: string) { return leer(${valor}, []); }`);
    pasa(`import { consultar } from "../autenticacion/repositorio";
      export async function f(id: string) { return consultar("select id from users where id = $1", [id], id); }`);
  });
});

test("alcance: las acciones del servidor de src/app también se revisan (acciones-efevoo.ts y cualquier \"use server\")", () => {
  assert.equal(esServidor("src/app/operacion/acciones-efevoo.ts"), true);
  assert.equal(esServidor("src/app/consola/acciones.ts"), true);
  assert.equal(esServidor("src/app/x/otro.ts", '"use server";\nexport async function f() {}'), true);
  assert.equal(esServidor("src/app/x/otro.ts", '/** comentario */\n"use server";'), true);
  // Mencionarlo en un comentario no lo vuelve acción; un componente no se revisa.
  assert.equal(esServidor("src/app/entrar/estado.ts", '/** un módulo "use server" solo exporta funciones */\nexport type X = 1;'), false);
  assert.equal(esServidor("src/app/x/pagina.tsx", "export default function P() { return null; }"), false);
  assert.equal(esServidor("src/app/operacion/acciones-efevoo.test.ts"), false);
});

test("R70-7: una acción en línea (\"use server\" como primera sentencia de una función) hace que el archivo se revise", () => {
  const pagina = `export default function Pagina() {
    async function guardar(datos: FormData) {
      "use server";
      const x = String(datos.get("x"));
      return aplicarSentencia(consulta, \`select * from t where a = '\${x}'\`, []);
    }
    return <form action={guardar} />;
  }`;
  assert.equal(esServidor("src/app/x/page.tsx", pagina), true);
  assert.ok((revisarSql("src/app/x/page.tsx", pagina) as string[]).length > 0);
  // Una cadena "use server" que no es la primera sentencia no la vuelve acción.
  assert.equal(esServidor("src/app/x/page.tsx", `export default function P() { const a = 1; "use server"; return null; }`), false);
  assert.equal(esServidor("src/app/x/page.tsx", `export default function P() { return <p>use server</p>; }`), false);
});
