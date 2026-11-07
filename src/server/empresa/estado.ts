/**
 * El guardia del estado de la empresa en la consola. Una empresa suspendida (75ª fr. I de las
 * disposiciones del art. 124 LACP: se suspende todo acto, operación o servicio) conserva sus
 * sesiones y sus roles para consultar. Cualquier escritura la rechaza la base con el trigger
 * `bloqueo_empresa_suspendida` (0028) y la pantalla muestra el mensaje propio de la suspensión.
 */
export function empresaSuspendida(empresa: { estado: string } | null | undefined): boolean {
  return empresa?.estado === "suspendida";
}

/** Los roles de la membresía cuentan si la empresa está activa o suspendida; en cualquier otro estado, no. */
export function membresiaConRoles(estado: string | null | undefined): boolean {
  return estado === "activa" || estado === "suspendida";
}
