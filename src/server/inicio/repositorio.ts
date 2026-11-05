import type { DatosInicio } from "../../dominio/inicio";
import { baseCliente, type ContextoConEmpresa } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";

export type RepositorioInicio = {
  leer: (ctx: ContextoConEmpresa, hoy: string) => Promise<DatosInicio>;
};

/** Proyección de configuración: no selecciona asientos, saldos, CLABE ni expedientes. */
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
    (select s.estado from subscriptions s where s.company_id = $1) as plan_estado
`;

export function repositorioPg(): RepositorioInicio {
  return {
    async leer(ctx, hoy) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL_INICIO, [ctx.empresa.id, hoy]);
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

function plan(valor: unknown): "recorrido" | "aceptada" {
  if (valor !== "recorrido" && valor !== "aceptada") throw new ErrorDeDominio("base_no_disponible");
  return valor;
}
