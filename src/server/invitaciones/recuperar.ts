import { randomUUID } from "node:crypto";

import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { auditar, operadorDeLaPlataforma } from "../bitacora/auditar";
import { enviadorDesdeEntorno } from "../correo/enviar";
import { plantillaRecuperarContrasena } from "../correo/plantillas/recuperar-contrasena";
import { hashDeToken, hashearContrasena, tokenNuevo } from "../session/hash";
import { tokenValido } from "../session/cookie";
import { correoValido, normalizarCorreo } from "../session/validar";
import { contrasenaNuevaValida } from "./servicio";
import { urlPublica } from "./correo";

const HORA_MS = 60 * 60 * 1000;
const VIGENCIA_MS = 60 * 60 * 1000;
const TOPE_POR_HORA = 3;

export type EstadoRecuperacion = "vigente" | "vencida" | "no_valida";

/**
 * Responde igual exista o no la cuenta. Sin remitente no escribe nada.
 * No abre sesión y no toca passkeys, TOTP ni códigos de respaldo.
 */
export async function solicitarRecuperacion(entrada: { correo?: unknown }): Promise<void> {
  const enviador = enviadorDesdeEntorno();
  const base = urlPublica();
  const correo = typeof entrada.correo === "string" ? normalizarCorreo(entrada.correo) : "";
  if (!correoValido(correo)) throw new ErrorDeDominio("correo_invalido");

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
    if (error instanceof ErrorDeDominio) throw error;
    throw new ErrorDeDominio("correo_no_disponible");
  }
}

export async function leerRecuperacion(token: string): Promise<EstadoRecuperacion> {
  if (!tokenValido(token)) return "no_valida";
  const fila = await leerFila(token);
  if (!fila || fila.usadoEn || fila.anuladoEn) return "no_valida";
  if (fila.venceEn.getTime() <= Date.now()) return "vencida";
  return "vigente";
}

/** Cambia la contraseña y cierra las sesiones. El segundo factor sigue. */
export async function restablecerContrasena(entrada: {
  token?: unknown;
  contrasena?: unknown;
  confirmacion?: unknown;
}): Promise<void> {
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
  await conContexto({ rol: "plataforma_cliente", userId: fila.userId }, async (consulta) => {
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
  });
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
