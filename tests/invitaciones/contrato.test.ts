import assert, { AssertionError } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { darDeAltaEmpresa } from "../../src/server/company/servicio.ts";
import type { MensajeCorreo } from "../../src/server/correo/tipos.ts";
import { contextoDesdeSesion } from "../../src/server/invitaciones/contexto.ts";
import { leerRecuperacion, restablecerContrasena, solicitarRecuperacion } from "../../src/server/invitaciones/recuperar.ts";
import { aceptarInvitacion, invitarUsuario, leerInvitacion } from "../../src/server/invitaciones/servicio.ts";
import { cerrarConexion } from "../../src/server/session/db.ts";
import { ErrorDeDominio } from "../../src/server/session/error-de-dominio.ts";
import { hashDeToken } from "../../src/server/session/hash.ts";
import { abrirCuenta, entrar, leerSesion } from "../../src/server/session/servicio.ts";
import { DIRECTORIO_MIGRACIONES, evaluarEsquema } from "../aislamiento/esquema.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable } from "../aislamiento/postgres.ts";

/**
 * La propuesta de db/propuestas/fase-4-invitaciones.sql contra Postgres:
 * se aplica sobre todas las migraciones y el servicio corre con el
 * repositorio real. Hace falta AISLAMIENTO_DATABASE_URL, igual que la prueba
 * de aislamiento. Sin esa base, falla: no se omite.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PROPUESTA = path.resolve(AQUI, "../../db/propuestas/fase-4-invitaciones.sql");
const CLAVE_ANA = "clave-de-ana-12";
const CLAVE_LUIS = "clave-de-luis-34";
const CLAVE_NUEVA = "clave-nueva-luis-56";

test("invitación y recuperación de un solo uso, contra Postgres", async () => {
  const esquema = evaluarEsquema(DIRECTORIO_MIGRACIONES);
  if (esquema.pendiente) throw new Error(esquema.motivo);
  const previo = process.env.DATABASE_URL;
  await conBaseDesechable(exigirBaseDesechable(), async (url) => {
    for (const archivo of esquema.archivos) aplicarArchivo(url, archivo);
    aplicarArchivo(url, PROPUESTA);
    await cerrarConexion();
    process.env.DATABASE_URL = url;
    try {
      await escenario(url);
    } catch (error) {
      throw sinSecreto(error);
    } finally {
      await cerrarConexion();
      if (previo === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previo;
    }
  });
});

async function escenario(url: string): Promise<void> {
  const enviados: MensajeCorreo[] = [];
  const envio = {
    urlBase: "https://app.ejemplo.mx",
    enviador: async (mensaje: MensajeCorreo) => {
      enviados.push(mensaje);
      return { id: `correo-${enviados.length}` };
    },
  };

  const ana = await abrirCuenta({ nombre: "Ana Pérez", correo: "ana-invita@ejemplo.mx", contrasena: CLAVE_ANA });
  const empresa = await darDeAltaEmpresa(ana.sesion, {
    rfc: "TNO010101AB1",
    razonSocial: "Talleres del Norte",
    codigoPostal: "64000",
    regimen: "601",
    usoCfdi: "G03",
  });
  const sesionAna = await leerSesion(ana.setCookie);
  assert.equal(sesionAna?.rol, "administrador");

  const enviada = await invitarUsuario(
    contextoDesdeSesion(sesionAna),
    { correo: "Luis@Ejemplo.mx", nombre: "Luis Alma", roles: ["liberador"] },
    envio,
  );
  const token = tokenDe(enviados[0], "invitacion");
  const fila = consultarJson<{ token_hash: string; correo: string; roles: string[] }>(
    url,
    `select row_to_json(i) from (select token_hash, correo, roles from invitations where id = '${enviada.invitacionId}') i`,
  );
  assert.equal(fila.token_hash, hashDeToken(token));
  assert.equal(fila.correo, "luis@ejemplo.mx");
  assert.deepEqual(fila.roles, ["liberador"]);
  assert.equal(
    consultarJson<number>(url, `select count(*) from invitations where token_hash = '${token}' or nombre = '${token}'`),
    0,
  );

  const lectura = await leerInvitacion(token);
  assert.equal(lectura.estado, "vigente");
  assert.equal(lectura.estado === "vigente" && lectura.razonSocial, "Talleres del Norte");

  const intentos = await Promise.allSettled([
    aceptarInvitacion({ token, contrasena: CLAVE_LUIS, confirmacion: CLAVE_LUIS }),
    aceptarInvitacion({ token, contrasena: CLAVE_LUIS, confirmacion: CLAVE_LUIS }),
  ]);
  const ganadores = intentos.filter((r) => r.status === "fulfilled");
  assert.equal(ganadores.length, 1, "dos clics a la vez aceptan una sola vez");
  assert.equal(consultarJson<number>(url, "select count(*) from users where correo = 'luis@ejemplo.mx'"), 1);
  assert.deepEqual((ganadores[0] as PromiseFulfilledResult<unknown>).value, { cuentaNueva: true, siguiente: null });
  assert.equal(
    consultarJson<number>(url, "select count(*) from sessions s join users u on u.id = s.user_id where u.correo = 'luis@ejemplo.mx'"),
    0,
    "aceptar no abre sesión: falta el segundo factor",
  );
  assert.deepEqual(
    consultarJson<{ company_id: string; rol: string }>(
      url,
      "select row_to_json(m) from (select company_id, rol from memberships m join users u on u.id = m.user_id where u.correo = 'luis@ejemplo.mx') m",
    ),
    { company_id: empresa.id, rol: "liberador" },
  );
  assert.equal(
    consultarJson<boolean>(url, "select to_json(correo_verificado_en is not null) from users where correo = 'luis@ejemplo.mx'"),
    true,
  );
  assert.equal(await codigo(aceptarInvitacion({ token, contrasena: CLAVE_LUIS, confirmacion: CLAVE_LUIS })), "invitacion_no_valida");
  assert.deepEqual(await leerInvitacion(token), { estado: "no_valida" });
  assert.ok(await entrar({ correo: "luis@ejemplo.mx", contrasena: CLAVE_LUIS }));

  assert.deepEqual(
    consultarJson<string[]>(
      url,
      `select json_agg(accion order by ocurrido_en, accion) from audit_events where entidad = 'invitations'`,
    ),
    ["invitacion_creada", "invitacion_aceptada"],
  );

  const id = enviada.invitacionId;
  assert.throws(() => ejecutar(url, `update invitations set aceptada_en = null, aceptada_por = null where id = '${id}'`), /invitacion_ya_cerrada|invitations_aceptacion/);
  assert.throws(() => ejecutar(url, `update invitations set revocada_en = now() where id = '${id}'`), /invitacion_ya_cerrada|invitations_un_desenlace/);
  assert.throws(() => ejecutar(url, `update invitations set vence_en = vence_en + interval '1 day' where id = '${id}'`), /invitacion_no_se_reescribe/);
  assert.throws(() => ejecutar(url, `delete from invitations where id = '${id}'`), /invitacion_no_se_borra/);
  assert.throws(() => ejecutar(url, "truncate invitations"), /invitacion_no_se_borra/);

  const usuarioAna = ana.sesion.usuario.id;
  const vieja = "99999999-9999-4999-8999-999999999999";
  ejecutar(
    url,
    `insert into invitations (id, company_id, tipo, correo, nombre, roles, token_hash, invitado_por, creada_en, vence_en)
     values ('${vieja}', '${empresa.id}', 'usuario', 'tarde@ejemplo.mx', 'Tarde', array['contador'], '${"b".repeat(64)}',
             '${usuarioAna}', now() - interval '4 days', now() - interval '1 day')`,
  );
  assert.throws(
    () => ejecutar(url, `update invitations set aceptada_en = now() - interval '2 days', aceptada_por = '${usuarioAna}' where id = '${vieja}'`),
    /invitacion_vencida/,
  );

  const insertar = (columnas: string) =>
    ejecutar(
      url,
      `insert into invitations (id, company_id, tipo, correo, nombre, roles, token_hash, creada_en, vence_en)
       values (gen_random_uuid(), '${empresa.id}', ${columnas})`,
    );
  assert.throws(() => insertar(`'usuario', 'x@ejemplo.mx', 'X', array['contador'], 'token-plano', now(), now() + interval '1 day'`), /invitations_token_hash_sha256/);
  assert.throws(() => insertar(`'empresa', 'x@ejemplo.mx', 'X', array['liberador'], '${"c".repeat(64)}', now(), now() + interval '1 day'`), /invitations_empresa_administra/);
  assert.throws(() => insertar(`'usuario', 'x@ejemplo.mx', 'X', array['dueno'], '${"c".repeat(64)}', now(), now() + interval '1 day'`), /invitations_roles_conocidos/);
  assert.throws(() => insertar(`'usuario', 'x@ejemplo.mx', 'X', array['contador'], '${"c".repeat(64)}', now(), now() + interval '31 days'`), /invitations_vigencia/);
  assert.throws(() => insertar(`'usuario', 'X@Ejemplo.mx', 'X', array['contador'], '${"c".repeat(64)}', now(), now() + interval '1 day'`), /invitations_correo_formato/);
  insertar(`'usuario', 'doble@ejemplo.mx', 'X', array['contador'], '${"d".repeat(64)}', now(), now() + interval '1 day'`);
  assert.throws(() => insertar(`'usuario', 'doble@ejemplo.mx', 'X', array['contador'], '${"e".repeat(64)}', now(), now() + interval '1 day'`), /invitations_una_pendiente/);

  await solicitarRecuperacion({ correo: "luis@ejemplo.mx" }, envio);
  await solicitarRecuperacion({ correo: "nadie@ejemplo.mx" }, envio);
  assert.equal(enviados.length, 2);
  const tokenRecuperar = tokenDe(enviados[1], "recuperar");
  assert.equal(await leerRecuperacion(tokenRecuperar), "vigente");
  assert.ok(consultarJson<number>(url, "select count(*) from sessions s join users u on u.id = s.user_id where u.correo = 'luis@ejemplo.mx'") > 0);

  await restablecerContrasena({ token: tokenRecuperar, contrasena: CLAVE_NUEVA, confirmacion: CLAVE_NUEVA });
  assert.equal(
    consultarJson<number>(url, "select count(*) from sessions s join users u on u.id = s.user_id where u.correo = 'luis@ejemplo.mx'"),
    0,
  );
  assert.equal(await codigo(entrar({ correo: "luis@ejemplo.mx", contrasena: CLAVE_LUIS })), "credenciales_invalidas");
  assert.ok(await entrar({ correo: "luis@ejemplo.mx", contrasena: CLAVE_NUEVA }));
  assert.equal(await leerRecuperacion(tokenRecuperar), "no_valida");
  assert.equal(
    await codigo(restablecerContrasena({ token: tokenRecuperar, contrasena: CLAVE_LUIS, confirmacion: CLAVE_LUIS })),
    "recuperacion_no_valida",
  );
  assert.deepEqual(
    consultarJson<string[]>(
      url,
      "select json_agg(accion order by accion) from audit_events where accion in ('recuperacion_solicitada', 'contrasena_restablecida')",
    ),
    ["contrasena_restablecida", "recuperacion_solicitada"],
  );
  assert.throws(() => ejecutar(url, "delete from password_resets"), /recuperacion_no_se_borra/);
  assert.throws(() => ejecutar(url, "update password_resets set usado_en = null"), /recuperacion_ya_cerrada/);
}

function tokenDe(mensaje: MensajeCorreo | undefined, ruta: string): string {
  const encontrado = new RegExp(`/${ruta}/([A-Za-z0-9_-]{43})`).exec(mensaje?.texto ?? "");
  if (!encontrado) throw new Error("el correo no trae el enlace");
  return encontrado[1];
}

async function codigo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorDeDominio) return error.codigo;
    throw error;
  }
  throw new Error("la operación no rechazó");
}

function sinSecreto(error: unknown): Error {
  if (error instanceof AssertionError) return error;
  const secretos = [process.env.DATABASE_URL ?? "", process.env.AISLAMIENTO_DATABASE_URL ?? ""].filter(Boolean);
  let texto = error instanceof Error ? error.message : String(error);
  for (const secreto of secretos) texto = texto.split(secreto).join("***");
  return new Error(texto || "La prueba de invitaciones falló.");
}
