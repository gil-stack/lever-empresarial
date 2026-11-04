import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { hashearContrasena } from "../../src/server/session/hash.ts";
import { aplicarArchivo, conBaseDesechable, exigirBaseDesechable } from "../aislamiento/postgres.ts";

/**
 * Corre con AISLAMIENTO_DATABASE_URL apuntando a un Postgres desechable.
 * Aplica todas las migraciones, incluida la 0016, y comprueba que la base
 * no abre una sesión sin segundo factor ni deja borrar un factor.
 */

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";

describe("autenticación en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("niega la sesión sin factor, el borrado y la recuperación a la misma persona", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (url) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) {
        if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
      }
      const { Client } = (await import("pg")) as {
        Client: new (opts: { connectionString: string }) => {
          connect: () => Promise<void>;
          query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }>;
          end: () => Promise<void>;
        };
      };
      const cliente = new Client({ connectionString: url });
      await cliente.connect();
      try {
        const usuario = randomUUID();
        const hash = await hashearContrasena("clave-segura-12");
        await cliente.query("insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, $4)", [
          usuario,
          "Ana Pérez",
          "ana@ejemplo.mx",
          hash,
        ]);

        await assert.rejects(
          cliente.query(
            "insert into sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '1 hour')",
            [randomUUID(), usuario, "ab".repeat(32)],
          ),
          /sesion_sin_segundo_factor|sessions_segundo_factor/,
        );

        const entrada = randomUUID();
        const sesion = randomUUID();
        await assert.rejects(
          cliente.query(
            `insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
             values ($1, $2, $3, now() + interval '1 hour', 'totp', $4)`,
            [sesion, usuario, "cd".repeat(32), entrada],
          ),
          /sesion_sin_segundo_factor|auth_entradas/,
        );

        await cliente.query("begin");
        await cliente.query(
          `insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en)
           values ($1, $2, $3, now(), now() + interval '10 minutes')`,
          [entrada, usuario, "ef".repeat(32)],
        );
        await cliente.query(
          `update auth_entradas set verificada_con = 'totp', verificada_en = now(), consumida_en = now() where id = $1`,
          [entrada],
        );
        await cliente.query(
          `insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
           values ($1, $2, $3, now() + interval '1 hour', 'totp', $4)`,
          [sesion, usuario, "11".repeat(32), entrada],
        );
        await cliente.query("commit");

        const passkey = randomUUID();
        await cliente.query("begin");
        await cliente.query(
          `insert into auth_passkeys (id, user_id, credencial_id, llave_publica, nombre, creada_en)
           values ($1, $2, $3, $4, 'Laptop', now())`,
          [passkey, usuario, "credencial-valida-0001", Buffer.alloc(32, 1)],
        );
        await assert.rejects(cliente.query("commit"), /factor_sin_auditoria/);
        await cliente.query("rollback");

        await cliente.query("begin");
        await cliente.query(
          `insert into audit_log (operator_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
           values ((select id from operators order by alta_en limit 1), 'miembro', $1, 'cliente', 'passkey_registrada', 'auth_passkeys', $2)`,
          [usuario, passkey],
        );
        await cliente.query(
          `insert into auth_passkeys (id, user_id, credencial_id, llave_publica, nombre, creada_en)
           values ($1, $2, $3, $4, 'Laptop', now())`,
          [passkey, usuario, "credencial-valida-0001", Buffer.alloc(32, 1)],
        );
        await cliente.query("commit");
        await assert.rejects(cliente.query("delete from auth_passkeys where id = $1", [passkey]), /passkey_no_se_borra/);

        const recuperacion = randomUUID();
        await cliente.query("begin");
        await cliente.query(
          `insert into audit_log (operator_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
           values ((select id from operators order by alta_en limit 1), 'miembro', $1, 'cliente', 'recuperacion_solicitada', 'auth_recuperaciones', $2)`,
          [usuario, recuperacion],
        );
        await cliente.query(
          "insert into auth_recuperaciones (id, user_id, solicitada_en, motivo) values ($1, $2, now(), 'Perdí el teléfono')",
          [recuperacion, usuario],
        );
        await cliente.query("commit");
        await assert.rejects(
          cliente.query(
            `update auth_recuperaciones
             set estado = 'aprobada', resuelta_por = $2, resuelta_en = now(), verificacion = 'presencial', vence_en = now() + interval '1 hour'
             where id = $1`,
            [recuperacion, usuario],
          ),
          /misma_persona|otra_persona|auth_recuperaciones_otra/,
        );
      } finally {
        await cliente.end();
      }
    });
  });
});
