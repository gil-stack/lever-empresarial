/**
 * La única matriz de permisos. Cada capacidad tiene nombre, pertenece a una
 * superficie y la dan roles de esa superficie. Un rol de la plataforma no da
 * una capacidad del cliente, ni al revés: el personal del operador no actúa
 * como la empresa.
 */

export const SUPERFICIES = ["cliente", "sofipo", "telefono"] as const;
export type Superficie = (typeof SUPERFICIES)[number];

export const ROLES_CLIENTE = ["administrador", "solicitante", "liberador", "tarjetahabiente", "contador"] as const;
export type RolCliente = (typeof ROLES_CLIENTE)[number];

/** Cada rol de la plataforma se enciende cuando su fase le da trabajo. */
export const ROLES_PLATAFORMA = ["administracion_plataforma"] as const;
export type RolPlataforma = (typeof ROLES_PLATAFORMA)[number];

type Regla<R> = { superficie: Superficie; roles: readonly R[] };

const TODOS: readonly RolCliente[] = ROLES_CLIENTE;
const DE_CONSOLA: readonly RolCliente[] = ["administrador", "solicitante", "liberador", "contador"];

const DEL_CLIENTE = {
  "cliente.consola.ver": { superficie: "cliente", roles: DE_CONSOLA },
  "cliente.precio.ver": { superficie: "cliente", roles: DE_CONSOLA },
  "cliente.plan.ver": { superficie: "cliente", roles: ["administrador"] },
  "cliente.configuracion.ver": { superficie: "cliente", roles: ["administrador"] },
  "cliente.politica.ver": { superficie: "cliente", roles: DE_CONSOLA },
  "cliente.politica.editar": { superficie: "cliente", roles: ["administrador"] },
  "cliente.maestro.ver": { superficie: "cliente", roles: ["administrador", "contador", "liberador"] },
  "cliente.maestro.editar": { superficie: "cliente", roles: ["administrador"] },
  "cliente.membresias.administrar": { superficie: "cliente", roles: ["administrador"] },
  "cliente.proveedores.ver": { superficie: "cliente", roles: ["administrador", "solicitante", "liberador", "contador"] },
  "cliente.proveedores.alta": { superficie: "cliente", roles: ["administrador", "liberador"] },
  "cliente.proveedores.clabe.cambiar": { superficie: "cliente", roles: ["administrador"] },
  "cliente.lista69b.ver": { superficie: "cliente", roles: ["administrador", "solicitante", "liberador", "contador"] },
  "cliente.poliza.ver": { superficie: "cliente", roles: ["administrador", "contador"] },
  "cliente.pago.solicitar": { superficie: "cliente", roles: ["administrador", "liberador", "solicitante"] },
  "cliente.pago.liberar": { superficie: "cliente", roles: ["liberador"] },
} as const satisfies Record<string, Regla<RolCliente>>;

const DEL_TELEFONO = {
  "telefono.inicio.ver": { superficie: "telefono", roles: TODOS },
  "telefono.topes.ver": { superficie: "telefono", roles: TODOS },
  "telefono.facturacion.ver": { superficie: "telefono", roles: TODOS },
} as const satisfies Record<string, Regla<RolCliente>>;

const DE_LA_PLATAFORMA = {
  "plataforma.lista69b.cargar": { superficie: "sofipo", roles: ["administracion_plataforma"] },
  "plataforma.precio.publicar": { superficie: "sofipo", roles: ["administracion_plataforma"] },
  "plataforma.suscripcion.aceptar": { superficie: "sofipo", roles: ["administracion_plataforma"] },
  "plataforma.empresa.alta": { superficie: "sofipo", roles: ["administracion_plataforma"] },
  "plataforma.invitacion.emitir": { superficie: "sofipo", roles: ["administracion_plataforma"] },
  "plataforma.personal.administrar": { superficie: "sofipo", roles: ["administracion_plataforma"] },
} as const satisfies Record<string, Regla<RolPlataforma>>;

export type CapacidadCliente = keyof typeof DEL_CLIENTE;
export type CapacidadTelefono = keyof typeof DEL_TELEFONO;
export type CapacidadPlataforma = keyof typeof DE_LA_PLATAFORMA;
export type Capacidad = CapacidadCliente | CapacidadTelefono | CapacidadPlataforma;

export const CAPACIDADES: readonly Capacidad[] = [
  ...(Object.keys(DEL_CLIENTE) as CapacidadCliente[]),
  ...(Object.keys(DEL_TELEFONO) as CapacidadTelefono[]),
  ...(Object.keys(DE_LA_PLATAFORMA) as CapacidadPlataforma[]),
];

export function superficieDe(capacidad: Capacidad): Superficie {
  if (capacidad in DEL_CLIENTE) return DEL_CLIENTE[capacidad as CapacidadCliente].superficie;
  if (capacidad in DEL_TELEFONO) return DEL_TELEFONO[capacidad as CapacidadTelefono].superficie;
  return DE_LA_PLATAFORMA[capacidad as CapacidadPlataforma].superficie;
}

/** Capacidades de una persona: las de sus roles en la empresa elegida y las de su rol de plataforma. */
export function capacidadesDe(entrada: {
  rolesCliente: readonly RolCliente[];
  rolesPlataforma: readonly RolPlataforma[];
}): Capacidad[] {
  const dadas: Capacidad[] = [];
  for (const [capacidad, regla] of Object.entries(DEL_CLIENTE) as [CapacidadCliente, Regla<RolCliente>][]) {
    if (regla.roles.some((rol) => entrada.rolesCliente.includes(rol))) dadas.push(capacidad);
  }
  for (const [capacidad, regla] of Object.entries(DEL_TELEFONO) as [CapacidadTelefono, Regla<RolCliente>][]) {
    if (regla.roles.some((rol) => entrada.rolesCliente.includes(rol))) dadas.push(capacidad);
  }
  for (const [capacidad, regla] of Object.entries(DE_LA_PLATAFORMA) as [
    CapacidadPlataforma,
    Regla<RolPlataforma>,
  ][]) {
    if (regla.roles.some((rol) => entrada.rolesPlataforma.includes(rol))) dadas.push(capacidad);
  }
  return dadas;
}

/** La pregunta que hace todo el código: ¿este contexto tiene esta capacidad? */
export function tiene(capacidades: readonly Capacidad[] | ReadonlySet<Capacidad> | null | undefined, capacidad: Capacidad): boolean {
  if (!capacidades) return false;
  return "has" in capacidades ? capacidades.has(capacidad) : capacidades.includes(capacidad);
}

export function esRolCliente(valor: unknown): valor is RolCliente {
  return typeof valor === "string" && (ROLES_CLIENTE as readonly string[]).includes(valor);
}

export function esRolPlataforma(valor: unknown): valor is RolPlataforma {
  return typeof valor === "string" && (ROLES_PLATAFORMA as readonly string[]).includes(valor);
}

/** Roles en un orden estable, sin repetidos ni desconocidos. */
export function rolesLeidos(valores: readonly unknown[]): RolCliente[] {
  return ROLES_CLIENTE.filter((rol) => valores.includes(rol));
}
