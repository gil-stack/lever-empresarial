import { auditar, actorDeIdentidad, operadorDeLaPlataforma } from "../bitacora/auditar";
import { conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { METODOS_SEGUNDO_FACTOR, type MetodoSegundoFactor, type Sesion } from "./tipos";

export type UsuarioInterno = {
  id: string;
  nombre: string;
  correo: string;
  passwordHash: string | null;
};

export type SesionGuardada = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type SegundoFactorVerificado = {
  tokenHashParcial: string;
  tokenHashCompleto: string;
  metodo: MetodoSegundoFactor;
  expiresAt: Date;
  ahora: Date;
};

export type RepositorioSesion = {
  buscarPorCorreo: (correo: string) => Promise<UsuarioInterno | null>;
  /** La sesión nace parcial: contraseña sí, segundo factor todavía no. */
  abrirSesion: (sesion: SesionGuardada) => Promise<void>;
  buscarPorTokenHash: (tokenHash: string, ahora: Date, completa: boolean) => Promise<Sesion | null>;
  /** Marca el segundo factor y cambia el token en un acto. Devuelve la sesión completa. */
  completarSegundoFactor: (verificado: SegundoFactorVerificado) => Promise<Sesion>;
  borrarPorTokenHash: (tokenHash: string, ahora: Date) => Promise<void>;
  registrarFallo: (userId: string | null) => Promise<void>;
};

// Antes de saber quién entra no hay empresa ni persona en el contexto. Esas
// búsquedas pasan por funciones SECURITY DEFINER de entrada estrecha.
export const SQL = {
  buscarCorreo: "select id, nombre, correo, password_hash from identidad_por_correo($1)",
  buscarSesion: `
    select sesion_id as id, user_id, nombre, correo, expires_at, segundo_factor_en, segundo_factor_metodo
    from sesion_por_token($1, $2, $3)
  `,
  insertarSesion:
    "insert into sessions (id, user_id, token_hash, expires_at, superficie) values ($1, $2, $3, $4, 'cliente')",
  borrarSesionesDelUsuario: "delete from sessions where user_id = $1",
  completar: `
    update sessions
    set token_hash = $2, segundo_factor_en = $3, segundo_factor_metodo = $4, expires_at = $5
    where token_hash = $1 and segundo_factor_en is null and expires_at > $3
  `,
  borrarSesion: "delete from sessions where token_hash = $1",
} as const;

type FilaUsuario = {
  id: unknown;
  nombre: unknown;
  correo: unknown;
  password_hash: unknown;
};

type FilaSesion = {
  id: unknown;
  expires_at: unknown;
  user_id: unknown;
  nombre: unknown;
  correo: unknown;
  segundo_factor_en?: unknown;
  segundo_factor_metodo?: unknown;
};

const SIN_CONTEXTO = { rol: "plataforma_cliente" } as const;

export function repositorioPg(): RepositorioSesion {
  return {
    buscarPorCorreo(correo) {
      return conContexto(SIN_CONTEXTO, async (consulta) => {
        const resultado = await consulta.query(SQL.buscarCorreo, [correo]);
        const fila = resultado.rows[0] as FilaUsuario | undefined;
        if (!fila) return null;
        if (
          typeof fila.id !== "string" ||
          typeof fila.nombre !== "string" ||
          typeof fila.correo !== "string" ||
          (fila.password_hash !== null && typeof fila.password_hash !== "string")
        ) {
          throw new ErrorDeDominio("base_no_disponible");
        }
        return { id: fila.id, nombre: fila.nombre, correo: fila.correo, passwordHash: fila.password_hash };
      });
    },
    abrirSesion(sesion) {
      return conContexto({ rol: "plataforma_cliente", userId: sesion.userId }, async (consulta) => {
        await consulta.query(SQL.borrarSesionesDelUsuario, [sesion.userId]);
        await consulta.query(SQL.insertarSesion, [sesion.id, sesion.userId, sesion.tokenHash, sesion.expiresAt]);
        await auditar(consulta, actorDeIdentidad({ id: sesion.userId }, undefined, await operadorDeLaPlataforma(consulta)), {
          accion: "entrada",
          identificador: sesion.id,
        });
      });
    },
    buscarPorTokenHash(tokenHash, ahora, completa) {
      return conContexto(SIN_CONTEXTO, (consulta) => sesionPorToken(consulta, tokenHash, ahora, completa));
    },
    async completarSegundoFactor(verificado) {
      const parcial = await conContexto(SIN_CONTEXTO, (consulta) =>
        sesionPorToken(consulta, verificado.tokenHashParcial, verificado.ahora, false),
      );
      if (!parcial) throw new ErrorDeDominio("sesion_ausente");
      return conContexto({ rol: "plataforma_cliente", userId: parcial.usuario.id }, async (consulta) => {
        const cambiada = await consulta.query(SQL.completar, [
          verificado.tokenHashParcial,
          verificado.tokenHashCompleto,
          verificado.ahora,
          verificado.metodo,
          verificado.expiresAt,
        ]);
        if (cambiada.rowCount !== 1) throw new ErrorDeDominio("sesion_ausente");
        await auditar(consulta, actorDeIdentidad(parcial.usuario, undefined, await operadorDeLaPlataforma(consulta)), {
          accion: "segundo_factor",
          identificador: parcial.id,
          cambio: { metodo: verificado.metodo },
        });
        const completa = await sesionPorToken(consulta, verificado.tokenHashCompleto, verificado.ahora, true);
        if (!completa) throw new ErrorDeDominio("base_no_disponible");
        return completa;
      });
    },
    async borrarPorTokenHash(tokenHash, ahora) {
      const sesion = await conContexto(
        SIN_CONTEXTO,
        async (consulta) =>
          (await sesionPorToken(consulta, tokenHash, ahora, true)) ??
          (await sesionPorToken(consulta, tokenHash, ahora, false)),
      );
      if (!sesion) return;
      await conContexto({ rol: "plataforma_cliente", userId: sesion.usuario.id }, async (consulta) => {
        await consulta.query(SQL.borrarSesion, [tokenHash]);
        await auditar(consulta, actorDeIdentidad(sesion.usuario, undefined, await operadorDeLaPlataforma(consulta)), {
          accion: "salida",
          identificador: sesion.id,
        });
      });
    },
    registrarFallo(userId) {
      const escribir = async (consulta: Consulta) => {
        await auditar(
          consulta,
          actorDeIdentidad(userId ? { id: userId } : null, undefined, await operadorDeLaPlataforma(consulta)),
          {
            accion: "entrada_fallida",
            identificador: userId,
            cambio: { motivo: userId ? "contrasena" : "correo_desconocido" },
          },
        );
      };
      return userId
        ? conContexto({ rol: "plataforma_cliente", userId }, escribir)
        : conContexto(SIN_CONTEXTO, escribir);
    },
  };
}

async function sesionPorToken(
  consulta: Consulta,
  tokenHash: string,
  ahora: Date,
  completa: boolean,
): Promise<Sesion | null> {
  const resultado = await consulta.query(SQL.buscarSesion, [tokenHash, ahora, completa]);
  const fila = resultado.rows[0] as FilaSesion | undefined;
  return fila ? mapearSesion(fila) : null;
}

export function mapearSesion(fila: FilaSesion): Sesion {
  const venceEn = instante(fila.expires_at);
  if (
    typeof fila.id !== "string" ||
    typeof fila.user_id !== "string" ||
    typeof fila.nombre !== "string" ||
    typeof fila.correo !== "string" ||
    !venceEn
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  const en = fila.segundo_factor_en == null ? null : instante(fila.segundo_factor_en);
  const metodo = METODOS_SEGUNDO_FACTOR.find((conocido) => conocido === fila.segundo_factor_metodo) ?? null;
  if ((en === null) !== (metodo === null) || (fila.segundo_factor_en != null && !en)) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    id: fila.id,
    venceEn,
    usuario: { id: fila.user_id, nombre: fila.nombre, correo: fila.correo },
    segundoFactor: en && metodo ? { metodo, en } : null,
  };
}

function instante(valor: unknown): Date | null {
  const fecha = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
