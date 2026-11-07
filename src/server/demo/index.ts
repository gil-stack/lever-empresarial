import "server-only";

import type { ContextoDeTenant } from "../../nucleo/contexto";
import type { ModuloDemo } from "../../dominio/demo/productos";
import { cargaDemo, type CargaDemo } from "./regla";

export type { CargaDemo } from "./regla";

/** La regla del modo demostración aplicada al contexto de la petición. */
export function leerDemo<M extends ModuloDemo>(ctx: ContextoDeTenant | null, modulo: M): CargaDemo<M> {
  return cargaDemo(ctx?.empresa, modulo);
}
