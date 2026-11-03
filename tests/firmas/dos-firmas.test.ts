import assert, { AssertionError } from "node:assert/strict";
import { test } from "node:test";

import { darDeAltaEmpresa } from "../../src/server/company/servicio.ts";
import { ErrorDeDominio } from "../../src/server/session/error-de-dominio.ts";
import { cerrarConexion } from "../../src/server/session/db.ts";
import { abrirCuenta } from "../../src/server/session/servicio.ts";
import type { Sesion } from "../../src/server/session/tipos.ts";
import { asignarMembresia, liberarLoteDePrueba, solicitarLoteDePrueba } from "../../src/server/roles/servicio.ts";
import { DIRECTORIO_MIGRACIONES, evaluarEsquema } from "../aislamiento/esquema.ts";
import {
  aplicarArchivo,
  conBaseDesechable,
  consultarJson,
  ejecutar,
  exigirBaseDesechable,
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

const CONTRASENA = "clave-segura-12";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const elena = await abrirCuenta({
    nombre: "Elena Ríos",
    correo: "firmas-elena@ejemplo.mx",
    contrasena: CONTRASENA,
  });
  await darDeAltaEmpresa(elena.sesion, {
    rfc: "EKU9003173C9",
    razonSocial: "Escuela Kemper Firmas",
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
  });
  const luis = await abrirCuenta({
    nombre: "Luis Navarro",
    correo: "firmas-luis@ejemplo.mx",
    contrasena: CONTRASENA,
  });
  const rosa = await abrirCuenta({
    nombre: "Rosa Vidal",
    correo: "firmas-rosa@ejemplo.mx",
    contrasena: CONTRASENA,
  });
  const carmen = await abrirCuenta({
    nombre: "Carmen Solís",
    correo: "firmas-carmen@ejemplo.mx",
    contrasena: CONTRASENA,
  });

  await asignarMembresia(elena.sesion, { userId: luis.sesion.usuario.id, rol: "liberador" });
  await asignarMembresia(elena.sesion, { userId: rosa.sesion.usuario.id, rol: "liberador" });
  await asignarMembresia(elena.sesion, { userId: carmen.sesion.usuario.id, rol: "contador" });

  const solicitud = await solicitarLoteDePrueba(luis.sesion, {});
  assert.equal(solicitud.liberadorId, null);
  assert.equal(solicitud.esPrueba, true);
  assert.notEqual(luis.sesion.usuario.id.toLowerCase(), rosa.sesion.usuario.id.toLowerCase());

  assert.equal(
    await codigo(liberarLoteDePrueba(conId(luis.sesion, luis.sesion.usuario.id.toUpperCase()), { loteId: solicitud.id })),
    "misma_persona_en_las_dos_firmas",
  );
  assert.equal(
    await codigo(liberarLoteDePrueba(elena.sesion, { loteId: solicitud.id })),
    "sin_permiso_para_liberar",
  );
  assert.equal(
    await codigo(liberarLoteDePrueba(carmen.sesion, { loteId: solicitud.id })),
    "contador_no_libera",
  );

  const abierta = leerFirmas(url, solicitud.id);
  assert.equal(abierta.solicitante, luis.sesion.usuario.id.toLowerCase());
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
       set liberador_user_id = ${uuidSql(elena.sesion.usuario.id)},
           liberado_en = clock_timestamp()
       where id = ${uuidSql(solicitud.id)}`,
    ),
    "sin_permiso_para_liberar",
  );
  assert.equal(
    codigoDelLibro(
      url,
      `update lotes_prueba
       set liberador_user_id = ${uuidSql(carmen.sesion.usuario.id)},
           liberado_en = clock_timestamp()
       where id = ${uuidSql(solicitud.id)}`,
    ),
    "contador_no_libera",
  );

  const sigueAbierta = leerFirmas(url, solicitud.id);
  assert.equal(sigueAbierta.liberador, null);

  const cerrada = await liberarLoteDePrueba(rosa.sesion, { loteId: solicitud.id });
  assert.equal(cerrada.solicitanteId, luis.sesion.usuario.id.toLowerCase());
  assert.equal(cerrada.liberadorId, rosa.sesion.usuario.id.toLowerCase());
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

function conId(sesion: Sesion, userId: string): Sesion {
  return { ...sesion, usuario: { ...sesion.usuario, id: userId } };
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
