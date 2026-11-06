import { etiquetaDelRol } from "@/dominio/personas";
import { capacidadesDe, ROLES_CLIENTE, tiene, type Capacidad } from "@/nucleo/capacidades";
import type { ContextoDeTenant } from "@/nucleo/contexto";
import { enEmpresa, rutaConsola } from "@/nucleo/rutas";

/** Otra empresa de la persona y la superficie donde aterriza al elegirla. */
export type EmpresaElegible = { id: string; razonSocial: string; destino: string };

/** Lo que el marco necesita del contexto. Sin la sesión ni los roles: solo capacidades. */
export type VistaDeMarco = {
  persona: { id: string; nombre: string; rol: string | null } | null;
  capacidades: readonly Capacidad[];
  empresaId: string | null;
  razonSocial: string | null;
  variasEmpresas: boolean;
  /** Las empresas de la persona, para cambiar desde la tarjeta de la empresa o desde su menú. */
  empresas: readonly EmpresaElegible[];
};

export const MARCO_SIN_SESION: VistaDeMarco = {
  persona: null,
  capacidades: [],
  empresaId: null,
  razonSocial: null,
  variasEmpresas: false,
  empresas: [],
};

export function vistaDeMarco(ctx: ContextoDeTenant | null | undefined): VistaDeMarco {
  if (!ctx) return MARCO_SIN_SESION;
  return {
    persona: { id: ctx.persona.id, nombre: ctx.persona.nombre, rol: rolVisible(ctx.roles) },
    capacidades: ctx.capacidades,
    empresaId: ctx.empresa?.id ?? null,
    razonSocial: ctx.empresa?.razonSocial ?? null,
    variasEmpresas: ctx.empresas.length > 1,
    empresas: ctx.empresas.map((empresa) => ({
      id: empresa.id,
      razonSocial: empresa.razonSocial,
      destino: destinoDe(empresa.id, empresa.roles),
    })),
  };
}

/** Hasta dos roles, en el orden de la matriz (Administrador primero). */
function rolVisible(roles: ContextoDeTenant["roles"]): string | null {
  const ordenados = ROLES_CLIENTE.filter((rol) => roles.includes(rol));
  return ordenados.length > 0 ? ordenados.slice(0, 2).map(etiquetaDelRol).join(" · ") : null;
}

/** Igual que en /empresas: la consola si sus roles la abren; si no, el teléfono. */
function destinoDe(empresaId: string, roles: ContextoDeTenant["roles"]): string {
  const capacidades = capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] });
  if (tiene(capacidades, "cliente.consola.ver")) return enEmpresa(empresaId, rutaConsola(capacidades));
  if (tiene(capacidades, "telefono.inicio.ver")) return enEmpresa(empresaId, "/telefono");
  return "/empresas";
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
