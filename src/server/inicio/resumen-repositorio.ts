import type { CategoriaResumen, DatosResumenInicio, MovimientoResumen, PeriodoResumen } from "../../dominio/resumen";
import { baseCliente, type ContextoConEmpresa } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

export type RepositorioResumen = {
  leer: (ctx: ContextoConEmpresa, hoy: string, periodo: PeriodoResumen) => Promise<DatosResumenInicio>;
};

const SQL = {
  saldo: `
    select coalesce(sum(centavos), 0)::text as saldo
    from postings
    where company_id = $1
  `,
  mensuales: `
    select to_char(date_trunc('month', ocurrido_en at time zone 'America/Mexico_City'), 'YYYY-MM') as mes,
           coalesce(sum(centavos) filter (where centavos > 0), 0)::text as ingresos,
           coalesce(sum(-centavos) filter (where centavos < 0), 0)::text as gastos
    from postings
    where company_id = $1
      and ocurrido_en >= ((date_trunc('month', $2::date) - (($3::int - 1) * interval '1 month')) at time zone 'America/Mexico_City')
    group by 1
    order by 1
  `,
  categorias: `
    select coalesce(d.codigo, 'sin_cajon') as codigo,
           coalesce(d.nombre, 'Sin cajón') as nombre,
           sum(-p.centavos)::text as gastos
    from postings p
    left join drawers d on d.id = p.drawer_id and d.company_id = p.company_id
    where p.company_id = $1
      and p.centavos < 0
      and p.ocurrido_en >= (date_trunc('month', $2::date) at time zone 'America/Mexico_City')
    group by d.id, d.codigo, d.nombre
  `,
  recientes: `
    select p.id, p.motivo, p.centavos, p.ocurrido_en,
           coalesce(d.nombre, 'Sin cajón') as categoria
    from postings p
    left join drawers d on d.id = p.drawer_id and d.company_id = p.company_id
    where p.company_id = $1
    order by p.ocurrido_en desc, p.id desc
    limit 6
  `,
} as const;

export function repositorioResumenPg(): RepositorioResumen {
  return {
    async leer(ctx, hoy, periodo) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const companyId = ctx.empresa.id;
        const saldo = await consulta.query(SQL.saldo, [companyId]);
        const mensuales = await consulta.query(SQL.mensuales, [companyId, hoy, periodo]);
        const categorias = await consulta.query(SQL.categorias, [companyId, hoy]);
        const recientes = await consulta.query(SQL.recientes, [companyId]);
        return {
          saldoCentavos: centavos((saldo.rows[0] as Record<string, unknown> | undefined)?.saldo),
          mensuales: mensuales.rows.map(mapearMes),
          categorias: categorias.rows.map(mapearCategoria),
          recientes: recientes.rows.map(mapearMovimiento),
        };
      });
    },
  };
}

function mapearMes(fila: unknown): DatosResumenInicio["mensuales"][number] {
  const registro = fila as Record<string, unknown>;
  if (typeof registro.mes !== "string" || !/^\d{4}-\d{2}$/.test(registro.mes)) throw new ErrorDeDominio("base_no_disponible");
  return {
    clave: registro.mes,
    ingresosCentavos: centavos(registro.ingresos),
    gastosCentavos: centavos(registro.gastos),
  };
}

function mapearCategoria(fila: unknown): CategoriaResumen {
  const registro = fila as Record<string, unknown>;
  if (typeof registro.codigo !== "string" || typeof registro.nombre !== "string") throw new ErrorDeDominio("base_no_disponible");
  return { codigo: registro.codigo, nombre: registro.nombre, gastosCentavos: centavos(registro.gastos) };
}

function mapearMovimiento(fila: unknown): MovimientoResumen {
  const registro = fila as Record<string, unknown>;
  if (
    typeof registro.id !== "string" ||
    typeof registro.motivo !== "string" ||
    typeof registro.categoria !== "string" ||
    !(registro.ocurrido_en instanceof Date) ||
    Number.isNaN(registro.ocurrido_en.getTime())
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    id: registro.id,
    motivo: registro.motivo,
    categoria: registro.categoria,
    centavos: centavos(registro.centavos),
    ocurridoEn: registro.ocurrido_en.toISOString(),
  };
}

function centavos(valor: unknown): number {
  const numero = typeof valor === "number" || (typeof valor === "string" && /^-?\d+$/.test(valor)) ? Number(valor) : NaN;
  if (!Number.isSafeInteger(numero)) throw new ErrorDeDominio("base_no_disponible");
  return numero;
}
