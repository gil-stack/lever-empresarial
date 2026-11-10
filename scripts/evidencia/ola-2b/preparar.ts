// Base local para el recorrido de la Ola 2b (navegación, modo demostración y
// Aprobaciones). Crea la base desde cero, aplica db/migrations y siembra:
//
// - Taller del Cierre, una empresa REAL (demostracion = false): la semilla de
//   Pagos a proveedores con la marca de demostración apagada, dos pagos por
//   autorizar que pidió Gil, una persona con nómina semanal vencida y sin lote,
//   y una persona por rol (administradora, finanzas, contadora, liberadora y
//   solicitante) para ver qué abre cada puerta.
// - Altamar Logística, la empresa de DEMOSTRACIÓN del diseño, con Laura.
//
//   DUENO_URL=postgres://postgres@127.0.0.1:5552/postgres \
//   ./node_modules/.bin/tsx scripts/evidencia/ola-2b/preparar.ts > test-results/ola-2b/entorno.json
//
// Imprime, en JSON, las variables que lee scripts/evidencia/ola-2b-navegacion.mjs.
// Solo acepta un Postgres en 127.0.0.1 o localhost.
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";

import { hoyEnMexico } from "../../../src/dominio/personas";
import { cerrarConexion } from "../../../src/nucleo/db";
import { aceptarInvitacion } from "../../../src/server/invitaciones/servicio";
import { darDeAltaPersona, nombrarCentro } from "../../../src/server/personas/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../../src/server/plataforma/servicio";
import { leerSesion } from "../../../src/server/session/servicio";
import { resolverContexto } from "../../../src/server/tenencia/resolver";
import { aplicarArchivo, ejecutar, urlDeAplicacion } from "../../../tests/aislamiento/postgres";
import { darDeAltaComoDuena } from "../../empresa-por-la-duena";

const BASE = "ola_2b";
const CLAVE = "Clave-ola2b-2026!";
const TALLER = "33333333-3333-4333-8333-333333333333";
const GIL = "11111111-1111-4111-8111-111111111111";
const dueno = new URL(process.env.DUENO_URL ?? "postgres://postgres@127.0.0.1:5552/postgres");
if (!["127.0.0.1", "localhost"].includes(dueno.hostname)) throw new Error("DUENO_URL tiene que ser un Postgres local.");

function token(): string {
  return `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
}

/** Una sesión de cliente con TOTP recién verificado: abre la consola y autoriza dentro de 30 minutos. */
function sesion(url: string, userId: string, superficie: "cliente" | "sofipo" = "cliente"): string {
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

/** Una persona con un rol en una empresa, con su rastro en la bitácora como lo exige la base. */
function personaConRol(url: string, empresa: string, actor: string, nombre: string, correo: string, rol: string): string {
  const id = randomUUID();
  ejecutar(url, `
    select set_config('app.user_id', '${actor}', false);
    select set_config('app.company_id', '${empresa}', false);
    insert into users (id, nombre, correo, password_hash)
      values ('${id}', '${nombre}', '${correo}', '$2b$12$${"a".repeat(53)}');
    insert into memberships (user_id, company_id, estado) values ('${id}', '${empresa}', 'activa');
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, id, 'miembro', '${actor}', 'cliente', 'asignar_rol', 'membership_roles', '${id}', '{"rol":"${rol}"}'
      from companies where id = '${empresa}';
    insert into membership_roles (user_id, company_id, rol) values ('${id}', '${empresa}', '${rol}');
  `);
  return id;
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

  // La semilla de Pagos a proveedores, con Taller del Cierre como empresa real.
  const semilla = readFileSync(join(process.cwd(), "tests/e2e/seed-pagos.sql"), "utf8");
  const real = semilla.replace("'activa', true);", "'activa', false);");
  if (real === semilla) throw new Error("La semilla cambió: no se encontró la marca de demostración de Taller.");
  const archivoReal = join(tmpdir(), `ola-2b-semilla-${process.pid}.sql`);
  writeFileSync(archivoReal, real);
  aplicarArchivo(url, archivoReal);
  process.env.DATABASE_URL = urlDeAplicacion(url);

  // Un segundo pago por autorizar (excepción) para clicar «Rechazar» con motivo.
  ejecutar(url, `
    select set_config('app.user_id', '${GIL}', false);
    select set_config('app.company_id', '${TALLER}', false);
    insert into supplier_payables (id, company_id, supplier_id, origen, referencia, total_centavos, emitida_el, vence_el, programada_el, motivo_excepcion, creado_por, creado_en, actualizado_en)
      values ('77777777-7777-4777-8777-777777777774', '${TALLER}', '44444444-4444-4444-8444-444444444442', 'excepcion', 'Mantenimiento de montacargas', 2315000, current_date - 4, current_date + 10, current_date + 3, 'Reparación urgente sin factura todavía', '${GIL}', now(), now());
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, '${TALLER}', 'miembro', '${GIL}', 'cliente', 'crear_cargo_proveedor', 'supplier_payables', '77777777-7777-4777-8777-777777777774', '{"origen":"excepcion","total_centavos":2315000}' from companies where id = '${TALLER}';
    insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el, solicitado_por, solicitado_en, creado_en)
      select '88888888-8888-4888-8888-888888888884', p.company_id, p.id, sc.id, sc.clabe, p.total_centavos, p.programada_el, '${GIL}', now(), now()
        from supplier_payables p join supplier_clabes sc on sc.company_id = p.company_id and sc.supplier_id = p.supplier_id and sc.vigente_hasta is null where p.id = '77777777-7777-4777-8777-777777777774';
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, '${TALLER}', 'miembro', '${GIL}', 'cliente', 'solicitar_pago_proveedor', 'supplier_payment_requests', '88888888-8888-4888-8888-888888888884', '{"total_centavos":2315000}' from companies where id = '${TALLER}';
  `);

  // Una persona por rol en la empresa real.
  const ana = personaConRol(url, TALLER, GIL, "Ana Administradora", "ana-2b@lever.test", "administrador");
  const fernanda = personaConRol(url, TALLER, GIL, "Fernanda Finanzas", "fernanda-2b@lever.test", "finanzas");
  const carla = personaConRol(url, TALLER, GIL, "Carla Contadora", "carla-2b@lever.test", "contador");
  const sergio = personaConRol(url, TALLER, GIL, "Sergio Solicitante", "sergio-2b@lever.test", "solicitante");

  // Nómina semanal vencida hoy y sin lote: Aprobaciones la ofrece para preparar.
  const sesionGil = await leerSesion(`sesion=${"a".repeat(43)}`);
  if (!sesionGil) throw new Error("La sesión sembrada de Gil no abrió.");
  const gil = (await resolverContexto({ sesion: sesionGil, empresaPedida: TALLER, peticionId: null, superficie: "cliente" })).ctx;
  const hoy = hoyEnMexico(new Date());
  const operacion = await nombrarCentro(gil, { nombre: "Operación", presupuesto: "80000.00" });
  await darDeAltaPersona(gil, {
    nombre: "Marta Ruiz",
    alta: hoy,
    baja: "",
    centroId: operacion.id,
    jefeId: "",
    presupuesto: "3000.00",
    altaLlave: randomUUID(),
    neto: "18500.00",
    frecuencia: "semanal",
    primerPago: hoy,
    destino: "clabe",
    clabe: "002180701150123452",
    acceso: "no",
    correo: "",
    rol: "",
  });

  // La empresa de demostración del diseño, dada de alta por el personal del operador.
  const personalId = randomUUID();
  ejecutar(url, `
    insert into users (id, nombre, correo, password_hash)
      values ('${personalId}', 'Ofelia Plataforma', 'ofelia-2b@lever.test', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '${personalId}', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '${personalId}', 'administracion_plataforma');
  `);
  const personal = await contextoDePersonal("ofelia-2b@lever.test");
  const altamar = await darDeAltaComoDuena(url, personal, {
    rfc: "ALO180312AB1",
    razonSocial: "Altamar Logística",
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
  }, { demostracion: true, corridoPor: "ofelia-2b@lever.test" });
  const invitacion = await invitarAdministrador(personal, {
    companyId: altamar.id,
    razonSocial: altamar.razonSocial,
    nombre: "Laura Méndez",
    correo: "laura-2b@lever.test",
  });
  await aceptarInvitacion({ token: invitacion.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const lauraId = invitacion.emitida.userId;
  const solicitanteDemo = personaConRol(url, altamar.id, lauraId, "Daniela Ruiz", "daniela-2b@lever.test", "solicitante");
  await cerrarConexion();

  console.log(JSON.stringify({
    DUENO_URL: url,
    DATABASE_URL: process.env.DATABASE_URL,
    EMPRESA_TALLER: TALLER,
    EMPRESA_ALTAMAR: altamar.id,
    PAGO_AUTORIZAR: "88888888-8888-4888-8888-888888888882",
    PAGO_RECHAZAR: "88888888-8888-4888-8888-888888888884",
    SESION_GIL: "a".repeat(43),
    SESION_ROSA: "b".repeat(43),
    SESION_ANA: sesion(url, ana),
    SESION_FERNANDA: sesion(url, fernanda),
    SESION_CARLA: sesion(url, carla),
    SESION_SERGIO: sesion(url, sergio),
    SESION_LAURA: sesion(url, lauraId),
    SESION_DANIELA: sesion(url, solicitanteDemo),
    CORREO_ANA: "ana-2b@lever.test",
  }, null, 2));
}

principal().catch(async (error: unknown) => {
  await cerrarConexion();
  console.error(error);
  process.exitCode = 1;
});
