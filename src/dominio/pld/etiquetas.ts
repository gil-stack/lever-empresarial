/** Textos de producto de PLD. Veraces y sin jerga: dicen qué pasó y qué disposición lo pide. */

export const REGLAS = ["excede_perfil", "monto_atipico", "fraccionamiento", "nomina_atipica", "aviso_manual"] as const;
export type Regla = (typeof REGLAS)[number];

export const REGLA: Record<Regla, { titulo: string; explicacion: string }> = {
  excede_perfil: {
    titulo: "Excede el perfil",
    explicacion:
      "La suma de instrucciones del mes (hora de la Ciudad de México), de este tipo, supera el monto máximo mensual que la empresa declaró. Incluye instrucciones canceladas.",
  },
  monto_atipico: {
    titulo: "Monto atípico",
    explicacion: "La instrucción supera varias veces la mediana de las de la empresa en los últimos 6 meses.",
  },
  fraccionamiento: {
    titulo: "Fraccionamiento",
    explicacion:
      "Varias instrucciones a la misma CLABE en pocos días, cada una por debajo del umbral, juntas lo superan. Incluye instrucciones canceladas.",
  },
  nomina_atipica: {
    titulo: "Nómina atípica",
    explicacion: "El lote supera el monto mensual de nómina declarado o su número de personas sube contra el promedio.",
  },
  aviso_manual: {
    titulo: "Aviso del personal",
    explicacion: "Una persona del personal avisó al área de Cumplimiento de una posible operación inusual o interna preocupante.",
  },
};

export const PROPUESTAS = ["reportar_inusual", "reportar_interna", "no_reportar"] as const;
export type Propuesta = (typeof PROPUESTAS)[number];

export const PROPUESTA: Record<Propuesta, string> = {
  reportar_inusual: "Reportar como operación inusual",
  reportar_interna: "Reportar como operación interna preocupante",
  no_reportar: "No reportar",
};

export const TIPOS_AVISO = ["posible_inusual", "posible_interna_preocupante"] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];

export const TIPO_AVISO: Record<TipoAviso, string> = {
  posible_inusual: "Posible operación inusual de un cliente",
  posible_interna_preocupante: "Posible conducta preocupante de alguien de la SOFIPO",
};

export const OPERACION: Record<"pago_proveedor" | "nomina", string> = {
  pago_proveedor: "Pagos a proveedores",
  nomina: "Nómina",
};

export const CARGOS_COMITE = ["PRESIDENTE", "SECRETARIO", "INTEGRANTE"] as const;
export type CargoComite = (typeof CARGOS_COMITE)[number];

export const CARGO_COMITE: Record<CargoComite, string> = {
  PRESIDENTE: "Presidente",
  SECRETARIO: "Secretario",
  INTEGRANTE: "Integrante",
};

/**
 * Área y cargo en la entidad para el SITI (instructivo de la CNBV, Apéndice A: «letras mayúsculas, sin acentos y
 * sin abreviaturas»). Solo en la salida para el SITI; en pantalla se ven como se capturaron (r2-base-N15). Como en
 * los nombres, la Ñ se conserva: es letra, no acento.
 */
export function textoParaSiti(valor: string): string {
  return valor.normalize("NFD").replace(/(?!\u0303)[\u0300-\u036f]/g, "").normalize("NFC").toLocaleUpperCase("es-MX");
}

/** Nombres para el layout del Comité: mayúsculas y sin acentos (instructivo de la CNBV, Apéndice A). */
export function nombreParaSiti(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/(?!̃)[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLocaleUpperCase("es-MX")
    .replace(/[^A-ZÑ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
