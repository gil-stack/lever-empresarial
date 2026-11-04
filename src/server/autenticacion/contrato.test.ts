import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const migracion = readFileSync(join(raiz, "../../../db/migrations/0019_autenticacion_fuerte.sql"), "utf8");

describe("contrato de la migración", () => {
  it("no honra una sesión sin segundo factor y no guarda secretos en claro", () => {
    assert.match(migracion, /sesion_sin_segundo_factor/);
    assert.match(migracion, /passkey_no_se_borra/);
    assert.match(migracion, /totp_no_se_borra/);
    assert.match(migracion, /respaldo_ya_usado/);
    assert.doesNotMatch(migracion, /recuperacion_con_factores_vigentes/);
    assert.match(migracion, /resuelta_por <> user_id/);
    assert.match(migracion, /codigo_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
    assert.match(migracion, /secreto_cifrado/);
    assert.doesNotMatch(migracion, /secreto_totp[^_]/);
    assert.doesNotMatch(migracion, /password/);
    assert.match(migracion, /DELETE FROM sessions/);
  });
});

describe("el módulo no imprime ni lee de más", () => {
  it("no hay console ni connection strings, y el entorno está acotado", () => {
    const archivos = readdirSync(raiz).filter((nombre) => nombre.endsWith(".ts") && !nombre.endsWith(".test.ts"));
    assert.ok(archivos.length >= 8);
    const permitidas = new Set([
      "AUTENTICACION_LLAVE_TOTP",
      "AUTENTICACION_DOMINIOS",
      "VERCEL_PROJECT_PRODUCTION_URL",
      "VERCEL_BRANCH_URL",
      "VERCEL_URL",
      "NODE_ENV",
    ]);
    for (const nombre of archivos) {
      const fuente = readFileSync(join(raiz, nombre), "utf8");
      assert.doesNotMatch(fuente, /\bconsole\b/);
      assert.doesNotMatch(fuente, /postgres(?:ql)?:\/\/[^"'\s]/);
      assert.doesNotMatch(fuente, /DATABASE_URL/);
      const lecturas = fuente.match(/process\.env(?:\??)\.[A-Za-z0-9_]+|env\.[A-Z0-9_]+|env\[[^\]]+\]/g) ?? [];
      for (const lectura of lecturas) {
        const variable = lectura.replace(/.*\./, "").replace(/.*\[.*/, "");
        if (lectura.includes("[")) continue;
        assert.equal(permitidas.has(variable), true, `${nombre} lee ${lectura}`);
      }
    }
  });
});
