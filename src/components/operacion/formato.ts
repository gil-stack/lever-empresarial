export function fechaHora(valor: Date): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(valor);
}

export function fechaDia(valor: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${valor}T00:00:00Z`));
}

export function etiquetaEstado(estado: string): string {
  const etiquetas: Record<string, string> = {
    prospecto: "Prospecto",
    en_alta: "En alta",
    activa: "Activa para portal",
    suspendida: "Suspendida",
    baja: "Baja",
    pendiente: "Pendiente",
    vigente: "Vigente",
    rechazada: "Rechazada",
    cerrada: "Cerrada",
    abierta: "Abierta",
    aprobada: "Aprobada",
  };
  return etiquetas[estado] ?? estado;
}
