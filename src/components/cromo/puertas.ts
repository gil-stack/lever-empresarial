import { puedeVerMaestro, type RolCuenta } from "@/dominio/personas";

/** El menú de finanzas no cambia de página en página. */
export function puertasDe(rol: RolCuenta | null | undefined, conEmpresa: boolean): {
  maestro: boolean;
  poliza: boolean;
} {
  return {
    maestro: Boolean(conEmpresa && puedeVerMaestro(rol)),
    poliza: Boolean(conEmpresa && rol === "contador"),
  };
}
