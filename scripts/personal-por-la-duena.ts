import { Client } from "pg";

import { ErrorDeDominio } from "../src/nucleo/error-de-dominio";
import type { Actor } from "../src/server/bitacora/auditar";
import { emitirEnTransaccion } from "../src/server/invitaciones/repositorio";
import { entregarInvitacion } from "../src/server/invitaciones/servicio";
import type { InvitacionEmitida } from "../src/server/invitaciones/tipos";
import type { InvitacionDeAlta } from "../src/server/plataforma/servicio";
import { correoValido, normalizarCorreo } from "../src/server/session/validar";

/**
 * La primera Administración del personal de un operador, con la conexión de la
 * dueña de la base. Desde la aplicación nadie sin usuario da roles (0028,
 * platform_staff_roles_revisar): esto queda para el comando y las bases de prueba.
 * Solo sirve para arrancar: si el operador ya tiene a alguien con Administración,
 * activo o invitado, no invita a nadie (las demás personas se invitan desde la
 * pantalla Personal). Cada alta queda en la bitácora con la conexión que corrió el
 * comando (session_user; en Neon siempre es la dueña) y el correo de la persona que
 * lo corrió. Nunca imprime la URL.
 */
export async function invitarPersonalComoDuena(
  url: string,
  correos: readonly string[],
  corridoPor: string,
): Promise<{ correo: string; resultado: "invitada" | "ya_era_personal"; invitacion?: InvitacionDeAlta }[]> {
  const quienCorre = normalizarCorreo(corridoPor);
  if (!correoValido(quienCorre)) throw new ErrorDeDominio("corrido_por_invalido");
  const emitidas: { correo: string; emitida: InvitacionEmitida | null }[] = [];
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    const operadores = await cliente.query("select id from operators order by alta_en, id");
    if (operadores.rows.length !== 1) throw new ErrorDeDominio("operador_ambiguo");
    const operadorId = String(operadores.rows[0].id);
    await cliente.query("begin");
    try {
      // El mismo candado que personal_rol_por_comando: dos corridas a la vez no arrancan dos veces.
      await cliente.query("select pg_advisory_xact_lock(hashtextextended('platform_staff_roles:' || $1::text, 0))", [operadorId]);
      const administra = await cliente.query(
        `select 1 from platform_staff s
         join platform_staff_roles r on r.operator_id = s.operator_id and r.user_id = s.user_id
         where s.operator_id = $1 and s.estado in ('activo', 'invitado') and r.rol = 'administracion_plataforma'
         limit 1`,
        [operadorId],
      );
      if (administra.rows.length > 0) throw new ErrorDeDominio("personal_con_administracion");
      const ejecutadoPor = String((await cliente.query("select session_user as quien")).rows[0].quien);
      const actor: Actor = {
        operadorId,
        companyId: null,
        actorTipo: "sistema",
        actorId: null,
        superficie: "sistema",
        peticionId: null,
        origen: "migracion_personal",
      };
      for (const correo of correos) {
        await cliente.query("savepoint correo");
        try {
          const emitida = await emitirEnTransaccion(cliente, actor, {
            operadorId,
            nombre: correo.split("@")[0] ?? correo,
            correo,
            destino: { tipo: "personal", roles: ["administracion_plataforma"] },
            ahora: new Date(),
            ejecutadoPor,
            corridoPor: quienCorre,
          });
          await cliente.query("release savepoint correo");
          emitidas.push({ correo, emitida });
        } catch (error) {
          if (error instanceof ErrorDeDominio && error.codigo === "personal_existente") {
            await cliente.query("rollback to savepoint correo");
            emitidas.push({ correo, emitida: null });
            continue;
          }
          throw error;
        }
      }
      await cliente.query("commit");
    } catch (error) {
      await cliente.query("rollback").catch(() => undefined);
      throw error;
    }
  } finally {
    await cliente.end();
  }
  // Los correos salen cuando las invitaciones ya quedaron en la base.
  const salida: { correo: string; resultado: "invitada" | "ya_era_personal"; invitacion?: InvitacionDeAlta }[] = [];
  for (const { correo, emitida } of emitidas) {
    salida.push(emitida
      ? { correo, resultado: "invitada", invitacion: { emitida, entrega: await entregarInvitacion(emitida, null) } }
      : { correo, resultado: "ya_era_personal" });
  }
  return salida;
}
