"use server";

import { decidirPago } from "@/app/consola/proveedores/acciones-pagos";
import { ESTADO_PAGO_INICIAL } from "@/app/consola/proveedores/estado";

/**
 * Lo que vuelve a la bandeja cuando la decisión se envió sin JavaScript (o antes de que la página hidrate). La
 * página se pinta de nuevo con esto: «listo» enciende «Decisión asentada»; «invalido» deja abierto el rechazo de ese
 * pago, con lo que se escribió y el aviso junto al campo.
 */
export type DecisionSinScript =
  | { tipo: "inicial" }
  | { tipo: "listo"; mensaje: string }
  | {
      tipo: "invalido";
      mensaje: string;
      campo?: string;
      requestId: string;
      decision: "autorizar" | "rechazar";
      motivo: string;
    };

/**
 * La misma decisión que la bandeja con JavaScript (`decidirPago`: permiso para liberar, segundo factor reciente,
 * versión e importe vistos, motivo para rechazar); solo cambia lo que devuelve.
 */
export async function decidirPagoSinScript(_previo: DecisionSinScript, datos: FormData): Promise<DecisionSinScript> {
  const resultado = await decidirPago(ESTADO_PAGO_INICIAL, datos);
  if (resultado.tipo === "listo") return { tipo: "listo", mensaje: resultado.mensaje };
  if (resultado.tipo === "inicial") return resultado;
  const valor = (campo: string) => {
    const crudo = datos.get(campo);
    return typeof crudo === "string" ? crudo : "";
  };
  return {
    tipo: "invalido",
    mensaje: resultado.mensaje,
    ...(resultado.campo ? { campo: resultado.campo } : {}),
    requestId: valor("requestId"),
    decision: valor("decision") === "autorizar" ? "autorizar" : "rechazar",
    motivo: valor("motivo").slice(0, 500),
  };
}
