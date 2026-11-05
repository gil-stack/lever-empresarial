import { randomUUID } from "node:crypto";

import type { ContextoConEmpresa, ContextoDePersonal, ContextoDeTenant } from "../../nucleo/contexto";
import type { Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { contieneMaterialProhibido } from "./material";

/**
 * La única función que escribe la bitácora. Cada acción viene de un catálogo
 * con su entidad y las claves de `cambio` que puede llevar. Lo demás se
 * rechaza: la defensa es la forma fija del evento, no un recorrido de patrones.
 */
export const CATALOGO = {
  alta_empresa: { entidad: "companies", cambio: ["demostracion"] },
  alta_centro_costo: { entidad: "cost_centers", cambio: ["presupuesto_centavos", "es_tesoreria"] },
  editar_area: { entidad: "cost_centers", cambio: ["presupuesto_anterior", "presupuesto_nuevo"] },
  alta_persona: { entidad: "employees", cambio: ["presupuesto_centavos"] },
  editar_persona: { entidad: "employees", cambio: ["presupuesto_anterior", "presupuesto_nuevo"] },
  baja_persona: { entidad: "employees", cambio: [] },
  desprovisionar_persona: { entidad: "employees", cambio: [] },
  configurar_nomina: { entidad: "employee_payroll_profiles", cambio: ["neto_anterior", "neto_nuevo"] },
  avanzar_calendario_nomina: { entidad: "employee_payroll_profiles", cambio: [] },
  desactivar_nomina: { entidad: "employee_payroll_profiles", cambio: [] },
  solicitar_tarjeta: { entidad: "employee_card_requests", cambio: [] },
  cancelar_tarjeta: { entidad: "employee_card_requests", cambio: [] },
  preparar_nomina: { entidad: "payroll_batches", cambio: ["fecha_pago", "total_centavos", "personas"] },
  autorizar_liberador: { entidad: "membership_roles", cambio: ["rol"] },
  quitar_liberador: { entidad: "membership_roles", cambio: ["rol"] },
  asignar_rol: { entidad: "membership_roles", cambio: ["rol"] },
  quitar_rol: { entidad: "membership_roles", cambio: ["rol"] },
  editar_politica: { entidad: "policies", cambio: [] },
  editar_umbral: { entidad: "policies", cambio: [] },
  quitar_umbral: { entidad: "policies", cambio: [] },
  editar_politica_persona: { entidad: "policy_persons", cambio: [] },
  quitar_politica_persona: { entidad: "policy_persons", cambio: [] },
  crear_categoria: { entidad: "policy_categories", cambio: [] },
  escribir_tope: { entidad: "policy_categories", cambio: [] },
  quitar_tope: { entidad: "policy_categories", cambio: [] },
  borrar_categoria: { entidad: "policy_categories", cambio: [] },
  alta_proveedor: { entidad: "suppliers", cambio: [] },
  clabe_proveedor: { entidad: "supplier_clabes", cambio: [] },
  publicar_precio: { entidad: "platform_pricing", cambio: ["centavos"] },
  aceptar_suscripcion: { entidad: "subscriptions", cambio: [] },
  cargar_lista_69b: { entidad: "lista_69b_snapshots", cambio: ["fecha_archivo", "contribuyentes"] },
  emitir_invitacion: { entidad: "invitations", cambio: ["roles", "expira_en"] },
  revocar_invitacion: { entidad: "invitations", cambio: [] },
  aceptar_invitacion: { entidad: "invitations", cambio: [] },
  alta_personal: { entidad: "platform_staff", cambio: ["rol"] },
  entrada: { entidad: "sessions", cambio: [] },
  segundo_factor: { entidad: "sessions", cambio: ["metodo"] },
  salida: { entidad: "sessions", cambio: [] },
  entrada_fallida: { entidad: "users", cambio: ["motivo"] },
  recuperacion_solicitada: { entidad: "password_resets", cambio: [] },
  contrasena_restablecida: { entidad: "password_resets", cambio: [] },
} as const satisfies Record<string, { entidad: string; cambio: readonly string[] }>;

export type AccionDeBitacora = keyof typeof CATALOGO;
export type ActorTipo = "personal" | "miembro" | "sistema" | "aviso";
export type SuperficieDeBitacora = "sofipo" | "cliente" | "telefono" | "sistema";
export type ValorDeCambio = string | number | boolean | null;

/** Quién actúa y por dónde. Sale del contexto, no del llamador. */
export type Actor = {
  operadorId: string | null;
  companyId: string | null;
  actorTipo: ActorTipo;
  actorId: string | null;
  superficie: SuperficieDeBitacora;
  peticionId: string | null;
  origen: string | null;
};

export type Hecho = {
  accion: AccionDeBitacora;
  identificador: string | null;
  motivo?: string | null;
  cambio?: Readonly<Record<string, ValorDeCambio>> | null;
};

export type Auditar = (consulta: Consulta, actor: Actor, hecho: Hecho) => Promise<void>;

const INSERTAR = `insert into audit_log (
  id, operator_id, company_id, actor_tipo, actor_id, superficie,
  accion, entidad, identificador, motivo, peticion_id, origen, cambio
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGEN = /^[a-z0-9_.:-]{1,80}$/;

export function actorDeCliente(ctx: ContextoConEmpresa, origen: string | null = "consola"): Actor {
  return {
    operadorId: ctx.empresa.operadorId,
    companyId: ctx.empresa.id,
    actorTipo: "miembro",
    actorId: ctx.persona.id,
    superficie: ctx.superficie === "telefono" ? "telefono" : "cliente",
    peticionId: ctx.peticionId,
    origen,
  };
}

export function actorDePersonal(
  ctx: ContextoDePersonal,
  companyId: string | null = null,
  origen: string | null = "consola",
): Actor {
  return {
    operadorId: ctx.personal.operadorId,
    companyId,
    actorTipo: "personal",
    actorId: ctx.persona.id,
    superficie: "sofipo",
    peticionId: ctx.peticionId,
    origen,
  };
}

/** Entrar y salir no tienen empresa. La persona que entra es el actor. */
export function actorDeIdentidad(
  persona: { id: string } | null,
  ctx?: Pick<ContextoDeTenant, "peticionId">,
  operadorId: string | null = null,
): Actor {
  return {
    operadorId,
    companyId: null,
    actorTipo: persona ? "miembro" : "sistema",
    actorId: persona?.id ?? null,
    superficie: "cliente",
    peticionId: ctx?.peticionId ?? null,
    origen: "consola",
  };
}

export async function operadorDeLaPlataforma(consulta: Consulta): Promise<string | null> {
  const resultado = await consulta.query("select id from operators order by alta_en limit 2");
  const fila = resultado.rows[0] as { id?: unknown } | undefined;
  if (resultado.rows.length !== 1 || typeof fila?.id !== "string") return null;
  return fila.id;
}

export const auditar: Auditar = async (consulta, actor, hecho) => {
  const fila = preparar(actor, hecho);
  try {
    await consulta.query(INSERTAR, fila);
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    throw new ErrorDeDominio("auditoria_no_disponible");
  }
};

export function preparar(actor: Actor, hecho: Hecho): unknown[] {
  const regla = CATALOGO[hecho.accion];
  if (!regla) throw new ErrorDeDominio("auditoria_no_disponible");
  if (!uuidOVacio(actor.operadorId) || !uuidOVacio(actor.companyId) || !uuidOVacio(actor.actorId)) {
    throw new ErrorDeDominio("auditoria_no_disponible");
  }
  if (!uuidOVacio(hecho.identificador) || !uuidOVacio(actor.peticionId)) {
    throw new ErrorDeDominio("auditoria_no_disponible");
  }
  if (actor.companyId && !actor.operadorId) throw new ErrorDeDominio("auditoria_no_disponible");
  if ((actor.actorTipo === "personal" || actor.actorTipo === "miembro") !== Boolean(actor.actorId)) {
    throw new ErrorDeDominio("auditoria_no_disponible");
  }
  if (actor.origen !== null && !ORIGEN.test(actor.origen)) throw new ErrorDeDominio("auditoria_no_disponible");
  const motivo = hecho.motivo?.trim() ? hecho.motivo.trim() : null;
  if (motivo && (motivo.length > 500 || /[\u0000-\u001f\u007f]/.test(motivo) || contieneMaterialProhibido(motivo))) {
    throw new ErrorDeDominio("auditoria_no_disponible");
  }
  const cambio = cambioPermitido(regla.cambio, hecho.cambio ?? null);
  return [
    randomUUID(),
    actor.operadorId,
    actor.companyId,
    actor.actorTipo,
    actor.actorId,
    actor.superficie,
    hecho.accion,
    regla.entidad,
    hecho.identificador,
    motivo,
    actor.peticionId,
    actor.origen,
    cambio === null ? null : JSON.stringify(cambio),
  ];
}

function cambioPermitido(
  permitidas: readonly string[],
  cambio: Readonly<Record<string, ValorDeCambio>> | null,
): Record<string, ValorDeCambio> | null {
  if (cambio === null) return null;
  if (typeof cambio !== "object" || Array.isArray(cambio)) throw new ErrorDeDominio("auditoria_no_disponible");
  const limpio: Record<string, ValorDeCambio> = {};
  for (const [clave, valor] of Object.entries(cambio)) {
    if (!permitidas.includes(clave)) throw new ErrorDeDominio("auditoria_no_disponible");
    const tipo = typeof valor;
    if (valor !== null && tipo !== "string" && tipo !== "number" && tipo !== "boolean") {
      throw new ErrorDeDominio("auditoria_no_disponible");
    }
    if (typeof valor === "string" && (valor.length > 200 || contieneMaterialProhibido(valor))) {
      throw new ErrorDeDominio("auditoria_no_disponible");
    }
    limpio[clave] = valor;
  }
  return Object.keys(limpio).length > 0 ? limpio : null;
}

function uuidOVacio(valor: string | null | undefined): boolean {
  return valor === null || valor === undefined || UUID.test(valor);
}
