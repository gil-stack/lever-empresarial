import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * El texto que otro frente copia a db/migrations. Este módulo no lo ejecuta
 * y el servidor no migra al arrancar.
 */
export const CONTRATO_TABLAS = readFileSync(fileURLToPath(new URL("./contrato.sql", import.meta.url)), "utf8");

/**
 * Sentencias que el repositorio usa cuando la tabla ya existe.
 * `es_prueba` va fijo en verdadero: no hay un parámetro para apagarlo.
 */
export const SQL = {
  usuarioExiste: "select 1 as presente from users where id = $1",
  bloquearUsuario: "select id from users where id = $1 for update",
  membresiaDe: "select user_id, company_id, rol from memberships where user_id = $1",
  membresiasDeLaEmpresa: "select user_id, company_id, rol from memberships where company_id = $1",
  insertarMembresia: "insert into memberships (user_id, company_id, rol) values ($1, $2, $3)",
  actualizarRol: "update memberships set rol = $1 where user_id = $2 and company_id = $3",
  insertarLote: `insert into lotes_prueba (
    id, company_id, solicitante_user_id, liberador_user_id, firmado_en, es_prueba
  ) values ($1, $2, $3, $4, $5, true)`,
} as const;
