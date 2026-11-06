import type { CategoriaResumen, DatosResumenInicio, MovimientoResumen, PeriodoResumen } from "../../dominio/resumen";
import { baseCliente, type ContextoConEmpresa } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

export type RepositorioResumen = {
  leer: (ctx: ContextoConEmpresa, hoy: string, periodo: PeriodoResumen) => Promise<DatosResumenInicio>;
};

/**
 * Una sola consulta por lectura. Los límites de mes se calculan en hora de
 * México sin depender de la zona de la sesión: la fecha se vuelve `timestamp`
 * (hora de pared), se trunca al mes y solo entonces se interpreta en
 * America/Mexico_City. `date_trunc` sobre un `date` daría un instante en la
 * zona de la sesión y, con la sesión en UTC, el mes empezaría 12 horas antes.
 * Cada ventana tiene límite inferior y superior, para que el mes actual de las
 * barras y de las categorías sea el mismo intervalo.
 *
 * Signo: positivo es entrada, negativo es salida (ver README.md del módulo).
 */
export const SQL_RESUMEN = `
  with limites as (
    select
      (date_trunc('month', $2::date::timestamp) - (($3::int - 1) * interval '1 month')) at time zone 'America/Mexico_City' as desde_periodo,
      date_trunc('month', $2::date::timestamp) at time zone 'America/Mexico_City' as desde_mes,
      (date_trunc('month', $2::date::timestamp) + interval '1 month') at time zone 'America/Mexico_City' as hasta
  ),
  mensuales as (
    select to_char(date_trunc('month', p.ocurrido_en at time zone 'America/Mexico_City'), 'YYYY-MM') as mes,
           coalesce(sum(p.centavos) filter (where p.centavos > 0), 0)::text as entradas,
           coalesce(sum(-p.centavos) filter (where p.centavos < 0), 0)::text as salidas
    from postings p, limites l
    where p.company_id = $1
      and p.ocurrido_en >= l.desde_periodo
      and p.ocurrido_en < l.hasta
    group by 1
  ),
  categorias as (
    select coalesce(d.codigo, 'sin_cajon') as codigo,
           coalesce(d.nombre, 'Sin cajón') as nombre,
           sum(-p.centavos)::text as salidas
    from postings p
    cross join limites l
    left join drawers d on d.id = p.drawer_id and d.company_id = p.company_id
    where p.company_id = $1
      and p.centavos < 0
      and p.ocurrido_en >= l.desde_mes
      and p.ocurrido_en < l.hasta
    group by d.id, d.codigo, d.nombre
  ),
  recientes as (
    select p.id, p.motivo, p.centavos::text as centavos, p.ocurrido_en,
           coalesce(d.nombre, 'Sin cajón') as categoria
    from postings p
    left join drawers d on d.id = p.drawer_id and d.company_id = p.company_id
    where p.company_id = $1
    order by p.ocurrido_en desc, p.id desc
    limit 6
  )
  select
    (select coalesce(sum(centavos), 0)::text from postings where company_id = $1) as saldo,
    coalesce((select json_agg(m order by m.mes) from mensuales m), '[]'::json) as mensuales,
    coalesce((select json_agg(c) from categorias c), '[]'::json) as categorias,
    coalesce((select json_agg(r order by r.ocurrido_en desc, r.id desc) from recientes r), '[]'::json) as recientes
`;

export function repositorioResumenPg(): RepositorioResumen {
  return {
    async leer(ctx, hoy, periodo) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL_RESUMEN, [ctx.empresa.id, hoy, periodo]);
        return mapearResumen(resultado.rows[0]);
      });
    },
  };
}

export function mapearResumen(fila: unknown): DatosResumenInicio {
  const registro = (fila ?? {}) as Record<string, unknown>;
  if (!Array.isArray(registro.mensuales) || !Array.isArray(registro.categorias) || !Array.isArray(registro.recientes)) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    saldoCentavos: centavos(registro.saldo),
    mensuales: registro.mensuales.map(mapearMes),
    categorias: registro.categorias.map(mapearCategoria),
    recientes: registro.recientes.map(mapearMovimiento),
  };
}

function mapearMes(fila: unknown): DatosResumenInicio["mensuales"][number] {
  const registro = fila as Record<string, unknown>;
  if (typeof registro.mes !== "string" || !/^\d{4}-\d{2}$/.test(registro.mes)) throw new ErrorDeDominio("base_no_disponible");
  return {
    clave: registro.mes,
    entradasCentavos: centavos(registro.entradas),
    salidasCentavos: centavos(registro.salidas),
  };
}

function mapearCategoria(fila: unknown): CategoriaResumen {
  const registro = fila as Record<string, unknown>;
  if (typeof registro.codigo !== "string" || typeof registro.nombre !== "string") throw new ErrorDeDominio("base_no_disponible");
  return { codigo: registro.codigo, nombre: registro.nombre, salidasCentavos: centavos(registro.salidas) };
}

function mapearMovimiento(fila: unknown): MovimientoResumen {
  const registro = fila as Record<string, unknown>;
  // json_agg entrega el instante como texto ISO 8601 con su desfase.
  const ocurrido = typeof registro.ocurrido_en === "string" ? new Date(registro.ocurrido_en) : null;
  if (
    typeof registro.id !== "string" ||
    typeof registro.motivo !== "string" ||
    typeof registro.categoria !== "string" ||
    !ocurrido ||
    Number.isNaN(ocurrido.getTime())
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    id: registro.id,
    motivo: registro.motivo,
    categoria: registro.categoria,
    centavos: centavos(registro.centavos),
    ocurridoEn: ocurrido.toISOString(),
  };
}

function centavos(valor: unknown): number {
  const numero = typeof valor === "number" || (typeof valor === "string" && /^-?\d+$/.test(valor)) ? Number(valor) : NaN;
  if (!Number.isSafeInteger(numero)) throw new ErrorDeDominio("base_no_disponible");
  return numero;
}
