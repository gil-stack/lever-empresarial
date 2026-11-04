import { puedeVerLista69b } from "@/dominio/lista-69b";
import { puedeVerMaestro, type RolCuenta } from "@/dominio/personas";
import { puedeVerProveedores } from "@/dominio/proveedores";

/** El menú de finanzas no cambia de página en página. El teléfono no usa estas puertas. */
export function puertasDe(rol: RolCuenta | null | undefined, conEmpresa: boolean): {
  maestro: boolean;
  poliza: boolean;
  proveedores: boolean;
  lista69b: boolean;
} {
  return {
    maestro: Boolean(conEmpresa && puedeVerMaestro(rol)),
    poliza: Boolean(conEmpresa && rol === "contador"),
    proveedores: Boolean(conEmpresa && puedeVerProveedores(rol)),
    lista69b: Boolean(conEmpresa && puedeVerLista69b(rol)),
  };
}
