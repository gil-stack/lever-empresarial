import { ErrorDeDominio } from "./error-de-dominio";

export type Consulta = {
  query: (
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: unknown[]; rowCount: number }>;
};

type ResultadoPg = { rows: unknown[]; rowCount: number | null };

type ClientePg = {
  query: (sql: string, params?: unknown[]) => Promise<ResultadoPg>;
  release: () => void;
};

type PoolPg = {
  connect: () => Promise<ClientePg>;
  query: (sql: string, params?: unknown[]) => Promise<ResultadoPg>;
  end: () => Promise<void>;
  on: (evento: "error", fn: () => void) => void;
};

type OpcionesPool = {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  query_timeout: number;
  statement_timeout: number;
  idle_in_transaction_session_timeout: number;
  allowExitOnIdle: boolean;
  application_name: string;
  ssl?: { rejectUnauthorized: boolean };
};

type ConstructorPool = new (opciones: OpcionesPool) => PoolPg;

let pool: PoolPg | null = null;
let pendiente: Promise<PoolPg> | null = null;
let iniciada = false;
let epoca = 0;

/** Suelta el pool. La prueba de aislamiento lo usa antes de borrar su base. */
export async function cerrarConexion(): Promise<void> {
  epoca += 1;
  const actual = pool;
  const espera = pendiente;
  pool = null;
  pendiente = null;
  iniciada = false;
  const abiertos = new Set<PoolPg>();
  if (actual) abiertos.add(actual);
  if (espera) {
    try {
      abiertos.add(await espera);
    } catch {
      // La creación falló o ya cerró el pool al ver el cambio de época.
    }
  }
  for (const abierto of abiertos) {
    try {
      await abierto.end();
    } catch {
      // El driver puede citar la conexión. No se publica.
    }
  }
}

export function conexionIniciada(): boolean {
  return iniciada;
}

/** Rol de base al que baja cada transacción. Ninguno es dueño de las tablas ni salta RLS. */
export const ROLES_DE_BASE = ["plataforma_cliente", "plataforma_sofipo"] as const;
export type RolDeBase = (typeof ROLES_DE_BASE)[number];

/** Lo que Postgres sabe de la petición. Las políticas de RLS leen estas tres variables. */
export type ContextoDeBase = {
  rol: RolDeBase;
  companyId?: string | null;
  userId?: string | null;
  operadorId?: string | null;
};

const UUID_DE_CONTEXTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Toda consulta de negocio pasa por aquí. Abre una transacción explícita,
 * baja al rol de base y fija el contexto con set_config local: Neon agrupa
 * conexiones en modo transacción y un ajuste de sesión pasaría a otra petición.
 */
export async function conContexto<T>(
  base: ContextoDeBase,
  fn: (consulta: Consulta) => Promise<T>,
): Promise<T> {
  if (!(ROLES_DE_BASE as readonly string[]).includes(base.rol)) throw new ErrorDeDominio("base_no_disponible");
  const companyId = valorDeContexto(base.companyId);
  const userId = valorDeContexto(base.userId);
  const operadorId = valorDeContexto(base.operadorId);
  return conTransaccion(async (consulta) => {
    if (base.rol === "plataforma_sofipo") await consulta.query("set local role plataforma_sofipo");
    else await consulta.query("set local role plataforma_cliente");
    await consulta.query(
      "select set_config('app.company_id', $1, true), set_config('app.user_id', $2, true), set_config('app.operator_id', $3, true)",
      [companyId, userId, operadorId],
    );
    return fn(consulta);
  });
}

/**
 * Solo para una tarea programada que ya se autenticó (el cron con CRON_SECRET):
 * baja a plataforma_tarea, sin empresa ni persona en el contexto. Ese rol no lee
 * tablas; solo ejecuta las funciones que 0026 le otorga.
 */
export async function comoTarea<T>(fn: (consulta: Consulta) => Promise<T>): Promise<T> {
  return conTransaccion(async (consulta) => {
    await consulta.query("set local role plataforma_tarea");
    return fn(consulta);
  });
}

/**
 * Serializa las escrituras de una empresa dentro de la transacción. Un candado
 * consultivo no pide permiso de escribir la fila de la empresa, que el rol
 * cliente no tiene. Falla si la empresa no es visible en el contexto.
 */
export async function bloquearEmpresa(consulta: Consulta, companyId: string): Promise<void> {
  const visible = await consulta.query("select id from companies where id = $1", [companyId]);
  if (visible.rows.length !== 1) throw new ErrorDeDominio("sin_empresa");
  await consulta.query("select pg_advisory_xact_lock(hashtextextended($1::text, 814272))", [companyId]);
}

function valorDeContexto(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  if (!UUID_DE_CONTEXTO.test(valor)) throw new ErrorDeDominio("base_no_disponible");
  return valor;
}

async function conTransaccion<T>(fn: (consulta: Consulta) => Promise<T>): Promise<T> {
  const cliente = await conectar();
  const consulta = comoConsulta(cliente);
  try {
    await consulta.query("begin");
    const resultado = await fn(consulta);
    await consulta.query("commit");
    return resultado;
  } catch (error) {
    try {
      await consulta.query("rollback");
    } catch {
      // El fallo del rollback puede citar la conexión. No se registra.
    }
    throw traducirErrorDeBase(error);
  } finally {
    try {
      cliente.release();
    } catch {
      // Igual que el rollback: se descarta para no publicar la conexión.
    }
  }
}

export function traducirErrorDeBase(error: unknown): Error {
  if (error instanceof ErrorDeDominio) return error;
  const codigo = campo(error, "code");
  const marca = `${campo(error, "constraint")} ${campo(error, "table")}`.toLowerCase();
  if (codigo === "42501") return new ErrorDeDominio("sin_permiso");
  if (codigo === "23505") {
    // Alta regulada: un doble envío concurrente. Otro formulario sobre lo mismo dice su motivo;
    // el mismo formulario (llave primaria repetida) se repite una vez y sale como el primero.
    if (marca.includes("kyb_versiones_un_borrador")) return new ErrorDeDominio("expediente_con_borrador");
    if (marca.includes("kyb_dictamenes_una_por_version")) return new ErrorDeDominio("dictamen_ya_registrado");
    if (marca.includes("company_suspensions_una_pendiente")) return new ErrorDeDominio("suspension_pendiente");
    if (marca.includes("company_commissions_una_pendiente")) return new ErrorDeDominio("comision_pendiente");
    if (marca.includes("lpb_cargas_archivo_unico")) return new ErrorDeDominio("lpb_ya_cargada");
    if (FORMULARIOS_REGULADOS.test(marca)) return new ErrorDeDominio("formulario_ya_aplicado");
    if (marca.includes("auth_passkeys")) return new ErrorDeDominio("passkey_duplicada");
    if (marca.includes("auth_totp")) return new ErrorDeDominio("totp_duplicado");
    if (marca.includes("auth_recuperaciones")) return new ErrorDeDominio("recuperacion_abierta");
    if (marca.includes("auth_codigos")) return new ErrorDeDominio("respaldo_duplicado");
    if (marca.includes("auth_retos")) return new ErrorDeDominio("reto_duplicado");
    if (marca.includes("auth_entradas")) return new ErrorDeDominio("entrada_duplicada");
    if (marca.includes("suppliers_rfc")) return new ErrorDeDominio("proveedor_duplicado");
    if (marca.includes("rfc")) return new ErrorDeDominio("rfc_duplicado");
    if (marca.includes("correo")) return new ErrorDeDominio("correo_duplicado");
    if (marca.includes("token_hash")) return new ErrorDeDominio("sesion_duplicada");
    if (marca.includes("membership")) return new ErrorDeDominio("membresia_existente");
    if (marca.includes("platform_staff")) return new ErrorDeDominio("personal_existente");
    if (marca.includes("cost_centers_nombre")) return new ErrorDeDominio("centro_duplicado");
    if (marca.includes("employees_un_usuario")) return new ErrorDeDominio("persona_repetida");
    if (marca.includes("policy_categories")) return new ErrorDeDominio("categoria_duplicada");
    if (marca.includes("supplier_clabes_una_vigente")) return new ErrorDeDominio("clabe_ya_vigente");
    if (marca.includes("supplier_payables_cfdi")) return new ErrorDeDominio("cfdi_duplicado");
    if (marca.includes("supplier_payment_requests_idempotencia")) return new ErrorDeDominio("idempotencia_pago_duplicada");
    if (marca.includes("expected_collections_cfdi")) return new ErrorDeDominio("cobro_duplicado");
    if (marca.includes("lista_69b")) return new ErrorDeDominio("listado_irreconocible");
    if (marca.includes("polic") || marca.includes("drawer") || marca.includes("posting")) {
      return new ErrorDeDominio("politica_invalida");
    }
  }
  if (codigo === "23503" && marca.includes("policy_persons")) {
    return new ErrorDeDominio("persona_ajena");
  }
  if (codigo === "23503" && (marca.includes("suppliers_area") || marca.includes("recurring_obligations_area"))) {
    return new ErrorDeDominio("area_ajena");
  }
  if (codigo === "23514") {
    // El servidor valida esos motivos antes y como la base (motivoEscrito: cuenta caracteres y los guarda
    // en un renglón); si aun así la base los rechaza, se avisa del mínimo del motivo, no «la base no respondió».
    if (/company_suspensions_textos|lpb_coincidencias_textos|kyb_dictamenes_motivo/.test(marca)) return new ErrorDeDominio("motivo_corto");
    // La bitácora admite un motivo de hasta 500 caracteres, recortado y sin controles; el servidor ya lo limpia y
    // `auditarOperacion` revisa el largo antes. Esto es la red: se avisa en el campo, no «la base no respondió».
    if (marca.includes("audit_log_motivo_formato")) return new ErrorDeDominio("motivo_largo");
    // Enviar una versión sin todos los datos generales: el servidor lo revisa antes; esto es la red.
    if (marca.includes("kyb_versiones_forma")) return new ErrorDeDominio("expediente_datos_incompletos");
    if (marca.includes("lista_69b")) return new ErrorDeDominio("listado_irreconocible");
    if (marca.includes("clabe")) return new ErrorDeDominio("clabe_invalida");
    if (marca.includes("baja")) return new ErrorDeDominio("baja_anterior");
    if (marca.includes("polic") || marca.includes("drawer") || marca.includes("posting")) {
      return new ErrorDeDominio("politica_invalida");
    }
  }
  if (campo(error, "code") === "P0001" || codigo === "23514") {
    const mensaje = campo(error, "message");
    const dePrecio = FRASES_DE_PRECIO[mensaje];
    if (dePrecio) return new ErrorDeDominio(dePrecio);
    if (CODIGOS_DE_FIRMA.has(mensaje)) return new ErrorDeDominio(mensaje);
    if (CODIGOS_DE_AUTENTICACION.has(mensaje)) return new ErrorDeDominio(mensaje);
    if (CODIGOS_DE_CLABE.has(mensaje)) return new ErrorDeDominio(mensaje);
    const dePersonas = FRASES_DE_PERSONAS[mensaje.trim()];
    if (dePersonas) return new ErrorDeDominio(dePersonas);
    if (CODIGOS_DE_TENENCIA.has(mensaje)) return new ErrorDeDominio(mensaje);
    if (CODIGOS_DE_ALTA_REGULADA.has(mensaje)) return new ErrorDeDominio(mensaje);
    const deProveedor = FRASES_DE_PROVEEDOR[mensaje.trim()];
    if (deProveedor) return new ErrorDeDominio(deProveedor);
    const deFlujo = FRASES_DE_FLUJO[mensaje.trim()];
    if (deFlujo) return new ErrorDeDominio(deFlujo);
    const deCobranza = FRASES_DE_COBRANZA[mensaje.trim()];
    if (deCobranza) return new ErrorDeDominio(deCobranza);
    if (FRASES_DE_AUDITORIA.has(mensaje)) return new ErrorDeDominio("auditoria_no_disponible");
  }
  if (codigo === "23514" && marca.includes("lotes_prueba_dos_firmas")) {
    return new ErrorDeDominio("misma_persona_en_las_dos_firmas");
  }
  if (codigo === "23514" && marca.includes("lotes_prueba_es_prueba")) {
    return new ErrorDeDominio("dinero_real_fuera");
  }
  registrarErrorSinTraducir(error, codigo);
  return new ErrorDeDominio("base_no_disponible");
}

// pg-pool y pg no ponen código a la espera agotada de una conexión; se reconoce
// por su frase fija. Solo se registra la clase, nunca el texto.
const FRASES_DE_ESPERA = ["timeout exceeded when trying to connect", "connection terminated due to connection timeout"];
const CODIGO_DE_RAISE = /^[a-z_]{1,64}$/;
// rechazarAuditoria (bitacora/material.ts) lanza un Error simple con este prefijo.
const AUDITORIA_RECHAZADA = "auditoría rechazada: ";

/**
 * Deja rastro de lo que llegó como «base_no_disponible»: el SQLSTATE o el código
 * de red, la restricción, la tabla y la rutina. No guarda el mensaje crudo ni los
 * parámetros, que pueden traer datos de personas. La única excepción es el texto
 * de un RAISE de la base cuando tiene forma de código (`sesion_sin_auditoria`),
 * y el código de una auditoría que la aplicación rechazó antes de escribir
 * (`evento_con_secreto`).
 */
function registrarErrorSinTraducir(error: unknown, codigo: string): void {
  const mensaje = error instanceof Error ? error.message.trim().toLowerCase() : "";
  const deAuditoria = mensaje.startsWith(AUDITORIA_RECHAZADA) ? mensaje.slice(AUDITORIA_RECHAZADA.length) : null;
  const clase =
    deAuditoria !== null
      ? "auditoria_rechazada"
      : FRASES_DE_ESPERA.some((frase) => mensaje.includes(frase))
        ? "espera_de_conexion_agotada"
        : /^[0-9A-Z]{5}$/.test(codigo)
          ? "postgres"
          : codigo
            ? "red"
            : "desconocida";
  const raise = deAuditoria ?? (codigo === "P0001" ? mensaje : "");
  console.error(
    JSON.stringify({
      nivel: "error",
      origen: "nucleo.db",
      evento: "error_de_base_sin_traducir",
      clase,
      codigo: codigo || null,
      restriccion: campo(error, "constraint") || null,
      tabla: campo(error, "table") || null,
      rutina: campo(error, "routine") || null,
      raise: CODIGO_DE_RAISE.test(raise) ? raise : null,
    }),
  );
}

/** Llave primaria de las tablas reguladas: su id es el del formulario que la crea. */
const FORMULARIOS_REGULADOS =
  /^(kyb_versiones|kyb_documentos|kyb_representantes|kyb_accionistas|kyb_dictamenes|kyb_calificaciones_riesgo|lpb_cargas|company_suspensions)_pkey /;

/** Reglas de la alta regulada (0028): roles, expediente, riesgo, lista de bloqueados, suspensión y candado. */
const CODIGOS_DE_ALTA_REGULADA = new Set([
  "empresa_nace_prospecto",
  "sin_rol_de_administracion",
  "personal_propio",
  "personal_no_se_reescribe",
  "expediente_con_borrador",
  "expediente_accionista_sin_curp",
  "expediente_accionista_sin_identificacion",
  "expediente_misma_persona_dos_identificadores",
  "expediente_accionista_sin_rfc",
  "expediente_estructura_muy_profunda",
  "rol_propio",
  "roles_incompatibles",
  "sin_permiso_roles",
  "sin_rol_para_expediente",
  "sin_rol_para_dictaminar",
  "sin_rol_para_calificar",
  "sin_rol_para_lpb",
  "sin_rol_para_suspender",
  "sin_rol_para_aprobar",
  "sin_rol_para_solicitar_activacion",
  "sin_rol_para_registrar",
  "expediente_en_revision",
  "expediente_enviado_inmutable",
  "expediente_rfc_distinto",
  "expediente_sin_representante",
  "expediente_sin_administrador",
  "expediente_falta_documento",
  "expediente_documento_vencido",
  "expediente_estructura_incompleta",
  "documento_fecha_futura",
  "documento_sin_representante",
  "accionista_padre_invalido",
  "accionista_con_desglose",
  "misma_persona_en_dictamen",
  "dictamen_sobre_borrador",
  "calificacion_sobre_version_vieja",
  "calificacion_fecha_invalida",
  "riesgo_debe_ser_alto",
  "coincidencia_transicion_invalida",
  "coincidencia_sigue_en_lista",
  "reporte_ya_registrado",
  "reporte_fecha_futura",
  "suspension_no_aplica",
  "reactivacion_no_aplica",
  "reactivacion_con_coincidencia_lpb",
  "misma_persona_en_suspension",
  "suspension_transicion_invalida",
  "activacion_sin_expediente_aprobado",
  "activacion_con_documento_vencido",
  "activacion_con_coincidencia_lpb",
  "activacion_sin_riesgo_vigente",
  "activacion_sin_estructura_corporativa",
  "empresa_suspendida",
  "pago_bloqueado_lpb",
  "nomina_bloqueada_lpb",
  "sin_permiso_expediente",
  "documento_no_existe",
  "cliente_de_baja",
]);

const CODIGOS_DE_CLABE = new Set([
  "clabe_no_se_pisa",
  "clabe_ya_cerrada",
  "historial_de_clabe_no_se_borra",
  "auditoria_de_clabe_ausente",
]);

/** Reglas de Personas y nómina (0023). Cada una con su propio mensaje en pantalla. */
const FRASES_DE_PERSONAS: Readonly<Record<string, string>> = {
  fecha_ya_preparada: "fecha_ya_preparada",
  sin_permiso_para_preparar_nomina: "sin_permiso",
  empresa_de_otra_cuenta: "sin_permiso",
  sin_permiso: "sin_permiso",
  total_de_lote_no_coincide: "lote_inconsistente",
  lote_de_nomina_vacio: "lote_inconsistente",
  lote_de_nomina_inmutable: "lote_inmutable",
  persona_identidad_inmutable: "persona_identidad_inmutable",
  baja_no_efectiva: "baja_no_efectiva",
  area_empresa_inmutable: "centro_invalido",
  clabe_nomina_sin_historial: "auditoria_no_disponible",
  auditoria_de_edicion_persona_ausente: "auditoria_no_disponible",
  auditoria_de_clabe_nomina_ausente: "auditoria_no_disponible",
  auditoria_de_area_ausente: "auditoria_no_disponible",
  auditoria_de_nomina_ausente: "auditoria_no_disponible",
  auditoria_de_tarjeta_ausente: "auditoria_no_disponible",
  auditoria_de_lote_nomina_ausente: "auditoria_no_disponible",
  auditoria_de_baja_ausente: "auditoria_no_disponible",
  auditoria_de_persona_ausente: "auditoria_no_disponible",
};

const CODIGOS_DE_TENENCIA = new Set([
  "invitacion_cerrada",
  "invitacion_vencida",
  "invitacion_no_se_borra",
]);

const FRASES_DE_AUDITORIA = new Set([
  "auditoria_de_rol_ausente",
  "auditoria_de_lista_ausente",
  "audit_log solo acepta inserciones",
  "regulado_sin_auditoria",
  "rol_personal_sin_auditoria",
]);

const FRASES_DE_PROVEEDOR: Readonly<Record<string, string>> = {
  auditoria_de_proveedor_ausente: "auditoria_no_disponible",
  constancia_ajena: "archivo_no_disponible",
  constancia_sin_proveedor: "archivo_no_disponible",
  proveedor_sin_clabe: "clabe_invalida",
  clabe_no_se_reescribe: "clabe_invalida",
  clabe_de_otra_empresa: "proveedor_ausente",
  rfc_de_proveedor_fijo: "proveedor_duplicado",
  pago_con_rfc_publicado: "listado_irreconocible",
  fecha_de_lista_distinta: "listado_irreconocible",
  situacion_distinta_de_la_copia: "listado_irreconocible",
  lectura_sin_copia: "listado_irreconocible",
  copia_69b_ausente: "listado_irreconocible",
  copia_69b_sin_filas: "listado_irreconocible",
  constancia_no_se_reescribe: "archivo_no_disponible",
  pago_proveedor_no_autorizable: "pago_no_autorizable",
  pago_proveedor_transicion_invalida: "pago_no_autorizable",
  pago_proveedor_inmutable: "pago_no_autorizable",
  pago_proveedor_no_se_borra: "pago_no_autorizable",
  cargo_proveedor_no_editable: "pago_no_autorizable",
  cargo_proveedor_inmutable: "pago_no_autorizable",
  cargo_proveedor_no_se_borra: "pago_no_autorizable",
  cargo_cfdi_inmutable: "cfdi_inmutable",
  cargo_sin_evidencia_nueva: "evidencia_requerida",
  pago_proveedor_regreso_sin_causa: "pago_no_autorizable",
  historial_pago_inmutable: "pago_no_autorizable",
  cancelacion_no_permitida: "cancelacion_no_permitida",
  documento_relacionado_inmutable: "archivo_no_disponible",
  auditoria_pago_proveedor_ausente: "auditoria_no_disponible",
};

/** Flujo de caja (0026). */
const FRASES_DE_FLUJO: Readonly<Record<string, string>> = {
  sin_permiso_para_flujo: "sin_permiso",
  saldo_declarado_no_se_pisa: "saldo_inmutable",
  saldo_con_fecha_futura: "fecha_futura",
  cobro_no_se_borra: "cobro_invalido",
  cobro_no_valido: "cobro_invalido",
  cobro_inmutable: "cobro_invalido",
  cobro_ya_resuelto: "cobro_ya_resuelto",
  cobro_con_fecha_futura: "fecha_futura",
  obligacion_no_se_borra: "obligacion_invalida",
  obligacion_no_valida: "obligacion_invalida",
  obligacion_inmutable: "obligacion_invalida",
  obligacion_inactiva: "obligacion_inactiva",
  configuracion_no_se_borra: "sin_permiso",
  configuracion_inmutable: "sin_permiso",
  preferencia_no_se_borra: "sin_permiso",
  envio_no_se_borra: "envio_cerrado",
  envio_solo_del_sistema: "sin_permiso",
  envio_no_valido: "envio_cerrado",
  envio_ya_cerrado: "envio_cerrado",
  auditoria_de_flujo_ausente: "auditoria_no_disponible",
  auditoria_de_area_proveedor_ausente: "auditoria_no_disponible",
};

/** Cobranza (0031). */
const FRASES_DE_COBRANZA: Readonly<Record<string, string>> = {
  sin_permiso_para_cobranza: "sin_permiso",
  cobranza_inmutable: "cobranza_inmutable",
  cobranza_no_se_borra: "cobranza_inmutable",
  cliente_archivado: "cliente_archivado",
  cliente_no_valido: "cliente_no_valido",
  plan_cancelado: "plan_cancelado",
  plan_no_valido: "plan_no_valido",
  cargo_no_valido: "cargo_no_valido",
  cargo_ya_resuelto: "cargo_ya_resuelto",
  pago_no_valido: "pago_no_valido",
  pago_anulado: "pago_anulado",
  aplicacion_no_valida: "aplicacion_no_valida",
  aplicacion_no_se_reescribe: "aplicacion_no_valida",
  cobranza_aplicado_no_cuadra: "aplicacion_no_valida",
  cobranza_pagado_no_cuadra: "aplicacion_no_valida",
  correo_no_valido: "correo_cerrado",
  correo_ya_cerrado: "correo_cerrado",
  entrega_no_se_reescribe: "correo_cerrado",
  importacion_ya_confirmada: "importacion_ya_confirmada",
  renglon_ya_resuelto: "renglon_ya_resuelto",
  auditoria_de_cobranza_ausente: "auditoria_no_disponible",
};

const CODIGOS_DE_AUTENTICACION = new Set([
  "entrada_no_se_borra",
  "entrada_no_se_reescribe",
  "entrada_ya_consumida",
  "sesion_no_se_reescribe",
  "sesion_sin_segundo_factor",
  "passkey_no_se_borra",
  "passkey_no_se_reescribe",
  "passkey_revocada",
  "passkey_contador_atras",
  "totp_no_se_borra",
  "totp_no_se_reescribe",
  "totp_revocado",
  "totp_codigo_repetido",
  "respaldo_no_se_borra",
  "respaldo_no_se_reescribe",
  "respaldo_ya_usado",
  "recuperacion_no_se_borra",
  "recuperacion_no_se_reescribe",
  "recuperacion_transicion_invalida",
  "recuperacion_sin_auditoria",
  "recuperacion_con_factores_vigentes",
  "factor_sin_auditoria",
]);

const CODIGOS_DE_FIRMA = new Set([
  "misma_persona_en_las_dos_firmas",
  "dinero_real_fuera",
  "firma_en_un_solo_acto",
  "firmante_ajeno",
  "contador_no_libera",
  "sin_permiso_para_liberar",
  "empresa_no_operable",
  "contador_no_crea_pago",
  "sin_permiso_para_solicitar",
  "lote_ya_firmado",
  "entrada_invalida",
]);

const FRASES_DE_PRECIO: Readonly<Record<string, string>> = {
  "el monto de la suscripcion ya esta publicado": "precio_ya_publicado",
  "la suscripcion no pasa a aceptada sin monto publicado": "precio_no_publicado",
  "la suscripcion aceptada no regresa a recorrido": "suscripcion_ya_aceptada",
  "la suscripcion nace en recorrido": "suscripcion_invalida",
  "platform_pricing no se borra": "precio_protegido",
  "platform_pricing es una sola fila": "precio_protegido",
  "la suscripcion no se borra": "suscripcion_protegida",
  "el recorrido no se reescribe": "suscripcion_protegida",
  "la aceptacion no trae quien ni cuando": "suscripcion_invalida",
};

/** Única entrega de un texto SQL al driver. El resto del servidor no arma la sentencia en el llamador. */
export function aplicarSentencia(consulta: Consulta, sentencia: string, params: readonly unknown[] = []) {
  return consulta.query(sentencia, params);
}

function comoConsulta(cliente: ClientePg): Consulta {
  return {
    query: async (sql, params = []) => {
      const resultado = await cliente.query(sql, [...params]);
      return { rows: resultado.rows, rowCount: resultado.rowCount ?? 0 };
    },
  };
}

async function conectar(): Promise<ClientePg> {
  try {
    const actual = await obtenerPool();
    return await actual.connect();
  } catch (error) {
    throw traducirErrorDeBase(error);
  }
}

function obtenerPool(): Promise<PoolPg> {
  if (pool) return Promise.resolve(pool);
  if (!pendiente) {
    const marca = epoca;
    pendiente = crearPool().then(
      (creado) => {
        if (marca !== epoca) {
          void creado.end().catch(() => undefined);
          throw new ErrorDeDominio("base_no_disponible");
        }
        pool = creado;
        iniciada = true;
        return creado;
      },
      (error) => {
        if (marca === epoca) pendiente = null;
        throw error;
      },
    );
  }
  return pendiente;
}

async function crearPool(): Promise<PoolPg> {
  const connectionString = leerConnectionString();
  try {
    const modulo = (await import("pg")) as { Pool?: ConstructorPool; default?: { Pool?: ConstructorPool } };
    const Pool = modulo.Pool ?? modulo.default?.Pool;
    if (!Pool) throw new ErrorDeDominio("base_no_disponible");
    const creado = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 10_000,
      allowExitOnIdle: true,
      application_name: "plataforma",
      ssl: esLocal(connectionString) ? undefined : { rejectUnauthorized: true },
    });
    creado.on("error", () => {
      // El driver puede adjuntar el connection string. No se registra.
    });
    await afirmarRolDeAplicacion(creado);
    return creado;
  } catch (error) {
    throw traducirErrorDeBase(error);
  }
}

async function afirmarRolDeAplicacion(creado: PoolPg): Promise<void> {
  const cliente = await creado.connect();
  try {
    const resultado = await cliente.query(
      `select r.rolsuper as super,
              r.rolbypassrls as salta,
              (
                select count(*)::int
                from pg_class as c
                join pg_namespace as n on n.oid = c.relnamespace
                where n.nspname = 'public'
                  and c.relkind = 'r'
                  and c.relname <> 'schema_migrations'
                  and c.relowner = r.oid
              ) as tablas
       from pg_roles as r
       where r.rolname = current_user`,
    );
    const fila = resultado.rows[0] as { super?: boolean; salta?: boolean; tablas?: number } | undefined;
    if (!fila || fila.super === true || fila.salta === true || Number(fila.tablas) > 0) {
      throw new ErrorDeDominio("conexion_duena");
    }
  } catch (error) {
    try {
      cliente.release();
    } catch {
      // Se cierra el pool abajo.
    }
    try {
      await creado.end();
    } catch {
      // El driver puede citar la conexión.
    }
    if (error instanceof ErrorDeDominio) throw error;
    throw new ErrorDeDominio("conexion_duena");
  }
  cliente.release();
}

function leerConnectionString(): string {
  const valor = process.env.DATABASE_URL;
  if (typeof valor !== "string" || valor.length === 0) {
    throw new ErrorDeDominio("base_no_configurada");
  }
  if (!valor.startsWith("postgres://") && !valor.startsWith("postgresql://")) {
    throw new ErrorDeDominio("base_no_configurada");
  }
  return valor;
}

function esLocal(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function campo(error: unknown, nombre: string): string {
  if (typeof error !== "object" || error === null || !(nombre in error)) return "";
  const valor = (error as Record<string, unknown>)[nombre];
  return typeof valor === "string" ? valor : "";
}
