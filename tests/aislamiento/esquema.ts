import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tablas del cimiento. Hasta que las migraciones las creen, la prueba de
 * aislamiento no puede correr contra el libro y queda pendiente de esquema.
 */
export const TABLAS_CIMIENTO = [
  "companies",
  "users",
  "sessions",
  "memberships",
  "audit_events",
] as const;

export type TablaCimiento = (typeof TABLAS_CIMIENTO)[number];

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/** `tests/aislamiento` vive dos niveles bajo la raíz del repositorio. */
export const DIRECTORIO_MIGRACIONES = path.resolve(AQUI, "../../db/migrations");

export type Esquema =
  | { pendiente: true; motivo: string }
  | { pendiente: false; archivos: string[] };

export function evaluarEsquema(directorio: string): Esquema {
  const etiqueta = etiquetar(directorio);
  if (!existsSync(directorio) || !statSync(directorio).isDirectory()) {
    return {
      pendiente: true,
      motivo:
        `pendiente de esquema: no existe ${etiqueta}. ` +
        "La prueba de aislamiento está escrita contra LecturaDeNegocio; " +
        "correrá cuando el cimiento cree companies, users, sessions, " +
        "memberships y audit_events. No se omite.",
    };
  }

  const archivos = readdirSync(directorio)
    .filter((nombre) => nombre.endsWith(".sql") && !nombre.startsWith("."))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((nombre) => path.join(directorio, nombre));

  if (archivos.length === 0) {
    return {
      pendiente: true,
      motivo:
        `pendiente de esquema: ${etiqueta} no tiene archivos .sql. ` +
        "La prueba de aislamiento está escrita contra LecturaDeNegocio y no se omite.",
    };
  }

  const encontradas = new Set<string>();
  for (const archivo of archivos) {
    for (const tabla of tablasDeclaradas(readFileSync(archivo, "utf8"))) {
      encontradas.add(tabla);
    }
  }

  const faltan = TABLAS_CIMIENTO.filter((tabla) => !encontradas.has(tabla));
  if (faltan.length > 0) {
    return {
      pendiente: true,
      motivo:
        `pendiente de esquema: ${etiqueta} todavía no crea ${faltan.join(", ")}. ` +
        "La prueba de aislamiento está escrita contra LecturaDeNegocio y no se omite.",
    };
  }

  return { pendiente: false, archivos };
}

/**
 * Nombres creados con CREATE TABLE. Se ignoran comentarios, literales y
 * cuerpos entre dólares para no tomar una tabla que solo está mencionada.
 */
export function tablasDeclaradas(sql: string): string[] {
  const limpio = enmascararSql(sql);
  const expresion =
    /\bcreate\s+(?:unlogged\s+|temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:only\s+)?([^\s(]+)/gi;
  const nombres: string[] = [];
  for (const coincidencia of limpio.matchAll(expresion)) {
    const nombre = limpiarNombre(coincidencia[1] ?? "");
    if (/^[a-z_][a-z0-9_]*$/.test(nombre)) nombres.push(nombre);
  }
  return nombres;
}

export function enmascararSql(sql: string): string {
  let salida = "";
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const fin = sql.indexOf("\n", i);
      i = fin === -1 ? sql.length : fin;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const fin = sql.indexOf("*/", i + 2);
      i = fin === -1 ? sql.length : fin + 2;
      continue;
    }
    if (sql[i] === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      salida += "''";
      continue;
    }
    if (sql[i] === "$") {
      const marca = /^\$([A-Za-z0-9_]*)\$/.exec(sql.slice(i));
      if (marca) {
        const cierre = `$${marca[1]}$`;
        const fin = sql.indexOf(cierre, i + marca[0].length);
        i = fin === -1 ? sql.length : fin + cierre.length;
        salida += "''";
        continue;
      }
    }
    salida += sql[i];
    i += 1;
  }
  return salida;
}

function limpiarNombre(token: string): string {
  const sinPuntuacion = token.replace(/[;,]+$/g, "");
  const partes = sinPuntuacion.split(".");
  const ultimo = partes[partes.length - 1] ?? "";
  return ultimo.replaceAll('"', "").toLowerCase();
}

function etiquetar(directorio: string): string {
  const normalizado = directorio.replaceAll("\\", "/");
  if (normalizado.endsWith("db/migrations")) return "db/migrations";
  return directorio;
}
