import type { DatosInicio } from "../../dominio/inicio";
import { baseCliente, type ContextoConEmpresa } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

export type RepositorioInicio = {
  leer: (ctx: ContextoConEmpresa, hoy: string) => Promise<DatosInicio>;
};

/**
 * Proyección de configuración y conteos de trabajo: no selecciona asientos,
 * saldos, importes, CLABE ni expedientes. $3 es la persona de la sesión.
 */
export const SQL_INICIO = `
  select
    (select count(*) from cost_centers c where c.company_id = $1) as centros,
    (select count(*) from employees e where e.company_id = $1) as personas,
    (select count(*)
       from memberships m
       join membership_roles r on r.user_id = m.user_id and r.company_id = m.company_id
       left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
      where m.company_id = $1
        and m.estado = 'activa'
        and r.rol = 'liberador'
        and (e.baja_en is null or e.baja_en > $2::date)) as liberadores,
    (select count(*) from policy_categories c where c.company_id = $1) as categorias,
    (select count(*) from policy_categories c where c.company_id = $1 and c.tope_centavos is null) as topes_sin_escribir,
    (select count(*) from suppliers s where s.company_id = $1) as proveedores,
    (select s.estado from subscriptions s where s.company_id = $1) as plan_estado,
    (select count(*) from supplier_payment_requests r
      where r.company_id = $1 and r.estado = 'por_autorizar' and r.solicitado_por <> $3) as pagos_por_autorizar,
    -- Igual que SQL.primeraFechaVencida de nomina/repositorio.ts, la fecha que toma prepararNomina.
    -- La revisión de seguridad no deja interpolar SQL de otro módulo; la prueba de Postgres
    -- tests/personas/colaboradores-postgres.test.ts exige que las dos fechas coincidan.
    (select to_char(min(p.proximo_pago_en), 'YYYY-MM-DD')
       from employee_payroll_profiles p
       join employees e on e.id = p.employee_id and e.company_id = p.company_id
      where p.company_id = $1 and p.activa and p.proximo_pago_en <= $2::date
        and e.alta_en <= p.proximo_pago_en
        and (e.baja_en is null or p.proximo_pago_en <= e.baja_en)
        and not exists (
          select 1 from payroll_batches b
          where b.company_id = p.company_id and b.fecha_pago = p.proximo_pago_en
        )) as nomina_por_preparar
`;

export function repositorioPg(): RepositorioInicio {
  return {
    async leer(ctx, hoy) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL_INICIO, [ctx.empresa.id, hoy, ctx.persona.id]);
        const fila = resultado.rows[0] as Record<string, unknown> | undefined;
        if (!fila || resultado.rows.length !== 1) throw new ErrorDeDominio("base_no_disponible");
        return {
          centros: entero(fila.centros),
          personas: entero(fila.personas),
          liberadores: entero(fila.liberadores),
          categorias: entero(fila.categorias),
          topesSinEscribir: entero(fila.topes_sin_escribir),
          proveedores: entero(fila.proveedores),
          plan: fila.plan_estado === null ? null : plan(fila.plan_estado),
          pagosPorAutorizar: entero(fila.pagos_por_autorizar),
          nominaPorPreparar: fila.nomina_por_preparar === null ? null : fecha(fila.nomina_por_preparar),
        };
      });
    },
  };
}

function entero(valor: unknown): number {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" && /^\d+$/.test(valor) ? Number(valor) : NaN;
  if (!Number.isSafeInteger(numero) || numero < 0) throw new ErrorDeDominio("base_no_disponible");
  return numero;
}

function fecha(valor: unknown): string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new ErrorDeDominio("base_no_disponible");
  return valor;
}

function plan(valor: unknown): "recorrido" | "aceptada" {
  if (valor !== "recorrido" && valor !== "aceptada") throw new ErrorDeDominio("base_no_disponible");
  return valor;
}
