import { randomUUID } from "node:crypto";

import type { RolCliente, RolPlataforma } from "../../nucleo/capacidades";
import { conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { auditar, type Actor } from "../bitacora/auditar";
import { hashDeToken, tokenNuevo } from "../session/hash";
import type { InvitacionEmitida, InvitacionLeida } from "./tipos";

/** Setenta y dos horas. La base no acepta más de siete días. */
export const VIGENCIA_INVITACION_MS = 72 * 60 * 60 * 1000;

export const SQL = {
  usuarioPorCorreo: "select id, nombre, tiene_contrasena from usuario_por_correo($1)",
  insertarUsuario: "insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, null)",
  membresia: "select estado from memberships where user_id = $1 and company_id = $2",
  insertarMembresia: "insert into memberships (user_id, company_id, estado) values ($1, $2, 'invitada')",
  insertarRol: "insert into membership_roles (user_id, company_id, rol) values ($1, $2, $3)",
  personal: "select estado from platform_staff where operator_id = $1 and user_id = $2",
  insertarPersonal: "insert into platform_staff (operator_id, user_id, estado) values ($1, $2, 'invitado')",
  insertarRolDePersonal: "insert into platform_staff_roles (operator_id, user_id, rol) values ($1, $2, $3)",
  revocarPendientes: `
    update invitations
    set revocada_en = now()
    where user_id = $1
      and company_id is not distinct from $2
      and usada_en is null
      and revocada_en is null
  `,
  insertarInvitacion: `
    insert into invitations (
      id, operator_id, company_id, user_id, token_hash,
      emitida_por_tipo, emitida_por, emitida_en, expira_en
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `,
  porToken: `
    select id, operator_id, company_id, user_id, nombre, correo, razon_social,
           tiene_contrasena, expira_en, usada_en, revocada_en
    from invitacion_por_token($1)
  `,
  consumir: `
    update invitations
    set usada_en = now()
    where id = $1 and usada_en is null and revocada_en is null and expira_en > now()
  `,
  fijarContrasena: `
    update users
    set password_hash = $2, correo_verificado_en = now()
    where id = $1 and password_hash is null
  `,
  verificarCorreo: "update users set correo_verificado_en = coalesce(correo_verificado_en, now()) where id = $1",
  activarMembresia: "update memberships set estado = 'activa' where user_id = $1 and company_id = $2 and estado = 'invitada'",
  activarPersonal: "update platform_staff set estado = 'activo' where operator_id = $1 and user_id = $2 and estado = 'invitado'",
} as const;

type Destino =
  | { tipo: "empresa"; companyId: string; roles: readonly RolCliente[] }
  | { tipo: "personal"; roles: readonly RolPlataforma[] };

/**
 * Emite dentro de la transacción del llamador: el rol de base y el contexto
 * ya están fijados. Crea a la persona sin contraseña si no existía, su
 * membresía «invitada» con sus roles (o su registro de personal), revoca la
 * invitación anterior que siguiera abierta y deja los eventos.
 */
export async function emitirEnTransaccion(
  consulta: Consulta,
  actor: Actor,
  entrada: {
    operadorId: string;
    nombre: string;
    correo: string;
    destino: Destino;
    ahora: Date;
    /** Quién corrió el comando de la dueña de la base (session_user), para el alta del personal. */
    ejecutadoPor?: string;
  },
): Promise<InvitacionEmitida> {
  const existente = await consulta.query(SQL.usuarioPorCorreo, [entrada.correo]);
  const fila = existente.rows[0] as { id?: unknown; nombre?: unknown } | undefined;
  let userId: string;
  let nombre = entrada.nombre;
  if (fila && typeof fila.id === "string") {
    userId = fila.id;
    if (typeof fila.nombre === "string") nombre = fila.nombre;
  } else {
    userId = randomUUID();
    await consulta.query(SQL.insertarUsuario, [userId, entrada.nombre, entrada.correo]);
  }

  const companyId = entrada.destino.tipo === "empresa" ? entrada.destino.companyId : null;
  if (entrada.destino.tipo === "empresa") {
    const previa = await consulta.query(SQL.membresia, [userId, entrada.destino.companyId]);
    if (previa.rows.length > 0) throw new ErrorDeDominio("correo_ya_entra");
    await consulta.query(SQL.insertarMembresia, [userId, entrada.destino.companyId]);
    await auditar(consulta, actor, {
      accion: "asignar_rol",
      identificador: userId,
      cambio: { rol: entrada.destino.roles.join(",") },
    });
    for (const rol of entrada.destino.roles) {
      await consulta.query(SQL.insertarRol, [userId, entrada.destino.companyId, rol]);
    }
  } else {
    const previo = await consulta.query(SQL.personal, [entrada.operadorId, userId]);
    if (previo.rows.length > 0) throw new ErrorDeDominio("personal_existente");
    await consulta.query(SQL.insertarPersonal, [entrada.operadorId, userId]);
    for (const rol of entrada.destino.roles) {
      await consulta.query(SQL.insertarRolDePersonal, [entrada.operadorId, userId, rol]);
    }
    await auditar(consulta, actor, {
      accion: "alta_personal",
      identificador: userId,
      cambio: {
        rol: entrada.destino.roles.join(","),
        ...(entrada.ejecutadoPor ? { ejecutado_por: entrada.ejecutadoPor } : {}),
      },
    });
  }

  return emitirToken(consulta, actor, {
    operadorId: entrada.operadorId,
    companyId,
    userId,
    nombre,
    correo: entrada.correo,
    roles: entrada.destino.roles,
    ahora: entrada.ahora,
  });
}

/** Un enlace nuevo para alguien que ya está invitado. El anterior deja de servir. */
export async function emitirToken(
  consulta: Consulta,
  actor: Actor,
  entrada: {
    operadorId: string;
    companyId: string | null;
    userId: string;
    nombre: string;
    correo: string;
    roles: readonly (RolCliente | RolPlataforma)[];
    ahora: Date;
  },
): Promise<InvitacionEmitida> {
  await consulta.query(SQL.revocarPendientes, [entrada.userId, entrada.companyId]);
  const id = randomUUID();
  const token = tokenNuevo();
  const expiraEn = new Date(entrada.ahora.getTime() + VIGENCIA_INVITACION_MS);
  await consulta.query(SQL.insertarInvitacion, [
    id,
    entrada.operadorId,
    entrada.companyId,
    entrada.userId,
    hashDeToken(token),
    actor.actorTipo,
    actor.actorId,
    entrada.ahora,
    expiraEn,
  ]);
  await auditar(consulta, actor, {
    accion: "emitir_invitacion",
    identificador: id,
    cambio: { roles: entrada.roles.join(","), expira_en: expiraEn.toISOString() },
  });
  return {
    invitacionId: id,
    userId: entrada.userId,
    companyId: entrada.companyId,
    correo: entrada.correo,
    nombre: entrada.nombre,
    roles: entrada.roles,
    token,
    expiraEn,
  };
}

export type RepositorioInvitaciones = {
  porToken: (tokenHash: string) => Promise<InvitacionLeida | null>;
  /** Cierra la invitación, fija la contraseña (si hace falta) y activa la membresía, en un acto. */
  consumir: (invitacion: InvitacionLeida, passwordHash: string | null) => Promise<void>;
};

export function repositorioPg(): RepositorioInvitaciones {
  return {
    porToken(tokenHash) {
      return conContexto({ rol: "plataforma_cliente" }, async (consulta) => {
        const resultado = await consulta.query(SQL.porToken, [tokenHash]);
        const fila = resultado.rows[0];
        return fila ? mapear(fila) : null;
      });
    },
    consumir(invitacion, passwordHash) {
      const deEmpresa = invitacion.companyId !== null;
      return conContexto(
        {
          rol: deEmpresa ? "plataforma_cliente" : "plataforma_sofipo",
          companyId: invitacion.companyId,
          userId: invitacion.userId,
          operadorId: invitacion.operadorId,
        },
        async (consulta) => {
          const cerrada = await consulta.query(SQL.consumir, [invitacion.id]);
          if (cerrada.rowCount !== 1) throw new ErrorDeDominio("invitacion_cerrada");
          if (passwordHash) {
            const fijada = await consulta.query(SQL.fijarContrasena, [invitacion.userId, passwordHash]);
            if (fijada.rowCount !== 1) throw new ErrorDeDominio("invitacion_cerrada");
          } else {
            await consulta.query(SQL.verificarCorreo, [invitacion.userId]);
          }
          if (invitacion.companyId) {
            await consulta.query(SQL.activarMembresia, [invitacion.userId, invitacion.companyId]);
          } else {
            await consulta.query(SQL.activarPersonal, [invitacion.operadorId, invitacion.userId]);
          }
          await auditar(
            consulta,
            {
              operadorId: invitacion.operadorId,
              companyId: invitacion.companyId,
              actorTipo: deEmpresa ? "miembro" : "personal",
              actorId: invitacion.userId,
              superficie: deEmpresa ? "cliente" : "sofipo",
              peticionId: null,
              origen: "invitacion",
            },
            { accion: "aceptar_invitacion", identificador: invitacion.id },
          );
        },
      );
    },
  };
}

function mapear(fila: unknown): InvitacionLeida {
  const r = fila as Record<string, unknown>;
  const expiraEn = instante(r.expira_en);
  if (
    typeof r.id !== "string" ||
    typeof r.operator_id !== "string" ||
    typeof r.user_id !== "string" ||
    typeof r.nombre !== "string" ||
    typeof r.correo !== "string" ||
    typeof r.tiene_contrasena !== "boolean" ||
    !expiraEn
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    id: r.id,
    operadorId: r.operator_id,
    companyId: typeof r.company_id === "string" ? r.company_id : null,
    userId: r.user_id,
    nombre: r.nombre,
    correo: r.correo,
    razonSocial: typeof r.razon_social === "string" ? r.razon_social : null,
    tieneContrasena: r.tiene_contrasena,
    expiraEn,
    usadaEn: instante(r.usada_en),
    revocadaEn: instante(r.revocada_en),
  };
}

function instante(valor: unknown): Date | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor;
  if (typeof valor === "string") {
    const fecha = new Date(valor);
    if (!Number.isNaN(fecha.getTime())) return fecha;
  }
  return null;
}
