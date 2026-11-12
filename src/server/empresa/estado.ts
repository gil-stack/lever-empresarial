import type { Capacidad } from "../../nucleo/capacidades";

/**
 * El guardia del estado de la empresa en la consola. Una empresa suspendida (75ª fr. I de las
 * disposiciones del art. 124 LACP: se suspende todo acto, operación o servicio) conserva sus
 * sesiones y sus roles, pero solo las capacidades de consulta. Así se rechazan las mutaciones
 * antes de proyecciones sensibles y efectos externos; la base refuerza el bloqueo de escrituras
 * con el trigger `bloqueo_empresa_suspendida` (0028).
 */
export function empresaSuspendida(empresa: { estado: string } | null | undefined): boolean {
  return empresa?.estado === "suspendida";
}

/** Los roles de la membresía cuentan si la empresa está activa o suspendida; en cualquier otro estado, no. */
export function membresiaConRoles(estado: string | null | undefined): boolean {
  return estado === "activa" || estado === "suspendida";
}

/** Con la empresa suspendida, solo las capacidades de consulta (`*.ver`). */
export function capacidadesSegunEstado<C extends Capacidad>(estado: string | null | undefined, capacidades: readonly C[]): C[] {
  return estado === "suspendida" ? capacidades.filter((capacidad) => capacidad.endsWith(".ver")) : [...capacidades];
}
