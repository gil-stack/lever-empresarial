import type { ReactNode } from "react";

import { enEmpresa } from "@/nucleo/rutas";

import {
  IconoAlta,
  IconoConsola,
  IconoLista,
  IconoPersonas,
  IconoPendientes,
  IconoPolitica,
  IconoPoliza,
  IconoPrecios,
  IconoProveedores,
  IconoEntrar,
} from "./iconos";
import type { puertasDe } from "./puertas";

export type Seccion = { ruta: string; href: string; etiqueta: string; Icono: () => ReactNode };
export type GrupoDeSecciones = { titulo: string; secciones: Seccion[] };

/** Un pendiente real de una sección. Sin pendiente, la sección no lleva número. */
export type Contador = { valor: number; etiqueta: string };

/**
 * La navegación lateral entera. Las puertas llegan de `puertasDe`. Cada enlace
 * lleva la empresa en la ruta: elegirla no autoriza nada. El título de cada
 * grupo lo lee el lector de pantalla; a la vista los separa un filete.
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
    ...(puertas.resumen ? [seccion("/consola", "Inicio", IconoConsola)] : []),
    ...(puertas.consola ? [seccion("/consola/pendientes", "Pendientes", IconoPendientes)] : []),
    ...(puertas.politica ? [seccion("/consola/politica", "Política", IconoPolitica)] : []),
    ...(puertas.proveedores ? [seccion("/consola/proveedores", "Proveedores", IconoProveedores)] : []),
    ...(puertas.lista69b ? [seccion("/consola/lista-69b", "Lista 69-B", IconoLista)] : []),
    ...(puertas.maestro ? [seccion("/consola/personas", "Personas", IconoPersonas)] : []),
    ...(puertas.poliza ? [seccion("/consola/poliza", "Póliza", IconoPoliza)] : []),
  ];
  const cuenta = [
    ...(puertas.configuracion ? [seccion("/consola/configuracion", "Configuración", IconoPrecios)] : []),
    ...(puertas.telefono ? [seccion("/telefono", "Teléfono", IconoEntrar)] : []),
    ...(variasEmpresas ? [seccion("/empresas", "Cambiar de empresa", IconoAlta)] : []),
  ];
  return [
    ...(operacion.length > 0 ? [{ titulo: "Operación", secciones: operacion }] : []),
    ...(cuenta.length > 0 ? [{ titulo: "Cuenta", secciones: cuenta }] : []),
  ];
}
