import { conTransaccion, consultar } from "./db";
import { ErrorDeDominio } from "./error-de-dominio";
import { ROLES, type Rol, type Sesion } from "./tipos";

export type UsuarioInterno = {
  id: string;
  nombre: string;
  correo: string;
  passwordHash: string;
};

export type SesionGuardada = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type RegistroCuenta = {
  usuario: UsuarioInterno;
  sesion: SesionGuardada;
};

export type RepositorioSesion = {
  crearCuenta: (registro: RegistroCuenta) => Promise<void>;
  buscarPorCorreo: (correo: string) => Promise<UsuarioInterno | null>;
  abrirSesion: (sesion: SesionGuardada) => Promise<void>;
  buscarPorTokenHash: (tokenHash: string, ahora: Date) => Promise<Sesion | null>;
  borrarPorTokenHash: (tokenHash: string) => Promise<void>;
  /** Borra la persona solo si no tiene empresa. Si ya hay membresía, no toca la fila. */
  descartarCuentaSinEmpresa: (userId: string) => Promise<boolean>;
};

// users: id, nombre, correo, password_hash.
// sessions: id, user_id, token_hash, expires_at.
// La empresa de la sesión sale de memberships, no de un id enviado por el navegador.
export const SQL = {
  insertarUsuario: "insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, $4)",
  buscarCorreo: "select id, nombre, correo, password_hash from users where correo = $1",
  insertarSesion: "insert into sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, $4)",
  borrarSesionesDelUsuario: "delete from sessions where user_id = $1",
  buscarSesion: `
    select s.id, s.expires_at, u.id as user_id, u.nombre, u.correo, m.company_id, m.rol
    from sessions s
    join users u on u.id = s.user_id
    left join lateral (
      select company_id, rol
      from memberships
      where user_id = u.id
      limit 1
    ) m on true
    where s.token_hash = $1 and s.expires_at > $2
  `,
  borrarSesion: "delete from sessions where token_hash = $1",
  bloquearUsuario: "select id from users where id = $1 for update",
  tieneMembresia: "select 1 as presente from memberships where user_id = $1 limit 1",
  borrarUsuario: "delete from users where id = $1",
} as const;

type FilaUsuario = {
  id: string;
  nombre: string;
  correo: string;
  password_hash: string;
};

type FilaSesion = {
  id: string;
  expires_at: Date | string;
  user_id: string;
  nombre: string;
  correo: string;
  company_id: string | null;
  rol: string | null;
};

export function repositorioPg(): RepositorioSesion {
  return {
    async crearCuenta(registro) {
      await conTransaccion(async (consulta) => {
        await consulta.query(SQL.insertarUsuario, [
          registro.usuario.id,
          registro.usuario.nombre,
          registro.usuario.correo,
          registro.usuario.passwordHash,
        ]);
        await consulta.query(SQL.insertarSesion, [
          registro.sesion.id,
          registro.sesion.userId,
          registro.sesion.tokenHash,
          registro.sesion.expiresAt,
        ]);
      });
    },
    async buscarPorCorreo(correo) {
      const resultado = await consultar(SQL.buscarCorreo, [correo]);
      const fila = resultado.rows[0] as FilaUsuario | undefined;
      if (!fila) return null;
      if (
        typeof fila.id !== "string" ||
        typeof fila.nombre !== "string" ||
        typeof fila.correo !== "string" ||
        typeof fila.password_hash !== "string"
      ) {
        throw new ErrorDeDominio("base_no_disponible");
      }
      return {
        id: fila.id,
        nombre: fila.nombre,
        correo: fila.correo,
        passwordHash: fila.password_hash,
      };
    },
    async abrirSesion(sesion) {
      await conTransaccion(async (consulta) => {
        await consulta.query(SQL.borrarSesionesDelUsuario, [sesion.userId]);
        await consulta.query(SQL.insertarSesion, [
          sesion.id,
          sesion.userId,
          sesion.tokenHash,
          sesion.expiresAt,
        ]);
      });
    },
    async buscarPorTokenHash(tokenHash, ahora) {
      const resultado = await consultar(SQL.buscarSesion, [tokenHash, ahora]);
      const fila = resultado.rows[0] as FilaSesion | undefined;
      if (!fila) return null;
      return mapearSesion(fila);
    },
    async borrarPorTokenHash(tokenHash) {
      await consultar(SQL.borrarSesion, [tokenHash]);
    },
    descartarCuentaSinEmpresa(userId) {
      return conTransaccion(async (consulta) => {
        const usuario = await consulta.query(SQL.bloquearUsuario, [userId]);
        if (usuario.rows.length === 0) return false;
        const membresia = await consulta.query(SQL.tieneMembresia, [userId]);
        if (membresia.rows.length > 0) return false;
        await consulta.query(SQL.borrarSesionesDelUsuario, [userId]);
        const borrado = await consulta.query(SQL.borrarUsuario, [userId]);
        return borrado.rowCount > 0;
      });
    },
  };
}

export function mapearSesion(fila: FilaSesion): Sesion {
  const venceEn = fila.expires_at instanceof Date ? fila.expires_at : new Date(String(fila.expires_at));
  if (
    typeof fila.id !== "string" ||
    typeof fila.user_id !== "string" ||
    typeof fila.nombre !== "string" ||
    typeof fila.correo !== "string" ||
    Number.isNaN(venceEn.getTime())
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    id: fila.id,
    venceEn,
    usuario: { id: fila.user_id, nombre: fila.nombre, correo: fila.correo },
    companyId: typeof fila.company_id === "string" ? fila.company_id : null,
    rol: rolLeido(fila.rol),
  };
}

function rolLeido(valor: string | null): Rol | null {
  if (valor === null) return null;
  return ROLES.find((rol) => rol === valor) ?? null;
}
