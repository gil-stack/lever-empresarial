export function rechazoDeAlta(estado: {
  tieneEmpresa: boolean;
  rfcOcupado: boolean;
}): "segunda_razon_social" | "rfc_duplicado" | null {
  if (estado.tieneEmpresa) return "segunda_razon_social";
  if (estado.rfcOcupado) return "rfc_duplicado";
  return null;
}
