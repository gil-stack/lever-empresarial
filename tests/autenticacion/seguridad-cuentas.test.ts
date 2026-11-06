import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cerrarConexion } from "../../src/nucleo/db.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { repositorioPg } from "../../src/server/autenticacion/repositorio.ts";
import { hashDeRespaldo } from "../../src/server/autenticacion/respaldo.ts";
import { iniciarConContrasena, leerPaso } from "../../src/server/autenticacion/servicio.ts";
import { restablecerContrasena, solicitarRecuperacion } from "../../src/server/invitaciones/recuperar.ts";
import type { AvisoDeSeguridad } from "../../src/server/seguridad/avisos.ts";
import { NOMBRE_COOKIE } from "../../src/server/session/cookie.ts";
import { hashDeToken, hashearContrasena } from "../../src/server/session/hash.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

/**
 * 0025_seguridad_cuentas en un Postgres desechable: la fuga de
 * recuperaciones_pendientes, el índice del bloqueo, la inactividad de la
 * sesión, la reautenticación dentro de la sesión y la recuperación por correo.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";

type Cliente = {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

describe("seguridad de cuentas en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("cierra la fuga entre empresas, indexa el bloqueo, vence por inactividad y no deja nada vivo al cambiar la contraseña", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (urlDuena) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) if (archivo.endsWith(".sql")) aplicarArchivo(urlDuena, join(dir, archivo));
      const { Client } = (await import("pg")) as unknown as { Client: new (opts: { connectionString: string }) => Cliente };
      const duena = new Client({ connectionString: urlDuena });
      await duena.connect();
      process.env.DATABASE_URL = urlDeAplicacion(urlDuena);
      await cerrarConexion();
      try {
        const operador = String((await duena.query("select id from operators order by alta_en limit 1")).rows[0]?.id);
        const hash = await hashearContrasena("clave-segura-12");
        const ana = randomUUID();
        const beto = randomUUID();
        const op = randomUUID();
        for (const [id, nombre, correo] of [
          [ana, "Ana de Empresa A", "ana@empresa-a.mx"],
          [beto, "Beto de Empresa B", "beto@empresa-b.mx"],
          [op, "Personal SOFIPO", "op@lever.mx"],
        ] as const) {
          await duena.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, $4)", [id, nombre, correo, hash]);
        }
        await duena.query("insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'activo')", [operador, op]);
        await duena.query(
          "insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, 'administracion_plataforma')",
          [operador, op],
        );

        // H3. recuperaciones_pendientes() ya no es legible como cliente.
        for (const [id, userId, motivo] of [
          [randomUUID(), ana, "Perdí el teléfono de Ana"],
          [randomUUID(), beto, "Perdí el teléfono de Beto"],
        ] as const) {
          await duena.query("begin");
          await duena.query(
            `insert into audit_log (operator_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
             values ($1, 'miembro', $2, 'cliente', 'recuperacion_solicitada', 'auth_recuperaciones', $3)`,
            [operador, userId, id],
          );
          await duena.query("insert into auth_recuperaciones (id, user_id, solicitada_en, motivo) values ($1, $2, now(), $3)", [
            id,
            userId,
            motivo,
          ]);
          await duena.query("commit");
        }
        const privilegios = (
          await duena.query(
            `select has_function_privilege('plataforma_cliente', 'recuperaciones_pendientes()', 'execute') as cliente,
                    has_function_privilege('plataforma_sofipo', 'recuperaciones_pendientes()', 'execute') as sofipo`,
          )
        ).rows[0];
        assert.deepEqual(privilegios, { cliente: false, sofipo: true });
        await duena.query("begin");
        await duena.query("set local role plataforma_cliente");
        await assert.rejects(duena.query("select * from recuperaciones_pendientes()"), /permission denied/);
        await duena.query("rollback");
        await duena.query("begin");
        await duena.query("set local role plataforma_sofipo");
        assert.equal((await duena.query("select * from recuperaciones_pendientes()")).rows.length, 2);
        await duena.query("rollback");
        const repo = repositorioPg();
        assert.equal((await repo.recuperacionesPendientes(op)).length, 2);
        await assert.rejects(
          repo.recuperacionesPendientes(ana),
          (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "sin_permiso",
        );

        // H6. El conteo de contraseñas fallidas usa el índice parcial.
        await duena.query(
          `insert into audit_log (operator_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, ocurrido_en)
           select $1, 'sistema', null, 'cliente',
                  case when g % 50 = 0 then 'entrada_fallida' else 'entrada_contrasena' end,
                  case when g % 50 = 0 then 'users' else 'auth_entradas' end,
                  case when g % 500 = 0 then $2::uuid else gen_random_uuid() end,
                  now() - (g || ' seconds')::interval
           from generate_series(1, 20000) as g`,
          [operador, ana],
        );
        await duena.query("analyze audit_log");
        const plan = (
          await duena.query(
            `explain select count(*) from audit_log
             where accion = 'entrada_fallida' and identificador = '${ana}' and ocurrido_en >= now() - interval '15 minutes'`,
          )
        ).rows
          .map((fila) => String(fila["QUERY PLAN"]))
          .join("\n");
        assert.match(plan, /audit_log_entrada_fallida_idx/);
        assert.doesNotMatch(plan, /Seq Scan/);
        const fallos = await repo.contarFallosContrasena(ana, new Date(Date.now() - 15 * 60_000));
        assert.equal(fallos, 1, "una fila de cada 500 es de Ana y solo la de g=500 cae en 15 minutos");

        // H9. La sesión sin uso en 30 minutos no se devuelve; leerla renueva el uso como mucho cada minuto.
        const tokenAna = "a".repeat(43);
        const sesionAna = await abrirSesion(duena, ana, tokenAna, "cliente");
        const cookieAna = `${NOMBRE_COOKIE}=${tokenAna}`;
        assert.ok(await leerSesion(cookieAna));
        await duena.query("update sessions set ultimo_uso = now() - interval '31 minutes' where id = $1", [sesionAna]);
        assert.equal(
          (await duena.query("select * from sesion_por_token($1, now(), true)", [hashDeToken(tokenAna)])).rows.length,
          0,
        );
        assert.equal(await leerSesion(cookieAna), null);
        await duena.query("update sessions set ultimo_uso = now() - interval '2 minutes' where id = $1", [sesionAna]);
        assert.ok(await leerSesion(cookieAna));
        const renovado = (await duena.query("select ultimo_uso from sessions where id = $1", [sesionAna])).rows[0]?.ultimo_uso as Date;
        assert.ok(Date.now() - renovado.getTime() < 10_000, "leerla renovó ultimo_uso");
        assert.ok(await leerSesion(cookieAna));
        const sinCambio = (await duena.query("select ultimo_uso from sessions where id = $1", [sesionAna])).rows[0]?.ultimo_uso as Date;
        assert.equal(sinCambio.getTime(), renovado.getTime(), "dentro del minuto no vuelve a escribir");
        await duena.query("begin");
        await duena.query("set local role plataforma_cliente");
        await duena.query("select set_config('app.user_id', $1, true)", [beto]);
        const ajena = await duena.query("update sessions set ultimo_uso = now() where id = $1", [sesionAna]);
        assert.equal(ajena.rowCount, 0, "RLS: nadie renueva la sesión de otra persona");
        await duena.query("rollback");

        // H1. Confirmar la identidad renueva segundo_factor_en, consume el código y se audita.
        const respaldo = "ABCDEFGHJKLMNPQR";
        await duena.query("insert into auth_codigos_respaldo (id, user_id, codigo_hash, creado_en) values ($1, $2, $3, now())", [
          randomUUID(),
          ana,
          hashDeRespaldo(respaldo),
        ]);
        await duena.query("update sessions set segundo_factor_en = now() - interval '10 minutes' where id = $1", [sesionAna]);
        await repo.reautenticar({
          sesionId: sesionAna,
          userId: ana,
          metodo: "respaldo",
          efecto: { tipo: "respaldo", codigoHash: hashDeRespaldo(respaldo) },
          superficie: "cliente",
          ahora: new Date(),
        });
        const renovada = (
          await duena.query(
            "select segundo_factor_en, segundo_factor_metodo, segundo_factor, reautenticaciones_fallidas from sessions where id = $1",
            [sesionAna],
          )
        ).rows[0];
        assert.ok(Date.now() - (renovada?.segundo_factor_en as Date).getTime() < 10_000);
        assert.equal(renovada?.segundo_factor_metodo, "respaldo");
        assert.equal(renovada?.segundo_factor, "totp", "el factor con que nació la sesión no se reescribe");
        assert.equal((await leerSesion(cookieAna))?.segundoFactor?.metodo, "respaldo");
        await assert.rejects(
          repo.reautenticar({
            sesionId: sesionAna,
            userId: ana,
            metodo: "respaldo",
            efecto: { tipo: "respaldo", codigoHash: hashDeRespaldo(respaldo) },
            superficie: "cliente",
            ahora: new Date(),
          }),
          (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "segundo_factor_invalido",
        );
        assert.equal(await contarAuditoria(duena, "reautenticacion", sesionAna), 1);

        const tokenOp = "o".repeat(43);
        const sesionOp = await abrirSesion(duena, op, tokenOp, "sofipo");
        await duena.query("insert into auth_codigos_respaldo (id, user_id, codigo_hash, creado_en) values ($1, $2, $3, now())", [
          randomUUID(),
          op,
          hashDeRespaldo("QRSTUVWXYZABCDEF"),
        ]);
        await repo.reautenticar({
          sesionId: sesionOp,
          userId: op,
          metodo: "respaldo",
          efecto: { tipo: "respaldo", codigoHash: hashDeRespaldo("QRSTUVWXYZABCDEF") },
          superficie: "sofipo",
          ahora: new Date(),
        });
        const firmaOp = (
          await duena.query(
            "select actor_tipo, superficie from audit_log where accion = 'reautenticacion' and identificador = $1",
            [sesionOp],
          )
        ).rows[0];
        assert.deepEqual(firmaOp, { actor_tipo: "personal", superficie: "sofipo" });

        const intentos: number[] = [];
        for (let i = 0; i < 5; i += 1) {
          intentos.push(await repo.sumarFalloDeReautenticacion({ sesionId: sesionOp, userId: op, superficie: "sofipo", ahora: new Date() }));
        }
        assert.deepEqual(intentos, [1, 2, 3, 4, 5]);
        assert.equal((await duena.query("select 1 from sessions where id = $1", [sesionOp])).rows.length, 0, "al quinto se cierra");
        assert.equal(await contarAuditoria(duena, "reautenticacion_fallida", sesionOp), 5);

        // H10. Revocar una app autenticadora ya usada funciona; un paso repetido o menor sigue rechazado.
        const totpUsado = randomUUID();
        await duena.query("begin");
        await duena.query("insert into auth_totp (id, user_id, secreto_cifrado, creado_en) values ($1, $2, $3, now())", [
          totpUsado,
          ana,
          `v1.${"a".repeat(16)}.${"b".repeat(32)}.${"c".repeat(22)}`,
        ]);
        await duena.query(
          `insert into audit_log (operator_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
           values ($1, 'miembro', $2, 'cliente', 'totp_confirmado', 'auth_totp', $3)`,
          [operador, ana, totpUsado],
        );
        await duena.query("update auth_totp set confirmado_en = now(), ultimo_paso = 100 where id = $1", [totpUsado]);
        await duena.query("commit");
        await assert.rejects(duena.query("update auth_totp set ultimo_paso = 100 - 1 where id = $1", [totpUsado]), /totp_codigo_repetido/);
        await duena.query("update auth_totp set ultimo_paso = 101 where id = $1", [totpUsado]);
        await duena.query("begin");
        await duena.query(
          `insert into audit_log (operator_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
           values ($1, 'miembro', $2, 'cliente', 'totp_revocado', 'auth_totp', $3)`,
          [operador, ana, totpUsado],
        );
        await duena.query("update auth_totp set revocado_en = now(), revocado_por = $2 where id = $1", [totpUsado, ana]);
        await duena.query("commit");
        assert.ok((await duena.query("select revocado_en from auth_totp where id = $1", [totpUsado])).rows[0]?.revocado_en);

        // H2. La contraseña nueva cierra sesiones y entradas, no toca factores y no salta el segundo factor.
        const sesionBeto = await abrirSesion(duena, beto, "b".repeat(43), "cliente");
        const entradaVieja = randomUUID();
        await duena.query(
          "insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en) values ($1, $2, $3, now(), now() + interval '10 minutes')",
          [entradaVieja, beto, hashDeToken("e".repeat(43))],
        );
        await duena.query("insert into auth_codigos_respaldo (id, user_id, codigo_hash, creado_en) values ($1, $2, $3, now())", [
          randomUUID(),
          beto,
          hashDeRespaldo("BCDEFGHJKLMNPQRS"),
        ]);
        const tokenReset = "r".repeat(43);
        await duena.query(
          "insert into password_resets (id, user_id, token_hash, creado_en, vence_en) values ($1, $2, $3, now(), now() + interval '1 hour')",
          [randomUUID(), beto, hashDeToken(tokenReset)],
        );
        const avisos: AvisoDeSeguridad[] = [];
        await restablecerContrasena(
          { token: tokenReset, contrasena: "clave-nueva-segura-1", confirmacion: "clave-nueva-segura-1" },
          { avisar: async (aviso) => void avisos.push(aviso) },
        );
        assert.equal((await duena.query("select 1 from sessions where user_id = $1", [beto])).rows.length, 0);
        assert.equal((await duena.query("select 1 from sessions where id = $1", [sesionBeto])).rows.length, 0);
        assert.equal(
          (await duena.query("select 1 from auth_entradas where user_id = $1 and consumida_en is null", [beto])).rows.length,
          0,
          "la entrada abierta con la contraseña anterior quedó quemada",
        );
        assert.equal(
          (await duena.query("select count(*)::int as n from auth_codigos_respaldo where user_id = $1 and usado_en is null and invalidado_en is null", [beto])).rows[0]?.n,
          1,
          "el segundo factor sigue igual",
        );
        assert.deepEqual(avisos.map((aviso) => [aviso.cambio, aviso.para, aviso.userId]), [["contrasena_cambiada", "beto@empresa-b.mx", beto]]);
        const otraVez = await iniciarConContrasena({ correo: "beto@empresa-b.mx", contrasena: "clave-nueva-segura-1" });
        assert.equal(otraVez.tipo, "entrada", "la contraseña nueva abre solo la entrada, no una sesión");
        assert.equal((await duena.query("select 1 from sessions where user_id = $1", [beto])).rows.length, 0);
        if (otraVez.tipo === "entrada") assert.equal((await leerPaso(otraVez.cookie.valor)).paso, "verificar");

        // H7. Misma respuesta y piso de tiempo exista o no la cuenta, aunque el correo no salga.
        const esperas: number[] = [];
        const caido = async () => {
          throw new ErrorDeDominio("correo_no_disponible");
        };
        const conCuenta = await solicitarRecuperacion(
          { correo: "ana@empresa-a.mx" },
          { enviador: caido, esperar: async (ms) => void esperas.push(ms) },
        );
        const sinCuenta = await solicitarRecuperacion(
          { correo: "nadie@empresa-z.mx" },
          { enviador: caido, esperar: async (ms) => void esperas.push(ms) },
        );
        assert.equal(conCuenta, undefined);
        assert.equal(sinCuenta, undefined);
        assert.equal(esperas.length, 2);
        assert.ok(esperas.every((ms) => ms > 0), "las dos esperan hasta el piso");
        const reset = (
          await duena.query("select anulado_en from password_resets where user_id = $1 order by creado_en desc limit 1", [ana])
        ).rows[0];
        assert.ok(reset?.anulado_en, "el enlace que no se pudo mandar quedó anulado");
      } finally {
        await duena.end();
        await cerrarConexion();
      }
    });
  });
});

/** Sesión con segundo factor como la abre la puerta: entrada verificada y consumida en la misma transacción. */
async function abrirSesion(duena: Cliente, userId: string, token: string, superficie: "cliente" | "sofipo"): Promise<string> {
  const entrada = randomUUID();
  const sesion = randomUUID();
  await duena.query("begin");
  await duena.query(
    "insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en) values ($1, $2, $3, now(), now() + interval '10 minutes')",
    [entrada, userId, hashDeToken(`${token.slice(0, 42)}E`)],
  );
  await duena.query("update auth_entradas set verificada_con = 'totp', verificada_en = now(), consumida_en = now() where id = $1", [
    entrada,
  ]);
  await duena.query(
    `insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id, superficie)
     values ($1, $2, $3, now() + interval '12 hours', 'totp', $4, $5)`,
    [sesion, userId, hashDeToken(token), entrada, superficie],
  );
  await duena.query("commit");
  return sesion;
}

async function contarAuditoria(duena: Cliente, accion: string, identificador: string): Promise<number> {
  const fila = (
    await duena.query("select count(*)::int as n from audit_log where accion = $1 and identificador = $2", [accion, identificador])
  ).rows[0];
  return Number(fila?.n ?? 0);
}
