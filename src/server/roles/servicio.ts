import { randomUUID } from "node:crypto";

import { ErrorDeDominio } from "../session/error-de-dominio.ts";
import type { Sesion } from "../session/tipos.ts";
import {
  canonUsuario,
  esRolAsignable,
  leerEntradaDeLiberacion,
  leerEntradaDeSolicitud,
  loteNoGuardable,
  mismoUsuario,
  puede,
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
 * El rol sale de la membresía guardada, no del objeto de sesión que armó
 * el llamador. El companyId que viaje en la entrada no elige la empresa.
 */
export async function asignarMembresia(
  sesion: Sesion | null | undefined,
  entrada: EntradaDeRol,
  deps?: DependenciasRoles,
): Promise<Membresia> {
  const actor = await exigirMembresia(sesion, deps);
  if (!puede(actor.rol, "administrar_membresias")) throw new ErrorDeDominio("sin_permiso");
  // La empresa la da la membresía de quien administra, no este campo.
  void entrada.companyId;
  const userId = exigirUsuario(entrada.userId);
  const rol = exigirRol(entrada.rol);
  const repo = await repositorioDe(deps);
  if (!(await repo.usuarioExiste(userId))) throw new ErrorDeDominio("usuario_ausente");
  const previa = await repo.membresiaDe(userId);
  if (previa) {
    throw new ErrorDeDominio(previa.companyId === actor.companyId ? "membresia_existente" : "segunda_razon_social");
  }
  const membresia: Membresia = { userId, companyId: actor.companyId, rol };
  await repo.insertarMembresia(membresia);
  return membresia;
}

export async function cambiarRol(
  sesion: Sesion | null | undefined,
  entrada: EntradaDeRol,
  deps?: DependenciasRoles,
): Promise<Membresia> {
  const actor = await exigirMembresia(sesion, deps);
  if (!puede(actor.rol, "administrar_membresias")) throw new ErrorDeDominio("sin_permiso");
  void entrada.companyId;
  const userId = exigirUsuario(entrada.userId);
  const rol = exigirRol(entrada.rol);
  const repo = await repositorioDe(deps);
  const previa = await repo.membresiaDe(userId);
  if (!previa || previa.companyId !== actor.companyId) throw new ErrorDeDominio("sin_membresia");
  if (previa.rol === rol) return previa;
  if (previa.rol === "administrador" && rol !== "administrador") {
    const miembros = await repo.membresiasDeLaEmpresa(actor.companyId);
    const administradores = miembros.filter((miembro) => miembro.rol === "administrador");
    if (administradores.length < 2) throw new ErrorDeDominio("ultimo_administrador");
  }
  const membresia: Membresia = { userId, companyId: actor.companyId, rol };
  await repo.actualizarRol(membresia);
  return membresia;
}

/** La entrada del contador exporta la póliza. No devuelve una acción de soltar dinero. */
export async function entrarAPoliza(
  sesion: Sesion | null | undefined,
  deps?: DependenciasRoles,
): Promise<{ accion: "exportar_poliza"; companyId: string }> {
  const actor = await exigirMembresia(sesion, deps);
  if (!puede(actor.rol, "exportar_poliza")) throw new ErrorDeDominio("sin_entrada_a_poliza");
  return { accion: "exportar_poliza", companyId: actor.companyId };
}

/**
 * Primer acto del lote de prueba. La sesión es quien solicita.
 * No escribe al liberador: esa firma es otra persona, en otra llamada.
 */
export async function solicitarLoteDePrueba(
  sesion: Sesion | null | undefined,
  entrada: unknown,
  deps?: DependenciasRoles,
): Promise<SolicitudDeLote> {
  const leida = leerEntradaDeSolicitud(entrada ?? {});
  if (!leida.ok) throw new ErrorDeDominio(leida.codigo);
  const actor = await exigirMembresia(sesion, deps);
  if (leida.solicitanteId && !mismoUsuario(leida.solicitanteId, actor.userId)) {
    throw new ErrorDeDominio("firma_ajena");
  }
  const repo = await repositorioDe(deps);
  const miembros = await repo.membresiasDeLaEmpresa(actor.companyId);
  const codigo = rechazoDeSolicitud({ actor, miembros });
  if (codigo) throw new ErrorDeDominio(codigo);

  const solicitud: SolicitudDeLote = {
    id: (deps?.id ?? randomUUID)(),
    companyId: actor.companyId,
    solicitanteId: canonUsuario(actor.userId),
    solicitadoEn: (deps?.ahora ?? (() => new Date()))(),
    liberadorId: null,
    liberadoEn: null,
    esPrueba: true,
  };
  const estructural = loteNoGuardable(solicitud);
  if (estructural) throw new ErrorDeDominio(estructural);
  await repo.insertarSolicitud(solicitud);
  return solicitud;
}

/**
 * Segundo acto. La sesión es quien libera, y no puede ser quien pidió el lote.
 * El administrador no libera. No hay monto.
 */
export async function liberarLoteDePrueba(
  sesion: Sesion | null | undefined,
  entrada: unknown,
  deps?: DependenciasRoles,
): Promise<LoteDePrueba> {
  const leida = leerEntradaDeLiberacion(entrada);
  if (!leida.ok) throw new ErrorDeDominio(leida.codigo);
  const actor = await exigirMembresia(sesion, deps);
  const repo = await repositorioDe(deps);
  const fila = await repo.leerLote(leida.loteId);
  if (!fila) throw new ErrorDeDominio("lote_ausente");
  if (fila.companyId !== actor.companyId) throw new ErrorDeDominio("firmante_ajeno");
  if (fila.liberadorId) throw new ErrorDeDominio("lote_ya_firmado");
  const [solicitante, miembros] = await Promise.all([
    repo.membresiaDe(fila.solicitanteId),
    repo.membresiasDeLaEmpresa(actor.companyId),
  ]);
  const codigo = rechazoDeLiberacion({
    actor,
    solicitanteId: fila.solicitanteId,
    solicitante: deLaEmpresa(solicitante, actor.companyId),
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
  await repo.cerrarLiberacion(lote);
  return lote;
}

async function exigirMembresia(sesion: Sesion | null | undefined, deps?: DependenciasRoles): Promise<Membresia> {
  const userId = sesion?.usuario?.id;
  if (typeof userId !== "string" || !uuidValido(userId)) throw new ErrorDeDominio("sesion_ausente");
  const membresia = await (await repositorioDe(deps)).membresiaDe(userId);
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

function deLaEmpresa(membresia: Membresia | null, companyId: string): Membresia | null {
  if (!membresia || membresia.companyId !== companyId) return null;
  return membresia;
}

async function repositorioDe(deps?: DependenciasRoles): Promise<RepositorioRoles> {
  if (deps?.repositorio) return deps.repositorio;
  const modulo = await import("./repositorio.ts");
  return modulo.repositorioPg();
}
