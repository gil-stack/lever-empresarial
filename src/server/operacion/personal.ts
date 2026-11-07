import { esRolPlataforma, ROLES_PLATAFORMA, type RolPlataforma } from "../../nucleo/capacidades";
import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { uuidValido } from "../../dominio/operacion";
import { exigirFactorReciente, VIGENCIA_FACTORES_MS } from "../autenticacion/reautenticacion";
import type { Sesion } from "../session/tipos";
import { auditarOperacion } from "./auditar";
import { exigirEnOperacion } from "./permisos";

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

export type PersonaDelPersonal = {
  id: string;
  nombre: string;
  correo: string;
  estado: "invitado" | "activo" | "suspendido";
  roles: RolPlataforma[];
};

/** El personal del operador con sus roles. Solo para quien administra al personal. */
export async function listarPersonalConRoles(ctx: ContextoDePersonal): Promise<PersonaDelPersonal[]> {
  exigirEnOperacion(ctx, "plataforma.personal.administrar");
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select u.id, u.nombre, u.correo, s.estado,
              coalesce(array_agg(r.rol order by r.rol) filter (where r.rol is not null), '{}') as roles
       from platform_staff s
       join users u on u.id = s.user_id
       left join platform_staff_roles r on r.operator_id = s.operator_id and r.user_id = s.user_id
       group by u.id, u.nombre, u.correo, s.estado
       order by u.nombre, u.id`,
      [],
    ),
  );
  return (resultado.rows as Array<Record<string, unknown>>).map((fila) => ({
    id: String(fila.id),
    nombre: String(fila.nombre),
    correo: String(fila.correo),
    estado: fila.estado === "invitado" || fila.estado === "suspendido" ? fila.estado : "activo",
    roles: ROLES_PLATAFORMA.filter((rol) => (Array.isArray(fila.roles) ? fila.roles : []).includes(rol)),
  }));
}

/**
 * Asigna o quita un rol. Exige el segundo factor probado hace cinco minutos o menos
 * (como aprobar una recuperación: dar acceso es igual de delicado) y deja el evento. La base
 * rechaza darse un rol a sí mismo y juntar Cumplimiento con Auditoría u
 * Originación (50ª), aunque alguien se salte esta función.
 */
export async function cambiarRolPersonal(
  ctx: ContextoDePersonal,
  sesion: Pick<Sesion, "segundoFactor" | "superficie">,
  entrada: { userId: unknown; rol: unknown; quitar: boolean },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.personal.administrar");
  exigirFactorReciente(sesion, { superficie: "sofipo", vigenciaMs: VIGENCIA_FACTORES_MS });
  if (!uuidValido(entrada.userId)) throw new ErrorDeDominio("persona_ausente");
  if (!esRolPlataforma(entrada.rol)) throw new ErrorDeDominio("rol_invalido");
  const userId = entrada.userId;
  const rol = entrada.rol;
  if (userId === ctx.persona.id) throw new ErrorDeDominio("rol_propio");
  const ahora = new Date();
  await conContexto(basePlataforma(ctx), async (consulta) => {
    const persona = await consulta.query(
      "select estado from platform_staff where operator_id = $1 and user_id = $2 for update",
      [ctx.personal.operadorId, userId],
    );
    if (persona.rows.length !== 1) throw new ErrorDeDominio("persona_ausente");
    const cambio = entrada.quitar
      ? await consulta.query("delete from platform_staff_roles where operator_id = $1 and user_id = $2 and rol = $3", [
          ctx.personal.operadorId,
          userId,
          rol,
        ])
      : await consulta.query(
          `insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)
           on conflict on constraint platform_staff_roles_pkey do nothing`,
          [ctx.personal.operadorId, userId, rol],
        );
    // Un doble clic no deja dos eventos: si no cambió nada, no hay nada que auditar.
    if (cambio.rowCount !== 1) return;
    await auditarOperacion(consulta, ctx, {
      companyId: null,
      accion: entrada.quitar ? "rol_personal_retirado" : "rol_personal_asignado",
      identificador: userId,
      ocurridoEn: ahora,
      cambio: { rol },
    });
  });
}

export const ETIQUETA_ROL_PLATAFORMA: Record<RolPlataforma, string> = {
  administracion_plataforma: "Administración",
  originacion: "Originación",
  aprobacion: "Aprobación",
  cumplimiento: "Cumplimiento",
  auditoria: "Auditoría",
};

export const DESCRIPCION_ROL_PLATAFORMA: Record<RolPlataforma, string> = {
  administracion_plataforma: "Personal, precio, lista 69-B, invitaciones, alertas y comisiones.",
  originacion: "Registra prospectos, arma el expediente y pide la activación.",
  aprobacion: "Decide activaciones y suspensiones que pidió otra persona.",
  cumplimiento: "Dictamina expedientes, califica el riesgo y lleva la Lista de Personas Bloqueadas.",
  auditoria: "Consulta expedientes, bandeja y bitácora. No cambia nada.",
};
