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
  const tareas: Array<() => Promise<void>> = [];
  await assert.rejects(
    () =>
      solicitarRecuperacion(
        { correo: "no-es-correo" },
        {
          diferir: (tarea) => void tareas.push(tarea),
          enviador: async () => ({ id: "x" }),
          esperar: async (ms) => void esperas.push(ms),
          ahoraMs: () => 1_000,
        },
      ),
    (error: unknown) => error instanceof ErrorDeDominio && error.codigo === "correo_invalido",
  );
  assert.deepEqual(esperas, [PISO_RESPUESTA_MS]);
  assert.equal(tareas.length, 0);
  assert.ok(PISO_RESPUESTA_MS >= 1_000);
});

test("la respuesta no espera a la base ni al proveedor de correo: todo eso corre después", async () => {
  const esperas: number[] = [];
  const tareas: Array<() => Promise<void>> = [];
  let envios = 0;
  // Un proveedor que nunca contesta: si la respuesta lo esperara, la prueba no terminaría.
  const enviadorColgado = () => {
    envios += 1;
    return new Promise<{ id: string }>(() => {});
  };
  for (const correo of ["ana@demo.test", "nadie@demo.test"]) {
    await solicitarRecuperacion(
      { correo },
      {
        diferir: (tarea) => void tareas.push(tarea),
        enviador: enviadorColgado,
        esperar: async (ms) => void esperas.push(ms),
        ahoraMs: () => 1_000,
      },
    );
  }
  assert.deepEqual(esperas, [PISO_RESPUESTA_MS, PISO_RESPUESTA_MS]);
  assert.equal(tareas.length, 2, "exista o no la cuenta, la búsqueda queda para después");
  assert.equal(envios, 0);
});

test("cambiar la contraseña vence la recuperación de segundo factor aprobada, con su evento", () => {
  assert.match(fuente, /update auth_recuperaciones set estado = 'vencida' where user_id = \$1 and estado = 'aprobada' returning id/);
  assert.match(fuente, /hecho\("recuperacion_vencida"/);
});
