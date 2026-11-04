import type { HechoAcceso } from "./auditar.ts";
import type {
  InvitacionNueva,
  RepositorioInvitaciones,
  RepositorioRecuperacion,
  RecuperacionNueva,
  TransaccionInvitaciones,
  TransaccionRecuperacion,
} from "./tipos.ts";
import type { MensajeCorreo } from "../correo/tipos.ts";
import type { Rol } from "../session/tipos.ts";
import { ErrorDeDominio } from "../session/error-de-dominio.ts";

export const EMPRESA = "6f0d1c2a-7b3e-4d5f-8a91-0c2b4e6d8f10";
export const ADMIN = "a1b2c3d4-e5f6-4789-a012-3456789abcde";

type Invitacion = InvitacionNueva & { aceptadaEn: Date | null; aceptadaPor: string | null; revocadaEn: Date | null };
type Usuario = { id: string; nombre: string; correo: string; passwordHash: string; verificadoEn: Date | null };
type Recuperacion = RecuperacionNueva & { usadoEn: Date | null; anuladoEn: Date | null };

export type Estado = {
  empresas: Map<string, { id: string; razonSocial: string; rfc: string }>;
  usuarios: Map<string, Usuario>;
  membresias: Array<{ userId: string; companyId: string; roles: Rol[] }>;
  invitaciones: Map<string, Invitacion>;
  recuperaciones: Map<string, Recuperacion>;
  sesiones: Map<string, string>;
  auditoria: HechoAcceso[];
};

export function estadoInicial(): Estado {
  return {
    empresas: new Map([[EMPRESA, { id: EMPRESA, razonSocial: "Talleres del Norte", rfc: "TNO010101AB1" }]]),
    usuarios: new Map([
      [ADMIN, { id: ADMIN, nombre: "Ana Pérez", correo: "ana@ejemplo.mx", passwordHash: "hash:ana-clave-123", verificadoEn: null }],
    ]),
    membresias: [{ userId: ADMIN, companyId: EMPRESA, roles: ["administrador"] }],
    invitaciones: new Map(),
    recuperaciones: new Map(),
    sesiones: new Map([["sesion-ana", ADMIN]]),
    auditoria: [],
  };
}

/** Una transacción en memoria: trabaja sobre una copia y solo la publica si no hubo error. */
export function memoria(opciones: { rolesCombinables?: boolean; unirFalla?: boolean } = {}) {
  const caja = { estado: estadoInicial() };
  const enTransaccion = async <T, X>(armar: (e: Estado) => X, fn: (tx: X) => Promise<T>): Promise<T> => {
    const copia = structuredClone(caja.estado);
    const resultado = await fn(armar(copia));
    caja.estado = copia;
    return resultado;
  };

  const invitaciones: RepositorioInvitaciones = {
    rolesCombinables: opciones.rolesCombinables ?? false,
    async empresa(id) {
      return caja.estado.empresas.get(id) ?? null;
    },
    async nombreDe(id) {
      return caja.estado.usuarios.get(id)?.nombre ?? null;
    },
    async esMiembro(correo, companyId) {
      const usuario = [...caja.estado.usuarios.values()].find((u) => u.correo === correo);
      return !!usuario && caja.estado.membresias.some((m) => m.userId === usuario.id && m.companyId === companyId);
    },
    async buscarPorTokenHash(hash) {
      const i = [...caja.estado.invitaciones.values()].find((x) => x.tokenHash === hash);
      if (!i) return null;
      const empresa = caja.estado.empresas.get(i.companyId)!;
      return {
        id: i.id,
        companyId: i.companyId,
        tipo: i.tipo,
        correo: i.correo,
        nombre: i.nombre,
        roles: [...i.roles],
        venceEn: i.venceEn,
        aceptadaEn: i.aceptadaEn,
        revocadaEn: i.revocadaEn,
        razonSocial: empresa.razonSocial,
        rfc: empresa.rfc,
        quienInvita: i.invitadoPor ? (caja.estado.usuarios.get(i.invitadoPor)?.nombre ?? null) : null,
        cuentaExistente: [...caja.estado.usuarios.values()].some((u) => u.correo === i.correo),
      };
    },
    async cuentaPorCorreo(correo) {
      const u = [...caja.estado.usuarios.values()].find((x) => x.correo === correo);
      return u ? { id: u.id, nombre: u.nombre, passwordHash: u.passwordHash } : null;
    },
    conTransaccion(fn) {
      return enTransaccion((e) => txInvitaciones(e, opciones.unirFalla ?? false), fn);
    },
  };

  const recuperacion: RepositorioRecuperacion = {
    async cuentaPorCorreo(correo) {
      const u = [...caja.estado.usuarios.values()].find((x) => x.correo === correo);
      return u ? { id: u.id, nombre: u.nombre, correo: u.correo } : null;
    },
    async buscarPorTokenHash(hash) {
      const r = [...caja.estado.recuperaciones.values()].find((x) => x.tokenHash === hash);
      return r ? { venceEn: r.venceEn, usadoEn: r.usadoEn, anuladoEn: r.anuladoEn } : null;
    },
    conTransaccion(fn) {
      return enTransaccion(txRecuperacion, fn);
    },
  };

  return {
    get estado() {
      return caja.estado;
    },
    invitaciones,
    recuperacion,
  };
}

function consultaQueAudita(e: Estado) {
  return {
    async query(_sql: string, params: readonly unknown[] = []) {
      const [, companyId, actorId, accion, entidad, identificador, ocurridoEn] = params;
      e.auditoria.push({ companyId, actorId, accion, entidad, identificador, ocurridoEn } as HechoAcceso);
      return { rows: [], rowCount: 1 };
    },
  };
}

function txInvitaciones(e: Estado, unirFalla: boolean): TransaccionInvitaciones {
  return {
    consulta: consultaQueAudita(e),
    async revocarPendientes(companyId, correo, ahora) {
      const ids: string[] = [];
      for (const i of e.invitaciones.values()) {
        if (i.companyId === companyId && i.correo === correo && !i.aceptadaEn && !i.revocadaEn) {
          i.revocadaEn = ahora;
          ids.push(i.id);
        }
      }
      return ids;
    },
    async insertar(i) {
      e.invitaciones.set(i.id, { ...i, roles: [...i.roles], aceptadaEn: null, aceptadaPor: null, revocadaEn: null });
    },
    async consumir(hash, ahora, userId) {
      const i = [...e.invitaciones.values()].find((x) => x.tokenHash === hash);
      if (!i || i.aceptadaEn || i.revocadaEn || i.venceEn.getTime() <= ahora.getTime()) return null;
      i.aceptadaEn = ahora;
      i.aceptadaPor = userId;
      return { id: i.id, companyId: i.companyId, correo: i.correo, roles: [...i.roles] };
    },
    async revocar(id, companyId, ahora) {
      const i = e.invitaciones.get(id);
      if (!i || i.companyId !== companyId || i.aceptadaEn || i.revocadaEn) return false;
      i.revocadaEn = ahora;
      return true;
    },
    async crearUsuario(u) {
      if ([...e.usuarios.values()].some((x) => x.correo === u.correo)) throw new ErrorDeDominio("correo_duplicado");
      e.usuarios.set(u.id, { ...u });
    },
    async marcarCorreoVerificado(userId, ahora) {
      const u = e.usuarios.get(userId);
      if (u && !u.verificadoEn) u.verificadoEn = ahora;
    },
    async unirAEmpresa({ userId, companyId, roles }) {
      if (unirFalla) throw new ErrorDeDominio("segunda_razon_social");
      e.membresias.push({ userId, companyId, roles: [...roles] });
    },
  };
}

function txRecuperacion(e: Estado): TransaccionRecuperacion {
  return {
    consulta: consultaQueAudita(e),
    async recientes(userId, desde) {
      return [...e.recuperaciones.values()].filter((r) => r.userId === userId && r.creadoEn >= desde).length;
    },
    async anularPendientes(userId, ahora) {
      for (const r of e.recuperaciones.values()) {
        if (r.userId === userId && !r.usadoEn && !r.anuladoEn) r.anuladoEn = ahora;
      }
    },
    async insertar(r) {
      e.recuperaciones.set(r.id, { ...r, usadoEn: null, anuladoEn: null });
    },
    async anular(id, ahora) {
      const r = e.recuperaciones.get(id);
      if (r && !r.usadoEn && !r.anuladoEn) r.anuladoEn = ahora;
    },
    async consumir(hash, ahora) {
      const r = [...e.recuperaciones.values()].find((x) => x.tokenHash === hash);
      if (!r || r.usadoEn || r.anuladoEn || r.venceEn.getTime() <= ahora.getTime()) return null;
      r.usadoEn = ahora;
      return r.userId;
    },
    async cambiarContrasena(userId, passwordHash) {
      e.usuarios.get(userId)!.passwordHash = passwordHash;
    },
    async marcarCorreoVerificado(userId, ahora) {
      const u = e.usuarios.get(userId);
      if (u && !u.verificadoEn) u.verificadoEn = ahora;
    },
    async cerrarSesiones(userId) {
      for (const [token, dueno] of [...e.sesiones.entries()]) if (dueno === userId) e.sesiones.delete(token);
    },
  };
}

export function buzon() {
  const enviados: MensajeCorreo[] = [];
  return {
    enviados,
    enviador: async (mensaje: MensajeCorreo) => {
      enviados.push(mensaje);
      return { id: `correo-${enviados.length}` };
    },
  };
}

export function tokenDe(mensaje: MensajeCorreo | undefined, ruta: "invitacion" | "recuperar"): string {
  const encontrado = new RegExp(`/${ruta}/([A-Za-z0-9_-]{43})`).exec(mensaje?.texto ?? "");
  if (!encontrado) throw new Error("el correo no trae el enlace");
  return encontrado[1];
}
