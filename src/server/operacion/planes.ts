import {
  calcularCobro,
  hoyEnMexico,
  normalizarPlan,
  periodoDeMes,
  uuidValido,
  type EstadoCliente,
  type Periodo,
} from "../../dominio/operacion";
import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { auditarOperacion } from "./auditar";
import { exigirEnOperacion } from "./permisos";

export type PlanDeCobro = {
  id: string;
  nivel: number;
  nombre: string;
  mensualidadCentavos: number;
  speiCentavos: number;
  deEjemplo: boolean;
};

export type CobroDeCliente = {
  companyId: string;
  razonSocial: string;
  rfc: string;
  estado: EstadoCliente;
  plan: { id: string; nombre: string } | null;
  mensualidadCentavos: number;
  spei: number;
  speiCentavos: number;
  /** De dónde sale el costo por SPEI: la tarifa propia vigente del cliente o su plan. */
  fuenteSpei: "tarifa_propia" | "plan" | "sin_plan";
  speiCentavosTotal: number;
  totalCentavos: number;
};

export type CobroDelMes = { periodo: Periodo; clientes: CobroDeCliente[]; totalCentavos: number };

/** Los tres planes del operador, del nivel 1 al 3. La migración 0046 los siembra con montos de ejemplo. */
export async function listarPlanes(ctx: ContextoDePersonal): Promise<PlanDeCobro[]> {
  exigirEnOperacion(ctx, "plataforma.operacion.ver");
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select id, nivel, nombre, mensualidad_centavos, spei_centavos, de_ejemplo
       from billing_plans order by nivel`,
    ),
  );
  return (resultado.rows as Array<Record<string, unknown>>).map(plan);
}

export async function actualizarPlan(
  ctx: ContextoDePersonal,
  entrada: { id: unknown; nombre: unknown; mensualidad: unknown; spei: unknown },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.empresa.alta");
  if (!uuidValido(entrada.id)) throw new ErrorDeDominio("plan_ausente");
  let normalizado: ReturnType<typeof normalizarPlan>;
  try {
    normalizado = normalizarPlan(entrada);
  } catch (error) {
    throw new ErrorDeDominio(error instanceof Error ? error.message : "plan_invalido");
  }
  const ahora = new Date();
  await conContexto(basePlataforma(ctx), async (consulta) => {
    const cambio = await consulta.query(
      `update billing_plans
       set nombre = $2, mensualidad_centavos = $3, spei_centavos = $4,
         de_ejemplo = false, actualizado_por = $5, actualizado_en = $6
       where id = $1`,
      [entrada.id, normalizado.nombre, normalizado.mensualidadCentavos, normalizado.speiCentavos, ctx.persona.id, ahora],
    );
    if (cambio.rowCount !== 1) throw new ErrorDeDominio("plan_ausente");
    await auditarOperacion(consulta, ctx, {
      companyId: null,
      accion: "plan_actualizado",
      identificador: entrada.id as string,
      ocurridoEn: ahora,
      cambio: { mensualidad_centavos: normalizado.mensualidadCentavos, spei_centavos: normalizado.speiCentavos },
    });
  });
}

export async function asignarPlan(ctx: ContextoDePersonal, entrada: { companyId: unknown; planId: unknown }): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.empresa.alta");
  if (!uuidValido(entrada.companyId)) throw new ErrorDeDominio("cliente_ausente");
  if (!uuidValido(entrada.planId)) throw new ErrorDeDominio("plan_ausente");
  const ahora = new Date();
  await conContexto(basePlataforma(ctx, entrada.companyId), async (consulta) => {
    const empresa = await consulta.query("select estado from companies where id = $1 for update", [entrada.companyId]);
    const fila = empresa.rows[0] as { estado?: unknown } | undefined;
    if (!fila) throw new ErrorDeDominio("cliente_ausente");
    if (fila.estado === "baja") throw new ErrorDeDominio("cliente_en_baja");
    const elegido = await consulta.query("select nivel from billing_plans where id = $1", [entrada.planId]);
    const nivel = (elegido.rows[0] as { nivel?: unknown } | undefined)?.nivel;
    if (nivel === undefined) throw new ErrorDeDominio("plan_ausente");
    await consulta.query(
      `insert into company_billing_plans (company_id, operator_id, plan_id, asignado_por, asignado_en)
       values ($1, $2, $3, $4, $5)
       on conflict (company_id) do update
       set plan_id = excluded.plan_id, asignado_por = excluded.asignado_por, asignado_en = excluded.asignado_en`,
      [entrada.companyId, ctx.personal.operadorId, entrada.planId, ctx.persona.id, ahora],
    );
    await auditarOperacion(consulta, ctx, {
      companyId: entrada.companyId as string,
      accion: "plan_asignado",
      identificador: entrada.companyId as string,
      ocurridoEn: ahora,
      cambio: { nivel: Number(nivel) },
    });
  });
}

/**
 * Lo que se le cobraría a cada cliente en el mes: la mensualidad de su plan y cada SPEI por su costo. Un SPEI es un
 * pago a proveedor autorizado en el mes. El costo por SPEI es la tarifa propia del cliente si tiene una vigente el
 * último día del mes (Comisiones · tarifas especiales) y, si no, el de su plan. Solo calcula: no genera cargos.
 * Las empresas de demostración y las dadas de baja no se cobran.
 */
export async function cobroDelMes(ctx: ContextoDePersonal, mes: unknown, ahora = new Date()): Promise<CobroDelMes> {
  exigirEnOperacion(ctx, "plataforma.operacion.ver");
  const periodo = periodoDeMes(mes, hoyEnMexico(ahora));
  const resultado = await conContexto(basePlataforma(ctx), (consulta) =>
    consulta.query(
      `select c.id, c.razon_social, c.rfc, c.estado,
         p.id as plan_id, p.nombre as plan_nombre, p.mensualidad_centavos, p.spei_centavos as plan_spei,
         propia.valor as spei_propio,
         coalesce(s.spei, 0) as spei
       from companies c
       left join company_billing_plans cp on cp.company_id = c.id
       left join billing_plans p on p.id = cp.plan_id
       left join lateral (
         select v.valor from company_commissions v
         where v.company_id = c.id and v.tipo = 'spei' and v.estado in ('vigente', 'cerrada')
           and v.vigente_desde <= $3::date and (v.vigente_hasta is null or v.vigente_hasta >= $3::date)
         order by v.vigente_desde desc limit 1
       ) propia on true
       left join spei_autorizados_por_empresa($1::timestamptz, $2::timestamptz) s on s.company_id = c.id
       where not c.demostracion and c.estado <> 'baja'
       order by c.razon_social`,
      [periodo.desde, periodo.hasta, periodo.ultimoDia],
    ),
  );
  const clientes = (resultado.rows as Array<Record<string, unknown>>).map((fila): CobroDeCliente => {
    const conPlan = typeof fila.plan_id === "string";
    const propia = fila.spei_propio === null || fila.spei_propio === undefined ? null : Number(fila.spei_propio);
    const speiCentavos = propia ?? (conPlan ? Number(fila.plan_spei) : 0);
    const mensualidadCentavos = conPlan ? Number(fila.mensualidad_centavos) : 0;
    const spei = Number(fila.spei);
    const cobro = calcularCobro({ mensualidadCentavos, speiCentavos, spei });
    return {
      companyId: String(fila.id),
      razonSocial: String(fila.razon_social),
      rfc: String(fila.rfc),
      estado: fila.estado as EstadoCliente,
      plan: conPlan ? { id: String(fila.plan_id), nombre: String(fila.plan_nombre) } : null,
      mensualidadCentavos,
      spei,
      speiCentavos,
      fuenteSpei: propia !== null ? "tarifa_propia" : conPlan ? "plan" : "sin_plan",
      ...cobro,
    };
  });
  const totalCentavos = clientes.reduce((suma, cliente) => suma + cliente.totalCentavos, 0);
  return { periodo, clientes, totalCentavos };
}

function plan(fila: Record<string, unknown>): PlanDeCobro {
  return {
    id: String(fila.id),
    nivel: Number(fila.nivel),
    nombre: String(fila.nombre),
    mensualidadCentavos: Number(fila.mensualidad_centavos),
    speiCentavos: Number(fila.spei_centavos),
    deEjemplo: fila.de_ejemplo === true,
  };
}
