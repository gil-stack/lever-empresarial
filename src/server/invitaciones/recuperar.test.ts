import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { PISO_RESPUESTA_MS, solicitarRecuperacion } from "./recuperar.ts";

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

test("la contraseña nueva cierra todo lo de antes y avisa por correo", () => {
  // Las entradas abiertas con la contraseña anterior se queman en la misma transacción.
  assert.match(fuente, /update auth_entradas set consumida_en = \$2 where user_id = \$1 and consumida_en is null/);
  assert.match(fuente, /cambio: "contrasena_cambiada"/);
});

test("un correo que no sale no se anuncia: solo pasaría con cuentas que existen", () => {
  assert.doesNotMatch(fuente, /throw new ErrorDeDominio\("correo_no_disponible"\)/);
  assert.match(fuente, /recuperacion_correo_no_enviado/);
});

test("toda solicitud espera el mismo piso de tiempo, aun la que se rechaza antes de buscar la cuenta", async () => {
  const esperas: number[] = [];
  await assert.rejects(
    () =>
      solicitarRecuperacion(
        { correo: "no-es-correo" },
        { enviador: async () => ({ id: "x" }), esperar: async (ms) => void esperas.push(ms), ahoraMs: () => 1_000 },
      ),
    (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "correo_invalido",
  );
  assert.deepEqual(esperas, [PISO_RESPUESTA_MS]);
  assert.ok(PISO_RESPUESTA_MS >= 1_000);
});
