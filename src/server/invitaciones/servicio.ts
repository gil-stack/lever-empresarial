import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { hashDeToken, hashearContrasena, verificarContrasena } from "../session/hash";
import { contrasenaCoincide } from "../session/servicio";
import { repositorioPg as repositorioSesionPg } from "../session/repositorio";
import { tokenValido } from "../session/cookie";
import { enlaceDeInvitacion, enviarInvitacion as enviarPorDefecto, urlPublica } from "./correo";
import { repositorioPg, type RepositorioInvitaciones } from "./repositorio";
import type {
  EnviarInvitacion,
  InvitacionEmitida,
  InvitacionLeida,
  ResultadoDeEntrega,
  VistaDeInvitacion,
} from "./tipos";

export type DependenciasInvitacion = {
  repositorio?: RepositorioInvitaciones;
  enviar?: EnviarInvitacion;
  urlBase?: string;
  ahora?: () => Date;
  hashear?: (contrasena: string) => Promise<string>;
  verificar?: (contrasena: string, hash: string) => Promise<boolean>;
  buscarHash?: (correo: string) => Promise<string | null>;
};

/** Lo que muestra la página del enlace. No consume la invitación. */
export async function leerInvitacion(token: string, deps?: DependenciasInvitacion): Promise<VistaDeInvitacion> {
  if (typeof token !== "string" || !tokenValido(token)) return { estado: "inexistente" };
  const invitacion = await (deps?.repositorio ?? repositorioPg()).porToken(hashDeToken(token));
  const estado = estadoDe(invitacion, (deps?.ahora ?? reloj)());
  if (!invitacion || estado !== "vigente") return { estado: estado === "vigente" ? "inexistente" : estado };
  return {
    estado: "vigente",
    nombre: invitacion.nombre,
    correo: invitacion.correo,
    razonSocial: invitacion.razonSocial,
    yaTieneContrasena: invitacion.tieneContrasena,
    expiraEn: invitacion.expiraEn,
  };
}

/**
 * Acepta una vez. Quien no tenía contraseña fija la suya; quien ya la tenía
 * (por ejemplo, una contadora que entra a una segunda empresa) confirma con
 * la suya. No abre sesión: el siguiente paso es registrar o verificar el segundo factor.
 */
export type Aceptacion = { userId: string; correo: string; cuentaNueva: boolean };

export async function aceptarInvitacion(
  entrada: { token?: unknown; contrasena?: unknown; confirmacion?: unknown },
  deps?: DependenciasInvitacion,
): Promise<Aceptacion> {
  const token = typeof entrada.token === "string" ? entrada.token : "";
  if (!tokenValido(token)) throw new ErrorDeDominio("invitacion_inexistente");
  const repositorio = deps?.repositorio ?? repositorioPg();
  const invitacion = await repositorio.porToken(hashDeToken(token));
  const estado = estadoDe(invitacion, (deps?.ahora ?? reloj)());
  if (!invitacion || estado !== "vigente") throw new ErrorDeDominio(`invitacion_${estado}`);

  const contrasena = typeof entrada.contrasena === "string" ? entrada.contrasena : "";
  const hashear = deps?.hashear ?? hashearContrasena;
  const verificar = deps?.verificar ?? verificarContrasena;
  let passwordHash: string | null = null;
  if (invitacion.tieneContrasena) {
    const buscar = deps?.buscarHash ?? hashActual;
    const actual = await buscar(invitacion.correo);
    if (!(await contrasenaCoincide(contrasena, actual, hashear, verificar))) {
      throw new ErrorDeDominio("credenciales_invalidas");
    }
  } else {
    if (!contrasenaNuevaValida(contrasena)) throw new ErrorDeDominio("contrasena_invalida");
    if (entrada.confirmacion !== contrasena) throw new ErrorDeDominio("contrasenas_distintas");
    passwordHash = await hashear(contrasena);
  }

  await repositorio.consumir(invitacion, passwordHash);
  return { userId: invitacion.userId, correo: invitacion.correo, cuentaNueva: passwordHash !== null };
}

/** Después de confirmar la emisión. Si el correo no sale, la invitación sigue emitida. */
export async function entregarInvitacion(
  emitida: InvitacionEmitida,
  razonSocial: string | null,
  deps?: DependenciasInvitacion,
): Promise<ResultadoDeEntrega> {
  try {
    const enlace = enlaceDeInvitacion(deps?.urlBase ?? urlPublica(), emitida.token);
    await (deps?.enviar ?? enviarPorDefecto)({
      invitacionId: emitida.invitacionId,
      para: emitida.correo,
      nombre: emitida.nombre,
      razonSocial,
      roles: emitida.roles,
      enlace,
      expiraEn: emitida.expiraEn,
    });
    return { entregada: true };
  } catch (error) {
    if (error instanceof ErrorDeDominio) return { entregada: false, codigo: error.codigo };
    return { entregada: false, codigo: "correo_no_disponible" };
  }
}

/** Al menos 10 caracteres y no más de 72 bytes, el tope de bcrypt. */
export function contrasenaNuevaValida(contrasena: string): boolean {
  if (contrasena.length < 10 || contrasena.trim().length === 0) return false;
  return new TextEncoder().encode(contrasena).length <= 72;
}

function estadoDe(invitacion: InvitacionLeida | null, ahora: Date): VistaDeInvitacion["estado"] {
  if (!invitacion) return "inexistente";
  if (invitacion.usadaEn) return "usada";
  if (invitacion.revocadaEn) return "revocada";
  if (invitacion.expiraEn.getTime() <= ahora.getTime()) return "vencida";
  return "vigente";
}

async function hashActual(correo: string): Promise<string | null> {
  const usuario = await repositorioSesionPg().buscarPorCorreo(correo);
  return usuario?.passwordHash ?? null;
}

function reloj(): Date {
  return new Date();
}
