import "server-only";

/**
 * La cookie y la lectura de la sesión están en `src/server/session`.
 * La base guarda el hash del token. El id de empresa que mande el navegador
 * no autoriza la lectura.
 */
export const SESION_IMPLEMENTADA_EN = "src/server/session" as const;
