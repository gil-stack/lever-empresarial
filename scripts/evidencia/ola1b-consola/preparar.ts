// Base local para el recorrido de Ola 1B (consola). Crea la base desde cero,
// aplica db/migrations, carga la semilla de Pagos a proveedores y da de alta,
// con los servicios del producto, una empresa de demostración con su
// administradora. Deja sesiones con segundo factor para el recorrido.
//
//   DUENO_URL=postgres://postgres@127.0.0.1:5542/postgres \
//   ./node_modules/.bin/tsx scripts/evidencia/ola1b-consola/preparar.ts
//
// Imprime, en JSON, las variables que lee scripts/evidencia/ola1b-consola.mjs.
// Solo acepta un Postgres en 127.0.0.1 o localhost.
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

import { cerrarConexion } from "../../../src/nucleo/db";
import { darDeAltaEmpresa } from "../../../src/server/company/servicio";
import { aceptarInvitacion } from "../../../src/server/invitaciones/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../../src/server/plataforma/servicio";
import { aplicarArchivo, ejecutar, urlDeAplicacion } from "../../../tests/aislamiento/postgres";

const BASE = "ola1b_consola";
const CLAVE = "Clave-ola1b-2026!";
const dueno = new URL(process.env.DUENO_URL ?? "postgres://postgres@127.0.0.1:5542/postgres");
if (!["127.0.0.1", "localhost"].includes(dueno.hostname)) throw new Error("DUENO_URL tiene que ser un Postgres local.");

function token(): string {
  return `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
}

function sesion(url: string, userId: string, superficie: "cliente" | "sofipo"): string {
  const valor = token();
  const entradaId = randomUUID();
  ejecutar(url, `
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      values ('${entradaId}', '${userId}', '${createHash("sha256").update(entradaId).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
    insert into sessions (id, user_id, token_hash, expires_at, superficie, segundo_factor, entrada_id)
      values ('${randomUUID()}', '${userId}', '${createHash("sha256").update(valor).digest("hex")}', now() + interval '12 hours', '${superficie}', 'totp', '${entradaId}');
  `);
  return valor;
}

async function principal(): Promise<void> {
  const admin = new Client({ connectionString: dueno.toString() });
  await admin.connect();
  await admin.query(`drop database if exists ${BASE} with (force)`);
  await admin.query(`create database ${BASE}`);
  await admin.end();

  const owner = new URL(dueno.toString());
  owner.pathname = `/${BASE}`;
  const url = owner.toString();
  const dir = join(process.cwd(), "db/migrations");
  for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
  // Taller del Cierre: proveedores, cargos, 69-B y las sesiones de Gil (administrador y liberador) y Rosa (liberadora).
  aplicarArchivo(url, join(process.cwd(), "tests/e2e/seed-pagos.sql"));
  process.env.DATABASE_URL = urlDeAplicacion(url);

  // Fernanda solo tiene el rol de finanzas en Taller: abre Inicio y Pendientes, y
  // el resto de la consola le muestra el estado «sin permiso».
  const finanzasId = randomUUID();
  ejecutar(url, `
    select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', false);
    select set_config('app.company_id', '33333333-3333-4333-8333-333333333333', false);
    insert into users (id, nombre, correo, password_hash)
      values ('${finanzasId}', 'Fernanda Finanzas', 'fernanda@lever.test', '$2b$12$${"a".repeat(53)}');
    insert into memberships (user_id, company_id, estado) values ('${finanzasId}', '33333333-3333-4333-8333-333333333333', 'activa');
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, id, 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'asignar_rol', 'membership_roles', '${finanzasId}', '{"rol":"finanzas"}'
      from companies where id = '33333333-3333-4333-8333-333333333333';
    insert into membership_roles (user_id, company_id, rol) values ('${finanzasId}', '33333333-3333-4333-8333-333333333333', 'finanzas');
  `);

  const personalId = randomUUID();
  ejecutar(url, `
    insert into users (id, nombre, correo, password_hash)
      values ('${personalId}', 'Ofelia Plataforma', 'ofelia@lever.test', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '${personalId}', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '${personalId}', 'administracion_plataforma');
  `);
  const personal = await contextoDePersonal("ofelia@lever.test");
  const empresa = await darDeAltaEmpresa(personal, {
    rfc: "ALO180312AB1",
    razonSocial: "Altamar Logística",
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
  }, { demostracion: true });
  const invitacion = await invitarAdministrador(personal, {
    companyId: empresa.id,
    razonSocial: empresa.razonSocial,
    nombre: "Laura Méndez",
    correo: "laura@lever.test",
  });
  await aceptarInvitacion({ token: invitacion.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  await cerrarConexion();

  console.log(JSON.stringify({
    DUENO_URL: url,
    DATABASE_URL: process.env.DATABASE_URL,
    EMPRESA_TALLER: "33333333-3333-4333-8333-333333333333",
    SESION_GIL: "a".repeat(43),
    SESION_ROSA: "b".repeat(43),
    EMPRESA_ALTAMAR: empresa.id,
    LAURA_ID: invitacion.emitida.userId,
    SESION_LAURA: sesion(url, invitacion.emitida.userId, "cliente"),
    CLAVE_LAURA: CLAVE,
    SESION_OFELIA: sesion(url, personalId, "sofipo"),
    SESION_FERNANDA: sesion(url, finanzasId, "cliente"),
  }, null, 2));
}

principal().catch(async (error: unknown) => {
  await cerrarConexion();
  console.error(error);
  process.exitCode = 1;
});
