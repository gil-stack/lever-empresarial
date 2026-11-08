import { CONTROL } from "../../dominio/control";
import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

/**
 * Los rechazos de la 0030 con su propio mensaje en pantalla. El núcleo (db.ts)
 * no los conoce: se traducen aquí, dentro de la transacción, antes de que el
 * núcleo los convierta en «base_no_disponible».
 */
export const CODIGOS_PLD = new Set([
  "cliente_ausente",
  "cliente_de_baja",
  "motivo_invalido",
  "sin_rol_para_perfil",
  "sin_rol_para_evaluar",
  "evaluacion_sobre_perfil_viejo",
  "evaluacion_sin_perfil_nuevo",
  "evaluacion_sobre_grado_viejo",
  "sin_rol_para_parametros",
  "sin_permiso_para_avisar",
  "aviso_no_existe",
  "exclusion_fuera_del_aviso",
  "exclusion_propia",
  "exclusion_fuera_del_personal",
  "sin_rol_para_analizar",
  "caso_sin_alertas",
  "caso_no_existe",
  "caso_ya_dictaminado",
  "alerta_no_existe",
  "serie_de_otra_empresa",
  "sin_rol_para_comite",
  "oficial_sin_rol_de_cumplimiento",
  "comite_fecha_futura",
  "comite_suplente_sin_titular",
  "comite_integrante_no_existe",
  "comite_sustitucion_antes_de_designacion",
  "comite_presidente_unico",
  "comite_secretario_unico",
  "comite_minimo_tres_titulares",
  "comite_un_suplente_por_titular",
  "comite_sin_oficial",
  "sesion_fecha_futura",
  "modo_oficial_sin_sesiones",
  "sesion_presentes_invalidos",
  "sesion_auditor_invalido",
  "sesion_no_existe",
  "sesion_sin_quorum",
  "propuesta_no_vigente",
  "propuesta_posterior_a_la_sesion",
  "acuse_antes_del_dictamen",
  "periodo_sin_cerrar",
  "acuse_antes_del_cierre",
  "voto_de_ausente",
  "suplente_con_titular_presente",
  "acuse_fecha_futura",
  "comunicacion_cubre_ajenos",
  "sin_rol_para_dictaminar",
  "dictamen_en_otro_modo",
  "solo_el_oficial_dictamina",
  "dictamen_sin_votacion_aprobada",
  "reporte_sin_dictamen_de_reportar",
  "sin_rol_para_reportar",
  "sin_rol_para_pld",
  "documento_no_existe",
  "periodo_invalido",
  "pld_registro_inmutable",
  "conservacion_no_se_borra",
  "pld_sin_auditoria",
]);

/** Llaves únicas de la 0030 que no son el id del formulario: cada una dice qué ya existía. */
const UNICAS: Readonly<Record<string, string>> = {
  pld_caso_alertas_una_vez: "alerta_ya_en_caso",
  pld_dictamenes_uno_por_caso: "dictamen_pld_ya_registrado",
  pld_reportes_uno_por_caso: "reporte_pld_ya_registrado",
  pld_periodicos_unico: "periodico_ya_registrado",
  pld_votos_uno_por_miembro: "voto_ya_registrado",
  pld_actas_una_por_sesion: "acta_ya_cargada",
  pld_comite_comunicaciones_folio_unico: "folio_repetido",
  pld_aviso_excluidos_pkey: "exclusion_repetida",
  pld_comite_bajas_pkey: "comite_baja_ya_registrada",
  pld_casos_24h_pkey: "caso_ya_marcado_24h",
};

/** CHECK de la 0030 que corresponden a un campo del formulario. */
const CAMPOS: Readonly<Record<string, string>> = {
  pld_perfiles_montos: "dato_invalido_montos",
  pld_perfiles_operaciones: "dato_invalido_operaciones",
  pld_perfiles_motivo: "motivo_corto",
  pld_evaluaciones_justificacion: "motivo_corto",
  pld_parametros_valores: "dato_invalido_parametros",
  pld_parametros_motivo: "motivo_corto",
  pld_avisos_descripcion: "dato_invalido_descripcion",
  pld_casos_24h_motivo: "motivo_corto",
  pld_notas_texto: "dato_invalido_texto",
  pld_propuestas_justificacion: "motivo_corto",
  pld_modo_dictamen_motivo: "motivo_corto",
  pld_comite_integrantes_nombres: "dato_invalido_nombres",
  pld_comite_integrantes_rfc: "dato_invalido_rfc",
  pld_comite_integrantes_curp: "dato_invalido_curp",
  pld_comite_integrantes_area: "dato_invalido_area",
  pld_comite_integrantes_cargo_entidad: "dato_invalido_cargoEntidad",
  pld_comite_integrantes_certificado: "dato_invalido_certificado",
  pld_comite_bajas_motivo: "motivo_corto",
  pld_comite_comunicaciones_folio: "dato_invalido_folio",
  pld_dictamenes_justificacion: "motivo_corto",
  pld_reportes_folio: "dato_invalido_folio",
  pld_reportes_periodo: "dato_invalido_periodo",
  pld_reportes_registros: "dato_invalido_registros",
  pld_entidad_claves: "dato_invalido_claves",
  pld_periodicos_acuse: "dato_invalido_folio",
  pld_periodicos_registros: "dato_invalido_registros",
};

function campo(error: unknown, nombre: string): string {
  if (typeof error !== "object" || error === null || !(nombre in error)) return "";
  const valor = (error as Record<string, unknown>)[nombre];
  return typeof valor === "string" ? valor : "";
}

/** Traduce un rechazo de la base a su código de PLD; lo que no es de la 0030 sigue igual al núcleo. */
export function traducirPld(error: unknown): unknown {
  if (error instanceof ErrorDeDominio) return error;
  const codigo = campo(error, "code");
  const restriccion = campo(error, "constraint");
  const mensaje = campo(error, "message").trim();
  if (codigo === "P0001" && CODIGOS_PLD.has(mensaje)) return new ErrorDeDominio(mensaje);
  if (codigo === "23505") {
    const unica = UNICAS[restriccion];
    if (unica) return new ErrorDeDominio(unica);
    // El id es el del formulario: un doble envío repite la operación y sale como el primero.
    if (/^pld_[a-z0-9_]+_pkey$/.test(restriccion)) return new ErrorDeDominio("formulario_ya_aplicado");
  }
  if (codigo === "23514" && restriccion.startsWith("pld_")) return new ErrorDeDominio(CAMPOS[restriccion] ?? "dato_invalido");
  if (codigo === "42501") return new ErrorDeDominio("sin_permiso_operacion");
  return error;
}

function traductora(consulta: Consulta): Consulta {
  return {
    query: async (sql, params) => {
      try {
        return await consulta.query(sql, params);
      } catch (error) {
        throw traducirPld(error);
      }
    },
  };
}

/**
 * Una transacción de PLD como el personal del operador. Al final corre las reglas
 * diferidas de la 0030 (bitácora obligatoria, integración del Comité, caso con
 * alerta) dentro de la traducción, para que su rechazo llegue con su código.
 */
export async function conPld<T>(ctx: ContextoDePersonal, companyId: string | null, fn: (consulta: Consulta) => Promise<T>): Promise<T> {
  return conContexto(basePlataforma(ctx, companyId), async (cruda) => {
    const consulta = traductora(cruda);
    const resultado = await fn(consulta);
    await consulta.query("set constraints all immediate");
    return resultado;
  });
}

export function fecha(valor: unknown): Date {
  const salida = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(salida.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return salida;
}

export function fechaOpcional(valor: unknown): Date | null {
  return valor === null || valor === undefined ? null : fecha(valor);
}

/** Una fecha de calendario que la base devuelve como texto (`::text`). */
export function dia(valor: unknown): string {
  const texto = String(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) throw new ErrorDeDominio("base_no_disponible");
  return texto;
}

export function diaOpcional(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : dia(valor);
}

/**
 * Un identificador o una identidad (folio de un acuse del SITI, nombres del Comité y del auditor):
 * con un control invisible se rechaza con el error de su campo, no se limpia. Los textos libres
 * (aviso, notas, motivos) sí lo vuelven un espacio con `sinControles`.
 */
export function rechazarControl(valor: unknown, codigo: string): void {
  if (typeof valor === "string" && CONTROL.test(valor.trim())) throw new ErrorDeDominio(codigo);
}

export function textoONulo(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}
