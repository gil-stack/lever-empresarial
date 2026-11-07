import type { ReactNode } from "react";

import { enEmpresa } from "@/nucleo/rutas";

import {
  IconoAhorro,
  IconoApariencia,
  IconoCalendario,
  IconoCobros,
  IconoConciliacion,
  IconoConfiguracion,
  IconoCredito,
  IconoCuenta,
  IconoFlujo,
  IconoGasolina,
  IconoGastos,
  IconoInicio,
  IconoIntegraciones,
  IconoInternacional,
  IconoInversion,
  IconoLista,
  IconoMovimientos,
  IconoPendientes,
  IconoPersonas,
  IconoPolitica,
  IconoPresupuestos,
  IconoProveedores,
  IconoSeguridad,
  IconoTarjetas,
  IconoTelefono,
  IconoViajes,
} from "./iconos";
import type { Puertas } from "./puertas";

export type Seccion = {
  ruta: string;
  href: string;
  etiqueta: string;
  Icono: () => ReactNode;
  /** Otras páginas que viven dentro de esta sección (Fiscal reúne la 69-B y la Póliza). */
  incluye?: readonly string[];
};
export type GrupoDeSecciones = { titulo: string; secciones: Seccion[] };

/** Un pendiente real de una sección. Sin pendiente, la sección no lleva número. */
export type Contador = { valor: number; etiqueta: string };

/**
 * La navegación lateral, con los grupos y el orden del diseño de los socios
 * (NAV_MAIN de la plataforma). Las puertas llegan de `puertasDe`; cada enlace
 * lleva la empresa en la ruta: elegirla no autoriza nada. El título de cada
 * grupo lo lee el lector de pantalla; a la vista los separa un filete.
 *
 * El flujo de caja (#52) es el valor de negocio que va primero: sus cuatro
 * pantallas reales no se esconden en un menú, forman su propio grupo justo
 * debajo de la operación diaria.
 */
export function seccionesDe(puertas: Puertas, empresaId: string | null): GrupoDeSecciones[] {
  const seccion = (ruta: string, etiqueta: string, Icono: () => ReactNode, incluye?: readonly string[]): Seccion => ({
    ruta,
    href: enEmpresa(empresaId, ruta),
    etiqueta,
    Icono,
    ...(incluye ? { incluye } : {}),
  });
  const si = (abre: boolean, s: Seccion): Seccion[] => (abre ? [s] : []);
  const m = puertas.modulos;
  const diaria = [
    ...si(puertas.resumen, seccion("/consola", "Resumen", IconoInicio)),
    ...si(m["/consola/conciliacion"], seccion("/consola/conciliacion", "Conciliación", IconoConciliacion)),
    ...si(m["/consola/aprobaciones"], seccion("/consola/aprobaciones", "Aprobaciones", IconoPendientes, ["/consola/pendientes"])),
    ...si(m["/consola/gastos"], seccion("/consola/gastos", "Gastos", IconoGastos)),
    ...si(m["/consola/tarjetas"], seccion("/consola/tarjetas", "Tarjetas", IconoTarjetas)),
    ...si(m["/consola/movimientos"], seccion("/consola/movimientos", "Movimientos", IconoMovimientos)),
    ...si(m["/consola/fiscal"], seccion("/consola/fiscal", "Fiscal", IconoLista, ["/consola/lista-69b", "/consola/poliza"])),
  ];
  const flujo = puertas.flujo
    ? [
      seccion("/consola/flujo", "Saldo y alertas", IconoFlujo),
      seccion("/consola/cobros", "Cobros", IconoCobros),
      seccion("/consola/calendario", "Calendario", IconoCalendario),
      seccion("/consola/presupuestos", "Presupuestos", IconoPresupuestos),
    ]
    : [];
  const dinero = [
    ...si(m["/consola/cuenta"], seccion("/consola/cuenta", "Cuenta", IconoCuenta)),
    ...si(m["/consola/internacional"], seccion("/consola/internacional", "Pagos internacionales", IconoInternacional)),
    ...si(puertas.proveedores, seccion("/consola/proveedores", "Proveedores", IconoProveedores)),
    // Nómina vive dentro de Personas: el directorio, las áreas y los lotes.
    ...si(puertas.maestro, seccion("/consola/personas/nomina", "Nómina", IconoPersonas, ["/consola/personas"])),
    ...si(m["/consola/credito"], seccion("/consola/credito", "Crédito", IconoCredito)),
    ...si(m["/consola/inversion"], seccion("/consola/inversion", "Inversión", IconoInversion)),
  ];
  const ocasional = [
    ...si(m["/consola/viajes"], seccion("/consola/viajes", "Viajes y proyectos", IconoViajes)),
    ...si(m["/consola/gasolina"], seccion("/consola/gasolina", "Gasolina", IconoGasolina)),
    ...si(m["/consola/ahorro"], seccion("/consola/ahorro", "Ahorro", IconoAhorro)),
  ];
  return [
    ...(diaria.length > 0 ? [{ titulo: "Operación", secciones: diaria }] : []),
    ...(flujo.length > 0 ? [{ titulo: "Flujo de caja", secciones: flujo }] : []),
    ...(dinero.length > 0 ? [{ titulo: "Dinero", secciones: dinero }] : []),
    ...(ocasional.length > 0 ? [{ titulo: "Ocasionales", secciones: ocasional }] : []),
  ];
}

/**
 * «Más»: lo que casi no se usa sale del lateral y vive en el menú de la tarjeta
 * de la empresa, como NAV_MORE del diseño (Tú y Empresa). Teléfono es otra
 * superficie de la misma persona, por eso va con «Tú».
 */
export function masDe(puertas: Puertas, empresaId: string | null): GrupoDeSecciones[] {
  const seccion = (ruta: string, etiqueta: string, Icono: () => ReactNode): Seccion => ({
    ruta,
    href: enEmpresa(empresaId, ruta),
    etiqueta,
    Icono,
  });
  const tu = [
    ...(puertas.modulos["/consola/perfil"] ? [seccion("/consola/perfil", "Mi perfil", IconoSeguridad)] : []),
    ...(empresaId ? [seccion("/consola/apariencia", "Apariencia", IconoApariencia)] : []),
    ...(puertas.telefono ? [seccion("/telefono", "Teléfono", IconoTelefono)] : []),
  ];
  const empresa = [
    ...(puertas.configuracion ? [seccion("/consola/configuracion", "Configuración", IconoConfiguracion)] : []),
    ...(puertas.politica ? [seccion("/consola/politica", "Políticas", IconoPolitica)] : []),
    ...(puertas.modulos["/consola/integraciones"] ? [seccion("/consola/integraciones", "Integraciones", IconoIntegraciones)] : []),
  ];
  return [
    ...(tu.length > 0 ? [{ titulo: "Tú", secciones: tu }] : []),
    ...(empresa.length > 0 ? [{ titulo: "Empresa", secciones: empresa }] : []),
  ];
}

/** La sección que se marca como actual: la de la ruta, o la que la incluye. */
export function seccionActual(grupos: readonly GrupoDeSecciones[], actual: string): Seccion | undefined {
  const todas = grupos.flatMap((grupo) => grupo.secciones);
  return todas.find((seccion) => seccion.ruta === actual) ?? todas.find((seccion) => seccion.incluye?.includes(actual));
}
