import { conTransaccion, consultar, type Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { ROLES, type Rol } from "../session/tipos";
import type {
  InvitacionConsumida,
  InvitacionLeida,
  RepositorioInvitaciones,
  RepositorioRecuperacion,
  TipoInvitacion,
  TransaccionInvitaciones,
  TransaccionRecuperacion,
} from "./tipos";

// Tablas de db/propuestas/fase-4-invitaciones.sql. Ninguna lectura trae el
// token: solo su SHA-256, y solo como filtro.
export const SQL = {
  empresa: "select id, razon_social, rfc from companies where id = $1",
  nombreDe: "select nombre from users where id = $1",
  esMiembro: `select 1 as presente
    from memberships m
    join users u on u.id = m.user_id
    where lower(u.correo) = $1 and m.company_id = $2
    limit 1`,
  buscarInvitacion: `select i.id, i.company_id, i.tipo, i.correo, i.nombre, i.roles, i.vence_en,
      i.aceptada_en, i.revocada_en, c.razon_social, c.rfc, q.nombre as quien_invita,
      exists (select 1 from users x where lower(x.correo) = i.correo) as cuenta_existente
    from invitations i
    join companies c on c.id = i.company_id
    left join users q on q.id = i.invitado_por
    where i.token_hash = $1`,
  cuentaPorCorreo: "select id, nombre, correo, password_hash from users where lower(correo) = $1",
  revocarPendientes: `update invitations set revocada_en = $3
    where company_id = $1 and correo = $2 and aceptada_en is null and revocada_en is null
    returning id`,
  insertarInvitacion: `insert into invitations (
      id, company_id, tipo, correo, nombre, roles, token_hash, invitado_por, creada_en, vence_en
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
  consumirInvitacion: `update invitations set aceptada_en = $2, aceptada_por = $3
    where token_hash = $1 and aceptada_en is null and revocada_en is null and vence_en > $2
    returning id, company_id, correo, roles`,
  revocarInvitacion: `update invitations set revocada_en = $3
    where id = $1 and company_id = $2 and aceptada_en is null and revocada_en is null`,
  insertarUsuario: `insert into users (id, nombre, correo, password_hash, correo_verificado_en)
    values ($1, $2, $3, $4, $5)`,
  marcarCorreoVerificado:
    "update users set correo_verificado_en = coalesce(correo_verificado_en, $2) where id = $1",
  unirAEmpresa: "insert into memberships (user_id, company_id, rol) values ($1, $2, $3)",

  buscarRecuperacion: "select vence_en, usado_en, anulado_en from password_resets where token_hash = $1",
  recuperacionesRecientes:
    "select count(*)::int as total from password_resets where user_id = $1 and creado_en >= $2",
  anularRecuperaciones: `update password_resets set anulado_en = $2
    where user_id = $1 and usado_en is null and anulado_en is null`,
  insertarRecuperacion: `insert into password_resets (id, user_id, token_hash, creado_en, vence_en)
    values ($1, $2, $3, $4, $5)`,
  anularRecuperacion:
    "update password_resets set anulado_en = $2 where id = $1 and usado_en is null and anulado_en is null",
  consumirRecuperacion: `update password_resets set usado_en = $2
    where token_hash = $1 and usado_en is null and anulado_en is null and vence_en > $2
    returning user_id`,
  cambiarContrasena: "update users set password_hash = $2 where id = $1",
  cerrarSesiones: "delete from sessions where user_id = $1",
} as const;

export function repositorioInvitacionesPg(): RepositorioInvitaciones {
  return {
    rolesCombinables: false,
    async empresa(companyId) {
      const fila = (await consultar(SQL.empresa, [companyId])).rows[0] as Record<string, unknown> | undefined;
      if (!fila) return null;
      return { id: texto(fila.id), razonSocial: texto(fila.razon_social), rfc: texto(fila.rfc) };
    },
    async nombreDe(userId) {
      const fila = (await consultar(SQL.nombreDe, [userId])).rows[0] as Record<string, unknown> | undefined;
      return fila ? texto(fila.nombre) : null;
    },
    async esMiembro(correo, companyId) {
      return (await consultar(SQL.esMiembro, [correo, companyId])).rows.length > 0;
    },
    async buscarPorTokenHash(tokenHash) {
      const fila = (await consultar(SQL.buscarInvitacion, [tokenHash])).rows[0] as
        | Record<string, unknown>
        | undefined;
      return fila ? mapearInvitacion(fila) : null;
    },
    async cuentaPorCorreo(correo) {
      const fila = (await consultar(SQL.cuentaPorCorreo, [correo])).rows[0] as Record<string, unknown> | undefined;
      if (!fila) return null;
      return { id: texto(fila.id), nombre: texto(fila.nombre), passwordHash: texto(fila.password_hash) };
    },
    conTransaccion(fn) {
      return conTransaccion((consulta) => fn(transaccionInvitaciones(consulta)));
    },
  };
}

export function transaccionInvitaciones(consulta: Consulta): TransaccionInvitaciones {
  return {
    consulta,
    async revocarPendientes(companyId, correo, ahora) {
      const resultado = await consulta.query(SQL.revocarPendientes, [companyId, correo, ahora]);
      return resultado.rows.map((fila) => texto((fila as Record<string, unknown>).id));
    },
    async insertar(i) {
      await consulta.query(SQL.insertarInvitacion, [
        i.id,
        i.companyId,
        i.tipo,
        i.correo,
        i.nombre,
        [...i.roles],
        i.tokenHash,
        i.invitadoPor,
        i.creadaEn,
        i.venceEn,
      ]);
    },
    async consumir(tokenHash, ahora, userId) {
      const fila = (await consulta.query(SQL.consumirInvitacion, [tokenHash, ahora, userId])).rows[0] as
        | Record<string, unknown>
        | undefined;
      if (!fila) return null;
      const consumida: InvitacionConsumida = {
        id: texto(fila.id),
        companyId: texto(fila.company_id),
        correo: texto(fila.correo),
        roles: roles(fila.roles),
      };
      return consumida;
    },
    async revocar(id, companyId, ahora) {
      return (await consulta.query(SQL.revocarInvitacion, [id, companyId, ahora])).rowCount > 0;
    },
    async crearUsuario(u) {
      await consulta.query(SQL.insertarUsuario, [u.id, u.nombre, u.correo, u.passwordHash, u.verificadoEn]);
    },
    async marcarCorreoVerificado(userId, ahora) {
      await consulta.query(SQL.marcarCorreoVerificado, [userId, ahora]);
    },
    async unirAEmpresa({ userId, companyId, roles: lista }) {
      // La membresía de hoy guarda un rol. La tenencia escribe la lista completa.
      if (lista.length !== 1) throw new ErrorDeDominio("roles_combinados_pendientes");
      await consulta.query(SQL.unirAEmpresa, [userId, companyId, lista[0]]);
    },
  };
}

export function repositorioRecuperacionPg(): RepositorioRecuperacion {
  return {
    async cuentaPorCorreo(correo) {
      const fila = (await consultar(SQL.cuentaPorCorreo, [correo])).rows[0] as Record<string, unknown> | undefined;
      if (!fila) return null;
      return { id: texto(fila.id), nombre: texto(fila.nombre), correo: texto(fila.correo) };
    },
    async buscarPorTokenHash(tokenHash) {
      const fila = (await consultar(SQL.buscarRecuperacion, [tokenHash])).rows[0] as
        | Record<string, unknown>
        | undefined;
      if (!fila) return null;
      return {
        venceEn: instante(fila.vence_en),
        usadoEn: instanteOpcional(fila.usado_en),
        anuladoEn: instanteOpcional(fila.anulado_en),
      };
    },
    conTransaccion(fn) {
      return conTransaccion((consulta) => fn(transaccionRecuperacion(consulta)));
    },
  };
}

export function transaccionRecuperacion(consulta: Consulta): TransaccionRecuperacion {
  return {
    consulta,
    async recientes(userId, desde) {
      const fila = (await consulta.query(SQL.recuperacionesRecientes, [userId, desde])).rows[0] as
        | Record<string, unknown>
        | undefined;
      const total = Number(fila?.total ?? 0);
      return Number.isFinite(total) ? total : 0;
    },
    async anularPendientes(userId, ahora) {
      await consulta.query(SQL.anularRecuperaciones, [userId, ahora]);
    },
    async insertar(r) {
      await consulta.query(SQL.insertarRecuperacion, [r.id, r.userId, r.tokenHash, r.creadoEn, r.venceEn]);
    },
    async anular(id, ahora) {
      await consulta.query(SQL.anularRecuperacion, [id, ahora]);
    },
    async consumir(tokenHash, ahora) {
      const fila = (await consulta.query(SQL.consumirRecuperacion, [tokenHash, ahora])).rows[0] as
        | Record<string, unknown>
        | undefined;
      return fila ? texto(fila.user_id) : null;
    },
    async cambiarContrasena(userId, passwordHash) {
      await consulta.query(SQL.cambiarContrasena, [userId, passwordHash]);
    },
    async marcarCorreoVerificado(userId, ahora) {
      await consulta.query(SQL.marcarCorreoVerificado, [userId, ahora]);
    },
    async cerrarSesiones(userId) {
      await consulta.query(SQL.cerrarSesiones, [userId]);
    },
  };
}

function mapearInvitacion(fila: Record<string, unknown>): InvitacionLeida {
  const tipo = fila.tipo;
  if (tipo !== "empresa" && tipo !== "usuario") throw new ErrorDeDominio("base_no_disponible");
  return {
    id: texto(fila.id),
    companyId: texto(fila.company_id),
    tipo: tipo as TipoInvitacion,
    correo: texto(fila.correo),
    nombre: texto(fila.nombre),
    roles: roles(fila.roles),
    venceEn: instante(fila.vence_en),
    aceptadaEn: instanteOpcional(fila.aceptada_en),
    revocadaEn: instanteOpcional(fila.revocada_en),
    razonSocial: texto(fila.razon_social),
    rfc: texto(fila.rfc),
    quienInvita: typeof fila.quien_invita === "string" ? fila.quien_invita : null,
    cuentaExistente: fila.cuenta_existente === true,
  };
}

function texto(valor: unknown): string {
  if (typeof valor !== "string") throw new ErrorDeDominio("base_no_disponible");
  return valor;
}

function roles(valor: unknown): Rol[] {
  if (!Array.isArray(valor) || valor.length === 0) throw new ErrorDeDominio("base_no_disponible");
  return valor.map((rol) => {
    const conocido = ROLES.find((r) => r === rol);
    if (!conocido) throw new ErrorDeDominio("base_no_disponible");
    return conocido;
  });
}

function instante(valor: unknown): Date {
  const fecha = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(fecha.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return fecha;
}

function instanteOpcional(valor: unknown): Date | null {
  return valor === null || valor === undefined ? null : instante(valor);
}
