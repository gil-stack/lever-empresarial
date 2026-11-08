import { formatoPesos } from "@/dominio/centavos";
import { OPERACION, TIPO_AVISO, type TipoAviso } from "@/dominio/pld";
import type { AlertaPld } from "@/server/pld";

const numero = (valor: unknown): number => (typeof valor === "number" ? valor : Number(valor ?? 0));
const pesos = (valor: unknown): string => formatoPesos(Math.round(numero(valor)));

/** Días naturales que quedan de un plazo, dichos sin ambigüedad. */
export function plazoEnDias(diasRestantes: number): string {
  if (diasRestantes < 0) return `Fuera de plazo: venció hace ${-diasRestantes} ${-diasRestantes === 1 ? "día" : "días"}`;
  if (diasRestantes === 0) return "Vence hoy";
  return `Quedan ${diasRestantes} ${diasRestantes === 1 ? "día" : "días"}`;
}

/** Días hábiles que quedan (los fines de semana y los inhábiles no cuentan). */
export function plazoEnDiasHabiles(dias: number, vencido: boolean): string {
  if (vencido) return "Fuera de plazo";
  if (dias === 0) return "Vence hoy";
  return `Quedan ${dias} ${dias === 1 ? "día hábil" : "días hábiles"}`;
}

/** Lo que vio la regla contra su parámetro, en una frase. */
export function resumenDeAlerta(alerta: Pick<AlertaPld, "regla" | "observado" | "tipoOperacion">): string {
  const o = alerta.observado;
  const grado = numero(o.factor_grado) < 1 ? " Con grado de riesgo alto el límite es más estricto." : "";
  switch (alerta.regla) {
    case "excede_perfil":
      return `${alerta.tipoOperacion ? OPERACION[alerta.tipoOperacion] : "Instrucciones"} de ${String(o.mes ?? "")}: ${pesos(o.suma_mes_centavos)} contra ${pesos(o.limite_centavos)} del perfil. Incluye instrucciones canceladas.${grado}`;
    case "monto_atipico":
      return `Instrucción de ${pesos(o.monto_centavos)}. ${numero(o.k)} veces la mediana de los últimos 6 meses es ${pesos(o.limite_centavos)} (${numero(o.historial_operaciones)} operaciones previas).${grado}`;
    case "fraccionamiento":
      return `${numero(o.instrucciones)} instrucciones a la CLABE terminación ${String(o.clabe ?? "").slice(-4)} en ${numero(o.ventana_dias)} días suman ${pesos(o.suma_centavos)}, cada una por debajo de ${pesos(o.umbral_centavos)}. Incluye instrucciones canceladas.${grado}`;
    case "nomina_atipica": {
      const razones = [
        o.lote_sobre_perfil === true ? `el lote supera los ${pesos(o.declarado_nomina_centavos)} de nómina declarados al mes` : null,
        o.personas_sobre_promedio === true ? `${numero(o.personas)} personas contra un tope de ${numero(o.tope_personas).toLocaleString("es-MX", { maximumFractionDigits: 1 })}` : null,
      ].filter(Boolean);
      return `Lote de ${pesos(o.monto_centavos)} con ${numero(o.personas)} personas: ${razones.join(" y ")}.${grado}`;
    }
    case "aviso_manual":
      return TIPO_AVISO[(o.tipo as TipoAviso) ?? "posible_inusual"] ?? "Aviso del personal";
  }
}

/** datetime-local en hora de la Ciudad de México, para el valor por omisión de un acuse. */
export function ahoraEnMexicoParaCampo(ahora: Date): string {
  return ahora.toLocaleString("sv-SE", { timeZone: "America/Mexico_City" }).slice(0, 16).replace(" ", "T");
}
