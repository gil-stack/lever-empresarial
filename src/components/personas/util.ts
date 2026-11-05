import { formatoPesos } from "@/dominio/centavos";
import type { FrecuenciaNomina } from "@/dominio/nomina";
import { estaDeBaja } from "@/dominio/personas";
import type { PersonaVista } from "@/dominio/personas-vista";

export function dinero(centavos: number | null, ausencia = "Sin asignar"): string {
  return centavos === null ? ausencia : formatoPesos(centavos);
}

export function frecuenciaVisible(frecuencia: FrecuenciaNomina): string {
  return frecuencia === "semanal" ? "Semanal" : frecuencia === "quincenal" ? "Quincenal · 15 y último" : "Mensual";
}

const MOMENTO = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function momentoLegible(iso: string): string {
  const instante = new Date(iso);
  return Number.isNaN(instante.getTime()) ? iso : MOMENTO.format(instante);
}

export function estadoDePersona(persona: Pick<PersonaVista, "bajaEn" | "nomina">, hoy: string): {
  texto: string;
  tono: "neutro" | "sello" | "aviso";
} {
  if (estaDeBaja(persona.bajaEn, hoy)) return { texto: "De baja", tono: "neutro" };
  if (persona.bajaEn) return { texto: "Baja programada", tono: "aviso" };
  if (!persona.nomina) return { texto: "Por configurar", tono: "aviso" };
  return { texto: "Vigente", tono: "sello" };
}

export function accesoVisible(persona: Pick<PersonaVista, "membresia" | "tarjetaPendiente">): string {
  const acceso = persona.membresia === "activa"
    ? "Acceso activo"
    : persona.membresia === "invitada"
      ? "Invitación pendiente"
      : persona.membresia === "suspendida"
        ? "Acceso suspendido"
        : "Sin acceso";
  return persona.tarjetaPendiente ? `${acceso} + tarjeta` : acceso;
}
