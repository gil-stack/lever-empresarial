// Base local para el recorrido de la Ola R2 (PLD). Una sola fase:
//
//   Crea la base «ola_r2_pld» desde cero, aplica db/migrations (0001-0030) y la semilla de Pagos a
//   proveedores (Taller del Cierre: tres proveedores con la misma CLABE, el pago A-81 ya autorizado y
//   el N-204 por autorizar, sesiones de Gil y Rosa). Con los servicios del producto:
//   - Taller (activa) con perfil transaccional que Omar propone y Celia aprueba: pagos $50,000.00 al mes y nómina $15,000.00.
//     El A-81 ($48,215.00) ya cuenta en el mes; al autorizar el N-204 la suma cruza el perfil (flujo 2).
//   - Un tercer pago por autorizar a la misma CLABE, $45,000.00: con él son tres instrucciones de
//     menos de $100,000.00 que suman más (fraccionamiento, flujo 3).
//   - Marta Ruiz con nómina semanal de $18,500.00 que vence hoy: el lote pasa el perfil (flujo 4).
//   - Nogal Comercial en alta con expediente aprobado, grado de riesgo y activación pedida, sin
//     perfil: la base no deja activarla (flujo 1).
//   - Cobre Antiguo activa, con su contrato celebrado hace siete meses: la evaluación semestral del
//     semestre en curso está pendiente (flujo 12). La aprobación de la activación la fecha la dueña.
//   - El personal SOFIPO con sus roles: Ofelia administra, Omar origina, Ana aprueba, Celia cumple
//     (y es la Oficial) y Aurelio audita. Cada quien con su app autenticadora y una sesión SOFIPO.
//
//   ESTADO=/fuera/del/repo/ola-r2-pld.json \
//   AUTENTICACION_LLAVE_TOTP=… BLOB_READ_WRITE_TOKEN=… VERCEL_BLOB_API_URL=… \
//   DUENO_URL=postgres://postgres@127.0.0.1:5553/postgres \
//   ./node_modules/.bin/tsx scripts/evidencia/ola-r2-pld/preparar.ts
//
// ESTADO guarda semillas TOTP y sesiones: tiene que vivir fuera del repositorio. Nada de eso se
// imprime. Solo acepta un Postgres en 127.0.0.1 o localhost.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

import { hoyEnMexico } from "../../../src/dominio/operacion";
import type { ContextoDePersonal } from "../../../src/nucleo/contexto";
import { cerrarConexion } from "../../../src/nucleo/db";
import { cifrarSemilla } from "../../../src/server/autenticacion/cifrado";
import { llaveTotpDesdeEntorno } from "../../../src/server/autenticacion/entorno";
import { decidirActivacion, solicitarActivacion } from "../../../src/server/operacion/activaciones";
import { registrarProspecto } from "../../../src/server/operacion/clientes";
import { calificarRiesgoEmpresa, dictaminarVersion, enviarVersion } from "../../../src/server/operacion/expediente";
import { darDeAltaPersona, nombrarCentro } from "../../../src/server/personas/servicio";
import { declararPerfil, resolverPropuestaDePerfil } from "../../../src/server/pld/perfil";
import { contextoDePersonal } from "../../../src/server/plataforma/servicio";
import { almacenVercel } from "../../../src/server/proveedores/constancia";
import { leerSesion } from "../../../src/server/session/servicio";
import { resolverContexto } from "../../../src/server/tenencia/resolver";
import { aplicarArchivo, consultarJson, ejecutar, urlDeAplicacion } from "../../../tests/aislamiento/postgres";
import { armarBorrador, SESION_SOFIPO } from "../../../tests/operacion/apoyo-alta-regulada";

const BASE = "ola_r2_pld";
const TALLER = "33333333-3333-4333-8333-333333333333";
const GIL = "11111111-1111-4111-8111-111111111111";
const PROVEEDOR_UNO = "44444444-4444-4444-8444-444444444441";
const PAGABLE_TERCERO = "77777777-7777-4777-8777-777777777774";
const PAGO_TERCERO = "88888888-8888-4888-8888-888888888884";
const rutaEstado = process.env.ESTADO ?? "";
if (!rutaEstado || rutaEstado.includes("/docs/") || rutaEstado.startsWith("docs/") || rutaEstado.includes("/scripts/")) {
  throw new Error("ESTADO tiene que ser un archivo fuera del repositorio: guarda semillas TOTP y sesiones.");
}
const dueno = new URL(process.env.DUENO_URL ?? "postgres://postgres@127.0.0.1:5553/postgres");
if (!["127.0.0.1", "localhost"].includes(dueno.hostname)) throw new Error("DUENO_URL tiene que ser un Postgres local.");
const llave = llaveTotpDesdeEntorno();
if (!llave) throw new Error("Falta AUTENTICACION_LLAVE_TOTP (32 bytes en base64url), la misma que usa next start.");

const PERSONAL = [
  { clave: "ofelia", nombre: "Ofelia Plataforma", correo: "ofelia@lever.test", roles: ["administracion_plataforma"] },
  { clave: "omar", nombre: "Omar Originación", correo: "omar@lever.test", roles: ["originacion"] },
  { clave: "ana", nombre: "Ana Aprobación", correo: "ana@lever.test", roles: ["aprobacion"] },
  { clave: "celia", nombre: "Celia Cumplimiento", correo: "celia@lever.test", roles: ["cumplimiento"] },
  { clave: "aurelio", nombre: "Aurelio Auditoría", correo: "aurelio@lever.test", roles: ["auditoria"] },
] as const;

function base32(bytes: Uint8Array): string {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let salida = "";
  for (let i = 0; i < bits.length; i += 5) salida += alfabeto[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return salida;
}

/** Sesión con segundo factor, como la deja la puerta: entrada verificada con TOTP y consumida. */
function sesion(url: string, userId: string): string {
  const valor = randomBytes(32).toString("base64url").slice(0, 43);
  const entradaId = randomUUID();
  ejecutar(url, `
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      values ('${entradaId}', '${userId}', '${createHash("sha256").update(entradaId).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
    insert into sessions (id, user_id, token_hash, expires_at, superficie, segundo_factor, entrada_id)
      values ('${randomUUID()}', '${userId}', '${createHash("sha256").update(valor).digest("hex")}', now() + interval '12 hours', 'sofipo', 'totp', '${entradaId}');
  `);
  return valor;
}

async function preparar(): Promise<void> {
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
  aplicarArchivo(url, join(process.cwd(), "tests/e2e/seed-pagos.sql"));
  process.env.DATABASE_URL = urlDeAplicacion(url);

  // Personal SOFIPO con sus roles, app autenticadora y sesión.
  const ids: Record<string, string> = { gil: GIL, rosa: "22222222-2222-4222-8222-222222222222" };
  const semillas: Record<string, string> = {};
  for (const persona of PERSONAL) {
    const id = randomUUID();
    ids[persona.clave] = id;
    const semilla = randomBytes(20);
    semillas[persona.clave] = base32(semilla);
    ejecutar(url, `
      insert into users (id, nombre, correo, password_hash)
        values ('${id}', '${persona.nombre}', '${persona.correo}', '$2b$12$${"a".repeat(53)}');
      insert into platform_staff (operator_id, user_id, estado)
        values ((select id from operators order by alta_en limit 1), '${id}', 'activo');
      ${persona.roles.map((rol) => `insert into platform_staff_roles (operator_id, user_id, rol) values ((select id from operators order by alta_en limit 1), '${id}', '${rol}');`).join("\n")}
      insert into auth_totp (id, user_id, secreto_cifrado, creado_en, confirmado_en)
        values ('${randomUUID()}', '${id}', '${cifrarSemilla(semilla, id, llave!)}', now(), now());
    `);
  }
  const sesiones: Record<string, string> = { gil: "a".repeat(43), rosa: "b".repeat(43) };
  for (const persona of PERSONAL) sesiones[persona.clave] = sesion(url, ids[persona.clave]!);

  const omar = (await contextoDePersonal("omar@lever.test")) as ContextoDePersonal;
  const ana = (await contextoDePersonal("ana@lever.test")) as ContextoDePersonal;
  const celia = (await contextoDePersonal("celia@lever.test")) as ContextoDePersonal;
  const almacen = almacenVercel();

  // Taller: perfil vigente, tercer pago por autorizar a la misma CLABE y Marta con nómina semanal. Taller ya
  // está activa: Originación propone el perfil y Cumplimiento lo aprueba (r2-base-N18).
  const propuestaTaller = randomUUID();
  await declararPerfil(omar, {
    companyId: TALLER, formId: propuestaTaller, pagosMonto: "50000", pagosOperaciones: "10", nominaMonto: "15000", nominaOperaciones: "4",
    motivo: "Perfil del cliente que operaba antes del registro de perfiles.",
  });
  await resolverPropuestaDePerfil(celia, {
    companyId: TALLER, propuestaId: propuestaTaller, decision: "aprobada", motivo: "Corresponde al giro y a lo que la empresa ya mueve.",
  });
  ejecutar(url, `
    begin;
    select set_config('app.user_id', '${GIL}', true), set_config('app.company_id', '${TALLER}', true);
    insert into supplier_payables (id, company_id, supplier_id, origen, referencia, total_centavos, emitida_el, vence_el, programada_el, motivo_excepcion, creado_por, creado_en, actualizado_en)
      values ('${PAGABLE_TERCERO}', '${TALLER}', '${PROVEEDOR_UNO}', 'excepcion', 'Anticipo de material', 4500000, current_date - 2, current_date + 10, current_date + 1,
              'Anticipo pactado en el contrato de suministro', '${GIL}', now(), now());
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, '${TALLER}', 'miembro', '${GIL}', 'cliente', 'crear_cargo_proveedor', 'supplier_payables', '${PAGABLE_TERCERO}', '{"origen":"excepcion","total_centavos":4500000}' from companies where id = '${TALLER}';
    insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el, solicitado_por, solicitado_en, creado_en)
      select '${PAGO_TERCERO}', p.company_id, p.id, sc.id, sc.clabe, p.total_centavos, p.programada_el, '${GIL}', now(), now()
        from supplier_payables p join supplier_clabes sc on sc.company_id = p.company_id and sc.supplier_id = p.supplier_id and sc.vigente_hasta is null
        where p.id = '${PAGABLE_TERCERO}';
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, '${TALLER}', 'miembro', '${GIL}', 'cliente', 'solicitar_pago_proveedor', 'supplier_payment_requests', '${PAGO_TERCERO}', '{"total_centavos":4500000}' from companies where id = '${TALLER}';
    commit;
  `);
  const sesionGil = await leerSesion(`sesion=${"a".repeat(43)}`);
  if (!sesionGil) throw new Error("La sesión sembrada de Gil no abrió.");
  const gil = (await resolverContexto({ sesion: sesionGil, empresaPedida: TALLER, peticionId: null, superficie: "cliente" })).ctx;
  const hoy = hoyEnMexico(new Date());
  const area = await nombrarCentro(gil, { nombre: "Operación", presupuesto: "80000.00" });
  await darDeAltaPersona(gil, {
    nombre: "Marta Ruiz", alta: hoy, baja: "", centroId: area.id, jefeId: "", presupuesto: "3000.00", altaLlave: randomUUID(),
    neto: "18500.00", frecuencia: "semanal", primerPago: hoy, destino: "clabe", clabe: "002180701150123452",
    acceso: "no", correo: "", rol: "",
  });

  // Nogal Comercial: en alta con todo en regla salvo el perfil transaccional.
  const nogal = { razonSocial: "Nogal Comercial, S.A. de C.V.", rfc: "NCO190505CD3" };
  const nogalId = await registrarProspecto(omar, { ...nogal, codigoPostal: "64000", regimen: "601", usoCfdi: "G03" });
  const borradorNogal = await armarBorrador(omar, { companyId: nogalId, ...nogal, almacen });
  await enviarVersion(omar, borradorNogal.versionId);
  await dictaminarVersion(celia, SESION_SOFIPO, { versionId: borradorNogal.versionId, formId: randomUUID(), resultado: "aprobado", motivo: "" });
  await calificarRiesgoEmpresa(celia, { companyId: nogalId, formId: randomUUID(), actividad: "baja", zona: "baja" });
  await solicitarActivacion(omar, nogalId);

  // Cobre Antiguo: activa, con la activación fechada hace siete meses (celebración del contrato).
  const cobre = { razonSocial: "Cobre Antiguo, S.A. de C.V.", rfc: "CAN150101CD4" };
  const cobreId = await registrarProspecto(omar, { ...cobre, codigoPostal: "44100", regimen: "601", usoCfdi: "G03" });
  const borradorCobre = await armarBorrador(omar, { companyId: cobreId, ...cobre, almacen });
  await enviarVersion(omar, borradorCobre.versionId);
  await dictaminarVersion(celia, SESION_SOFIPO, { versionId: borradorCobre.versionId, formId: randomUUID(), resultado: "aprobado", motivo: "" });
  await calificarRiesgoEmpresa(celia, { companyId: cobreId, formId: randomUUID(), actividad: "baja", zona: "baja" });
  await declararPerfil(omar, {
    companyId: cobreId, formId: randomUUID(), pagosMonto: "300000", pagosOperaciones: "20", nominaMonto: "120000", nominaOperaciones: "2", motivo: "",
  });
  const solicitudCobre = await solicitarActivacion(omar, cobreId);
  await decidirActivacion(ana, SESION_SOFIPO, { id: solicitudCobre, aprobada: true });
  ejecutar(url, `
    begin;
    set local session_replication_role = replica;
    update company_activation_requests
       set requested_at = now() - interval '7 months 1 day', decided_at = now() - interval '7 months'
     where id = '${solicitudCobre}';
    commit;
  `);
  const celebracion = consultarJson<{ fecha: string }>(url, `select json_build_object('fecha', pld_celebracion_contrato('${cobreId}')::text)`).fecha;
  await cerrarConexion();

  writeFileSync(rutaEstado, JSON.stringify({
    DUENO_URL: url,
    DATABASE_URL: process.env.DATABASE_URL,
    EMPRESA_TALLER: TALLER,
    EMPRESA_NOGAL: nogalId,
    EMPRESA_COBRE: cobreId,
    CELEBRACION_COBRE: celebracion,
    PAGO_EXCEDE: "88888888-8888-4888-8888-888888888882",
    PAGO_FRACCION: PAGO_TERCERO,
    SESIONES: sesiones,
    SEMILLAS: semillas,
    IDS: ids,
  }, null, 2), { mode: 0o600 });
  console.log(`Base ${BASE} lista: 0001-0030, Taller con perfil, dos pagos por autorizar, Marta con nómina, Nogal sin perfil, Cobre con contrato del ${celebracion} y ${PERSONAL.length} personas del personal.`);
}

preparar().catch(async (error: unknown) => {
  await cerrarConexion();
  console.error(error);
  process.exitCode = 1;
});
