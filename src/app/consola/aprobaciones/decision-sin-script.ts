import type { EstadoPagoFormulario } from "@/app/consola/proveedores/estado";

/**
 * Lo que vuelve a la bandeja cuando la decisión se envió sin JavaScript (o antes de que la página hidrate). La
 * página se pinta de nuevo con esto: «listo» enciende «Decisión asentada»; «invalido» deja abierto lo de ese pago
 * (el rechazo con lo escrito, o el código de la app si el segundo factor ya no es reciente) con el aviso junto al
 * campo, o arriba de la bandeja si la fila ya no está.
 */
export type DecisionSinScript =
  | { tipo: "inicial" }
  | { tipo: "listo"; mensaje: string }
  | {
      tipo: "invalido";
      mensaje: string;
      campo?: string;
      codigo?: string;
      requestId: string;
      decision: "autorizar" | "rechazar";
      motivo: string;
    };

/** Solo adapta: el resultado de `decidirPago` y lo que se envió, para volver a pintar la fila. No decide nada. */
export function aDecisionSinScript(resultado: EstadoPagoFormulario, datos: FormData): DecisionSinScript {
  if (resultado.tipo !== "invalido") return resultado.tipo === "listo" ? { tipo: "listo", mensaje: resultado.mensaje } : resultado;
  const valor = (campo: string) => {
    const crudo = datos.get(campo);
    return typeof crudo === "string" ? crudo : "";
  };
  return {
    tipo: "invalido",
    mensaje: resultado.mensaje,
    ...(resultado.campo ? { campo: resultado.campo } : {}),
    ...(resultado.codigo ? { codigo: resultado.codigo } : {}),
    requestId: valor("requestId"),
    decision: valor("decision") === "autorizar" ? "autorizar" : "rechazar",
    motivo: valor("motivo").slice(0, 500),
  };
}
