import type { ReactNode } from "react";

import { enEmpresa } from "@/nucleo/rutas";

import {
  IconoAlta,
  IconoConsola,
  IconoLista,
  IconoPersonas,
  IconoPolitica,
  IconoPoliza,
  IconoPrecios,
  IconoProveedores,
} from "./iconos";
import type { puertasDe } from "./puertas";

export type Seccion = { ruta: string; href: string; etiqueta: string; Icono: () => ReactNode };
export type GrupoDeSecciones = { titulo: string; secciones: Seccion[] };

/**
 * La navegación lateral entera. Una sección nueva entra aquí, con su ícono en
 * iconos.tsx; las puertas llegan de `puertasDe` y no se deciden aquí. Cada
 * enlace lleva la empresa en la ruta: elegirla no autoriza nada.
 */
export function seccionesDe(
  puertas: ReturnType<typeof puertasDe>,
  empresaId: string | null,
  variasEmpresas: boolean,
): GrupoDeSecciones[] {
  const seccion = (ruta: string, etiqueta: string, Icono: () => ReactNode): Seccion => ({
    ruta,
    href: enEmpresa(empresaId, ruta),
    etiqueta,
    Icono,
  });
  const operacion = [
    ...(puertas.consola ? [seccion("/consola", "Consola", IconoConsola)] : []),
    ...(puertas.politica ? [seccion("/consola/politica", "Política", IconoPolitica)] : []),
    ...(puertas.proveedores ? [seccion("/consola/proveedores", "Proveedores", IconoProveedores)] : []),
    ...(puertas.lista69b ? [seccion("/consola/lista-69b", "Lista 69-B", IconoLista)] : []),
    ...(puertas.maestro ? [seccion("/consola/personas", "Personas", IconoPersonas)] : []),
    ...(puertas.poliza ? [seccion("/consola/poliza", "Póliza", IconoPoliza)] : []),
  ];
  const cuenta = [
    ...(puertas.precios ? [seccion("/precios", "Precios", IconoPrecios)] : []),
    ...(variasEmpresas ? [seccion("/empresas", "Cambiar de empresa", IconoAlta)] : []),
  ];
  return [
    ...(operacion.length > 0 ? [{ titulo: "Operación", secciones: operacion }] : []),
    ...(cuenta.length > 0 ? [{ titulo: "Cuenta", secciones: cuenta }] : []),
  ];
}
