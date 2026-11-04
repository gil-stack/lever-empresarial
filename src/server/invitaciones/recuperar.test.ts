import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fuente = readFileSync(new URL("./recuperar.ts", import.meta.url), "utf8");

test("recuperar la contraseña no toca el segundo factor ni abre sesión", () => {
  assert.equal(fuente.includes("auth_passkeys"), false);
  assert.equal(fuente.includes("auth_totp"), false);
  assert.equal(fuente.includes("auth_codigos_respaldo"), false);
  assert.equal(fuente.includes("setCookie"), false);
  assert.equal(fuente.includes("abrirSesion"), false);
  assert.match(fuente, /delete from sessions/);
  assert.match(fuente, /password_hash/);
});
