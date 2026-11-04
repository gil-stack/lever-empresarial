import { baseCliente } from "../../nucleo/contexto";
import { bloquearEmpresa, conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { ContextoClabes, FilaClabe, RepositorioClabes } from "./tipos";

// La empresa es la del contexto. El navegador no la manda.
export const SQL = {
  listar: `
    select id, supplier_id, clabe, vigente_desde, vigente_hasta
    from supplier_clabes
    where company_id = $1
    order by vigente_desde desc, id
  `,
  vigente: `
    select id, supplier_id, clabe, vigente_desde, vigente_hasta
    from supplier_clabes
    where company_id = $1
      and supplier_id = $2
      and vigente_hasta is null
    for update
  `,
  cerrar: `
    update supplier_clabes
    set vigente_hasta = $3
    where id = $1
      and company_id = $2
      and vigente_hasta is null
  `,
  insertar: `
    insert into supplier_clabes (
      id, company_id, supplier_id, clabe, digito_valido, vigente_desde
    ) values ($1, $2, $3, $4, true, $5)
  `,
} as const;

export function repositorioPg(): RepositorioClabes {
  return {
    listar(ctx) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL.listar, [ctx.empresa.id]);
        return resultado.rows.map(mapearFila);
      });
    },
    conEmpresa(ctx, fn) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        await bloquearEmpresa(consulta, ctx.empresa.id);
        return fn(contexto(consulta, ctx.empresa.id));
      });
    },
  };
}

function contexto(consulta: Consulta, companyId: string): ContextoClabes {
  return {
    companyId,
    consulta,
    async vigente(supplierId) {
      const resultado = await consulta.query(SQL.vigente, [companyId, supplierId]);
      const fila = resultado.rows[0];
      return fila ? mapearFila(fila) : null;
    },
    async cerrar(id, hasta) {
      const resultado = await consulta.query(SQL.cerrar, [id, companyId, hasta]);
      if (resultado.rowCount !== 1) throw new ErrorDeDominio("proveedor_ausente");
    },
    async insertar(fila) {
      await consulta.query(SQL.insertar, [
        fila.id,
        companyId,
        fila.supplierId,
        fila.clabe,
        fila.desde,
      ]);
    },
  };
}


function mapearFila(fila: unknown): FilaClabe {
  if (typeof fila !== "object" || fila === null) throw new ErrorDeDominio("base_no_disponible");
  const registro = fila as {
    id?: unknown;
    supplier_id?: unknown;
    clabe?: unknown;
    vigente_desde?: unknown;
    vigente_hasta?: unknown;
  };
  if (typeof registro.id !== "string" || typeof registro.supplier_id !== "string") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  if (typeof registro.clabe !== "string" || !/^[0-9]{18}$/.test(registro.clabe)) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    id: registro.id,
    supplierId: registro.supplier_id,
    clabe: registro.clabe,
    desde: instante(registro.vigente_desde),
    hasta: registro.vigente_hasta == null ? null : instante(registro.vigente_hasta),
  };
}

function instante(valor: unknown): Date {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return new Date(valor.getTime());
  if (typeof valor === "string") {
    const fecha = new Date(valor);
    if (!Number.isNaN(fecha.getTime())) return fecha;
  }
  throw new ErrorDeDominio("base_no_disponible");
}
