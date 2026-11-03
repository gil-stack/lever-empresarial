import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * El texto vive en contrato.sql y en la migración 0011. Este módulo no lo
 * ejecuta y el servidor no migra al arrancar.
 */
export const CONTRATO_TABLAS = readFileSync(rutaDelContrato(), "utf8");

function rutaDelContrato(): string {
  try {
    const convertida = fileURLToPath(new URL("./contrato.sql", import.meta.url));
    if (typeof convertida === "string" && convertida.endsWith(".sql")) return convertida;
  } catch {
    // El empaquetador de la página no entrega una ruta de archivo.
  }
  return path.join(process.cwd(), "src/server/roles/contrato.sql");
}

/**
 * Sentencias que el repositorio usa cuando la tabla ya existe.
 * `es_prueba` va fijo en verdadero: no hay un parámetro para apagarlo.
 */
export const SQL = {
  usuarioExiste: "select 1 as presente from users where id = $1",
  bloquearUsuario: "select id from users where id = $1 for update",
  membresiaDe: `select m.user_id, m.company_id, m.rol,
    coalesce(
      e.baja_en is not null
      and e.baja_en <= (timezone('America/Mexico_City', clock_timestamp()))::date,
      false
    ) as de_baja
    from memberships m
    left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
    where m.user_id = $1`,
  membresiasDeLaEmpresa: `select m.user_id, m.company_id, m.rol,
    coalesce(
      e.baja_en is not null
      and e.baja_en <= (timezone('America/Mexico_City', clock_timestamp()))::date,
      false
    ) as de_baja
    from memberships m
    left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
    where m.company_id = $1`,
  insertarMembresia: "insert into memberships (user_id, company_id, rol) values ($1, $2, $3)",
  actualizarRol: "update memberships set rol = $1 where user_id = $2 and company_id = $3",
  insertarSolicitud: `insert into lotes_prueba (
    id, company_id, solicitante_user_id, solicitado_en, es_prueba
  ) values ($1, $2, $3, $4, true)`,
  leerLote: `select id, company_id, solicitante_user_id, solicitado_en, liberador_user_id, liberado_en
    from lotes_prueba where id = $1`,
  cerrarLiberacion: `update lotes_prueba
    set liberador_user_id = $2, liberado_en = $3
    where id = $1
      and company_id = $4
      and liberador_user_id is null
      and es_prueba is true`,
} as const;
