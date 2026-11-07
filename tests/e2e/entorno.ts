import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

import { iniciarBlobLocal, type BlobLocal } from "./blob-local/servidor";
import { sembrarRecorridos } from "./siembra";

import { hoyEnMexico } from "../../src/dominio/personas";
import { cerrarConexion } from "../../src/nucleo/db";
import { darDeAltaEmpresa } from "../../src/server/company/servicio";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio";
import { aplicarArchivo, ejecutar, urlDeAplicacion } from "../aislamiento/postgres";

const CLAVE = "clave-segura-12";
// Los mismos valores por omisión que playwright.config.ts y next.config.ts.
const PUERTO = process.env.E2E_PUERTO ?? "3109";
const ORIGEN = process.env.E2E_BASE_URL ?? `http://localhost:${PUERTO}`;
// 0 deja que el sistema elija un puerto libre.
const PUERTO_BLOB = Number(process.env.E2E_BLOB_PUERTO ?? "0");
// Token falso con la forma vercel_blob_rw_<almacén>_<clave>: @vercel/blob saca
// de ahí el almacén («e2elocal»). Solo vale contra el emulador local.
const TOKEN_BLOB_LOCAL = ["vercel", "blob", "rw", "e2elocal", "emulador"].join("_");
const PRELOAD_BLOB = join(process.cwd(), "tests/e2e/blob-local/preload.mjs");
// Proveedor de correo falso: los recorridos leen las invitaciones y los enlaces de recuperación que «llegan».
const PRELOAD_CORREO = join(process.cwd(), "tests/e2e/correo-local/preload.mjs");
const ARCHIVO_CORREO = join(process.cwd(), "test-results/correos-e2e.jsonl");
// Solo existe en el servidor de la prueba, que nunca llama a Resend: el preload contesta por él.
const CLAVE_CORREO_LOCAL = ["e2e", "correo", "local"].join("-");

declare global {
  var __blobLocalE2E: BlobLocal | undefined;
}

/** E2E_ADMIN_URL puede venir sin base (como la usa reiniciar-pagos.sh): se conecta a postgres. */
function urlAdministrativa(): string | undefined {
  const admin = process.env.E2E_ADMIN_URL ?? process.env.AISLAMIENTO_DATABASE_URL;
  if (!admin) return undefined;
  const analizada = new URL(admin);
  if (analizada.pathname === "" || analizada.pathname === "/") analizada.pathname = "/postgres";
  return analizada.toString();
}

export async function iniciarEntorno(): Promise<void> {
  const admin = urlAdministrativa();
  if (!admin) throw new Error("Define E2E_ADMIN_URL con un Postgres desechable. Nunca uses la base plataforma.");
  const analizada = new URL(admin);
  if (analizada.pathname === "/plataforma") throw new Error("La base administrativa de E2E no puede ser plataforma.");
  const nombre = `e2e_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const cliente = new Client({ connectionString: admin });
  await cliente.connect();
  await cliente.query(`create database "${nombre}"`);
  await cliente.end();
  analizada.pathname = `/${nombre}`;
  const owner = analizada.toString();
  process.env.E2E_OWNER_DATABASE_URL = owner;
  process.env.E2E_DATABASE_NAME = nombre;
  try {
    const dir = join(process.cwd(), "db/migrations");
    for (const archivo of readdirSync(dir).sort()) {
      if (archivo.endsWith(".sql")) aplicarArchivo(owner, join(dir, archivo));
    }
    // La empresa de Pagos a proveedores va primero: su semilla reescribe la
    // contraseña de todos los usuarios que existan en ese momento.
    aplicarArchivo(owner, join(process.cwd(), "tests/e2e/seed-pagos.sql"));
    process.env.DATABASE_URL = urlDeAplicacion(owner);
    process.env.URL_APLICACION = ORIGEN;
    process.env.E2E_SERVER_ACTIONS = "1";
    delete process.env.RESEND_API_KEY;
    delete process.env.CORREO_REMITENTE;
    // Llave TOTP de esta corrida: la siembra cifra las semillas con ella y el servidor las lee.
    process.env.AUTENTICACION_LLAVE_TOTP = randomBytes(32).toString("base64url");
    ejecutar(owner, `
      insert into users (id, nombre, correo, password_hash)
        values ('99999999-9999-4999-8999-999999999999', 'Personal E2E', 'personal-e2e@ejemplo.mx', '$2b$12$${"a".repeat(53)}');
      insert into platform_staff (operator_id, user_id, estado)
        values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'activo');
      insert into platform_staff_roles (operator_id, user_id, rol)
        values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'administracion_plataforma');
    `);
    const personal = await contextoDePersonal("personal-e2e@ejemplo.mx");
    const empresa = await darDeAltaEmpresa(personal, {
      rfc: "TCM010101AB1",
      razonSocial: "Empresa Personas E2E",
      codigoPostal: "06600",
      regimen: "601",
      usoCfdi: "G03",
    }, { demostracion: true });
    const invitacion = await invitarAdministrador(personal, {
      companyId: empresa.id,
      razonSocial: empresa.razonSocial,
      nombre: "Admin E2E",
      correo: "admin-e2e@ejemplo.mx",
    });
    await aceptarInvitacion({ token: invitacion.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
    const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
    const entradaId = randomUUID();
    ejecutar(owner, `
      insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
        values ('${entradaId}', '${invitacion.emitida.userId}', '${createHash("sha256").update(entradaId).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
      insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
        values ('${randomUUID()}', '${invitacion.emitida.userId}', '${createHash("sha256").update(token).digest("hex")}', now() + interval '12 hours', 'totp', '${entradaId}');
    `);
    process.env.E2E_SESSION_TOKEN = token;
    process.env.E2E_COMPANY_ID = empresa.id;
    process.env.E2E_ADMIN_ID = invitacion.emitida.userId;
    process.env.E2E_TODAY = hoyEnMexico(new Date());
    await sembrarRecorridos(owner);
    await cerrarConexion();
    await levantarBlobLocal();
    await levantarServidor();
  } catch (error) {
    await cerrarConexion();
    await detenerServidor();
    await detenerBlobLocal();
    await borrarBase(admin, nombre);
    throw error;
  }
}

export async function cerrarEntorno(): Promise<void> {
  await detenerServidor();
  await detenerBlobLocal();
  await cerrarConexion();
  const admin = urlAdministrativa();
  const nombre = process.env.E2E_DATABASE_NAME;
  if (admin && nombre) await borrarBase(admin, nombre);
}

/**
 * Los recorridos que suben constancias, contratos, CFDI y evidencia nunca usan
 * un almacén real: el token de Blob del entorno se reemplaza por el del
 * emulador y put/del/get van a 127.0.0.1.
 */
async function levantarBlobLocal(): Promise<void> {
  const blob = await iniciarBlobLocal(PUERTO_BLOB, TOKEN_BLOB_LOCAL);
  globalThis.__blobLocalE2E = blob;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.BLOB_STORE_ID;
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN_BLOB_LOCAL;
  process.env.VERCEL_BLOB_API_URL = blob.api;
  process.env.E2E_BLOB_LOCAL_URL = blob.origen;
  process.env.E2E_BLOB_LOCAL = "1";
}

async function detenerBlobLocal(): Promise<void> {
  await globalThis.__blobLocalE2E?.cerrar();
  globalThis.__blobLocalE2E = undefined;
}

async function levantarServidor(): Promise<void> {
  // Fuera de outputDir (Playwright lo vacía al empezar); el script de CI lo imprime si algo falla.
  mkdirSync(join(process.cwd(), "test-results"), { recursive: true });
  const registro = createWriteStream(join(process.cwd(), "test-results/next-e2e.log"));
  writeFileSync(ARCHIVO_CORREO, "");
  process.env.E2E_CORREO_ARCHIVO = ARCHIVO_CORREO;
  const servidor = spawn("npm", ["run", "start", "--", "-p", PUERTO], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      RESEND_API_KEY: CLAVE_CORREO_LOCAL,
      CORREO_REMITENTE: "Lever E2E <no-responder@lever-e2e.mx>",
      // Solo el servidor de la prueba carga el desvío del almacén privado al emulador y el correo falso.
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${PRELOAD_BLOB}`, `--import=${PRELOAD_CORREO}`].filter(Boolean).join(" "),
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  servidor.stdout.pipe(registro);
  servidor.stderr.pipe(registro);
  if (!servidor.pid) throw new Error("No se pudo arrancar Next para E2E.");
  process.env.E2E_SERVER_PID = String(servidor.pid);
  for (let intento = 0; intento < 120; intento += 1) {
    if (servidor.exitCode !== null) throw new Error("Next terminó antes de abrir el puerto E2E.");
    try {
      const respuesta = await fetch(`http://127.0.0.1:${PUERTO}/salud`);
      if (respuesta.ok) return;
    } catch {
      // El servidor todavía está compilando.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Next no abrió el puerto ${PUERTO} en 60 segundos.`);
}

async function detenerServidor(): Promise<void> {
  const pid = Number(process.env.E2E_SERVER_PID);
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Ya estaba detenido.
    }
  }
  delete process.env.E2E_SERVER_PID;
}

async function borrarBase(admin: string, nombre: string): Promise<void> {
  const cliente = new Client({ connectionString: admin });
  await cliente.connect();
  await cliente.query(`drop database if exists "${nombre}" with (force)`);
  await cliente.end();
}
