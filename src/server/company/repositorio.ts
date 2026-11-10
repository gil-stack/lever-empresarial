import { baseCliente, type ContextoConEmpresa } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Empresa } from "./tipos";

// Desde la aplicación una empresa solo nace prospecto (src/server/operacion/clientes.ts)
// y llega a activa por el alta regulada. La base lo exige (0028, empresa_nace_prospecto).
export const SQL = {
  leerEmpresa: `
    select id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at
    from companies
    where id = $1
  `,
} as const;

export type RepositorioEmpresas = {
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
