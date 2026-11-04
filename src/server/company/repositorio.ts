import { auditar, actorDePersonal } from "../bitacora/auditar";
import { baseCliente, basePlataforma, type ContextoConEmpresa, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Empresa, EmpresaNormalizada } from "./tipos";

export const SQL = {
  rfcOcupado: "select 1 as presente from companies where rfc = $1 limit 1",
  insertarEmpresa: `
    insert into companies (
      id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at,
      operator_id, estado, demostracion, originada_por
    )
    values ($1, $2, $3, $4, $5, $6, now(), $7, 'activa', $8, $9)
    returning id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at
  `,
  leerEmpresa: `
    select id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at
    from companies
    where id = $1
  `,
} as const;

export type RepositorioEmpresas = {
  /** El personal del operador da de alta. La empresa nace con su operador y su evento. */
  insertar: (
    ctx: ContextoDePersonal,
    empresa: EmpresaNormalizada & { id: string; demostracion: boolean },
  ) => Promise<Empresa>;
  leer: (ctx: ContextoConEmpresa) => Promise<Empresa | null>;
};

type FilaEmpresa = {
  id: unknown;
  rfc: unknown;
  razon_social: unknown;
  codigo_postal: unknown;
  regimen: unknown;
  uso_cfdi: unknown;
  alta_at: unknown;
};

export function repositorioPg(): RepositorioEmpresas {
  return {
    insertar(ctx, empresa) {
      return conContexto(basePlataforma(ctx, empresa.id), async (consulta) => {
        const ocupado = await consulta.query(SQL.rfcOcupado, [empresa.rfc]);
        if (ocupado.rows.length > 0) throw new ErrorDeDominio("rfc_duplicado");
        const insertada = await consulta.query(SQL.insertarEmpresa, [
          empresa.id,
          empresa.rfc,
          empresa.razonSocial,
          empresa.codigoPostal,
          empresa.regimen,
          empresa.usoCfdi,
          ctx.personal.operadorId,
          empresa.demostracion,
          ctx.persona.id,
        ]);
        const fila = insertada.rows[0] as FilaEmpresa | undefined;
        if (!fila) throw new ErrorDeDominio("base_no_disponible");
        await auditar(consulta, actorDePersonal(ctx, empresa.id, "comando"), {
          accion: "alta_empresa",
          identificador: empresa.id,
          cambio: { demostracion: empresa.demostracion },
        });
        return mapearEmpresa(fila);
      });
    },
    leer(ctx) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL.leerEmpresa, [ctx.empresa.id]);
        const fila = resultado.rows[0] as FilaEmpresa | undefined;
        return fila ? mapearEmpresa(fila) : null;
      });
    },
  };
}

export function mapearEmpresa(fila: FilaEmpresa): Empresa {
  if (
    typeof fila.id !== "string" ||
    typeof fila.rfc !== "string" ||
    typeof fila.razon_social !== "string" ||
    typeof fila.codigo_postal !== "string" ||
    typeof fila.regimen !== "string" ||
    typeof fila.uso_cfdi !== "string"
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  const altaEn = fila.alta_at instanceof Date ? fila.alta_at : new Date(String(fila.alta_at));
  if (Number.isNaN(altaEn.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return {
    id: fila.id,
    rfc: fila.rfc,
    razonSocial: fila.razon_social,
    codigoPostal: fila.codigo_postal,
    regimen: fila.regimen,
    usoCfdi: fila.uso_cfdi,
    altaEn,
  };
}
