import assert, { AssertionError } from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { darDeAltaEmpresa, leerEmpresa } from "../../src/server/company/servicio.ts";
import { ErrorDeDominio } from "../../src/server/session/error-de-dominio.ts";
import { NOMBRE_COOKIE } from "../../src/server/session/cookie.ts";
import { cerrarConexion } from "../../src/server/session/db.ts";
import { abrirCuenta, leerSesion } from "../../src/server/session/servicio.ts";
import { DIRECTORIO_MIGRACIONES, evaluarEsquema } from "./esquema.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable } from "./postgres.ts";

/**
 * Fase 1. El usuario de la empresa A no lee la empresa B.
 *
 * Corre con `node --test tests/aislamiento/aislamiento.test.ts`.
 * Lee con `leerSesion` y `leerEmpresa` de `src/server`. No hay un SQL paralelo.
 *
 * Hace falta AISLAMIENTO_DATABASE_URL: un Postgres desechable, no el libro.
 * La prueba crea una base, aplica las seis migraciones y la borra. Apunta
 * DATABASE_URL solo a esa base, en este proceso, y no imprime la URL.
 * Si no hay base desechable, falla: no se omite y no se da por pasada.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CONTRASENA = "clave-segura-12";
const RFC_A = "TCM010101AB1";
const RFC_B = "CABL840215RF4";
const RAZON_A = "Escuela Alfa Aislamiento";
const RAZON_B = "Taller Beta Aislamiento";

test("el aislamiento lee con leerEmpresa y leerSesion, no con un SQL paralelo", () => {
  const otras = readdirSync(AQUI)
    .filter((nombre) => nombre.endsWith(".ts") && nombre !== "aislamiento.test.ts")
    .map((nombre) => readFileSync(path.join(AQUI, nombre), "utf8"))
    .join("\n");
  const esta = readFileSync(new URL("./aislamiento.test.ts", import.meta.url), "utf8");
  assert.match(esta, /leerEmpresa/);
  assert.match(esta, /leerSesion/);
  assert.match(esta, /src\/server\/company\/servicio/);
  assert.match(esta, /src\/server\/session\/servicio/);
  assert.equal(otras.includes("crearLectura"), false);
  assert.equal(otras.includes("sqlLeerEmpresa"), false);
  assert.equal(otras.includes("LecturaDeNegocio"), false);
});

test("el usuario de la empresa A no lee la empresa B", async () => {
  const esquema = evaluarEsquema(DIRECTORIO_MIGRACIONES);
  if (esquema.pendiente) throw new Error(esquema.motivo);
  if (esquema.archivos.length < 6) {
    throw new Error(
      `La prueba de aislamiento no se da por pasada: hacían falta las seis migraciones y hay ${esquema.archivos.length}.`,
    );
  }

  const urlAdmin = exigirBaseDesechable();
  const previo = process.env.DATABASE_URL;
  await conBaseDesechable(urlAdmin, async (url) => {
    for (const archivo of esquema.archivos) {
      aplicarArchivo(url, archivo);
    }
    await cerrarConexion();
    process.env.DATABASE_URL = url;
    try {
      await escenario();
    } catch (error) {
      throw sinSecreto(error);
    } finally {
      await cerrarConexion();
      if (previo === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previo;
    }
  });
});

async function escenario(): Promise<void> {
  const alfa = await abrirEmpresa({
    nombre: "Persona Alfa",
    correo: "alfa-aislamiento@ejemplo.mx",
    rfc: RFC_A,
    razonSocial: RAZON_A,
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
  });
  const beta = await abrirEmpresa({
    nombre: "Persona Beta",
    correo: "beta-aislamiento@ejemplo.mx",
    rfc: RFC_B,
    razonSocial: RAZON_B,
    codigoPostal: "44100",
    regimen: "612",
    usoCfdi: "G03",
  });

  const sesionA = await leerSesion(alfa.cookie);
  const sesionB = await leerSesion(beta.cookie);
  assert.ok(sesionA);
  assert.ok(sesionB);
  assert.equal(sesionA.companyId, alfa.empresaId);
  assert.equal(sesionB.companyId, beta.empresaId);
  assert.notEqual(sesionA.companyId, beta.empresaId);

  const aPideB = await leerEmpresa(sesionA, { companyId: beta.empresaId });
  assert.equal(aPideB?.id, alfa.empresaId);
  assert.equal(aPideB?.rfc, RFC_A);
  assert.equal(aPideB?.razonSocial, RAZON_A);
  assert.equal(json(aPideB).includes(beta.empresaId), false);
  assert.equal(json(aPideB).includes(RFC_B), false);
  assert.equal(json(aPideB).includes(RAZON_B), false);
  assert.equal(json(sesionA).includes(RFC_B), false);
  assert.equal(json(sesionA).includes(RAZON_B), false);
  assert.equal(json(sesionA).includes(beta.empresaId), false);

  const bPideA = await leerEmpresa(sesionB, { companyId: alfa.empresaId });
  assert.equal(bPideA?.id, beta.empresaId);
  assert.equal(bPideA?.rfc, RFC_B);
  assert.equal(json(bPideA).includes(RFC_A), false);
  assert.equal(json(bPideA).includes(RAZON_A), false);
  assert.equal(json(bPideA).includes(alfa.empresaId), false);

  const suelta = await abrirCuenta({
    nombre: "Persona Suelta",
    correo: "suelta-aislamiento@ejemplo.mx",
    contrasena: CONTRASENA,
  });
  const sesionSuelta = await leerSesion(suelta.setCookie);
  assert.equal(sesionSuelta?.companyId, null);
  assert.equal(await leerEmpresa(sesionSuelta), null);
  assert.equal(json(sesionSuelta).includes(RFC_A), false);
  assert.equal(json(sesionSuelta).includes(RFC_B), false);

  const tokenVencido = "e".repeat(43);
  await abrirCuenta(
    {
      nombre: "Persona Vencida",
      correo: "vencida-aislamiento@ejemplo.mx",
      contrasena: CONTRASENA,
    },
    {
      ahora: () => new Date("2000-01-01T00:00:00.000Z"),
      token: () => tokenVencido,
    },
  );
  assert.equal(await leerSesion(`${NOMBRE_COOKIE}=${tokenVencido}`), null);
  assert.equal(await leerSesion(`${NOMBRE_COOKIE}=${"f".repeat(43)}`), null);

  await assert.rejects(
    leerEmpresa(null, { companyId: beta.empresaId }),
    (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sesion_ausente",
  );
}

async function abrirEmpresa(datos: {
  nombre: string;
  correo: string;
  rfc: string;
  razonSocial: string;
  codigoPostal: string;
  regimen: string;
  usoCfdi: string;
}): Promise<{ cookie: string; empresaId: string }> {
  const abierta = await abrirCuenta({
    nombre: datos.nombre,
    correo: datos.correo,
    contrasena: CONTRASENA,
  });
  const empresa = await darDeAltaEmpresa(abierta.sesion, {
    rfc: datos.rfc,
    razonSocial: datos.razonSocial,
    codigoPostal: datos.codigoPostal,
    regimen: datos.regimen,
    usoCfdi: datos.usoCfdi,
  });
  return { cookie: abierta.setCookie, empresaId: empresa.id };
}

function json(valor: unknown): string {
  return JSON.stringify(valor);
}

function sinSecreto(error: unknown): Error {
  if (error instanceof AssertionError) return error;
  const secretos: string[] = [];
  for (const valor of [process.env.DATABASE_URL ?? "", process.env.AISLAMIENTO_DATABASE_URL ?? ""]) {
    if (!valor) continue;
    secretos.push(valor);
    try {
      const clave = decodeURIComponent(new URL(valor).password);
      if (clave) secretos.push(clave);
    } catch {
      // El valor no es una URL. Igual se redacta entero.
    }
  }
  const texto = error instanceof Error ? error.message : String(error);
  let limpio = texto;
  for (const secreto of secretos) limpio = limpio.split(secreto).join("***");
  return new Error(limpio || "La prueba de aislamiento falló.");
}
