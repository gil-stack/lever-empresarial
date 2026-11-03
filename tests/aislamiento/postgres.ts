import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

/**
 * La prueba crea una base, aplica db/migrations y la borra.
 * Este módulo no migra el libro. Compara el destino con DATABASE_URL para
 * rechazarlo, y no imprime ninguna URL.
 */
export function exigirBaseDesechable(): string {
  const url = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
  if (!url) {
    throw new Error(
      "No hay una base desechable. La prueba de aislamiento no se da por pasada. " +
        "Hace falta AISLAMIENTO_DATABASE_URL apuntando a un Postgres donde se pueda crear y borrar una base. " +
        "La prueba aplica las migraciones ahí y lee con leerEmpresa y leerSesion. " +
        "No uses el libro: DATABASE_URL no es esa base y no debe aparecer en la salida.",
    );
  }

  let analizada: URL;
  try {
    analizada = new URL(url);
  } catch {
    throw new Error("AISLAMIENTO_DATABASE_URL no es una URL válida.");
  }
  if (analizada.protocol !== "postgres:" && analizada.protocol !== "postgresql:") {
    throw new Error("AISLAMIENTO_DATABASE_URL tiene que usar el protocolo postgres.");
  }

  const base = decodeURIComponent(analizada.pathname.replace(/^\//, ""));
  if (!base) {
    throw new Error(
      "AISLAMIENTO_DATABASE_URL tiene que nombrar una base de mantenimiento, por ejemplo postgres.",
    );
  }
  if (base === "plataforma") {
    throw new Error(
      "AISLAMIENTO_DATABASE_URL no puede apuntar a la base plataforma. " +
        "Indica una base de mantenimiento en un servidor desechable: la prueba crea otra base y la borra.",
    );
  }

  const libro = process.env.DATABASE_URL?.trim();
  if (libro && mismoDestino(url, libro)) {
    throw new Error(
      "AISLAMIENTO_DATABASE_URL no puede ser el mismo destino que DATABASE_URL. Esa variable es el libro.",
    );
  }
  return url;
}

export async function conBaseDesechable<T>(
  urlAdmin: string,
  fn: (url: string) => Promise<T>,
): Promise<T> {
  const nombre = `aislamiento_${randomBytes(4).toString("hex")}`;
  try {
    ejecutar(urlAdmin, `create database ${ident(nombre)}`);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    throw new Error(
      "No se pudo crear la base desechable del aislamiento. " +
        "AISLAMIENTO_DATABASE_URL tiene que poder crear bases; la prueba no escribe dentro de la base indicada.\n" +
        detalle,
    );
  }

  const url = urlConBase(urlAdmin, nombre);
  let errorDePrueba: unknown;
  try {
    return await fn(url);
  } catch (error) {
    errorDePrueba = error;
    throw error;
  } finally {
    try {
      ejecutar(urlAdmin, `drop database if exists ${ident(nombre)} with (force)`);
    } catch (limpieza) {
      if (errorDePrueba === undefined) {
        const detalle = limpieza instanceof Error ? limpieza.message : String(limpieza);
        throw new Error(`No se pudo borrar la base desechable ${nombre}.\n${detalle}`);
      }
    }
  }
}

export function aplicarArchivo(url: string, archivo: string): void {
  correrPsql(url, ["-f", archivo]);
}

export function ejecutar(url: string, sql: string): void {
  correrPsql(url, ["-c", sql]);
}

export function consultarJson<T>(url: string, sql: string): T {
  const salida = correrPsql(url, ["-A", "-t", "-c", sql]).trim();
  if (!salida) throw new Error("La consulta de aislamiento no devolvió JSON.");
  try {
    return JSON.parse(salida) as T;
  } catch {
    throw new Error(`La consulta de aislamiento no devolvió JSON.\n${salida.slice(0, 500)}`);
  }
}

function ident(nombre: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nombre)) {
    throw new Error("Nombre de base no admitido en la prueba de aislamiento.");
  }
  return `"${nombre}"`;
}

function urlConBase(url: string, base: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(base)) {
    throw new Error(`Nombre de base no admitido: ${base}`);
  }
  const analizada = new URL(url);
  analizada.pathname = `/${base}`;
  return analizada.toString();
}

function correrPsql(url: string, args: string[]): string {
  const { uri, env, secretos } = preparar(url);
  const resultado = spawnSync("psql", [uri, "-X", "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    env,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });

  if (resultado.error) {
    const codigo = (resultado.error as NodeJS.ErrnoException).code;
    if (codigo === "ENOENT" || codigo === "EACCES") {
      throw new Error(
        "No está el cliente psql. Con el esquema ya en db/migrations, la prueba lo usa para " +
          "aplicar esas migraciones sobre AISLAMIENTO_DATABASE_URL.",
      );
    }
    throw new Error(redactar(resultado.error.message, secretos));
  }
  if (resultado.status !== 0) {
    const detalle = redactar(`${resultado.stderr ?? ""}\n${resultado.stdout ?? ""}`.trim(), secretos);
    throw new Error(detalle || "psql terminó con error.");
  }
  return resultado.stdout ?? "";
}

function preparar(url: string): { uri: string; env: NodeJS.ProcessEnv; secretos: string[] } {
  const analizada = new URL(url);
  const password = decodeURIComponent(analizada.password);
  const secretos = [
    url,
    password,
    process.env.DATABASE_URL ?? "",
    process.env.AISLAMIENTO_DATABASE_URL ?? "",
  ].filter((valor) => valor.length > 0);
  analizada.password = "";
  const env: NodeJS.ProcessEnv = { ...process.env };
  // El cliente que aplica el SQL no hereda el libro ni la URL con secreto.
  delete env.DATABASE_URL;
  delete env.AISLAMIENTO_DATABASE_URL;
  if (password) env.PGPASSWORD = password;
  const opciones = ["-c statement_timeout=30000", "-c lock_timeout=10000"];
  env.PGOPTIONS = [process.env.PGOPTIONS, ...opciones].filter(Boolean).join(" ");
  env.PGCLIENTENCODING = "UTF8";
  return { uri: analizada.toString(), env, secretos };
}

function mismoDestino(izquierda: string, derecha: string): boolean {
  const a = destino(izquierda);
  const b = destino(derecha);
  return a !== null && a === b;
}

function destino(url: string): string | null {
  try {
    const analizada = new URL(url);
    const puerto = analizada.port || "5432";
    const base = decodeURIComponent(analizada.pathname.replace(/^\//, ""));
    const host = analizada.searchParams.get("host") || analizada.hostname;
    return `${host}:${puerto}:${decodeURIComponent(analizada.username)}:${base}`;
  } catch {
    return null;
  }
}

function redactar(texto: string, secretos: string[]): string {
  let limpio = texto;
  for (const secreto of secretos) {
    if (secreto.length > 0) limpio = limpio.split(secreto).join("***");
  }
  return limpio;
}
