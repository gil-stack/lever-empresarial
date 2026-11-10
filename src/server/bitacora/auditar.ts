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
  editar_area: {
    entidad: "cost_centers",
    cambio: [
      "nombre_anterior",
      "nombre_nuevo",
      "presupuesto_anterior",
      "presupuesto_nuevo",
      "tesoreria_anterior",
      "tesoreria_nueva",
    ],
  },
  alta_persona: { entidad: "employees", cambio: ["presupuesto_centavos", "clabe_nueva"] },
  editar_persona: { entidad: "employees", cambio: ["campos", "presupuesto_anterior", "presupuesto_nuevo"] },
  // La CLABE viaja enmascarada (últimos 4). Nunca los 18 dígitos.
  cambiar_clabe_nomina: { entidad: "employees", cambio: ["clabe_anterior", "clabe_nueva"] },
  aviso_clabe_nomina: { entidad: "employees", cambio: ["entregado", "codigo"] },
  baja_persona: { entidad: "employees", cambio: ["baja_anterior", "baja_nueva"] },
  desprovisionar_persona: { entidad: "employees", cambio: ["baja_en"] },
  configurar_nomina: {
    entidad: "employee_payroll_profiles",
    cambio: [
      "neto_anterior",
      "neto_nuevo",
      "frecuencia_anterior",
      "frecuencia_nueva",
      "destino_anterior",
      "destino_nuevo",
      "pago_anterior",
      "pago_nuevo",
    ],
  },
  avanzar_calendario_nomina: { entidad: "employee_payroll_profiles", cambio: ["pago_anterior", "pago_nuevo"] },
  desactivar_nomina: { entidad: "employee_payroll_profiles", cambio: ["baja_en"] },
  solicitar_tarjeta: { entidad: "employee_card_requests", cambio: [] },
  cancelar_tarjeta: { entidad: "employee_card_requests", cambio: ["baja_en"] },
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
  // El área inicial del proveedor, por nombre, cuando se elige en el alta (0026).
  alta_proveedor: { entidad: "suppliers", cambio: ["area"] },
  clabe_proveedor: { entidad: "supplier_clabes", cambio: [] },
  documento_proveedor: { entidad: "supplier_documents", cambio: ["tipo"] },
  documento_cargo_proveedor: { entidad: "supplier_payable_documents", cambio: ["tipo"] },
  crear_cargo_proveedor: { entidad: "supplier_payables", cambio: ["origen", "total_centavos"] },
  editar_cargo_proveedor: { entidad: "supplier_payables", cambio: ["total_centavos"] },
  solicitar_pago_proveedor: { entidad: "supplier_payment_requests", cambio: ["total_centavos"] },
  autorizar_pago_proveedor: { entidad: "supplier_payment_requests", cambio: [] },
  rechazar_pago_proveedor: { entidad: "supplier_payment_requests", cambio: [] },
  cancelar_pago_proveedor: { entidad: "supplier_payment_requests", cambio: [] },
  descargar_documento: { entidad: "documents", cambio: ["tipo"] },
  // Flujo de caja (0026). El área del proveedor viaja por nombre, nunca por id.
  asignar_area_proveedor: { entidad: "suppliers", cambio: ["area_anterior", "area_nueva"] },
  declarar_saldo: { entidad: "cash_balance_declarations", cambio: ["saldo_centavos", "al_dia"] },
  registrar_cobro: { entidad: "expected_collections", cambio: ["origen", "monto_centavos", "fecha_probable"] },
  cobrar_cobro: { entidad: "expected_collections", cambio: ["cobrado_el"] },
  cancelar_cobro: { entidad: "expected_collections", cambio: [] },
  registrar_obligacion: {
    entidad: "recurring_obligations",
    cambio: ["concepto", "monto_centavos", "frecuencia", "proxima_fecha", "area", "proveedor"],
  },
  editar_obligacion: {
    entidad: "recurring_obligations",
    cambio: [
      "concepto_anterior",
      "concepto_nuevo",
      "monto_anterior",
      "monto_nuevo",
      "frecuencia_anterior",
      "frecuencia_nueva",
      "fecha_anterior",
      "fecha_nueva",
      "area_anterior",
      "area_nueva",
      "proveedor_anterior",
      "proveedor_nuevo",
    ],
  },
  desactivar_obligacion: { entidad: "recurring_obligations", cambio: [] },
  configurar_colchon: { entidad: "cash_flow_settings", cambio: ["colchon_anterior", "colchon_nuevo"] },
  preferencia_correo_semanal: { entidad: "weekly_digest_preferences", cambio: ["activo"] },
  correo_semanal: { entidad: "weekly_digest_sends", cambio: ["estado", "destinatarios", "codigo"] },
  // Una fila por persona que ya recibió el correo de la semana; sin correo ni nombre.
  correo_semanal_entregado: { entidad: "weekly_digest_deliveries", cambio: [] },
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
  // Cobranza (0031). La CLABE viaja enmascarada; nunca correos, nombres ni la referencia del pagador.
  configurar_cobranza: {
    entidad: "collection_settings",
    cambio: ["clabe_anterior", "clabe_nueva", "beneficiario_cambio", "contacto", "calendario"],
  },
  alta_cliente_cobranza: { entidad: "collection_customers", cambio: ["correos", "con_rfc"] },
  editar_cliente_cobranza: { entidad: "collection_customers", cambio: ["campos"] },
  archivar_cliente_cobranza: { entidad: "collection_customers", cambio: [] },
  recordatorios_cliente_cobranza: { entidad: "collection_customers", cambio: ["activos", "por"] },
  alta_plan_cobranza: {
    entidad: "collection_plans",
    cambio: ["tipo", "periodicidad", "monto_centavos", "primer_vencimiento", "fin"],
  },
  editar_plan_cobranza: {
    entidad: "collection_plans",
    cambio: ["concepto_cambio", "monto_anterior", "monto_nuevo", "fin_anterior", "fin_nuevo"],
  },
  pausar_plan_cobranza: { entidad: "collection_plans", cambio: [] },
  reanudar_plan_cobranza: { entidad: "collection_plans", cambio: ["reanudado_el"] },
  cancelar_plan_cobranza: { entidad: "collection_plans", cambio: [] },
  generar_cargo: { entidad: "collection_charges", cambio: ["periodo", "vencimiento", "monto_centavos", "estado"] },
  emitir_cargo: { entidad: "collection_charges", cambio: ["monto_centavos"] },
  cancelar_cargo: { entidad: "collection_charges", cambio: [] },
  abono_cargo: { entidad: "collection_charges", cambio: ["pagado_centavos", "estado"] },
  registrar_pago_cobranza: {
    entidad: "collection_payments",
    cambio: ["fuente", "monto_centavos", "recibido_el", "regla", "posible_duplicado", "con_comprobante"],
  },
  saldo_pago_cobranza: { entidad: "collection_payments", cambio: ["aplicado_centavos", "estado"] },
  anular_pago_cobranza: { entidad: "collection_payments", cambio: [] },
  aplicacion_cobranza: { entidad: "collection_applications", cambio: ["monto_centavos", "regla"] },
  correo_cobranza: { entidad: "collection_emails", cambio: ["tipo", "estado", "destinatarios", "codigo"] },
  correo_cobranza_entregado: { entidad: "collection_email_deliveries", cambio: [] },
  cuenta_proveedor_cobranza: { entidad: "collection_provider_accounts", cambio: ["proveedor", "cuenta"] },
  clabe_cliente_cobranza: { entidad: "collection_virtual_accounts", cambio: ["proveedor", "terminacion", "recuperada"] },
  aviso_proveedor_cobranza: { entidad: "collection_provider_events", cambio: ["proveedor", "repetido"] },
  empate_estado_cuenta: { entidad: "collection_statement_mappings", cambio: ["banco", "fila_encabezado"] },
  importar_estado_cuenta: { entidad: "collection_statement_imports", cambio: ["banco", "renglones", "abonos", "nuevos"] },
  confirmar_estado_cuenta: { entidad: "collection_statement_imports", cambio: ["aplicados", "por_conciliar", "ya_registrados", "descartados"] },
  renglon_estado_cuenta: { entidad: "collection_statement_rows", cambio: ["estado"] },
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
