// Base local para el recorrido de la Ola R1 (alta regulada). Dos fases:
//
//   base    Crea la base desde cero, aplica db/migrations (0001-0028) y la semilla de
//           Pagos a proveedores (Taller del Cierre: proveedores, un pago por autorizar y las
//           sesiones de Gil y Rosa). Da de alta, con los servicios del producto, a Marta Ruiz
//           con nómina semanal (el lote queda por preparar) y a Iván Invitado con acceso por
//           aceptar (su enlace va a ESTADO: el flujo 9 intenta aceptarlo con la empresa
//           suspendida). Siembra al personal SOFIPO:
//           Ofelia administra; Omar, Ana, Celia y Aurelio entran sin rol, porque el flujo 1
//           se los da por pantalla. Cada quien con su app autenticadora (semilla cifrada como
//           la guarda el producto) y una sesión SOFIPO con segundo factor.
//   lumbre  Corre después del flujo 1, con los roles ya dados por pantalla. Distribuidora
//           Lumbre entra por el servidor (Omar captura y envía, Celia aprueba) y recibe, como
//           dueña de la base, una calificación de riesgo de hace siete meses: la revisión
//           periódica vence y la bandeja de Cumplimiento la muestra (flujo 4). La base solo deja
//           a Cumplimiento calificar con la fecha de hoy; por eso esta fila la escribe la dueña.
//   ronda3  Corre al empezar las regresiones de la tercera revisión. Brisa Regresión queda en
//           alta con expediente aprobado, riesgo vigente y la activación pedida (Celia la mete
//           en la lista por pantalla y Ana intenta aprobarla); Cedro Regresión queda con su
//           versión enviada, por dictaminar (la pista bajo «Motivo» del dictamen).
//
//   ESTADO=/fuera/del/repo/ola-r-alta.json \
//   AUTENTICACION_LLAVE_TOTP=… BLOB_READ_WRITE_TOKEN=… VERCEL_BLOB_API_URL=… \
//   DUENO_URL=postgres://postgres@127.0.0.1:5551/postgres \
//   ./node_modules/.bin/tsx scripts/evidencia/ola-r-alta/preparar.ts base|lumbre|ronda3
//
// ESTADO guarda semillas TOTP y sesiones: tiene que vivir fuera del repositorio. Nada de eso
// se imprime. Solo acepta un Postgres en 127.0.0.1 o localhost.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

import { calificarRiesgo, hoyEnMexico } from "../../../src/dominio/operacion";
import type { ContextoDePersonal } from "../../../src/nucleo/contexto";
import { cerrarConexion } from "../../../src/nucleo/db";
import { cifrarSemilla } from "../../../src/server/autenticacion/cifrado";
import { llaveTotpDesdeEntorno } from "../../../src/server/autenticacion/entorno";
import { solicitarActivacion } from "../../../src/server/operacion/activaciones";
import { registrarProspecto } from "../../../src/server/operacion/clientes";
import { dictaminarVersion, enviarVersion } from "../../../src/server/operacion/expediente";
import { darDeAltaPersona, nombrarCentro } from "../../../src/server/personas/servicio";
import { contextoDePersonal } from "../../../src/server/plataforma/servicio";
import { almacenVercel } from "../../../src/server/proveedores/constancia";
import { leerSesion } from "../../../src/server/session/servicio";
import { resolverContexto } from "../../../src/server/tenencia/resolver";
import { aplicarArchivo, consultarJson, ejecutar, urlDeAplicacion } from "../../../tests/aislamiento/postgres";
import { armarBorrador, expedienteEnRegla, SESION_SOFIPO } from "../../../tests/operacion/apoyo-alta-regulada";

const BASE = "ola_r_alta";
const TALLER = "33333333-3333-4333-8333-333333333333";
const fase = process.argv[2] ?? "base";
const rutaEstado = process.env.ESTADO ?? "";
if (!rutaEstado || rutaEstado.includes("/docs/") || rutaEstado.startsWith("docs/") || rutaEstado.includes("/scripts/")) {
  throw new Error("ESTADO tiene que ser un archivo fuera del repositorio: guarda semillas TOTP y sesiones.");
}
const dueno = new URL(process.env.DUENO_URL ?? "postgres://postgres@127.0.0.1:5551/postgres");
if (!["127.0.0.1", "localhost"].includes(dueno.hostname)) throw new Error("DUENO_URL tiene que ser un Postgres local.");
const llave = llaveTotpDesdeEntorno();
if (!llave) throw new Error("Falta AUTENTICACION_LLAVE_TOTP (32 bytes en base64url), la misma que usa next start.");

const PERSONAL = [
  { clave: "ofelia", nombre: "Ofelia Plataforma", correo: "ofelia@lever.test", roles: ["administracion_plataforma"] },
  { clave: "omar", nombre: "Omar Originación", correo: "omar@lever.test", roles: [] },
  { clave: "ana", nombre: "Ana Aprobación", correo: "ana@lever.test", roles: [] },
  { clave: "celia", nombre: "Celia Cumplimiento", correo: "celia@lever.test", roles: [] },
  { clave: "aurelio", nombre: "Aurelio Auditoría", correo: "aurelio@lever.test", roles: [] },
] as const;

function base32(bytes: Uint8Array): string {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let salida = "";
  for (let i = 0; i < bits.length; i += 5) salida += alfabeto[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return salida;
}

function token(): string {
  return randomBytes(32).toString("base64url").slice(0, 43);
}

/** Sesión con segundo factor, como la deja la puerta: entrada verificada con TOTP y consumida. */
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

type Estado = {
  DUENO_URL: string;
  DATABASE_URL: string;
  EMPRESA_TALLER: string;
  PAGO_POR_AUTORIZAR: string;
  SESIONES: Record<string, string>;
  SEMILLAS: Record<string, string>;
  IDS: Record<string, string>;
  EMPRESA_LUMBRE?: string;
  INVITACION_IVAN: string;
};

async function faseBase(): Promise<void> {
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

  // Marta, con nómina semanal que vence hoy: «Preparar nómina» queda disponible para el flujo 9.
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
  // Iván, con acceso por aceptar: en el flujo 9 la consola suspendida no renueva su invitación y él no puede aceptarla.
  let invitacionIvan = "";
  await darDeAltaPersona(gil, {
    nombre: "Iván Invitado", alta: hoy, baja: "", centroId: area.id, jefeId: "", presupuesto: "", altaLlave: randomUUID(),
    nomina: "no", acceso: "nueva", correo: "ivan@taller.test", rol: ["contador"],
  }, {
    entregar: async (emitida) => {
      invitacionIvan = emitida.token;
      return { entregada: false, codigo: "correo_no_configurado" };
    },
  });
  if (!invitacionIvan) throw new Error("La invitación de Iván no quedó emitida.");

  const ids: Record<string, string> = { gil: "11111111-1111-4111-8111-111111111111", rosa: "22222222-2222-4222-8222-222222222222" };
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
  for (const persona of PERSONAL) sesiones[persona.clave] = sesion(url, ids[persona.clave]!, "sofipo");
  await cerrarConexion();

  const estado: Estado = {
    DUENO_URL: url,
    DATABASE_URL: process.env.DATABASE_URL,
    EMPRESA_TALLER: TALLER,
    PAGO_POR_AUTORIZAR: "88888888-8888-4888-8888-888888888882",
    SESIONES: sesiones,
    SEMILLAS: semillas,
    IDS: ids,
    INVITACION_IVAN: invitacionIvan,
  };
  writeFileSync(rutaEstado, JSON.stringify(estado, null, 2), { mode: 0o600 });
  console.log(`Base ${BASE} lista: 0001-0028, Taller, Marta con nómina, Iván por aceptar y ${PERSONAL.length} personas del personal.`);
}

async function faseLumbre(): Promise<void> {
  const estado = JSON.parse(readFileSync(rutaEstado, "utf8")) as Estado;
  process.env.DATABASE_URL = estado.DATABASE_URL;
  const omar = (await contextoDePersonal("omar@lever.test")) as ContextoDePersonal;
  const celia = (await contextoDePersonal("celia@lever.test")) as ContextoDePersonal;
  if (!omar.personal?.roles.includes("originacion") || !celia.personal?.roles.includes("cumplimiento")) {
    throw new Error("Corre esta fase después del flujo 1: Omar necesita Originación y Celia Cumplimiento.");
  }
  const razonSocial = "Distribuidora Lumbre, S.A. de C.V.";
  const rfc = "DLU160701CD2";
  const companyId = await registrarProspecto(omar, { razonSocial, rfc, codigoPostal: "44100", regimen: "601", usoCfdi: "G03" });
  const { versionId } = await armarBorrador(omar, {
    companyId, razonSocial, rfc, almacen: almacenVercel(),
    socios: [{ nombre: "Tomás Herrera Lima", tipoPersona: "fisica", rfc: "HELT700202AB3", curp: "HELT700202HJCRMM05", capital: "100", votos: "100" }],
  });
  await enviarVersion(omar, versionId);
  await dictaminarVersion(celia, SESION_SOFIPO, { versionId, formId: randomUUID(), resultado: "aprobado", motivo: "" });

  // Calificación de hace siete meses: con la fecha de hoy, su revisión semestral (27ª) ya venció.
  const hoy = new Date();
  const antes = new Date(hoy);
  antes.setMonth(antes.getMonth() - 7);
  const diaAntes = hoyEnMexico(antes);
  const datos = consultarJson<{ fecha: string; volumen: string }>(estado.DUENO_URL, `
    select json_build_object('fecha', fecha_constitucion::text, 'volumen', volumen_mensual_centavos::text)
    from kyb_versiones where id = '${versionId}'`);
  const calificacion = calificarRiesgo({
    actividad: "baja", zona: "baja", fechaConstitucion: datos.fecha, hoy: diaAntes, capas: 1, pep: "no",
    volumenMensualCentavos: Number(datos.volumen), coincidencias: "ninguna",
  });
  const id = randomUUID();
  ejecutar(estado.DUENO_URL, `
    begin;
    insert into kyb_calificaciones_riesgo (
      id, operator_id, company_id, version_id, tipo, factores, puntaje, grado, pep_extranjera, coincidencia_exacta,
      calificada_por, calificada_el, calificada_en, revisar_antes_de
    ) values (
      '${id}', '${omar.personal.operadorId}', '${companyId}', '${versionId}', 'alta', '${JSON.stringify(calificacion.factores)}',
      ${calificacion.puntaje}, '${calificacion.grado}', false, false, '${estado.IDS.celia}', date '${diaAntes}',
      timestamptz '${diaAntes} 12:00:00-06', date '${calificacion.revisarAntesDe}'
    );
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio, ocurrido_en)
      values ('${omar.personal.operadorId}', '${companyId}', 'personal', '${estado.IDS.celia}', 'sofipo', 'riesgo_calificado',
        'kyb_calificaciones_riesgo', '${id}', '{"grado":"${calificacion.grado}","puntaje":${calificacion.puntaje},"siembra":"recorrido"}',
        timestamptz '${diaAntes} 12:00:00-06');
    commit;
  `);
  await cerrarConexion();
  writeFileSync(rutaEstado, JSON.stringify({ ...estado, EMPRESA_LUMBRE: companyId }, null, 2), { mode: 0o600 });
  console.log(`Distribuidora Lumbre lista: expediente aprobado y revisión de riesgo vencida el ${calificacion.revisarAntesDe}.`);
}

async function faseRonda3(): Promise<void> {
  const estado = JSON.parse(readFileSync(rutaEstado, "utf8")) as Estado;
  process.env.DATABASE_URL = estado.DATABASE_URL;
  const omar = (await contextoDePersonal("omar@lever.test")) as ContextoDePersonal;
  const celia = (await contextoDePersonal("celia@lever.test")) as ContextoDePersonal;
  const brisa = { razonSocial: "Brisa Regresión, S.A. de C.V.", rfc: "BRR180303CD6" };
  const brisaId = await registrarProspecto(omar, { ...brisa, codigoPostal: "64000", regimen: "601", usoCfdi: "G03" });
  await expedienteEnRegla(omar, celia, { companyId: brisaId, ...brisa });
  await solicitarActivacion(omar, brisaId);
  const cedro = { razonSocial: "Cedro Regresión, S.A. de C.V.", rfc: "CER170404CD5" };
  const cedroId = await registrarProspecto(omar, { ...cedro, codigoPostal: "64000", regimen: "601", usoCfdi: "G03" });
  const { versionId } = await armarBorrador(omar, { companyId: cedroId, ...cedro, almacen: almacenVercel() });
  await enviarVersion(omar, versionId);
  await cerrarConexion();
  console.log("Brisa Regresión en alta con la activación pedida; Cedro Regresión con su versión por dictaminar.");
}

(fase === "lumbre" ? faseLumbre() : fase === "ronda3" ? faseRonda3() : faseBase()).catch(async (error: unknown) => {
  await cerrarConexion();
  console.error(error);
  process.exitCode = 1;
});
