import { conTransaccion, consultar, type Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import type { Empresa } from "./tipos";

export const ROL_DE_ALTA = "administrador";

// companies: id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at.
// memberships: user_id, company_id, rol. El alta bloquea la fila de users.
export const SQL = {
  bloquearCuenta: "select id from users where id = $1 for update",
  tieneEmpresa: "select 1 as presente from memberships where user_id = $1 limit 1",
  rfcOcupado: "select 1 as presente from companies where rfc = $1 limit 1",
  insertarEmpresa: `
    insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at)
    values ($1, $2, $3, $4, $5, $6, now())
    returning id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, alta_at
  `,
  insertarMembresia: "insert into memberships (user_id, company_id, rol) values ($1, $2, $3)",
  leerEmpresa: `
    select c.id, c.rfc, c.razon_social, c.codigo_postal, c.regimen, c.uso_cfdi, c.alta_at
    from memberships m
    join companies c on c.id = m.company_id
    where m.user_id = $1
    limit 1
  `,
} as const;

export type EmpresaInsertada = {
  id: string;
  rfc: string;
  razonSocial: string;
  codigoPostal: string;
  regimen: string;
  usoCfdi: string;
};

export type CuentaBloqueada = {
  tieneEmpresa: () => Promise<boolean>;
  rfcOcupado: (rfc: string) => Promise<boolean>;
  insertar: (empresa: EmpresaInsertada) => Promise<Empresa>;
  consulta: Consulta;
};

export type RepositorioEmpresas = {
  conCuenta: <T>(userId: string, fn: (cuenta: CuentaBloqueada) => Promise<T>) => Promise<T>;
  leerDeLaCuenta: (userId: string) => Promise<Empresa | null>;
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
    conCuenta(userId, fn) {
      return conTransaccion(async (consulta) => {
        const usuario = await consulta.query(SQL.bloquearCuenta, [userId]);
        if (usuario.rows.length === 0) throw new ErrorDeDominio("usuario_ausente");
        return fn(cuentaDesde(consulta, userId));
      });
    },
    async leerDeLaCuenta(userId) {
      const resultado = await consultar(SQL.leerEmpresa, [userId]);
      const fila = resultado.rows[0] as FilaEmpresa | undefined;
      return fila ? mapearEmpresa(fila) : null;
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

function cuentaDesde(consulta: Consulta, userId: string): CuentaBloqueada {
  return {
    async tieneEmpresa() {
      const resultado = await consulta.query(SQL.tieneEmpresa, [userId]);
      return resultado.rows.length > 0;
    },
    async rfcOcupado(rfc) {
      const resultado = await consulta.query(SQL.rfcOcupado, [rfc]);
      return resultado.rows.length > 0;
    },
    async insertar(empresa) {
      const insertada = await consulta.query(SQL.insertarEmpresa, [
        empresa.id,
        empresa.rfc,
        empresa.razonSocial,
        empresa.codigoPostal,
        empresa.regimen,
        empresa.usoCfdi,
      ]);
      await consulta.query(SQL.insertarMembresia, [userId, empresa.id, ROL_DE_ALTA]);
      const fila = insertada.rows[0] as FilaEmpresa | undefined;
      if (!fila) throw new ErrorDeDominio("base_no_disponible");
      return mapearEmpresa(fila);
    },
    consulta,
  };
}
