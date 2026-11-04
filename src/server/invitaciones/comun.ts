import { enviadorDesdeEntorno } from "../correo/enviar";
import { leerUrlPublica } from "../correo/configuracion";
import type { Enviador } from "../correo/tipos";
import type { Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import type { Auditar, HechoAcceso } from "./auditar";

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Envio = { enviador: Enviador; urlBase: string };

/**
 * Se resuelve antes de escribir la base. Sin clave, sin remitente o sin la
 * URL pública, lanza `correo_no_configurado` y no queda nada a medias.
 */
export function resolverEnvio(deps?: { enviador?: Enviador; urlBase?: string }): Envio {
  const enviador = deps?.enviador ?? enviadorDesdeEntorno();
  const urlBase = deps?.urlBase ?? leerUrlPublica();
  return { enviador, urlBase };
}

export async function auditarEn(fn: Auditar, consulta: Consulta, evento: HechoAcceso): Promise<void> {
  try {
    await fn(evento, consultaSinCierre(consulta));
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    throw new ErrorDeDominio("auditoria_no_disponible");
  }
}

function consultaSinCierre(consulta: Consulta): Consulta {
  return {
    async query(sql, params) {
      const verbo = (sql.trim().toLowerCase().split(/\s+/)[0] ?? "").replace(/;$/, "");
      if (["begin", "commit", "rollback", "start", "savepoint", "release"].includes(verbo)) {
        throw new ErrorDeDominio("auditoria_no_disponible");
      }
      return consulta.query(sql, params);
    },
  };
}
