import "server-only";

import { cache } from "react";

import type { ContextoDeTenant } from "../../nucleo/contexto";
import { leerBandejaInicio } from "./servicio";

/**
 * Una lectura de la bandeja por petición. La página de Pendientes y el
 * contador del lateral reciben el mismo contexto de la petición y comparten
 * esta lectura en lugar de repetir la consulta.
 */
export const bandejaDeLaPeticion = cache((ctx: ContextoDeTenant) => leerBandejaInicio(ctx));
