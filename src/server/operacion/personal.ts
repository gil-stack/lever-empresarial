import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";

export async function listarPersonal(ctx: ContextoDePersonal): Promise<Array<{ id: string; nombre: string; correo: string }>> {
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select u.id, u.nombre, u.correo
       from platform_staff s join users u on u.id = s.user_id
       where s.estado = 'activo'
       order by u.nombre, u.id`,
      [],
    ),
  );
  return (resultado.rows as Array<Record<string, unknown>>).map((fila) => ({
    id: String(fila.id),
    nombre: String(fila.nombre),
    correo: String(fila.correo),
  }));
}
