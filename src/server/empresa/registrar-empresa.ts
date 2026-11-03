import "server-only";

/**
 * El alta que escribe la razón social está en `src/server/company`.
 * La puerta la llama con `darDeAltaEmpresa`, dentro de la misma acción que
 * abre la cookie. Un segundo RFC en la misma cuenta responde
 * `segunda_razon_social` y no se inserta.
 */
export const ALTA_IMPLEMENTADA_EN = "src/server/company" as const;
