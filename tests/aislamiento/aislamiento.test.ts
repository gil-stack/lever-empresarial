import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";

import { darDeAltaEmpresa, leerEmpresa } from "../../src/server/company/servicio.ts";
import { invitarAdministrador, contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import { resolverContexto } from "../../src/server/tenencia/resolver.ts";
import { DIRECTORIO_MIGRACIONES, evaluarEsquema } from "./esquema.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "./postgres.ts";

/**
 * Fase 4. La empresa A no se lee desde la empresa B, ni por el servicio ni
 * por Postgres cuando el filtro de la aplicación no está.
 */

const RFC_A = "TCM010101AB1";
const RFC_B = "CABL840215RF4";
const CORREO = "contador-aislamiento@ejemplo.mx";
const CLAVE = "clave-segura-12";
const HASH = "a".repeat(53);

test("el usuario de la empresa A no lee la empresa B, y Postgres tampoco", async () => {
  const esquema = evaluarEsquema(DIRECTORIO_MIGRACIONES);
  if (esquema.pendiente) throw new Error(esquema.motivo);

  const urlAdmin = exigirBaseDesechable();
  const previo = process.env.DATABASE_URL;
  await conBaseDesechable(urlAdmin, async (url) => {
    for (const archivo of esquema.archivos) aplicarArchivo(url, archivo);
    await cerrarConexion();
    process.env.DATABASE_URL = urlDeAplicacion(url);
    try {
      await escenario(url);
    } finally {
      await cerrarConexion();
      if (previo === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previo;
    }
  });
});

async function escenario(url: string): Promise<void> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("sofipo-aislamiento@ejemplo.mx");
  const alfa = await darDeAltaEmpresa(
    personal,
    { rfc: RFC_A, razonSocial: "Escuela Alfa Aislamiento", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" },
    { demostracion: true },
  );
  const beta = await darDeAltaEmpresa(
    personal,
    { rfc: RFC_B, razonSocial: "Taller Beta Aislamiento", codigoPostal: "44100", regimen: "612", usoCfdi: "G03" },
    { demostracion: true },
  );

  const primera = await invitarAdministrador(personal, {
    companyId: alfa.id,
    razonSocial: alfa.razonSocial,
    nombre: "Contadora Norte",
    correo: CORREO,
  });
  const sesionA = await entrar(url, primera.emitida.token);
  const soloAlfa = await resolverContexto({
    sesion: sesionA,
    empresaPedida: null,
    peticionId: null,
    superficie: "cliente",
  });
  assert.equal(soloAlfa.eleccion, "unica");
  const leida = await leerEmpresa(soloAlfa.ctx);
  assert.equal(leida?.id, alfa.id);
  assert.equal(leida?.rfc, RFC_A);
  assert.equal(JSON.stringify(leida).includes(RFC_B), false);

  const ajena = await resolverContexto({
    sesion: sesionA,
    empresaPedida: beta.id,
    peticionId: null,
    superficie: "cliente",
  });
  assert.equal(ajena.eleccion, "ajena");
  assert.equal(ajena.ctx.empresa, null);

  const segunda = await invitarAdministrador(personal, {
    companyId: beta.id,
    razonSocial: beta.razonSocial,
    nombre: "Contadora Norte",
    correo: CORREO,
  });
  const sesionB = await entrar(url, segunda.emitida.token);
  const enBeta = await resolverContexto({
    sesion: sesionB,
    empresaPedida: beta.id,
    peticionId: null,
    superficie: "cliente",
  });
  assert.equal(enBeta.eleccion, "ruta");
  const leidaBeta = await leerEmpresa(enBeta.ctx);
  assert.equal(leidaBeta?.rfc, RFC_B);
  assert.equal(JSON.stringify(leidaBeta).includes(RFC_A), false);

  const enAlfa = await resolverContexto({
    sesion: sesionB,
    empresaPedida: alfa.id,
    peticionId: null,
    superficie: "cliente",
  });
  assert.equal((await leerEmpresa(enAlfa.ctx))?.rfc, RFC_A);

  const sinFiltro = consultarJson<Array<{ empresas: number; cajones: number }>>(
    url,
    `begin;
     set local role plataforma_cliente;
     select json_agg(fila) from (
       select
         (select count(*) from companies) as empresas,
         (select count(*) from drawers) as cajones
     ) fila;`,
  );
  // set local role inside a select script: psql runs the whole script. json_agg
  // after set role sees RLS. The begin/rollback keeps it in one transaction.
  assert.equal(sinFiltro[0]?.empresas, 0);
  assert.equal(sinFiltro[0]?.cajones, 0);

  const deAlfa = consultarJson<Array<{ empresas: number }>>(
    url,
    `begin;
     set local role plataforma_cliente;
     select set_config('app.company_id', '${alfa.id}', true);
     select json_agg(fila) from (select (select count(*) from companies) as empresas) fila;`,
  );
  assert.equal(deAlfa[0]?.empresas, 1);

  assert.throws(
    () =>
      ejecutar(
        url,
        `begin; set local role plataforma_cliente; insert into lista_69b_snapshots (id, fecha_archivo, cargado_en) values (gen_random_uuid(), current_date, now()); commit;`,
      ),
    /permission denied|sin_permiso/,
  );

  ejecutar(
    url,
    `begin;
     savepoint marca;
     insert into cost_centers (id, company_id, nombre)
       values ('88888888-8888-4888-8888-888888888888', '${alfa.id}', 'Obra');
     insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
       values ((select operator_id from companies where id = '${alfa.id}'),
         '${alfa.id}', 'miembro', (select user_id from memberships where company_id = '${alfa.id}' limit 1),
         'cliente', 'alta_centro_costo', 'cost_centers', '88888888-8888-4888-8888-888888888888');
     release savepoint marca;
     commit;`,
  );
  const centros = consultarJson<Array<{ n: number }>>(
    url,
    `select json_agg(fila) from (select count(*)::int as n from cost_centers where nombre = 'Obra') fila`,
  );
  assert.equal(centros[0]?.n, 1);
}

async function entrar(url: string, token: string) {
  const aceptada = await aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE });
  const sesionToken = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
  const entradaId = randomUUID();
  const sesionId = randomUUID();
  const hashEntrada = createHash("sha256").update(entradaId).digest("hex");
  const hashSesion = createHash("sha256").update(sesionToken).digest("hex");
  ejecutar(
    url,
    `begin;
     insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
       values ('${entradaId}', '${aceptada.userId}', '${hashEntrada}', now(), now() + interval '10 minutes', 'totp', now(), now());
     insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
       values ('${sesionId}', '${aceptada.userId}', '${hashSesion}', now() + interval '12 hours', 'totp', '${entradaId}');
     commit;`,
  );
  const sesion = await leerSesion(`sesion=${sesionToken}`);
  assert.equal(sesion?.segundoFactor?.metodo, "totp");
  if (!sesion) throw new Error("la sesión de la prueba no se leyó");
  return sesion;
}

function sembrarPersonal(url: string): void {
  ejecutar(
    url,
    `insert into users (id, nombre, correo, password_hash)
       values ('99999999-9999-4999-8999-999999999999', 'Personal', 'sofipo-aislamiento@ejemplo.mx',
         '$2b$12$${HASH}');
     insert into platform_staff (operator_id, user_id, estado)
       values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'activo');
     insert into platform_staff_roles (operator_id, user_id, rol)
       values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'administracion_plataforma');`,
  );
}
