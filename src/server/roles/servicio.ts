import { randomUUID } from "node:crypto";

import { exigir, exigirEmpresa, puede, type ContextoConEmpresa, type ContextoDeTenant } from "../../nucleo/contexto.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { actorDeCliente } from "../bitacora/auditar.ts";
import {
  canonUsuario,
  esRolAsignable,
  leerEntradaDeLiberacion,
  leerEntradaDeSolicitud,
  loteNoGuardable,
  mismoUsuario,
  rechazoDeLiberacion,
  rechazoDeSolicitud,
  uuidValido,
  type RolAsignable,
} from "./decidir.ts";
import type { LoteDePrueba, Membresia, RepositorioRoles, SolicitudDeLote } from "./tipos.ts";

export type DependenciasRoles = {
  repositorio?: RepositorioRoles;
  ahora?: () => Date;
  id?: () => string;
};

type EntradaDeRol = {
  userId?: unknown;
  rol?: unknown;
  companyId?: unknown;
};

/**
 * Da un rol más a una persona con membresía activa en la empresa del
 * contexto. El companyId que viaje en la entrada no elige la empresa.
 * Las personas nuevas entran por invitación, no por aquí.
 */
export async function asignarRol(
  ctx: ContextoDeTenant | null | undefined,
  entrada: EntradaDeRol,
  deps?: DependenciasRoles,
): Promise<Membresia> {
  const conEmpresa = exigirAdministracion(ctx);
  const userId = exigirUsuario(entrada.userId);
  const rol = exigirRol(entrada.rol);
  const repo = await repositorioDe(deps);
  const previa = await repo.membresiaDe(conEmpresa, userId);
  if (!previa) throw new ErrorDeDominio("sin_membresia");
  if (previa.roles.includes(rol)) return previa;
  await repo.agregarRol(conEmpresa, { userId, rol, actor: actorDeCliente(conEmpresa) });
  return { ...previa, roles: [...previa.roles, rol] };
}

/** Quita un rol. La empresa no se queda sin administrador y nadie queda sin roles. */
export async function quitarRol(
  ctx: ContextoDeTenant | null | undefined,
  entrada: EntradaDeRol,
  deps?: DependenciasRoles,
): Promise<Membresia> {
  const conEmpresa = exigirAdministracion(ctx);
  const userId = exigirUsuario(entrada.userId);
  const rol = exigirRol(entrada.rol);
  const repo = await repositorioDe(deps);
  const previa = await repo.membresiaDe(conEmpresa, userId);
  if (!previa) throw new ErrorDeDominio("sin_membresia");
  if (!previa.roles.includes(rol)) return previa;
  if (previa.roles.length === 1) throw new ErrorDeDominio("ultimo_rol");
  if (rol === "administrador") {
    const miembros = await repo.membresiasDeLaEmpresa(conEmpresa);
    const administradores = miembros.filter((miembro) => miembro.roles.includes("administrador") && !miembro.deBaja);
    if (administradores.length < 2) throw new ErrorDeDominio("ultimo_administrador");
  }
  await repo.quitarRol(conEmpresa, { userId, rol, actor: actorDeCliente(conEmpresa) });
  return { ...previa, roles: previa.roles.filter((actual) => actual !== rol) };
}

/** La entrada del contador exporta la póliza. No devuelve una acción de soltar dinero. */
export async function entrarAPoliza(
  ctx: ContextoDeTenant | null | undefined,
): Promise<{ accion: "exportar_poliza"; companyId: string }> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.poliza.ver")) throw new ErrorDeDominio("sin_entrada_a_poliza");
  return { accion: "exportar_poliza", companyId: conEmpresa.empresa.id };
}

/**
 * Primer acto del lote de prueba. La sesión es quien solicita.
 * No escribe al liberador: esa firma es otra persona, en otra llamada.
 */
export async function solicitarLoteDePrueba(
  ctx: ContextoDeTenant | null | undefined,
  entrada: unknown,
  deps?: DependenciasRoles,
): Promise<SolicitudDeLote> {
  const leida = leerEntradaDeSolicitud(entrada ?? {});
  if (!leida.ok) throw new ErrorDeDominio(leida.codigo);
  const conEmpresa = exigirEmpresa(ctx);
  const repo = await repositorioDe(deps);
  const actor = await exigirMembresia(conEmpresa, repo);
  if (leida.solicitanteId && !mismoUsuario(leida.solicitanteId, actor.userId)) {
    throw new ErrorDeDominio("firma_ajena");
  }
  const miembros = await repo.membresiasDeLaEmpresa(conEmpresa);
  const codigo = rechazoDeSolicitud({ actor, miembros });
  if (codigo) throw new ErrorDeDominio(codigo);

  const solicitud: SolicitudDeLote = {
    id: (deps?.id ?? randomUUID)(),
    companyId: conEmpresa.empresa.id,
    solicitanteId: canonUsuario(actor.userId),
    solicitadoEn: (deps?.ahora ?? (() => new Date()))(),
    liberadorId: null,
    liberadoEn: null,
    esPrueba: true,
  };
  const estructural = loteNoGuardable(solicitud);
  if (estructural) throw new ErrorDeDominio(estructural);
  await repo.insertarSolicitud(conEmpresa, solicitud);
  return solicitud;
}

/**
 * Segundo acto. La sesión es quien libera, y no puede ser quien pidió el lote.
 * Solo libera quien tiene el rol de liberador. No hay monto.
 */
export async function liberarLoteDePrueba(
  ctx: ContextoDeTenant | null | undefined,
  entrada: unknown,
  deps?: DependenciasRoles,
): Promise<LoteDePrueba> {
  const leida = leerEntradaDeLiberacion(entrada);
  if (!leida.ok) throw new ErrorDeDominio(leida.codigo);
  const conEmpresa = exigirEmpresa(ctx);
  const repo = await repositorioDe(deps);
  const actor = await exigirMembresia(conEmpresa, repo);
  const fila = await repo.leerLote(conEmpresa, leida.loteId);
  if (!fila) throw new ErrorDeDominio("lote_ausente");
  if (fila.companyId !== actor.companyId) throw new ErrorDeDominio("firmante_ajeno");
  if (fila.liberadorId) throw new ErrorDeDominio("lote_ya_firmado");
  const [solicitante, miembros] = await Promise.all([
    repo.membresiaDe(conEmpresa, fila.solicitanteId),
    repo.membresiasDeLaEmpresa(conEmpresa),
  ]);
  const codigo = rechazoDeLiberacion({
    actor,
    solicitanteId: fila.solicitanteId,
    solicitante,
    miembros,
  });
  if (codigo) throw new ErrorDeDominio(codigo);

  const lote: LoteDePrueba = {
    id: fila.id,
    companyId: fila.companyId,
    solicitanteId: fila.solicitanteId,
    solicitadoEn: fila.solicitadoEn,
    liberadorId: canonUsuario(actor.userId),
    liberadoEn: (deps?.ahora ?? (() => new Date()))(),
    esPrueba: true,
  };
  const estructural = loteNoGuardable(lote);
  if (estructural) throw new ErrorDeDominio(estructural);
  await repo.cerrarLiberacion(conEmpresa, lote);
  return lote;
}

function exigirAdministracion(ctx: ContextoDeTenant | null | undefined): ContextoConEmpresa {
  return exigir(ctx, "cliente.membresias.administrar");
}

async function exigirMembresia(ctx: ContextoConEmpresa, repo: RepositorioRoles): Promise<Membresia> {
  const membresia = await repo.membresiaDe(ctx, ctx.persona.id);
  if (!membresia) throw new ErrorDeDominio("sin_membresia");
  return membresia;
}

function exigirUsuario(valor: unknown): string {
  if (typeof valor !== "string" || !uuidValido(valor)) throw new ErrorDeDominio("identificador_invalido");
  return valor;
}

function exigirRol(valor: unknown): RolAsignable {
  if (typeof valor !== "string" || !esRolAsignable(valor)) throw new ErrorDeDominio("rol_no_asignable");
  return valor;
}

async function repositorioDe(deps?: DependenciasRoles): Promise<RepositorioRoles> {
  if (deps?.repositorio) return deps.repositorio;
  const modulo = await import("./repositorio.ts");
  return modulo.repositorioPg();
}
