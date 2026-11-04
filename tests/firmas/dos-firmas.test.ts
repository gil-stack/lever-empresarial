import assert, { AssertionError } from "node:assert/strict";
import { test } from "node:test";

import type { RolCliente } from "../../src/nucleo/capacidades.ts";
import type { ContextoDeTenant } from "../../src/nucleo/contexto.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { cerrarConexion } from "../../src/nucleo/db.ts";
import { liberarLoteDePrueba, solicitarLoteDePrueba } from "../../src/server/roles/servicio.ts";
import { DIRECTORIO_MIGRACIONES, evaluarEsquema } from "../aislamiento/esquema.ts";
import {
  aplicarArchivo,
  conBaseDesechable,
  consultarJson,
  ejecutar,
  exigirBaseDesechable,
  urlDeAplicacion,
} from "../aislamiento/postgres.ts";

/**
 * Fase 2. Las dos firmas se prueban contra Postgres, con los servicios
 * de producción y con un UPDATE directo al libro.
 *
 * Corre con `node --test tests/firmas/dos-firmas.test.ts`.
 * Usa la misma base desechable que tests/aislamiento: crea una base,
 * aplica las migraciones y la borra. No migra el libro y no imprime la URL.
 * Si no hay base, falla: no se omite y no se da por pasada.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ELENA = "11111111-1111-4111-8111-111111111111";
const LUIS = "22222222-2222-4222-8222-222222222222";
const ROSA = "33333333-3333-4333-8333-333333333333";
const CARMEN = "44444444-4444-4444-8444-444444444444";
const EMPRESA = "55555555-5555-4555-8555-555555555555";

type FilaDeFirmas = {
  solicitante: string | null;
  liberador: string | null;
};

test("dos usuarios firman, y el libro rechaza la misma persona, a la administradora y al contador", async () => {
  const esquema = evaluarEsquema(DIRECTORIO_MIGRACIONES);
  if (esquema.pendiente) {
    throw new Error(`La prueba de las dos firmas no se da por pasada. ${esquema.motivo}`);
  }
  if (!esquema.archivos.some((archivo) => archivo.endsWith("0011_firmas_plazo_baja.sql"))) {
    throw new Error(
      "La prueba de las dos firmas no se da por pasada: falta db/migrations/0011_firmas_plazo_baja.sql.",
    );
  }

  const urlAdmin = exigirBaseDeFirmas();
  const previo = process.env.DATABASE_URL;
  await conBaseDesechable(urlAdmin, async (url) => {
    for (const archivo of esquema.archivos) {
      try {
        aplicarArchivo(url, archivo);
      } catch (error) {
        throw sinSecreto(error);
      }
    }
    await cerrarConexion();
    process.env.DATABASE_URL = urlDeAplicacion(url);
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
  sembrar(url);
  const elena = contexto(ELENA, ["administrador"]);
  const luis = contexto(LUIS, ["liberador"]);
  const rosa = contexto(ROSA, ["liberador"]);
  const carmen = contexto(CARMEN, ["contador"]);

  const solicitud = await solicitarLoteDePrueba(luis, {});
  assert.equal(solicitud.liberadorId, null);
  assert.equal(solicitud.esPrueba, true);
  assert.notEqual(LUIS, ROSA);

  assert.equal(
    await codigo(liberarLoteDePrueba(contexto(LUIS.toUpperCase(), ["liberador"]), { loteId: solicitud.id })),
    "misma_persona_en_las_dos_firmas",
  );
  assert.equal(
    await codigo(liberarLoteDePrueba(elena, { loteId: solicitud.id })),
    "sin_permiso_para_liberar",
  );
  assert.equal(
    await codigo(liberarLoteDePrueba(carmen, { loteId: solicitud.id })),
    "contador_no_libera",
  );

  const abierta = leerFirmas(url, solicitud.id);
  assert.equal(abierta.solicitante, LUIS);
  assert.equal(abierta.liberador, null);

  assert.equal(
    codigoDelLibro(
      url,
      `update lotes_prueba
       set liberador_user_id = solicitante_user_id,
           liberado_en = clock_timestamp()
       where id = ${uuidSql(solicitud.id)}`,
    ),
    "misma_persona_en_las_dos_firmas",
  );
  assert.equal(
    codigoDelLibro(
      url,
      `update lotes_prueba
       set liberador_user_id = upper(solicitante_user_id::text)::uuid,
           liberado_en = clock_timestamp()
       where id = ${uuidSql(solicitud.id)}`,
    ),
    "misma_persona_en_las_dos_firmas",
  );
  assert.equal(
    codigoDelLibro(
      url,
      `update lotes_prueba
       set liberador_user_id = ${uuidSql(ELENA)},
           liberado_en = clock_timestamp()
       where id = ${uuidSql(solicitud.id)}`,
    ),
    "sin_permiso_para_liberar",
  );
  assert.equal(
    codigoDelLibro(
      url,
      `update lotes_prueba
       set liberador_user_id = ${uuidSql(CARMEN)},
           liberado_en = clock_timestamp()
       where id = ${uuidSql(solicitud.id)}`,
    ),
    "contador_no_libera",
  );

  const sigueAbierta = leerFirmas(url, solicitud.id);
  assert.equal(sigueAbierta.liberador, null);

  const cerrada = await liberarLoteDePrueba(rosa, { loteId: solicitud.id });
  assert.equal(cerrada.solicitanteId, LUIS);
  assert.equal(cerrada.liberadorId, ROSA);
  assert.notEqual(cerrada.solicitanteId, cerrada.liberadorId);
  assert.equal(cerrada.esPrueba, true);

  const enElLibro = leerFirmas(url, solicitud.id);
  assert.equal(enElLibro.solicitante, cerrada.solicitanteId);
  assert.equal(enElLibro.liberador, cerrada.liberadorId);
  assert.notEqual(enElLibro.solicitante, enElLibro.liberador);
}

function exigirBaseDeFirmas(): string {
  try {
    return exigirBaseDesechable();
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    throw new Error(
      "La prueba de las dos firmas no se da por pasada. Hace falta un Postgres desechable y no se omite.\n" +
        detalle,
    );
  }
}

function contexto(userId: string, roles: RolCliente[]): ContextoDeTenant {
  return {
    sesionId: "66666666-6666-4666-8666-666666666666",
    peticionId: null,
    superficie: "cliente",
    persona: { id: userId, nombre: "Persona", correo: `${userId.slice(0, 8)}@ejemplo.mx` },
    segundoFactor: "totp",
    empresa: {
      id: EMPRESA,
      rfc: "EKU9003173C9",
      razonSocial: "Escuela Kemper Firmas",
      operadorId: "77777777-7777-4777-8777-777777777777",
      estado: "activa",
      demostracion: true,
    },
    roles,
    personal: null,
    empresas: [{ id: EMPRESA, razonSocial: "Escuela Kemper Firmas" }],
    capacidades: [],
  };
}

function sembrar(url: string): void {
  const personas = [
    [ELENA, "elena", "administrador"],
    [LUIS, "luis", "liberador"],
    [ROSA, "rosa", "liberador"],
    [CARMEN, "carmen", "contador"],
  ] as const;
  const roles = personas
    .map(
      ([id, , rol]) =>
        `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
         values (operador, '${EMPRESA}', 'miembro', '${ELENA}', 'cliente', 'asignar_rol', 'membership_roles', '${id}', '{"rol":"${rol}"}');
         insert into membership_roles (user_id, company_id, rol) values ('${id}', '${EMPRESA}', '${rol}');`,
    )
    .join("\n");
  const usuarios = personas
    .map(
      ([id, nombre]) =>
        `insert into users (id, nombre, correo) values ('${id}', '${nombre}', 'firmas-${nombre}@ejemplo.mx');
         insert into memberships (user_id, company_id, estado) values ('${id}', '${EMPRESA}', 'activa');`,
    )
    .join("\n");
  ejecutar(
    url,
    `begin;
     insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
       values ('${EMPRESA}', 'EKU9003173C9', 'Escuela Kemper Firmas', '06600', '601', 'G03',
         (select id from operators order by alta_en limit 1), 'activa', true);
     insert into audit_log (operator_id, company_id, actor_tipo, superficie, accion, entidad, identificador)
       values ((select id from operators order by alta_en limit 1), '${EMPRESA}', 'sistema', 'sistema', 'alta_empresa', 'companies', '${EMPRESA}');
     ${usuarios}
     do $$
     declare operador uuid := (select id from operators order by alta_en limit 1);
     begin
       ${roles}
     end $$;
     commit;`,
  );
}

async function codigo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
    return "aceptada";
  } catch (error) {
    if (error instanceof ErrorDeDominio) return error.codigo;
    throw error;
  }
}

function leerFirmas(url: string, loteId: string): FilaDeFirmas {
  return consultarJson<FilaDeFirmas>(
    url,
    `select coalesce(
       (
         select json_build_object(
           'solicitante', solicitante_user_id::text,
           'liberador', liberador_user_id::text
         )
         from lotes_prueba
         where id = ${uuidSql(loteId)}
       ),
       'null'::json
     )`,
  );
}

function codigoDelLibro(url: string, sql: string): string {
  let texto = "";
  try {
    ejecutar(url, sql);
  } catch (error) {
    texto = error instanceof Error ? error.message : String(error);
  }
  if (!texto) {
    throw new Error("El libro aceptó una firma que tenía que rechazar. La prueba no se da por pasada.");
  }
  if (/postgres(?:ql)?:\/\//i.test(texto)) {
    throw new Error("La prueba de firmas iba a mostrar la URL de la base. No se da por pasada.");
  }
  const marca = texto.match(
    /misma_persona_en_las_dos_firmas|sin_permiso_para_liberar|contador_no_libera/,
  );
  if (!marca) {
    const limpio = texto.replace(/postgres(?:ql)?:\/\/\S+/gi, "***").slice(0, 300);
    throw new Error(`El libro rechazó la firma sin el código esperado.\n${limpio}`);
  }
  return marca[0];
}

function uuidSql(id: string): string {
  if (!UUID.test(id)) throw new Error("Identificador no admitido en la prueba de firmas.");
  return `'${id.toLowerCase()}'::uuid`;
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
  for (const secreto of secretos) {
    if (secreto) limpio = limpio.split(secreto).join("***");
  }
  return new Error(limpio || "La prueba de las dos firmas falló.");
}
