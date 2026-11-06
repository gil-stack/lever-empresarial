import { randomUUID } from "node:crypto";

import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { avisarPorCorreo, avisarSinDeshacer, type Avisar } from "../seguridad/avisos";
import { hecho, registrarHechoAutenticacion } from "../autenticacion/auditar";
import { auditar, operadorDeLaPlataforma } from "../bitacora/auditar";
import { enviadorDesdeEntorno } from "../correo/enviar";
import type { Enviador } from "../correo/tipos";
import { plantillaRecuperarContrasena } from "../correo/plantillas/recuperar-contrasena";
import { hashDeToken, hashearContrasena, tokenNuevo } from "../session/hash";
import { tokenValido } from "../session/cookie";
import { correoValido, normalizarCorreo } from "../session/validar";
import { contrasenaNuevaValida } from "./servicio";
import { urlPublica } from "./correo";

const HORA_MS = 60 * 60 * 1000;
const VIGENCIA_MS = 60 * 60 * 1000;
const TOPE_POR_HORA = 3;
/**
 * Toda solicitud tarda esto. La respuesta ya no toca la base ni el proveedor de
 * correo (eso corre después de responder), así que el piso no esconde trabajo:
 * deja el mismo tiempo para todos y frena a quien prueba correos en serie.
 */
export const PISO_RESPUESTA_MS = 1_500;

export type EstadoRecuperacion = "vigente" | "vencida" | "no_valida";

/** Corre la tarea después de responder. En la aplicación es `after` de next/server. */
export type Diferir = (tarea: () => Promise<void>) => void;

export type DependenciasRecuperar = {
  diferir: Diferir;
  enviador?: Enviador;
  esperar?: (ms: number) => Promise<void>;
  ahoraMs?: () => number;
};

/**
 * Responde igual exista o no la cuenta: misma salida y mismo tiempo, porque
 * buscar la cuenta, guardar el enlace y mandar el correo corren después de
 * responder. Un correo que no sale no se anuncia: se registra y la solicitud
 * se anula. Sin remitente configurado no escribe nada y lo dice: eso no
 * depende del correo que se escribió. No abre sesión y no toca passkeys, TOTP
 * ni códigos de respaldo.
 */
export async function solicitarRecuperacion(
  entrada: { correo?: unknown },
  deps: DependenciasRecuperar,
): Promise<void> {
  const ahoraMs = deps.ahoraMs ?? Date.now;
  const inicio = ahoraMs();
  try {
    const enviador = deps.enviador ?? enviadorDesdeEntorno();
    const base = urlPublica();
    const correo = typeof entrada.correo === "string" ? normalizarCorreo(entrada.correo) : "";
    if (!correoValido(correo)) throw new ErrorDeDominio("correo_invalido");
    deps.diferir(() => emitirSiHayCuenta(correo, enviador, base));
  } finally {
    const resta = PISO_RESPUESTA_MS - (ahoraMs() - inicio);
    if (resta > 0) await (deps.esperar ?? esperar)(resta);
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/**
 * Corre después de responder: nadie espera su resultado, así que nada lanza.
 * Cualquier falla queda registrada con identificadores internos.
 */
async function emitirSiHayCuenta(correo: string, enviador: Enviador, base: string): Promise<void> {
  try {
    await emitir(correo, enviador, base);
  } catch (error) {
    console.error(
      JSON.stringify({
        nivel: "error",
        origen: "invitaciones.recuperar",
        evento: "recuperacion_no_emitida",
        error: error instanceof ErrorDeDominio ? error.codigo : "desconocido",
      }),
    );
  }
}

async function emitir(correo: string, enviador: Enviador, base: string): Promise<void> {
  const cuenta = await conContexto({ rol: "plataforma_cliente" }, async (consulta) => {
    const fila = (
      await consulta.query("select id, nombre from usuario_por_correo($1)", [correo])
    ).rows[0] as { id?: unknown; nombre?: unknown } | undefined;
    if (!fila || typeof fila.id !== "string" || typeof fila.nombre !== "string") return null;
    return { id: fila.id, nombre: fila.nombre, correo };
  });
  if (!cuenta) return;

  const token = tokenNuevo();
  const id = randomUUID();
  const ahora = new Date();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_MS);
  const enviado = await conContexto({ rol: "plataforma_cliente", userId: cuenta.id }, async (consulta) => {
    const recientes = await consulta.query(
      `select count(*)::int as n from password_resets
       where user_id = $1 and creado_en >= $2`,
      [cuenta.id, new Date(ahora.getTime() - HORA_MS)],
    );
    const n = Number((recientes.rows[0] as { n?: unknown } | undefined)?.n ?? 0);
    if (n >= TOPE_POR_HORA) return false;
    await consulta.query(
      `update password_resets set anulado_en = $2
       where user_id = $1 and usado_en is null and anulado_en is null`,
      [cuenta.id, ahora],
    );
    await consulta.query(
      `insert into password_resets (id, user_id, token_hash, creado_en, vence_en)
       values ($1, $2, $3, $4, $5)`,
      [id, cuenta.id, hashDeToken(token), ahora, venceEn],
    );
    await auditar(consulta, {
      operadorId: await operadorDeLaPlataforma(consulta),
      companyId: null,
      actorTipo: "miembro",
      actorId: cuenta.id,
      superficie: "cliente",
      peticionId: null,
      origen: "consola",
    }, { accion: "recuperacion_solicitada", identificador: id });
    return true;
  });
  if (!enviado) return;

  const plantilla = plantillaRecuperarContrasena({
    nombre: cuenta.nombre,
    enlace: `${base}/recuperar/${token}`,
    venceEn,
  });
  try {
    await enviador({
      para: cuenta.correo,
      asunto: plantilla.asunto,
      html: plantilla.html,
      texto: plantilla.texto,
      idempotencia: `recuperacion/${id}`,
    });
  } catch (error) {
    await conContexto({ rol: "plataforma_cliente", userId: cuenta.id }, (consulta) =>
      consulta.query(
        `update password_resets set anulado_en = $2
         where id = $1 and usado_en is null and anulado_en is null`,
        [id, new Date()],
      ),
    );
    // Avisar que el envío falló solo pasaría con cuentas que existen. Se
    // registra con identificadores internos y la persona ve lo mismo que todos.
    console.error(
      JSON.stringify({
        nivel: "error",
        origen: "invitaciones.recuperar",
        evento: "recuperacion_correo_no_enviado",
        solicitud: id,
        error: error instanceof ErrorDeDominio ? error.codigo : "desconocido",
      }),
    );
  }
}

export async function leerRecuperacion(token: string): Promise<EstadoRecuperacion> {
  if (!tokenValido(token)) return "no_valida";
  const fila = await leerFila(token);
  if (!fila || fila.usadoEn || fila.anuladoEn) return "no_valida";
  if (fila.venceEn.getTime() <= Date.now()) return "vencida";
  return "vigente";
}

/**
 * Cambia la contraseña. Decisión: el enlace de correo prueba el correo, no a la
 * persona, así que no toca el segundo factor ni abre sesión. Después de esto
 * se entra con la contraseña nueva Y el segundo factor de siempre. En la misma
 * transacción cierra todas las sesiones (cliente y SOFIPO), quema las entradas
 * abiertas con la contraseña anterior y vence la recuperación de segundo factor
 * que estuviera aprobada (se aprobó para quien sabía la contraseña anterior):
 * nada de antes sobrevive. Al final avisa por correo; si el correo no sale, se
 * registra y el cambio sigue.
 */
export async function restablecerContrasena(
  entrada: {
    token?: unknown;
    contrasena?: unknown;
    confirmacion?: unknown;
  },
  deps?: { avisar?: Avisar },
): Promise<void> {
  const token = typeof entrada.token === "string" ? entrada.token : "";
  if (!tokenValido(token)) throw new ErrorDeDominio("recuperacion_no_valida");
  const contrasena = typeof entrada.contrasena === "string" ? entrada.contrasena : "";
  if (!contrasenaNuevaValida(contrasena)) throw new ErrorDeDominio("contrasena_invalida");
  if (entrada.confirmacion !== contrasena) throw new ErrorDeDominio("contrasenas_distintas");
  const fila = await leerFila(token);
  if (!fila || fila.usadoEn || fila.anuladoEn) throw new ErrorDeDominio("recuperacion_no_valida");
  if (fila.venceEn.getTime() <= Date.now()) throw new ErrorDeDominio("recuperacion_vencida");
  const hash = await hashearContrasena(contrasena);
  const ahora = new Date();
  const persona = await conContexto({ rol: "plataforma_cliente", userId: fila.userId }, async (consulta) => {
    const usada = await consulta.query(
      `update password_resets set usado_en = $2
       where id = $1 and usado_en is null and anulado_en is null and vence_en > $2`,
      [fila.id, ahora],
    );
    if (usada.rowCount !== 1) throw new ErrorDeDominio("recuperacion_no_valida");
    await consulta.query(
      `update users set password_hash = $2, correo_verificado_en = coalesce(correo_verificado_en, $3) where id = $1`,
      [fila.userId, hash, ahora],
    );
    await consulta.query("delete from sessions where user_id = $1", [fila.userId]);
    await consulta.query(
      "update auth_entradas set consumida_en = $2 where user_id = $1 and consumida_en is null",
      [fila.userId, ahora],
    );
    const vencidas = await consulta.query(
      "update auth_recuperaciones set estado = 'vencida' where user_id = $1 and estado = 'aprobada' returning id",
      [fila.userId],
    );
    for (const vencida of vencidas.rows as { id?: unknown }[]) {
      if (typeof vencida.id !== "string") continue;
      await registrarHechoAutenticacion(hecho("recuperacion_vencida", vencida.id, fila.userId, ahora), consulta);
    }
    await auditar(
      consulta,
      {
        operadorId: await operadorDeLaPlataforma(consulta),
        companyId: null,
        actorTipo: "miembro",
        actorId: fila.userId,
        superficie: "cliente",
        peticionId: null,
        origen: "consola",
      },
      { accion: "contrasena_restablecida", identificador: fila.id },
    );
    const leida = (await consulta.query("select nombre, correo from users where id = $1", [fila.userId])).rows[0] as
      | { nombre?: unknown; correo?: unknown }
      | undefined;
    return typeof leida?.nombre === "string" && typeof leida.correo === "string"
      ? { nombre: leida.nombre, correo: leida.correo }
      : null;
  });
  if (persona) {
    await avisarSinDeshacer(deps?.avisar ?? avisarPorCorreo, {
      userId: fila.userId,
      para: persona.correo,
      nombre: persona.nombre,
      cambio: "contrasena_cambiada",
      cuando: ahora,
    });
  }
}

async function leerFila(token: string): Promise<{ id: string; userId: string; venceEn: Date; usadoEn: Date | null; anuladoEn: Date | null } | null> {
  const resultado = await conContexto({ rol: "plataforma_cliente" }, (consulta) =>
    consulta.query("select id, user_id, vence_en, usado_en, anulado_en from password_reset_por_token($1)", [
      hashDeToken(token),
    ]),
  );
  const fila = resultado.rows[0] as Record<string, unknown> | undefined;
  if (!fila || typeof fila.id !== "string" || typeof fila.user_id !== "string") return null;
  const venceEn = fila.vence_en instanceof Date ? fila.vence_en : new Date(String(fila.vence_en));
  if (Number.isNaN(venceEn.getTime())) return null;
  return {
    id: fila.id,
    userId: fila.user_id,
    venceEn,
    usadoEn: fila.usado_en == null ? null : new Date(String(fila.usado_en)),
    anuladoEn: fila.anulado_en == null ? null : new Date(String(fila.anulado_en)),
  };
}
