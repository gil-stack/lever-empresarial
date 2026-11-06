import { tiene, type Capacidad } from "@/nucleo/capacidades";
import type { ContextoDeTenant } from "@/nucleo/contexto";

/** Lo que el marco necesita del contexto. Sin la sesión ni los roles: solo capacidades. */
export type VistaDeMarco = {
  persona: { nombre: string } | null;
  capacidades: readonly Capacidad[];
  empresaId: string | null;
  razonSocial: string | null;
  variasEmpresas: boolean;
};

export const MARCO_SIN_SESION: VistaDeMarco = {
  persona: null,
  capacidades: [],
  empresaId: null,
  razonSocial: null,
  variasEmpresas: false,
};

export function vistaDeMarco(ctx: ContextoDeTenant | null | undefined): VistaDeMarco {
  if (!ctx) return MARCO_SIN_SESION;
  return {
    persona: { nombre: ctx.persona.nombre },
    capacidades: ctx.capacidades,
    empresaId: ctx.empresa?.id ?? null,
    razonSocial: ctx.empresa?.razonSocial ?? null,
    variasEmpresas: ctx.empresas.length > 1,
  };
}

/** El menú no cambia de página en página. Lo decide la matriz de capacidades, no el marco. */
export function puertasDe(capacidades: readonly Capacidad[]): {
  consola: boolean;
  resumen: boolean;
  politica: boolean;
  maestro: boolean;
  poliza: boolean;
  proveedores: boolean;
  lista69b: boolean;
  configuracion: boolean;
  telefono: boolean;
} {
  return {
    consola: tiene(capacidades, "cliente.consola.ver"),
    resumen: tiene(capacidades, "cliente.resumen.ver"),
    politica: tiene(capacidades, "cliente.politica.ver"),
    maestro: tiene(capacidades, "cliente.maestro.ver"),
    poliza: tiene(capacidades, "cliente.poliza.ver"),
    proveedores: tiene(capacidades, "cliente.proveedores.ver"),
    lista69b: tiene(capacidades, "cliente.lista69b.ver") || tiene(capacidades, "plataforma.lista69b.cargar"),
    configuracion: tiene(capacidades, "cliente.configuracion.ver"),
    telefono: tiene(capacidades, "telefono.inicio.ver"),
  };
}
