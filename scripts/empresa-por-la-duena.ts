import { randomUUID } from "node:crypto";

import { Client } from "pg";

import { exigirPersonal, type ContextoDeTenant } from "../src/nucleo/contexto";
import { ErrorDeDominio } from "../src/nucleo/error-de-dominio";
import { mapearEmpresa } from "../src/server/company/repositorio";
import type { AltaEmpresaEntrada, Empresa } from "../src/server/company/tipos";
import { validarAlta } from "../src/server/company/validar";

/**
 * Alta de una empresa ya activa con la conexión de la dueña de la base. La
 * aplicación no puede hacerlo: desde ella una empresa solo nace prospecto y llega
 * a activa por el alta regulada (0028, empresa_nace_prospecto). Esto queda para
 * las empresas de demostración del comando y para las bases desechables de
 * pruebas, recorridos y evidencia. La pide una persona del personal con el rol de
 * alta, que queda en la bitácora. Nunca imprime la URL.
 */
export async function darDeAltaComoDuena(
  url: string,
  ctx: ContextoDeTenant | null | undefined,
  empresa: AltaEmpresaEntrada,
  opciones: { demostracion: boolean },
): Promise<Empresa> {
  const personal = exigirPersonal(ctx, "plataforma.empresa.alta");
  const validada = validarAlta(empresa);
  if (!validada.ok) throw new ErrorDeDominio(validada.codigo);
  const id = randomUUID();
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query("begin");
    const ocupado = await cliente.query("select 1 from companies where rfc = $1", [validada.valor.rfc]);
    if (ocupado.rows.length > 0) throw new ErrorDeDominio("rfc_duplicado");
    const insertada = await cliente.query(
      `insert into companies (
         id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at, operator_id, estado, demostracion, originada_por
       ) values ($1, $2, $3, $4, $5, $6, now(), $7, 'activa', $8, $9)
       returning id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at`,
      [id, validada.valor.rfc, validada.valor.razonSocial, validada.valor.codigoPostal, validada.valor.regimen,
        validada.valor.usoCfdi, personal.personal.operadorId, opciones.demostracion, personal.persona.id],
    );
    await cliente.query(
      `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen, cambio)
       values ($1, $2, 'personal', $3, 'sofipo', 'alta_empresa', 'companies', $2, 'comando', $4)`,
      [personal.personal.operadorId, id, personal.persona.id, JSON.stringify({ demostracion: opciones.demostracion })],
    );
    await cliente.query("commit");
    return mapearEmpresa(insertada.rows[0]);
  } catch (error) {
    await cliente.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await cliente.end();
  }
}
