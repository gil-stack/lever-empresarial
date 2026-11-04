import { baseCliente } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { DatosFiscalesTelefono, RepositorioTelefono, TopeTelefono } from "./tipos";

export const SQL_TELEFONO = {
  inicio: `
    select e.nombre, e.baja_en
    from employees e
    where e.company_id = $1 and e.user_id = $2
  `,
  topes: `
    select c.id, c.nombre, c.tope_centavos::text
    from policy_categories c
    where c.company_id = $1
    order by c.nombre, c.id
  `,
  facturacion: `
    select c.rfc, c.razon_social, c.codigo_postal, c.regimen, c.uso_cfdi
    from companies c
    where c.id = $1
  `,
} as const;

export function repositorioPg(): RepositorioTelefono {
  return {
    async inicio(ctx) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL_TELEFONO.inicio, [ctx.empresa.id, ctx.persona.id]);
        const fila = resultado.rows[0] as Record<string, unknown> | undefined;
        if (!fila) return null;
        if (typeof fila.nombre !== "string" || fila.nombre.length === 0) throw new ErrorDeDominio("base_no_disponible");
        return { nombre: fila.nombre, bajaEn: fechaNula(fila.baja_en) };
      });
    },
    async topes(ctx) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL_TELEFONO.topes, [ctx.empresa.id]);
        return resultado.rows.map((fila) => mapearTope(fila as Record<string, unknown>));
      });
    },
    async facturacion(ctx) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL_TELEFONO.facturacion, [ctx.empresa.id]);
        const fila = resultado.rows[0] as Record<string, unknown> | undefined;
        if (!fila) return null;
        return mapearFiscales(fila);
      });
    },
  };
}

function mapearTope(fila: Record<string, unknown>): TopeTelefono {
  if (typeof fila.id !== "string" || typeof fila.nombre !== "string" || fila.nombre.length === 0) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return { id: fila.id, nombre: fila.nombre, topeCentavos: centavosNulos(fila.tope_centavos) };
}

function mapearFiscales(fila: Record<string, unknown>): DatosFiscalesTelefono {
  if (
    typeof fila.rfc !== "string" ||
    typeof fila.razon_social !== "string" ||
    typeof fila.codigo_postal !== "string" ||
    typeof fila.regimen !== "string" ||
    typeof fila.uso_cfdi !== "string" ||
    !/^\d{5}$/.test(fila.codigo_postal)
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    rfc: fila.rfc,
    razonSocial: fila.razon_social,
    codigoPostal: fila.codigo_postal,
    regimen: fila.regimen,
    uso: fila.uso_cfdi,
  };
}

function fechaNula(valor: unknown): string | null {
  if (valor === null) return null;
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}/.test(valor)) return valor.slice(0, 10);
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString().slice(0, 10);
  throw new ErrorDeDominio("base_no_disponible");
}

function centavosNulos(valor: unknown): number | null {
  if (valor === null) return null;
  const numero = typeof valor === "number" ? valor : typeof valor === "string" && /^\d+$/.test(valor) ? Number(valor) : NaN;
  if (!Number.isSafeInteger(numero) || numero < 0) throw new ErrorDeDominio("base_no_disponible");
  return numero;
}
