import type { FrecuenciaNomina } from "../../dominio/nomina";
import type { FrecuenciaObligacion } from "../../dominio/flujo/fechas";
import type { FuentesPresupuesto } from "../../dominio/flujo/presupuestos";
import type { FuentesFlujo, SaldoDeclarado } from "../../dominio/flujo/proyeccion";
import type { Consulta } from "../../nucleo/db";
import { aplicarSentencia } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import {
  booleano,
  centavos,
  centavosPorMes,
  centavosONulo,
  entero,
  fecha,
  fechaONula,
  instante,
  lista,
  registro,
  texto,
  textoONulo,
  unaFila,
} from "./lectura";

/**
 * Las lecturas del flujo. Todas corren dentro de `conContexto` con la empresa
 * de la sesión: RLS filtra, y cada consulta además nombra la empresa ($1).
 * Ninguna escribe.
 */

export type PagoFuente = FuentesFlujo["pagos"][number] & { venceEl: string };
export type ObligacionFuente = FuentesFlujo["obligaciones"][number] & {
  areaId: string | null;
  areaNombre: string | null;
  proveedorNombre: string | null;
};
export type CobroFuente = FuentesFlujo["cobros"][number] & { referencia: string | null };
export type CobradoFuente = FuentesFlujo["cobrados"][number] & { referencia: string | null };
export type NominaFuente = FuentesFlujo["nomina"][number] & { areaId: string | null };

export type Fuentes = {
  nomina: NominaFuente[];
  lotes: FuentesFlujo["lotes"][number][];
  pagos: PagoFuente[];
  obligaciones: ObligacionFuente[];
  cobros: CobroFuente[];
  cobrados: CobradoFuente[];
};

const SQL_SALDO = `
  select
    (select json_build_object(
        'centavos', d.saldo_centavos::text,
        'al_dia', to_char(d.al_dia, 'YYYY-MM-DD'),
        'autor', u.nombre,
        'declarado_en', d.declarado_en)
       from cash_balance_declarations d
       join users u on u.id = d.declarado_por
      where d.company_id = $1
      order by d.al_dia desc, d.declarado_en desc, d.id desc
      limit 1) as saldo,
    (select s.colchon_centavos::text from cash_flow_settings s where s.company_id = $1) as colchon
`;

export async function leerSaldo(consulta: Consulta, empresaId: string): Promise<{ saldo: SaldoDeclarado | null; colchonCentavos: number }> {
  const fila = unaFila(await aplicarSentencia(consulta, SQL_SALDO, [empresaId]));
  const saldo = fila.saldo === null || fila.saldo === undefined ? null : registro(fila.saldo);
  return {
    saldo: saldo
      ? { centavos: centavos(saldo.centavos), alDia: fecha(saldo.al_dia), autor: texto(saldo.autor), declaradoEn: instante(saldo.declarado_en) }
      : null,
    colchonCentavos: fila.colchon === null || fila.colchon === undefined ? 0 : centavos(fila.colchon),
  };
}

/**
 * Las fuentes del flujo con fecha entre $2 y $3. Pagos: sin anulados, ni
 * rechazados ni cancelados (un cargo sin solicitud todavía cuenta), y también
 * los de antes de $2 con su estado: la proyección da por pagados los
 * autorizados y lleva los no autorizados como vencidos sin autorizar.
 * Cobros: los esperados por su fecha probable y los cobrados por la fecha en
 * que llegó el dinero; con ellos, el saldo de los cargos de cobranza y los
 * pagos recibidos (0031), sin copiarlos a expected_collections. Nómina y obligaciones: su base, para que el
 * dominio arme la serie.
 */
export const SQL_FUENTES = `
  select
    coalesce((select json_agg(json_build_object(
        'neto', p.neto_centavos::text, 'frecuencia', p.frecuencia,
        'proximo', to_char(p.proximo_pago_en, 'YYYY-MM-DD'), 'ancla', p.ancla_dia,
        'alta', to_char(e.alta_en, 'YYYY-MM-DD'), 'baja', to_char(e.baja_en, 'YYYY-MM-DD'),
        'area', e.cost_center_id) order by p.employee_id)
       from employee_payroll_profiles p
       join employees e on e.id = p.employee_id and e.company_id = p.company_id
      where p.company_id = $1 and p.activa and p.proximo_pago_en <= $3::date
        and (e.baja_en is null or e.baja_en >= $2::date)), '[]'::json) as nomina,
    coalesce((select json_agg(json_build_object(
        'id', b.id, 'fecha', to_char(b.fecha_pago, 'YYYY-MM-DD'), 'total', b.total_centavos::text,
        'personas', (select count(*) from payroll_batch_items i where i.batch_id = b.id and i.company_id = b.company_id)) order by b.fecha_pago, b.id)
       from payroll_batches b
      where b.company_id = $1 and b.fecha_pago between $2::date and $3::date), '[]'::json) as lotes,
    coalesce((select json_agg(json_build_object(
        'id', p.id, 'proveedor', coalesce(s.nombre_comercial, s.razon_social), 'referencia', p.referencia,
        'total', p.total_centavos::text, 'programada', to_char(p.programada_el, 'YYYY-MM-DD'),
        'vence', to_char(p.vence_el, 'YYYY-MM-DD'), 'estado', coalesce(r.estado, 'sin_solicitud')) order by p.programada_el, p.id)
       from supplier_payables p
       join suppliers s on s.id = p.supplier_id and s.company_id = p.company_id
       left join supplier_payment_requests r on r.payable_id = p.id and r.company_id = p.company_id
      where p.company_id = $1 and p.anulado_en is null
        and p.programada_el <= $3::date
        and coalesce(r.estado, 'por_autorizar') in ('por_autorizar', 'listo_para_pagar')), '[]'::json) as pagos,
    coalesce((select json_agg(json_build_object(
        'id', o.id, 'concepto', o.concepto, 'monto', o.monto_centavos::text, 'frecuencia', o.frecuencia,
        'proxima', to_char(o.proxima_fecha, 'YYYY-MM-DD'), 'ancla', o.ancla_dia,
        'area', o.cost_center_id, 'area_nombre', c.nombre,
        'proveedor_nombre', coalesce(s.nombre_comercial, s.razon_social),
        -- Por mes, lo que el proveedor de la obligación ya trae en cargos vivos: se descuenta de la obligación.
        'cargos_por_mes', case when o.supplier_id is null then '{}'::json else (select coalesce(json_object_agg(x.mes, x.total::text), '{}'::json)
           from (select to_char(p.programada_el, 'YYYY-MM') as mes, sum(p.total_centavos) as total
                   from supplier_payables p
                   left join supplier_payment_requests r on r.payable_id = p.id and r.company_id = p.company_id
                  where p.company_id = $1 and p.supplier_id = o.supplier_id and p.anulado_en is null
                    and p.programada_el between date_trunc('month', $2::date)::date and $3::date
                    and coalesce(r.estado, 'por_autorizar') in ('por_autorizar', 'listo_para_pagar')
                  group by 1) x) end) order by o.proxima_fecha, o.id)
       from recurring_obligations o
       left join cost_centers c on c.id = o.cost_center_id and c.company_id = o.company_id
       left join suppliers s on s.id = o.supplier_id and s.company_id = o.company_id
      where o.company_id = $1 and o.activa and o.proxima_fecha <= $3::date), '[]'::json) as obligaciones,
    coalesce((select json_agg(json_build_object(
        'id', x.id, 'cliente', x.cliente, 'concepto', x.concepto, 'monto', x.monto::text,
        'fecha', to_char(x.fecha, 'YYYY-MM-DD'), 'referencia', x.referencia) order by x.fecha, x.id)
       from (
         select k.id, k.cliente_nombre as cliente, k.concepto, k.monto_centavos as monto, k.fecha_probable as fecha, k.referencia
           from expected_collections k
          where k.company_id = $1 and k.estado = 'esperado'
            and k.fecha_probable between $2::date and $3::date
         -- Cobranza (0031): lo que falta por pagar de cada cargo emitido, por su vencimiento. No se copia a expected_collections.
         union all
         select c.id, n.nombre, c.concepto, c.monto_centavos - c.pagado_centavos, c.vencimiento, c.referencia
           from collection_charges c
           join collection_customers n on n.id = c.customer_id and n.company_id = c.company_id
          where c.company_id = $1 and c.estado = 'emitido'
            and c.vencimiento between $2::date and $3::date
       ) x), '[]'::json) as cobros,
    coalesce((select json_agg(json_build_object(
        'id', x.id, 'cliente', x.cliente, 'concepto', x.concepto, 'monto', x.monto::text,
        'cobrado', to_char(x.fecha, 'YYYY-MM-DD'), 'referencia', x.referencia) order by x.fecha, x.id)
       from (
         select k.id, k.cliente_nombre as cliente, k.concepto, k.monto_centavos as monto, k.cobrado_el as fecha, k.referencia
           from expected_collections k
          where k.company_id = $1 and k.estado = 'cobrado'
            and k.cobrado_el between $2::date and $3::date
         -- Cobranza: cada pago que llegó, completo (lo aplicado y el saldo a favor), por el día en que llegó.
         union all
         select p.id, coalesce(n.nombre, 'Pago sin identificar'), 'Pago recibido', p.monto_centavos, p.recibido_el, p.clave_rastreo
           from collection_payments p
           left join collection_customers n on n.id = p.customer_id and n.company_id = p.company_id
          where p.company_id = $1 and p.estado not in ('anulado', 'devuelto')
            and p.recibido_el between $2::date and $3::date
       ) x), '[]'::json) as cobrados
`;

export async function leerFuentes(consulta: Consulta, empresaId: string, desde: string, hasta: string): Promise<Fuentes> {
  const fila = unaFila(await aplicarSentencia(consulta, SQL_FUENTES, [empresaId, desde, hasta]));
  return {
    nomina: lista(fila.nomina).map((p) => ({
      netoCentavos: centavos(p.neto),
      frecuencia: frecuenciaNomina(p.frecuencia),
      proximoPagoEn: fecha(p.proximo),
      anclaDia: entero(p.ancla),
      altaEn: fecha(p.alta),
      bajaEn: fechaONula(p.baja),
      areaId: textoONulo(p.area),
    })),
    lotes: lista(fila.lotes).map((b) => ({ id: texto(b.id), fechaPago: fecha(b.fecha), totalCentavos: centavos(b.total), personas: entero(b.personas) })),
    pagos: lista(fila.pagos).map((p) => ({
      id: texto(p.id),
      proveedor: texto(p.proveedor),
      referencia: texto(p.referencia),
      totalCentavos: centavos(p.total),
      programadaEl: fecha(p.programada),
      venceEl: fecha(p.vence),
      estado: estadoPago(p.estado),
    })),
    obligaciones: lista(fila.obligaciones).map((o) => ({
      id: texto(o.id),
      concepto: texto(o.concepto),
      montoCentavos: centavos(o.monto),
      frecuencia: frecuenciaObligacion(o.frecuencia),
      proximaFecha: fecha(o.proxima),
      anclaDia: entero(o.ancla),
      areaId: textoONulo(o.area),
      areaNombre: textoONulo(o.area_nombre),
      proveedorNombre: textoONulo(o.proveedor_nombre),
      cargosPorMes: centavosPorMes(o.cargos_por_mes),
    })),
    cobros: lista(fila.cobros).map((k) => ({
      id: texto(k.id),
      cliente: texto(k.cliente),
      concepto: texto(k.concepto),
      montoCentavos: centavos(k.monto),
      fechaProbable: fecha(k.fecha),
      referencia: textoONulo(k.referencia),
    })),
    cobrados: lista(fila.cobrados).map((k) => ({
      id: texto(k.id),
      cliente: texto(k.cliente),
      concepto: texto(k.concepto),
      montoCentavos: centavos(k.monto),
      cobradoEl: fecha(k.cobrado),
      referencia: textoONulo(k.referencia),
    })),
  };
}

export const SQL_PRESUPUESTOS = `
  select
    coalesce((select json_agg(json_build_object(
        'id', c.id, 'nombre', c.nombre, 'presupuesto', c.presupuesto_mensual_centavos::text) order by lower(c.nombre), c.id)
       from cost_centers c where c.company_id = $1), '[]'::json) as areas,
    coalesce((select json_agg(json_build_object('area', e.cost_center_id, 'neto', p.neto_centavos::text, 'frecuencia', p.frecuencia))
       from employee_payroll_profiles p
       join employees e on e.id = p.employee_id and e.company_id = p.company_id
      where p.company_id = $1 and p.activa and e.cost_center_id is not null
        and e.alta_en <= $3::date
        and (e.baja_en is null or e.baja_en >= $2::date)), '[]'::json) as nomina,
    coalesce((select json_agg(json_build_object('area', x.area, 'centavos', x.total::text)) from (
        select s.cost_center_id as area, sum(p.total_centavos) as total
          from supplier_payables p
          join suppliers s on s.id = p.supplier_id and s.company_id = p.company_id
          left join supplier_payment_requests r on r.payable_id = p.id and r.company_id = p.company_id
         where p.company_id = $1 and s.cost_center_id is not null and p.anulado_en is null
           and p.programada_el between $2::date and $3::date
           and coalesce(r.estado, 'por_autorizar') not in ('rechazado', 'cancelado')
         group by s.cost_center_id) x), '[]'::json) as pagos,
    coalesce((select json_agg(json_build_object(
        'area', o.cost_center_id, 'monto', o.monto_centavos::text, 'frecuencia', o.frecuencia,
        'proxima', to_char(o.proxima_fecha, 'YYYY-MM-DD'), 'ancla', o.ancla_dia,
        'cargos_por_mes', case when o.supplier_id is null then '{}'::json else (select coalesce(json_object_agg(x.mes, x.total::text), '{}'::json)
           from (select to_char(p.programada_el, 'YYYY-MM') as mes, sum(p.total_centavos) as total
                   from supplier_payables p
                   left join supplier_payment_requests r on r.payable_id = p.id and r.company_id = p.company_id
                  where p.company_id = $1 and p.supplier_id = o.supplier_id and p.anulado_en is null
                    and p.programada_el between date_trunc('month', $2::date)::date and $3::date
                    and coalesce(r.estado, 'por_autorizar') in ('por_autorizar', 'listo_para_pagar')
                  group by 1) x) end))
       from recurring_obligations o
      where o.company_id = $1 and o.activa and o.cost_center_id is not null and o.proxima_fecha <= $3::date), '[]'::json) as obligaciones,
    coalesce((select json_agg(json_build_object(
        'id', e.id, 'nombre', e.nombre, 'area', c.nombre, 'presupuesto', e.presupuesto_mensual_centavos::text,
        'pagos', coalesce(g.total, 0)::text) order by e.nombre, e.id)
       from employees e
       left join cost_centers c on c.id = e.cost_center_id and c.company_id = e.company_id
       -- Una sola pasada por las solicitudes del mes, agrupada por quien pidió; no una subconsulta por persona.
       left join (
         select r.solicitado_por, sum(p.total_centavos) as total
           from supplier_payment_requests r
           join supplier_payables p on p.id = r.payable_id and p.company_id = r.company_id
          where r.company_id = $1 and r.estado not in ('rechazado', 'cancelado') and p.anulado_en is null
            and p.programada_el between $2::date and $3::date
          group by r.solicitado_por) g on g.solicitado_por = e.user_id
      where e.company_id = $1 and e.presupuesto_mensual_centavos is not null
        and (e.baja_en is null or e.baja_en >= $2::date)), '[]'::json) as personas
`;

export async function leerFuentesPresupuesto(
  consulta: Consulta,
  empresaId: string,
  hoy: string,
  desde: string,
  hasta: string,
): Promise<FuentesPresupuesto> {
  const fila = unaFila(await aplicarSentencia(consulta, SQL_PRESUPUESTOS, [empresaId, desde, hasta]));
  return {
    hoy,
    areas: lista(fila.areas).map((a) => ({ id: texto(a.id), nombre: texto(a.nombre), presupuestoCentavos: centavosONulo(a.presupuesto) })),
    nomina: lista(fila.nomina).map((p) => ({ areaId: textoONulo(p.area), netoCentavos: centavos(p.neto), frecuencia: frecuenciaNomina(p.frecuencia) })),
    pagosPorArea: lista(fila.pagos).map((p) => ({ areaId: texto(p.area), centavos: centavos(p.centavos) })),
    obligaciones: lista(fila.obligaciones).map((o) => ({
      areaId: textoONulo(o.area),
      montoCentavos: centavos(o.monto),
      frecuencia: frecuenciaObligacion(o.frecuencia),
      proximaFecha: fecha(o.proxima),
      anclaDia: entero(o.ancla),
      cargosPorMes: centavosPorMes(o.cargos_por_mes),
    })),
    personas: lista(fila.personas).map((p) => ({
      id: texto(p.id),
      nombre: texto(p.nombre),
      areaNombre: textoONulo(p.area),
      presupuestoCentavos: centavos(p.presupuesto),
      pagosCentavos: centavos(p.pagos),
    })),
  };
}

export type DeclaracionVista = { id: string; centavos: number; alDia: string; autor: string; declaradoEn: string };

export async function leerHistorialSaldo(consulta: Consulta, empresaId: string): Promise<DeclaracionVista[]> {
  const resultado = await aplicarSentencia(
    consulta,
    `select d.id, d.saldo_centavos::text as centavos, to_char(d.al_dia, 'YYYY-MM-DD') as al_dia, u.nombre as autor, d.declarado_en
       from cash_balance_declarations d
       join users u on u.id = d.declarado_por
      where d.company_id = $1
      order by d.declarado_en desc, d.id desc
      limit 50`,
    [empresaId],
  );
  return resultado.rows.map(registro).map((d) => ({
    id: texto(d.id),
    centavos: centavos(d.centavos),
    alDia: fecha(d.al_dia),
    autor: texto(d.autor),
    declaradoEn: instante(d.declarado_en),
  }));
}

export type CobroVista = {
  id: string;
  origen: "manual" | "cfdi";
  cliente: string;
  rfc: string | null;
  concepto: string;
  montoCentavos: number;
  fechaProbable: string;
  referencia: string | null;
  cfdiUuid: string | null;
  estado: "esperado" | "cobrado" | "cancelado";
  cobradoEl: string | null;
  motivo: string | null;
  creadoPor: string | null;
};

export async function leerCobros(consulta: Consulta, empresaId: string): Promise<CobroVista[]> {
  const resultado = await aplicarSentencia(
    consulta,
    `select k.id, k.origen, k.cliente_nombre, k.cliente_rfc, k.concepto, k.monto_centavos::text as monto,
            to_char(k.fecha_probable, 'YYYY-MM-DD') as fecha, k.referencia, k.cfdi_uuid, k.estado,
            to_char(k.cobrado_el, 'YYYY-MM-DD') as cobrado_el, k.motivo_cancelacion, u.nombre as creado_por
       from expected_collections k
       left join users u on u.id = k.creado_por
      where k.company_id = $1
      order by (k.estado = 'esperado') desc, k.fecha_probable, k.id
      limit 500`,
    [empresaId],
  );
  return resultado.rows.map(registro).map((k) => ({
    id: texto(k.id),
    origen: k.origen === "cfdi" ? "cfdi" : "manual",
    cliente: texto(k.cliente_nombre),
    rfc: textoONulo(k.cliente_rfc),
    concepto: texto(k.concepto),
    montoCentavos: centavos(k.monto),
    fechaProbable: fecha(k.fecha),
    referencia: textoONulo(k.referencia),
    cfdiUuid: textoONulo(k.cfdi_uuid),
    estado: estadoCobro(k.estado),
    cobradoEl: fechaONula(k.cobrado_el),
    motivo: textoONulo(k.motivo_cancelacion),
    creadoPor: textoONulo(k.creado_por),
  }));
}

/** Totales sin el tope de la lista: lo que se espera cobrar y lo vencido. */
export async function leerTotalesCobro(
  consulta: Consulta,
  empresaId: string,
  hoy: string,
): Promise<{ porCobrar: number; vencidos: number; vencidosCentavos: number }> {
  const fila = unaFila(await aplicarSentencia(
    consulta,
    `select coalesce(sum(monto), 0)::text as por_cobrar,
            count(*) filter (where fecha < $2::date) as vencidos,
            coalesce(sum(monto) filter (where fecha < $2::date), 0)::text as vencidos_centavos
       from (
         select monto_centavos as monto, fecha_probable as fecha
           from expected_collections
          where company_id = $1 and estado = 'esperado'
         union all
         -- Cobranza (0031): el saldo de cada cargo emitido.
         select monto_centavos - pagado_centavos, vencimiento
           from collection_charges
          where company_id = $1 and estado = 'emitido'
       ) x`,
    [empresaId, hoy],
  ));
  return { porCobrar: centavos(fila.por_cobrar), vencidos: entero(fila.vencidos), vencidosCentavos: centavos(fila.vencidos_centavos) };
}

export type ObligacionVista = {
  id: string;
  concepto: string;
  montoCentavos: number;
  frecuencia: FrecuenciaObligacion;
  proximaFecha: string;
  areaId: string | null;
  areaNombre: string | null;
  proveedorId: string | null;
  proveedorNombre: string | null;
};

export async function leerObligaciones(consulta: Consulta, empresaId: string): Promise<ObligacionVista[]> {
  const resultado = await aplicarSentencia(
    consulta,
    `select o.id, o.concepto, o.monto_centavos::text as monto, o.frecuencia, to_char(o.proxima_fecha, 'YYYY-MM-DD') as proxima,
            o.cost_center_id, c.nombre as area, o.supplier_id, coalesce(s.nombre_comercial, s.razon_social) as proveedor
       from recurring_obligations o
       left join cost_centers c on c.id = o.cost_center_id and c.company_id = o.company_id
       left join suppliers s on s.id = o.supplier_id and s.company_id = o.company_id
      where o.company_id = $1 and o.activa
      order by o.proxima_fecha, lower(o.concepto), o.id`,
    [empresaId],
  );
  return resultado.rows.map(registro).map((o) => ({
    id: texto(o.id),
    concepto: texto(o.concepto),
    montoCentavos: centavos(o.monto),
    frecuencia: frecuenciaObligacion(o.frecuencia),
    proximaFecha: fecha(o.proxima),
    areaId: textoONulo(o.cost_center_id),
    areaNombre: textoONulo(o.area),
    proveedorId: textoONulo(o.supplier_id),
    proveedorNombre: textoONulo(o.proveedor),
  }));
}

export async function leerAreas(consulta: Consulta, empresaId: string): Promise<{ id: string; nombre: string }[]> {
  const resultado = await aplicarSentencia(
    consulta,
    "select id, nombre from cost_centers where company_id = $1 order by lower(nombre), id",
    [empresaId],
  );
  return resultado.rows.map(registro).map((a) => ({ id: texto(a.id), nombre: texto(a.nombre) }));
}

export type ProveedorConArea = { id: string; nombre: string; rfc: string; areaId: string | null; areaNombre: string | null };

export async function leerProveedoresConArea(consulta: Consulta, empresaId: string): Promise<ProveedorConArea[]> {
  const resultado = await aplicarSentencia(
    consulta,
    `select s.id, coalesce(s.nombre_comercial, s.razon_social) as nombre, s.rfc, s.cost_center_id, c.nombre as area
       from suppliers s
       left join cost_centers c on c.id = s.cost_center_id and c.company_id = s.company_id
      where s.company_id = $1 and s.activo
      order by lower(coalesce(s.nombre_comercial, s.razon_social)), s.id
      limit 500`,
    [empresaId],
  );
  return resultado.rows.map(registro).map((s) => ({
    id: texto(s.id),
    nombre: texto(s.nombre),
    rfc: texto(s.rfc),
    areaId: textoONulo(s.cost_center_id),
    areaNombre: textoONulo(s.area),
  }));
}

/** El aviso de la persona: su elección o, sin elección, el de su rol. */
export async function leerPreferenciaCorreo(consulta: Consulta, empresaId: string, userId: string): Promise<boolean> {
  const fila = unaFila(await aplicarSentencia(
    consulta,
    `select coalesce(
        (select p.activo from weekly_digest_preferences p where p.company_id = $1 and p.user_id = $2),
        exists (select 1 from membership_roles r
                 where r.company_id = $1 and r.user_id = $2 and r.rol in ('administrador', 'finanzas'))
      ) as activo`,
    [empresaId, userId],
  ));
  return booleano(fila.activo);
}

function frecuenciaNomina(valor: unknown): FrecuenciaNomina {
  if (valor === "semanal" || valor === "quincenal" || valor === "mensual") return valor;
  throw new ErrorDeDominio("base_no_disponible");
}

function frecuenciaObligacion(valor: unknown): FrecuenciaObligacion {
  if (valor === "semanal" || valor === "mensual" || valor === "bimestral" || valor === "trimestral" || valor === "anual") return valor;
  throw new ErrorDeDominio("base_no_disponible");
}

function estadoPago(valor: unknown): PagoFuente["estado"] {
  if (valor === "por_autorizar" || valor === "listo_para_pagar" || valor === "sin_solicitud") return valor;
  throw new ErrorDeDominio("base_no_disponible");
}

function estadoCobro(valor: unknown): CobroVista["estado"] {
  if (valor === "esperado" || valor === "cobrado" || valor === "cancelado") return valor;
  throw new ErrorDeDominio("base_no_disponible");
}
