import type { CodigoFinanzas, EstadoFinanzas } from "../../dominio/personas.ts";
import type { ContextoDeTenant } from "../../nucleo/contexto.ts";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio.ts";
import { asignarRol, quitarRol, type DependenciasRoles } from "./servicio.ts";

const CODIGOS: Readonly<Record<string, CodigoFinanzas>> = {
  sesion_ausente: "sesion",
  usuario_ausente: "sesion",
  sin_permiso: "sin_permiso",
  identificador_invalido: "identificador_invalido",
  sin_membresia: "sin_membresia",
  rol_existente: "rol_existente",
  ultimo_rol: "ultimo_rol",
};

/**
 * Da o retira Finanzas a una persona de la empresa del contexto. El permiso
 * y la empresa los exige asignarRol/quitarRol; aquí solo se traduce el
 * resultado a lo que la casilla muestra. Un error que no es de dominio sube.
 */
export async function cambiarAccesoFinanzas(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { userId: unknown; verFinanzas: unknown },
  deps?: DependenciasRoles,
): Promise<EstadoFinanzas> {
  const { verFinanzas } = entrada;
  if (verFinanzas !== "si" && verFinanzas !== "no") {
    return { tipo: "rechazado", codigo: "identificador_invalido", habilitado: false };
  }
  const otorgar = verFinanzas === "si";
  try {
    const cambio = { userId: entrada.userId, rol: "finanzas" as const };
    if (otorgar) await asignarRol(ctx, cambio, deps);
    else await quitarRol(ctx, cambio, deps);
  } catch (error) {
    if (!(error instanceof ErrorDeDominio)) throw error;
    return rechazoDeFinanzas(CODIGOS[error.codigo] ?? "libro", otorgar);
  }
  return {
    tipo: "listo",
    mensaje: otorgar ? "La persona ya puede ver Inicio financiero." : "Se retiró el acceso a Inicio financiero.",
    habilitado: otorgar,
  };
}

/** Si el cambio no entró, la casilla vuelve a su valor anterior; si ya existía el rol, queda marcada. */
export function rechazoDeFinanzas(codigo: CodigoFinanzas, otorgar: boolean): EstadoFinanzas {
  return { tipo: "rechazado", codigo, habilitado: codigo === "rol_existente" ? true : !otorgar };
}
