import { Client } from "pg";

import { ErrorDeDominio } from "../src/nucleo/error-de-dominio";
import type { Actor } from "../src/server/bitacora/auditar";
import { emitirEnTransaccion } from "../src/server/invitaciones/repositorio";
import { entregarInvitacion } from "../src/server/invitaciones/servicio";
import type { InvitacionDeAlta } from "../src/server/plataforma/servicio";

/**
 * La primera Administración del personal de un operador, con la conexión de la
 * dueña de la base. Desde la aplicación nadie sin usuario da roles (0028,
 * platform_staff_roles_revisar): esto queda para el comando y las bases de prueba.
 * Cada correo recibe una invitación y el alta queda en la bitácora con quién corrió
 * el comando (session_user). Nunca imprime la URL.
 */
export async function invitarPersonalComoDuena(
  url: string,
  correos: readonly string[],
): Promise<{ correo: string; resultado: "invitada" | "ya_era_personal"; invitacion?: InvitacionDeAlta }[]> {
  const salida: { correo: string; resultado: "invitada" | "ya_era_personal"; invitacion?: InvitacionDeAlta }[] = [];
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    const operadores = await cliente.query("select id from operators order by alta_en, id");
    if (operadores.rows.length !== 1) throw new ErrorDeDominio("operador_ambiguo");
    const operadorId = String(operadores.rows[0].id);
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
      await cliente.query("begin");
      try {
        const emitida = await emitirEnTransaccion(cliente, actor, {
          operadorId,
          nombre: correo.split("@")[0] ?? correo,
          correo,
          destino: { tipo: "personal", roles: ["administracion_plataforma"] },
          ahora: new Date(),
          ejecutadoPor,
        });
        await cliente.query("commit");
        salida.push({ correo, resultado: "invitada", invitacion: { emitida, entrega: await entregarInvitacion(emitida, null) } });
      } catch (error) {
        await cliente.query("rollback").catch(() => undefined);
        if (error instanceof ErrorDeDominio && error.codigo === "personal_existente") {
          salida.push({ correo, resultado: "ya_era_personal" });
          continue;
        }
        throw error;
      }
    }
    return salida;
  } finally {
    await cliente.end();
  }
}
