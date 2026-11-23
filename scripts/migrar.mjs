#!/usr/bin/env node
/**
 * Aplica db/migrations en orden: lo mismo que db/migrate.sh, pero con la librería `pg` en vez de psql.
 *
 * Se usa de dos formas:
 *
 * - `node scripts/migrar.mjs` (a mano, o como paso de migración antes de desplegar en Google Cloud):
 *   migra siempre. Exige `DATABASE_URL_UNPOOLED`.
 * - `node scripts/migrar.mjs --al-construir` (lo llama `npm run build`): migra SOLO si el build es el de
 *   producción de Vercel (`VERCEL_ENV=production`). En vistas previas, en local y en el contenedor no
 *   hace nada y lo dice. En producción, si falta la variable o una migración falla, sale con error y el
 *   build se detiene: el código nuevo no se publica sin sus tablas.
 *
 * Es compatible con lo que ya anotó db/migrate.sh: misma tabla `schema_migrations` (una fila por archivo,
 * con el nombre sin `.sql`), mismo candado (814271), una sola transacción, y salta lo ya anotado. Una
 * versión anotada que no tiene archivo en esta rama (por ejemplo, una que se aplicó desde un PR abierto)
 * no estorba: solo se revisan los archivos que existen.
 *
 * No imprime el connection string. Los errores pasan por `tachar` antes de mostrarse.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

export const CANDADO = 814271;
const AQUI = dirname(fileURLToPath(import.meta.url));
export const DIRECTORIO = join(AQUI, "../db/migrations");
const NOMBRE = /^[0-9]{4}_[a-z0-9_]+\.sql$/;

/** Quita cualquier connection string de un texto antes de mostrarlo. */
export function tachar(texto) {
  return String(texto).replace(/postgres(ql)?:\/\/[^\s'"]+/g, "***");
}

/**
 * ¿Hay que migrar? Con `alConstruir`, solo en el build de producción de Vercel. Sin él, siempre.
 * Devuelve `{ migrar: false, motivo }` o `{ migrar: true }`.
 */
export function decidir(env, alConstruir) {
  if (!alConstruir) return { migrar: true };
  if (env.VERCEL_ENV === "production") return { migrar: true };
  const donde = env.VERCEL_ENV ? `Vercel (${env.VERCEL_ENV})` : "fuera de Vercel";
  return {
    migrar: false,
    motivo: `Build ${donde}: no se migra. Solo el build de producción de Vercel aplica migraciones.`,
  };
}

/**
 * La conexión tiene que ser la directa de la base `plataforma`: nunca el pooler. Acepta el socket de
 * Cloud SQL (`postgresql://usuario@/plataforma?host=/cloudsql/…`), que no lleva máquina en la URL.
 * Devuelve el texto del error o `null` si está bien.
 */
export function revisarUrl(crudo, esperada = "plataforma") {
  if (!crudo) {
    return "Falta DATABASE_URL_UNPOOLED: el connection string directo de la base plataforma (host sin -pooler).";
  }
  const partes = /^postgres(?:ql)?:\/\/(?:[^@/?#]*@)?([^/?#]*)(\/[^?#]*)?(?:\?([^#]*))?$/.exec(crudo);
  if (!partes) return "DATABASE_URL_UNPOOLED tiene que ser el connection string directo de Postgres.";
  let host;
  let base;
  let consulta;
  try {
    consulta = new URLSearchParams(partes[3] ?? "");
    host = partes[1] ? decodeURIComponent(partes[1]) : (consulta.get("host") ?? "");
    base = decodeURIComponent((partes[2] ?? "").replace(/^\//, "").split("/")[0]);
  } catch {
    return "DATABASE_URL_UNPOOLED tiene que ser el connection string directo de Postgres.";
  }
  if (!host) return "DATABASE_URL_UNPOOLED tiene que ser el connection string directo de Postgres.";
  if (host.includes("-pooler") || consulta.get("pgbouncer") === "true") {
    return "DATABASE_URL_UNPOOLED apunta al connection string agrupado. Las migraciones usan el directo, sin -pooler.";
  }
  if (base !== esperada) return `DATABASE_URL_UNPOOLED tiene que apuntar a la base ${esperada}.`;
  return null;
}

/**
 * La base que se espera en la URL directa. Por omisión `plataforma`. La integración de Neon en Vercel
 * publica `PGDATABASE` desde la misma base que `DATABASE_URL_UNPOOLED`; si está, manda esa: así la
 * guarda sigue rechazando una URL de otra base sin obligar a que la base se llame `plataforma`.
 */
export function baseEsperada(env) {
  const declarada = env.PGDATABASE?.trim();
  return declarada ? declarada : "plataforma";
}

/** Igual que `cifradoDeConexion` de src/nucleo/db.ts: TLS verificado, salvo máquina local o socket de Cloud SQL. */
export function cifrado(url) {
  const partes = /^postgres(?:ql)?:\/\/(?:[^@/?#]*@)?([^/?#]*)(?:\/[^?#]*)?(?:\?([^#]*))?$/.exec(url);
  const host = partes?.[1]
    ? decodeURIComponent(partes[1]).replace(/:\d+$/, "")
    : (new URLSearchParams(partes?.[2] ?? "").get("host") ?? "");
  if (["localhost", "127.0.0.1", "[::1]"].includes(host) || /^\/cloudsql\//.test(host)) return undefined;
  return { rejectUnauthorized: true };
}

/** Los archivos de migración en orden, con las mismas reglas de nombre que db/migrate.sh. */
export function archivos(directorio = DIRECTORIO) {
  const lista = readdirSync(directorio)
    .filter((archivo) => archivo.endsWith(".sql"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (lista.length === 0) throw new Error("No hay archivos en db/migrations.");
  let anterior = "";
  for (const archivo of lista) {
    if (!NOMBRE.test(archivo)) throw new Error(`Nombre de migración inválido: ${archivo}`);
    const prefijo = archivo.slice(0, 4);
    if (prefijo === anterior.slice(0, 4)) throw new Error(`Prefijo repetido ${prefijo}: ${anterior} y ${archivo}.`);
    anterior = archivo;
  }
  return lista;
}

/**
 * Aplica lo que falte, en una transacción. Devuelve las versiones aplicadas, en orden.
 * `cliente` ya está conectado; quien llama lo cierra.
 */
export async function aplicar(cliente, { directorio = DIRECTORIO, avisar = () => {} } = {}) {
  const lista = archivos(directorio);
  const aplicadas = [];
  await cliente.query("SET lock_timeout = '15s'");
  await cliente.query("SET client_min_messages TO warning");
  await cliente.query("BEGIN");
  try {
    await cliente.query("SELECT pg_advisory_xact_lock($1)", [CANDADO]);
    await cliente.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);
    await cliente.query("COMMENT ON TABLE schema_migrations IS 'Control de db/migrate.sh. No es tabla de negocio.'");

    const anotada = async (version) =>
      (await cliente.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version])).rowCount > 0;
    const correr = async (archivo) => {
      const version = archivo.slice(0, -4);
      avisar(`Aplicando ${version}`);
      await cliente.query(readFileSync(join(directorio, archivo), "utf8"));
      await cliente.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      aplicadas.push(version);
    };

    for (const archivo of lista) {
      const version = archivo.slice(0, -4);
      // La misma reparación que db/migrate.sh: las 0022 históricas no crearon el historial que la 0030
      // ya necesita, así que antes de la 0030 se adelanta la 0034 si falta. Al llegar a la 0034, su
      // marca impide repetirla.
      if (version === "0030_pld_alertas_reportes") {
        const falta = await cliente.query("SELECT to_regclass('public.supplier_payment_request_history') IS NULL AS falta");
        if (falta.rows[0].falta && !(await anotada("0034_pagos_proveedores_hardening"))) {
          avisar("Aplicando 0034_pagos_proveedores_hardening (prerrequisito de 0030)");
          await correr("0034_pagos_proveedores_hardening.sql");
        }
      }
      if (await anotada(version)) continue;
      await correr(archivo);
    }
    await cliente.query("COMMIT");
    return aplicadas;
  } catch (error) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

/**
 * La aplicación entra con `plataforma_app`, nunca con la dueña. Con `PLATAFORMA_APP_CLAVE`, la dueña
 * le da entrada a ese rol con esa clave y le abre la base. Se repite en cada build sin daño: deja la
 * misma clave. Corre solo donde se migra (el build de producción), después de las migraciones. La
 * clave no se imprime; va como literal escapado por el driver.
 */
export async function prepararRolDeAplicacion(cliente, clave) {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(clave)) {
    throw new Error("PLATAFORMA_APP_CLAVE tiene que tener al menos 32 letras, números, - o _.");
  }
  await cliente.query(`ALTER ROLE plataforma_app WITH LOGIN PASSWORD ${cliente.escapeLiteral(clave)}`);
  const base = (await cliente.query("SELECT current_database() AS base")).rows[0].base;
  await cliente.query(`GRANT CONNECT ON DATABASE ${cliente.escapeIdentifier(base)} TO plataforma_app`);
}

/** ¿Hay que dejar lista la entrada de la aplicación? Solo donde se migra y si la clave está. */
export function tocaRolDeAplicacion(env) {
  return (env.PLATAFORMA_APP_CLAVE?.trim() ?? "") !== "";
}

async function principal() {
  const alConstruir = process.argv.includes("--al-construir");
  const decision = decidir(process.env, alConstruir);
  if (!decision.migrar) {
    console.log(decision.motivo);
    return 0;
  }
  const url = process.env.DATABASE_URL_UNPOOLED?.trim() ?? "";
  const problema = revisarUrl(url, baseEsperada(process.env));
  if (problema) {
    console.error(problema);
    if (alConstruir) console.error("El build de producción se detiene: el código nuevo no sale sin sus migraciones.");
    return 1;
  }
  const cliente = new pg.Client({ connectionString: url, ssl: cifrado(url) });
  cliente.on("error", () => {});
  cliente.on("notice", (aviso) => {
    if (aviso.severity === "WARNING") console.error(tachar(`Aviso: ${aviso.message}`));
  });
  try {
    await cliente.connect();
    const aplicadas = await aplicar(cliente, { avisar: (texto) => console.log(texto) });
    console.log(aplicadas.length === 0 ? "Nada que aplicar: la base ya está al día." : `Listo: ${aplicadas.length} aplicadas.`);
    if (tocaRolDeAplicacion(process.env)) {
      await prepararRolDeAplicacion(cliente, process.env.PLATAFORMA_APP_CLAVE.trim());
      console.log("La entrada de plataforma_app quedó lista.");
    }
    return 0;
  } catch (error) {
    console.error(tachar(`La migración falló y no se aplicó nada: ${error instanceof Error ? error.message : error}`));
    if (alConstruir) console.error("El build de producción se detiene: el código nuevo no sale sin sus migraciones.");
    return 1;
  } finally {
    await cliente.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Sin await de nivel superior: las pruebas importan este archivo desde CommonJS.
  principal().then((codigo) => {
    process.exitCode = codigo;
  });
}
