/**
 * La única matriz de permisos. Cada capacidad tiene nombre, pertenece a una
 * superficie y la dan roles de esa superficie. Un rol de la plataforma no da
 * una capacidad del cliente, ni al revés: el personal del operador no actúa
 * como la empresa.
 */

export const SUPERFICIES = ["cliente", "sofipo", "telefono"] as const;
export type Superficie = (typeof SUPERFICIES)[number];

export const ROLES_CLIENTE = ["administrador", "solicitante", "liberador", "tarjetahabiente", "contador", "finanzas"] as const;
export type RolCliente = (typeof ROLES_CLIENTE)[number];

/**
 * Cada rol de la plataforma se enciende cuando su fase le da trabajo. Los cuatro de la Ola R1 separan
 * funciones como piden las disposiciones del art. 124 LACP: quien origina no dictamina, quien dictamina
 * no audita (50ª) y quien aprueba no es quien pidió.
 */
export const ROLES_PLATAFORMA = ["administracion_plataforma", "originacion", "aprobacion", "cumplimiento", "auditoria"] as const;
export type RolPlataforma = (typeof ROLES_PLATAFORMA)[number];

type Regla<R> = { superficie: Superficie; roles: readonly R[] };

/**
 * Finanzas es un acceso adicional, no un rol de trabajo: abre Inicio,
 * Pendientes y el flujo de caja (saldo, cobros, calendario y presupuestos), y
 * nada más (ni el teléfono). Una membresía no se queda solo con Finanzas.
 */
const DE_TRABAJO: readonly RolCliente[] = ROLES_CLIENTE.filter((rol) => rol !== "finanzas");
const DE_CONSOLA: readonly RolCliente[] = ["administrador", "solicitante", "liberador", "contador"];

const DEL_CLIENTE = {
  "cliente.consola.ver": { superficie: "cliente", roles: [...DE_CONSOLA, "finanzas"] },
  "cliente.resumen.ver": { superficie: "cliente", roles: ["administrador", "finanzas"] },
  // Flujo de caja: quien ve el resumen lo ve; la contaduría lo lee sin editar.
  "cliente.flujo.ver": { superficie: "cliente", roles: ["administrador", "finanzas", "contador"] },
  // Saldo declarado, cobros esperados, obligaciones, colchón y área de un proveedor.
  "cliente.flujo.editar": { superficie: "cliente", roles: ["administrador", "finanzas"] },
  "cliente.precio.ver": { superficie: "cliente", roles: DE_CONSOLA },
  "cliente.plan.ver": { superficie: "cliente", roles: ["administrador"] },
  "cliente.configuracion.ver": { superficie: "cliente", roles: ["administrador"] },
  "cliente.politica.ver": { superficie: "cliente", roles: DE_CONSOLA },
  "cliente.politica.editar": { superficie: "cliente", roles: ["administrador"] },
  "cliente.maestro.ver": { superficie: "cliente", roles: ["administrador", "contador", "liberador"] },
  "cliente.maestro.editar": { superficie: "cliente", roles: ["administrador"] },
  // Cambiar la CLABE de nómina de una persona: además exige segundo factor reciente.
  "cliente.personas.clabe.cambiar": { superficie: "cliente", roles: ["administrador"] },
  // Neto por persona y renglones del lote: quien prepara o autoriza la nómina.
  "cliente.nomina.detalle.ver": { superficie: "cliente", roles: ["administrador", "liberador"] },
  "cliente.membresias.administrar": { superficie: "cliente", roles: ["administrador"] },
  "cliente.proveedores.ver": { superficie: "cliente", roles: ["administrador", "solicitante", "liberador", "contador"] },
  /** CLABE completa, constancia y contratos. Quien solo solicita ve la terminación. */
  "cliente.proveedores.expediente.ver": { superficie: "cliente", roles: ["administrador", "liberador", "contador"] },
  "cliente.proveedores.alta": { superficie: "cliente", roles: ["administrador", "liberador"] },
  "cliente.proveedores.clabe.cambiar": { superficie: "cliente", roles: ["administrador"] },
  "cliente.lista69b.ver": { superficie: "cliente", roles: ["administrador", "solicitante", "liberador", "contador"] },
  "cliente.poliza.ver": { superficie: "cliente", roles: ["administrador", "contador"] },
  "cliente.pago.solicitar": { superficie: "cliente", roles: ["administrador", "liberador", "solicitante"] },
  "cliente.pago.liberar": { superficie: "cliente", roles: ["liberador"] },
  "cliente.pago.cancelar_listo": { superficie: "cliente", roles: ["administrador", "liberador"] },
} as const satisfies Record<string, Regla<RolCliente>>;

const DEL_TELEFONO = {
  "telefono.inicio.ver": { superficie: "telefono", roles: DE_TRABAJO },
  "telefono.topes.ver": { superficie: "telefono", roles: DE_TRABAJO },
  "telefono.facturacion.ver": { superficie: "telefono", roles: DE_TRABAJO },
} as const satisfies Record<string, Regla<RolCliente>>;

const DE_LA_PLATAFORMA = {
  "plataforma.lista69b.cargar": { superficie: "sofipo", roles: ["administracion_plataforma"] },
  "plataforma.precio.publicar": { superficie: "sofipo", roles: ["administracion_plataforma"] },
  "plataforma.suscripcion.aceptar": { superficie: "sofipo", roles: ["administracion_plataforma"] },
  "plataforma.empresa.alta": { superficie: "sofipo", roles: ["administracion_plataforma"] },
  "plataforma.invitacion.emitir": { superficie: "sofipo", roles: ["administracion_plataforma"] },
  "plataforma.personal.administrar": { superficie: "sofipo", roles: ["administracion_plataforma"] },
  // Ola R1: alta regulada. Entrar a Operación lo da cualquier rol; cada pantalla pide el suyo.
  "plataforma.operacion.ver": {
    superficie: "sofipo",
    roles: ["administracion_plataforma", "originacion", "aprobacion", "cumplimiento", "auditoria"],
  },
  "plataforma.prospecto.registrar": { superficie: "sofipo", roles: ["administracion_plataforma", "originacion"] },
  "plataforma.activacion.solicitar": { superficie: "sofipo", roles: ["administracion_plataforma", "originacion"] },
  "plataforma.activacion.aprobar": { superficie: "sofipo", roles: ["aprobacion"] },
  "plataforma.expediente.ver": { superficie: "sofipo", roles: ["originacion", "aprobacion", "cumplimiento", "auditoria"] },
  "plataforma.expediente.capturar": { superficie: "sofipo", roles: ["originacion"] },
  "plataforma.expediente.dictaminar": { superficie: "sofipo", roles: ["cumplimiento"] },
  "plataforma.riesgo.calificar": { superficie: "sofipo", roles: ["cumplimiento"] },
  "plataforma.lpb.cargar": { superficie: "sofipo", roles: ["cumplimiento"] },
  "plataforma.lpb.resolver": { superficie: "sofipo", roles: ["cumplimiento"] },
  "plataforma.cumplimiento.bandeja": { superficie: "sofipo", roles: ["cumplimiento", "auditoria"] },
  "plataforma.suspension.solicitar": { superficie: "sofipo", roles: ["originacion", "cumplimiento"] },
  "plataforma.suspension.aprobar": { superficie: "sofipo", roles: ["aprobacion"] },
  "plataforma.bitacora.ver": { superficie: "sofipo", roles: ["administracion_plataforma", "cumplimiento", "auditoria"] },
  // Ola R2: PLD. Lo sensible lo ven Cumplimiento y Auditoría (55ª); avisar al área de Cumplimiento lo puede todo el personal (60ª).
  "plataforma.pld.ver": { superficie: "sofipo", roles: ["cumplimiento", "auditoria"] },
  "plataforma.pld.analizar": { superficie: "sofipo", roles: ["cumplimiento"] },
  "plataforma.pld.comite": { superficie: "sofipo", roles: ["cumplimiento"] },
  "plataforma.pld.dictaminar": { superficie: "sofipo", roles: ["cumplimiento"] },
  "plataforma.pld.reportar": { superficie: "sofipo", roles: ["cumplimiento"] },
  "plataforma.pld.aviso.emitir": {
    superficie: "sofipo",
    roles: ["administracion_plataforma", "originacion", "aprobacion", "cumplimiento", "auditoria"],
  },
  "plataforma.pld.manifiesto": { superficie: "sofipo", roles: ["cumplimiento", "auditoria"] },
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

/** Hay al menos un rol de trabajo; Finanzas solo no cuenta. */
export function tieneRolDeTrabajo(roles: readonly RolCliente[]): boolean {
  return roles.some((rol) => DE_TRABAJO.includes(rol));
}

/** Roles en un orden estable, sin repetidos ni desconocidos. */
export function rolesLeidos(valores: readonly unknown[]): RolCliente[] {
  return ROLES_CLIENTE.filter((rol) => valores.includes(rol));
}
