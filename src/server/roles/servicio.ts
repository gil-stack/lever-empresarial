import { randomUUID } from "node:crypto";

import { ErrorDeDominio } from "../session/error-de-dominio.ts";
import type { Sesion } from "../session/tipos.ts";
import {
  esRolAsignable,
  leerEntradaDeLote,
  loteNoGuardable,
  puede,
  rechazoDeFirmas,
  uuidValido,
  type RolAsignable,
} from "./decidir.ts";
import type { LoteDePrueba, Membresia, RepositorioRoles } from "./tipos.ts";

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
 * Deja firmado un lote de nómina de prueba. Quien llama tiene que ser
 * quien libera, y esa persona no puede ser también quien solicita.
 * No hay monto: la fila no puede salir a un SPEI.
 */
export async function firmarLoteDePrueba(
  sesion: Sesion | null | undefined,
  entrada: unknown,
  deps?: DependenciasRoles,
): Promise<LoteDePrueba> {
  const leida = leerEntradaDeLote(entrada);
  if (!leida.ok) throw new ErrorDeDominio(leida.codigo);
  const actor = await exigirMembresia(sesion, deps);
  const repo = await repositorioDe(deps);
  const [solicitante, liberador, miembros] = await Promise.all([
    repo.membresiaDe(leida.solicitanteId),
    repo.membresiaDe(leida.liberadorId),
    repo.membresiasDeLaEmpresa(actor.companyId),
  ]);
  const codigo = rechazoDeFirmas({
    actor,
    solicitanteId: leida.solicitanteId,
    liberadorId: leida.liberadorId,
    solicitante: deLaEmpresa(solicitante, actor.companyId),
    liberador: deLaEmpresa(liberador, actor.companyId),
    miembros,
  });
  if (codigo) throw new ErrorDeDominio(codigo);

  const lote: LoteDePrueba = {
    id: (deps?.id ?? randomUUID)(),
    companyId: actor.companyId,
    solicitanteId: leida.solicitanteId,
    liberadorId: leida.liberadorId,
    firmadoEn: (deps?.ahora ?? (() => new Date()))(),
    esPrueba: true,
  };
  const estructural = loteNoGuardable(lote);
  if (estructural) throw new ErrorDeDominio(estructural);
  await repo.insertarLote(lote);
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
