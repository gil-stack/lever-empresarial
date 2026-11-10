import { DATOS_DEMO, type DatosDemo } from "../../dominio/demo";
import { PRODUCTOS, type ModuloDemo, type ProductoDemo } from "../../dominio/demo/productos";

/**
 * Lo que una página demo puede pintar en esta petición: los datos de ejemplo
 * de Altamar Logística, o solo la línea de producto de «Disponible pronto».
 */
export type CargaDemo<M extends ModuloDemo> =
  | { readonly tipo: "demostracion"; readonly modulo: M; readonly datos: DatosDemo[M] }
  | { readonly tipo: "pronto"; readonly modulo: M; readonly producto: ProductoDemo };

/**
 * La única regla del modo demostración. Los datos de ejemplo salen solo si la
 * empresa de la petición está marcada `demostracion` (la base impide pasar esa
 * marca de true a false). Cualquier otra cosa —empresa real, sin empresa, base
 * caída— recibe la línea de producto y ni una cifra.
 */
export function cargaDemo<M extends ModuloDemo>(
  empresa: { readonly demostracion: boolean } | null | undefined,
  modulo: M,
): CargaDemo<M> {
  if (empresa?.demostracion === true) return { tipo: "demostracion", modulo, datos: DATOS_DEMO[modulo] };
  return { tipo: "pronto", modulo, producto: PRODUCTOS[modulo] };
}
