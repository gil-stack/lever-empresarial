import { capacidadesDe, tiene, type CapacidadPlataforma } from "../../nucleo/capacidades";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

/** Capacidades del personal según sus roles de plataforma. La base repite cada regla con su trigger. */
export function capacidadesDelPersonal(ctx: ContextoDePersonal): CapacidadPlataforma[] {
  return capacidadesDe({ rolesCliente: [], rolesPlataforma: ctx.personal.roles }).filter(
    (capacidad): capacidad is CapacidadPlataforma => capacidad.startsWith("plataforma."),
  );
}

export function puedeEnOperacion(ctx: ContextoDePersonal, capacidad: CapacidadPlataforma): boolean {
  return tiene(capacidadesDelPersonal(ctx), capacidad);
}

export function exigirEnOperacion(ctx: ContextoDePersonal, capacidad: CapacidadPlataforma): void {
  if (!puedeEnOperacion(ctx, capacidad)) throw new ErrorDeDominio("sin_permiso_operacion");
}
