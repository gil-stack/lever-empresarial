"use server";

import { decidirPago } from "@/app/consola/proveedores/acciones-pagos";
import { ESTADO_PAGO_INICIAL } from "@/app/consola/proveedores/estado";

import { aDecisionSinScript, type DecisionSinScript } from "./decision-sin-script";

/**
 * La decisión de la bandeja sin JavaScript: la misma `decidirPago` que con JavaScript (permiso para liberar, segundo
 * factor reciente o el código de la app, versión e importe vistos, motivo y bitácora, todo en `resolverPagoProveedor`).
 * Solo cambia lo que devuelve.
 */
export async function decidirPagoSinScript(_previo: DecisionSinScript, datos: FormData): Promise<DecisionSinScript> {
  return aDecisionSinScript(await decidirPago(ESTADO_PAGO_INICIAL, datos), datos);
}
