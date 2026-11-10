import { Client } from "pg";

import { ErrorDeDominio } from "../src/nucleo/error-de-dominio";
import type { Actor } from "../src/server/bitacora/auditar";
import { emitirEnTransaccion, emitirToken } from "../src/server/invitaciones/repositorio";
import { entregarInvitacion } from "../src/server/invitaciones/servicio";
import type { InvitacionEmitida } from "../src/server/invitaciones/tipos";
import type { InvitacionDeAlta } from "../src/server/plataforma/servicio";
import { correoValido, normalizarCorreo } from "../src/server/session/validar";

/**
 * La primera Administración del personal de un operador, con la conexión de la
 * dueña de la base. Desde la aplicación nadie sin usuario da roles (0028,
 * platform_staff_roles_revisar): esto queda para el comando y las bases de prueba.
 * Solo sirve para arrancar: si el operador ya tiene a alguien con Administración
 * activa, no invita a nadie (las demás personas se invitan desde la pantalla
 * Personal). Si la Administración solo está invitada (el correo no salió, nadie
 * guardó el enlace o venció), una corrida con los mismos correos emite un enlace
 * nuevo y el anterior deja de servir; un correo distinto no entra. Cada alta y cada
 * enlace quedan en la bitácora con la conexión que corrió el comando (session_user;
 * en Neon siempre es la dueña) y el correo de la persona que lo corrió. Nunca
 * imprime la URL.
 */
export type ResultadoDelArranque = {
  correo: string;
  resultado: "invitada" | "reenviada" | "ya_era_personal";
  invitacion?: InvitacionDeAlta;
};

export async function invitarPersonalComoDuena(
  url: string,
  correos: readonly string[],
  corridoPor: string,
): Promise<ResultadoDelArranque[]> {
  const quienCorre = normalizarCorreo(corridoPor);
  if (!correoValido(quienCorre)) throw new ErrorDeDominio("corrido_por_invalido");
  const emitidas: { correo: string; emitida: InvitacionEmitida | null; reenviada: boolean }[] = [];
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
        `select u.id, u.nombre, u.correo, s.estado from platform_staff s
         join platform_staff_roles r on r.operator_id = s.operator_id and r.user_id = s.user_id
         join users u on u.id = s.user_id
         where s.operator_id = $1 and s.estado in ('activo', 'invitado') and r.rol = 'administracion_plataforma'`,
        [operadorId],
      );
      const administracion = administra.rows as Array<{ id: string; nombre: string; correo: string; estado: string }>;
      if (administracion.some((fila) => fila.estado === "activo")) throw new ErrorDeDominio("personal_con_administracion");
      const invitadas = new Map(administracion.map((fila) => [normalizarCorreo(fila.correo), fila]));
      if (invitadas.size > 0 && correos.some((correo) => !invitadas.has(normalizarCorreo(correo)))) {
        throw new ErrorDeDominio("arranque_con_otros_correos");
      }
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
        // base-N15: la Administración invitada recibe un enlace nuevo; el anterior queda revocado.
        const invitada = invitadas.get(normalizarCorreo(correo));
        if (invitada) {
          const emitida = await emitirToken(cliente, actor, {
            operadorId,
            companyId: null,
            userId: invitada.id,
            nombre: invitada.nombre,
            correo: invitada.correo,
            roles: ["administracion_plataforma"],
            ahora: new Date(),
            ejecutadoPor,
            corridoPor: quienCorre,
          });
          emitidas.push({ correo, emitida, reenviada: true });
          continue;
        }
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
          emitidas.push({ correo, emitida, reenviada: false });
        } catch (error) {
          if (error instanceof ErrorDeDominio && error.codigo === "personal_existente") {
            await cliente.query("rollback to savepoint correo");
            emitidas.push({ correo, emitida: null, reenviada: false });
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
  const salida: ResultadoDelArranque[] = [];
  for (const { correo, emitida, reenviada } of emitidas) {
    salida.push(emitida
      ? { correo, resultado: reenviada ? "reenviada" : "invitada", invitacion: { emitida, entrega: await entregarInvitacion(emitida, null) } }
      : { correo, resultado: "ya_era_personal" });
  }
  return salida;
}
