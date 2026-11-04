import { conTransaccion, consultar, type Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { ROLES, type Rol } from "../session/tipos";
import type { ContextoClabes, FilaClabe, RepositorioClabes } from "./tipos";

// El company_id sale de la membresía. El navegador no lo manda.
export const SQL = {
  bloquearEmpresa: `
    select m.company_id, m.rol
    from memberships m
    join companies c on c.id = m.company_id
    where m.user_id = $1
    for update of c
  `,
  puerta: `
    select rol
    from memberships
    where user_id = $1
  `,
  listar: `
    select s.id, s.supplier_id, s.clabe, s.vigente_desde, s.vigente_hasta
    from supplier_clabes s
    join memberships m on m.company_id = s.company_id
    where m.user_id = $1
    order by s.vigente_desde desc, s.id
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
    async puerta(userId) {
      const resultado = await consultar(SQL.puerta, [userId]);
      const fila = resultado.rows[0] as { rol?: unknown } | undefined;
      if (!fila) return null;
      const rol = rolLeido(fila.rol);
      if (!rol) throw new ErrorDeDominio("base_no_disponible");
      return { rol };
    },
    async listar(userId) {
      const resultado = await consultar(SQL.listar, [userId]);
      return resultado.rows.map(mapearFila);
    },
    conEmpresa(userId, fn) {
      return conTransaccion(async (consulta) => {
        const puerta = await consulta.query(SQL.bloquearEmpresa, [userId]);
        const fila = puerta.rows[0] as { company_id?: unknown; rol?: unknown } | undefined;
        if (!fila || typeof fila.company_id !== "string") throw new ErrorDeDominio("sin_empresa");
        const rol = rolLeido(fila.rol);
        if (!rol) throw new ErrorDeDominio("base_no_disponible");
        return fn(contexto(consulta, fila.company_id, rol));
      });
    },
  };
}

function contexto(consulta: Consulta, companyId: string, rol: Rol): ContextoClabes {
  return {
    companyId,
    rol,
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

function rolLeido(valor: unknown): Rol | null {
  return ROLES.find((rol) => rol === valor) ?? null;
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
