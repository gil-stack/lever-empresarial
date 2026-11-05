import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { hoyEnMexico } from "../../src/dominio/personas";
import { cerrarConexion } from "../../src/nucleo/db";
import { darDeAltaEmpresa } from "../../src/server/company/servicio";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio";
import { aplicarArchivo, ejecutar, urlDeAplicacion } from "../aislamiento/postgres";

const CLAVE = "clave-segura-12";
const PUERTO = process.env.E2E_PUERTO ?? "3107";

export async function iniciarEntorno(): Promise<void> {
  const admin = process.env.E2E_ADMIN_URL ?? process.env.AISLAMIENTO_DATABASE_URL;
  if (!admin) throw new Error("Define E2E_ADMIN_URL con un Postgres desechable. Nunca uses la base plataforma.");
  const analizada = new URL(admin);
  if (analizada.pathname === "/plataforma") throw new Error("La base administrativa de E2E no puede ser plataforma.");
  const nombre = `personas_e2e_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
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
    process.env.DATABASE_URL = urlDeAplicacion(owner);
    process.env.URL_APLICACION = `http://127.0.0.1:${PUERTO}`;
    process.env.E2E_SERVER_ACTIONS = "1";
    delete process.env.RESEND_API_KEY;
    delete process.env.CORREO_REMITENTE;
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
    await cerrarConexion();
    await levantarServidor();
  } catch (error) {
    await cerrarConexion();
    await detenerServidor();
    await borrarBase(admin, nombre);
    throw error;
  }
}

export async function cerrarEntorno(): Promise<void> {
  await detenerServidor();
  await cerrarConexion();
  const admin = process.env.E2E_ADMIN_URL ?? process.env.AISLAMIENTO_DATABASE_URL;
  const nombre = process.env.E2E_DATABASE_NAME;
  if (admin && nombre) await borrarBase(admin, nombre);
}

async function levantarServidor(): Promise<void> {
  const directorioRegistro = mkdtempSync(join(tmpdir(), "personas-e2e-"));
  const registro = createWriteStream(join(directorioRegistro, "next.log"));
  const servidor = spawn("npm", ["run", "start", "--", "-p", PUERTO], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production" },
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
