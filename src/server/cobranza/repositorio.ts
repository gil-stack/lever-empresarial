import { CUBETAS, dso, type Cubeta } from "../../dominio/cobranza/antiguedad";
import { esPeriodicidad, type Periodicidad } from "../../dominio/cobranza/periodos";
import type { TipoCorreo } from "../../dominio/cobranza/recordatorios";
import { INSTITUCIONES_TRADICIONALES } from "../../dominio/clabe-proveedor";
import { desplazar, primeroDelMes } from "../../dominio/flujo/fechas";
import { aplicarSentencia, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import {
  booleano,
  centavos,
  centavosONulo,
  entero,
  fecha,
  fechaONula,
  instante,
  instanteONulo,
  lista,
  registro,
  texto,
  textoONulo,
  unaFila,
} from "../flujo/lectura";

/**
 * Lecturas de cobranza. Todas corren dentro de `conContexto` con la empresa:
 * RLS filtra y cada consulta además nombra la empresa ($1). Ninguna escribe.
 * La lista se pagina; el resumen sale de una sola consulta agregada.
 */

export type ConfiguracionCobranza = {
  clabe: string;
  banco: string | null;
  beneficiario: string;
  correoContacto: string | null;
  emitirDiasAntes: number;
  antesDias: number;
  avisoElDia: boolean;
  despuesCadaDias: number;
  despuesTope: number;
  envioAutomatico: boolean;
  actualizadoEn: string;
  actualizadoPor: string | null;
};

export function bancoDeClabe(clabe: string): string | null {
  return INSTITUCIONES_TRADICIONALES[clabe.slice(0, 3)] ?? null;
}

export async function leerConfiguracion(consulta: Consulta, empresaId: string): Promise<ConfiguracionCobranza | null> {
  const r = await aplicarSentencia(
    consulta,
    `select s.clabe, s.beneficiario, s.correo_contacto, s.emitir_dias_antes, s.antes_dias, s.aviso_el_dia,
            s.despues_cada_dias, s.despues_tope, s.envio_automatico, s.actualizado_en, u.nombre as autor
       from collection_settings s
       left join users u on u.id = s.actualizado_por
      where s.company_id = $1`,
    [empresaId],
  );
  const fila = r.rows[0] ? registro(r.rows[0]) : null;
  if (!fila) return null;
  const clabe = texto(fila.clabe);
  return {
    clabe,
    banco: bancoDeClabe(clabe),
    beneficiario: texto(fila.beneficiario),
    correoContacto: textoONulo(fila.correo_contacto),
    emitirDiasAntes: entero(fila.emitir_dias_antes),
    antesDias: entero(fila.antes_dias),
    avisoElDia: booleano(fila.aviso_el_dia),
    despuesCadaDias: entero(fila.despues_cada_dias),
    despuesTope: entero(fila.despues_tope),
    envioAutomatico: booleano(fila.envio_automatico),
    actualizadoEn: instante(fila.actualizado_en),
    actualizadoPor: textoONulo(fila.autor),
  };
}

// Resumen ------------------------------------------------------------------------------

export type ResumenCobranza = {
  porCobrar: number;
  vencidoCentavos: number;
  vencidos: number;
  cobradoMes: number;
  dso: number | null;
  antiguedad: Record<Cubeta, { centavos: number; cargos: number }>;
  faltaMonto: number;
  porConciliar: number;
  correosFallidos: number;
  clientesActivos: number;
};

/**
 * Lo pendiente junta los cargos emitidos (su saldo) y los cobros sueltos
 * esperados de 0026; lo cobrado del mes, los pagos que llegaron (completos) y
 * los cobros sueltos marcados como cobrados. DSO con 90 días de emitido.
 */
export async function leerResumen(consulta: Consulta, empresaId: string, hoy: string): Promise<ResumenCobranza> {
  const fila = unaFila(await aplicarSentencia(
    consulta,
    `with pendientes as (
       select monto_centavos - pagado_centavos as saldo, vencimiento
         from collection_charges where company_id = $1 and estado = 'emitido'
       union all
       select monto_centavos, fecha_probable from expected_collections where company_id = $1 and estado = 'esperado'
     )
     select
       coalesce(sum(saldo), 0)::text as por_cobrar,
       coalesce(sum(saldo) filter (where vencimiento < $2::date), 0)::text as vencido,
       count(*) filter (where vencimiento < $2::date) as vencidos,
       coalesce(sum(saldo) filter (where vencimiento >= $2::date), 0)::text as b0,
       count(*) filter (where vencimiento >= $2::date) as n0,
       coalesce(sum(saldo) filter (where $2::date - vencimiento between 1 and 30), 0)::text as b1,
       count(*) filter (where $2::date - vencimiento between 1 and 30) as n1,
       coalesce(sum(saldo) filter (where $2::date - vencimiento between 31 and 60), 0)::text as b2,
       count(*) filter (where $2::date - vencimiento between 31 and 60) as n2,
       coalesce(sum(saldo) filter (where $2::date - vencimiento between 61 and 90), 0)::text as b3,
       count(*) filter (where $2::date - vencimiento between 61 and 90) as n3,
       coalesce(sum(saldo) filter (where $2::date - vencimiento > 90), 0)::text as b4,
       count(*) filter (where $2::date - vencimiento > 90) as n4,
       ((select coalesce(sum(monto_centavos), 0) from collection_payments
          where company_id = $1 and estado <> 'anulado' and recibido_el between $3::date and $2::date)
        + (select coalesce(sum(monto_centavos), 0) from expected_collections
          where company_id = $1 and estado = 'cobrado' and cobrado_el between $3::date and $2::date))::text as cobrado_mes,
       ((select coalesce(sum(monto_centavos), 0) from collection_charges
          where company_id = $1 and estado in ('emitido', 'pagado')
            and (timezone('America/Mexico_City', emitido_en))::date between $4::date and $2::date)
        + (select coalesce(sum(monto_centavos), 0) from expected_collections
          where company_id = $1 and estado <> 'cancelado'
            and (timezone('America/Mexico_City', creado_en))::date between $4::date and $2::date))::text as emitido_ventana,
       (select count(*) from collection_charges where company_id = $1 and estado = 'por_emitir') as falta_monto,
       (select count(*) from collection_payments where company_id = $1 and estado = 'abierto') as por_conciliar,
       (select count(*) from collection_emails where company_id = $1 and estado = 'fallido') as correos_fallidos,
       (select count(*) from collection_customers where company_id = $1 and estado = 'activo') as clientes
     from pendientes`,
    [empresaId, hoy, primeroDelMes(hoy), desplazar(hoy, -89)],
  ));
  const porCobrar = centavos(fila.por_cobrar);
  const antiguedad = Object.fromEntries(
    CUBETAS.map((cubeta, i) => [cubeta, { centavos: centavos(fila[`b${i}`]), cargos: entero(fila[`n${i}`]) }]),
  ) as Record<Cubeta, { centavos: number; cargos: number }>;
  return {
    porCobrar,
    vencidoCentavos: centavos(fila.vencido),
    vencidos: entero(fila.vencidos),
    cobradoMes: centavos(fila.cobrado_mes),
    dso: dso(porCobrar, centavos(fila.emitido_ventana)),
    antiguedad,
    faltaMonto: entero(fila.falta_monto),
    porConciliar: entero(fila.por_conciliar),
    correosFallidos: entero(fila.correos_fallidos),
    clientesActivos: entero(fila.clientes),
  };
}

// Lista de cargos ----------------------------------------------------------------------

export type EstadoFila = "por_emitir" | "emitido" | "pagado" | "cancelado" | "omitido";
export type OrigenFila = "plan" | "unico" | "manual" | "cfdi";

export type FilaCargo = {
  tipo: "cargo" | "cobro_suelto";
  id: string;
  clienteId: string | null;
  cliente: string;
  rfc: string | null;
  concepto: string;
  origen: OrigenFila;
  periodicidad: Periodicidad | null;
  montoCentavos: number | null;
  pagadoCentavos: number;
  vencimiento: string;
  referencia: string | null;
  estado: EstadoFila;
  pagadoEl: string | null;
  motivo: string | null;
  ultimoCorreo: { tipo: TipoCorreo; estado: string; en: string } | null;
};

export const FILTROS_ESTADO = ["todos", "por_emitir", "por_vencer", "vencido", "pagado", "cancelado"] as const;
export type FiltroEstado = (typeof FILTROS_ESTADO)[number];

export type FiltrosCargos = {
  estado: FiltroEstado;
  cubeta: Cubeta | null;
  /** Busca en cliente, concepto y referencia. */
  q: string | null;
  clienteId: string | null;
  pagina: number;
};

export const POR_PAGINA = 50;

const SQL_FILAS = `
  select * from (
    select 'cargo' as tipo, c.id, c.customer_id as cliente_id, n.nombre as cliente, n.rfc, c.concepto,
           case when c.plan_id is null then 'unico' else 'plan' end as origen, p.periodicidad,
           c.monto_centavos::text as monto, c.pagado_centavos::text as pagado, c.vencimiento, c.referencia, c.estado,
           c.pagado_el, c.motivo,
           (select json_build_object('tipo', m.tipo, 'estado', m.estado, 'en', m.intentado_en)
              from collection_emails m where m.company_id = c.company_id and m.charge_id = c.id
             order by m.intentado_en desc limit 1) as ultimo_correo
      from collection_charges c
      join collection_customers n on n.id = c.customer_id and n.company_id = c.company_id
      left join collection_plans p on p.id = c.plan_id and p.company_id = c.company_id
     where c.company_id = $1
    union all
    select 'cobro_suelto', k.id, null, k.cliente_nombre, k.cliente_rfc, k.concepto, k.origen, null,
           k.monto_centavos::text, case when k.estado = 'cobrado' then k.monto_centavos else 0 end::text, k.fecha_probable,
           k.referencia, case k.estado when 'esperado' then 'emitido' when 'cobrado' then 'pagado' else 'cancelado' end,
           k.cobrado_el, k.motivo_cancelacion, null
      from expected_collections k
     where k.company_id = $1 and $7::uuid is null
  ) f
  where ($7::uuid is null or f.cliente_id = $7::uuid)
    and (case $2::text
           when 'por_emitir' then f.estado = 'por_emitir'
           when 'por_vencer' then f.estado = 'emitido' and f.vencimiento >= $3::date
           when 'vencido' then f.estado = 'emitido' and f.vencimiento < $3::date
           when 'pagado' then f.estado = 'pagado'
           when 'cancelado' then f.estado in ('cancelado', 'omitido')
           else true end)
    and ($4::date is null or (f.estado = 'emitido' and f.vencimiento >= $4::date))
    and ($5::date is null or (f.estado = 'emitido' and f.vencimiento <= $5::date))
    and ($6::text is null or f.cliente ilike '%' || $6 || '%' or f.concepto ilike '%' || $6 || '%' or f.referencia = $6)
`;

/**
 * Urgencia primero: sin monto, vencidos (el más viejo arriba), por vencer
 * (el más próximo arriba) y al final lo resuelto (lo más reciente arriba).
 */
const ORDEN = `
  order by case when f.estado = 'por_emitir' then 0
                when f.estado = 'emitido' and f.vencimiento < $3::date then 1
                when f.estado = 'emitido' then 2 else 3 end,
           case when f.estado in ('por_emitir', 'emitido') then f.vencimiento end asc,
           f.vencimiento desc, f.id
`;

function escaparLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function leerCargos(
  consulta: Consulta,
  empresaId: string,
  hoy: string,
  filtros: FiltrosCargos,
  rango: { desde: string | null; hasta: string | null },
): Promise<{ filas: FilaCargo[]; total: number }> {
  const params = [empresaId, filtros.estado, hoy, rango.desde, rango.hasta, filtros.q ? escaparLike(filtros.q) : null, filtros.clienteId];
  const total = entero(unaFila(await aplicarSentencia(consulta, `select count(*) as n from (${SQL_FILAS}) t`, params)).n);
  const r = await aplicarSentencia(
    consulta,
    `${SQL_FILAS} ${ORDEN} limit ${POR_PAGINA} offset $8`,
    [...params, Math.max(0, filtros.pagina - 1) * POR_PAGINA],
  );
  return { filas: r.rows.map(registro).map(filaCargo), total };
}

function filaCargo(f: Record<string, unknown>): FilaCargo {
  const ultimo = f.ultimo_correo ? registro(f.ultimo_correo) : null;
  return {
    tipo: f.tipo === "cobro_suelto" ? "cobro_suelto" : "cargo",
    id: texto(f.id),
    clienteId: textoONulo(f.cliente_id),
    cliente: texto(f.cliente),
    rfc: textoONulo(f.rfc),
    concepto: texto(f.concepto),
    origen: (["plan", "unico", "manual", "cfdi"] as const).find((o) => o === f.origen) ?? "manual",
    periodicidad: esPeriodicidad(f.periodicidad) ? f.periodicidad : null,
    montoCentavos: centavosONulo(f.monto),
    pagadoCentavos: centavos(f.pagado),
    vencimiento: fechaDe(f.vencimiento),
    referencia: textoONulo(f.referencia),
    estado: estadoFila(f.estado),
    pagadoEl: f.pagado_el ? fechaDe(f.pagado_el) : null,
    motivo: textoONulo(f.motivo),
    ultimoCorreo: ultimo ? { tipo: texto(ultimo.tipo) as TipoCorreo, estado: texto(ultimo.estado), en: instante(ultimo.en) } : null,
  };
}

function estadoFila(valor: unknown): EstadoFila {
  const estados: readonly EstadoFila[] = ["por_emitir", "emitido", "pagado", "cancelado", "omitido"];
  const e = estados.find((x) => x === valor);
  if (!e) throw new ErrorDeDominio("base_no_disponible");
  return e;
}

/** pg entrega `date` como Date a medianoche local o como texto según la consulta; aquí siempre YYYY-MM-DD. */
export function fechaDe(valor: unknown): string {
  if (valor instanceof Date) {
    const y = valor.getFullYear();
    const m = String(valor.getMonth() + 1).padStart(2, "0");
    const d = String(valor.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return fecha(valor);
}

// Clientes -------------------------------------------------------------------------------

export type ClienteVista = {
  id: string;
  nombre: string;
  rfc: string | null;
  correos: string[];
  estado: "activo" | "archivado";
  recordatorios: boolean;
  recordatoriosPor: "empresa" | "pagador" | null;
  plan: { tipo: "fijo" | "variable"; periodicidad: Periodicidad; montoCentavos: number | null; estado: string } | null;
  pendienteCentavos: number;
  vencidoCentavos: number;
  saldoAFavor: number;
  proximoVencimiento: string | null;
};

const SQL_CLIENTES = `
  select k.id, k.nombre, k.rfc, k.correos, k.estado, k.recordatorios, k.recordatorios_por,
         (select json_build_object('tipo', p.tipo, 'periodicidad', p.periodicidad, 'monto', p.monto_centavos::text, 'estado', p.estado)
            from collection_plans p where p.company_id = k.company_id and p.customer_id = k.id
           order by (p.estado <> 'cancelado') desc, p.creado_en desc limit 1) as plan,
         (select coalesce(sum(c.monto_centavos - c.pagado_centavos), 0) from collection_charges c
           where c.company_id = k.company_id and c.customer_id = k.id and c.estado = 'emitido')::text as pendiente,
         (select coalesce(sum(c.monto_centavos - c.pagado_centavos), 0) from collection_charges c
           where c.company_id = k.company_id and c.customer_id = k.id and c.estado = 'emitido' and c.vencimiento < $2::date)::text as vencido,
         (select coalesce(sum(p.monto_centavos - p.aplicado_centavos), 0) from collection_payments p
           where p.company_id = k.company_id and p.customer_id = k.id and p.estado = 'abierto')::text as a_favor,
         (select min(c.vencimiento) from collection_charges c
           where c.company_id = k.company_id and c.customer_id = k.id and c.estado in ('emitido', 'por_emitir') and c.vencimiento >= $2::date) as proximo
    from collection_customers k
   where k.company_id = $1
`;

function clienteVista(f: Record<string, unknown>): ClienteVista {
  const plan = f.plan ? registro(f.plan) : null;
  return {
    id: texto(f.id),
    nombre: texto(f.nombre),
    rfc: textoONulo(f.rfc),
    correos: Array.isArray(f.correos) ? f.correos.map(texto) : [],
    estado: f.estado === "archivado" ? "archivado" : "activo",
    recordatorios: booleano(f.recordatorios),
    recordatoriosPor: f.recordatorios_por === "empresa" || f.recordatorios_por === "pagador" ? f.recordatorios_por : null,
    plan: plan && esPeriodicidad(plan.periodicidad)
      ? { tipo: plan.tipo === "variable" ? "variable" : "fijo", periodicidad: plan.periodicidad, montoCentavos: centavosONulo(plan.monto), estado: texto(plan.estado) }
      : null,
    pendienteCentavos: centavos(f.pendiente),
    vencidoCentavos: centavos(f.vencido),
    saldoAFavor: centavos(f.a_favor),
    proximoVencimiento: f.proximo ? fechaDe(f.proximo) : null,
  };
}

export async function leerClientes(consulta: Consulta, empresaId: string, hoy: string): Promise<ClienteVista[]> {
  const r = await aplicarSentencia(consulta, `${SQL_CLIENTES} order by (k.estado = 'activo') desc, lower(k.nombre), k.id limit 500`, [empresaId, hoy]);
  return r.rows.map(registro).map(clienteVista);
}

export type PlanVista = {
  id: string;
  concepto: string;
  tipo: "fijo" | "variable";
  montoCentavos: number | null;
  periodicidad: Periodicidad;
  primerVencimiento: string;
  fin: string | null;
  estado: "activo" | "pausado" | "cancelado";
  reanudadoEl: string | null;
  motivo: string | null;
  siguientePeriodo: number;
};

export type CargoDeCliente = FilaCargo & { periodo: number | null; planId: string | null; correos: { tipo: TipoCorreo; secuencia: number; estado: string; en: string }[] };

export type PagoVista = {
  id: string;
  fuente: FuentePago;
  montoCentavos: number;
  aplicadoCentavos: number;
  recibidoEl: string;
  claveRastreo: string | null;
  referencia: string | null;
  clienteId: string | null;
  cliente: string | null;
  estado: "abierto" | "aplicado" | "anulado";
  posibleDuplicado: boolean;
  conComprobante: boolean;
  documentoId: string | null;
  motivo: string | null;
  aplicaciones: { id: string; cargoId: string; montoCentavos: number; regla: string; concepto: string; revertida: boolean }[];
};

export type FuentePago = "manual" | "demo" | "fintoc" | "estado_cuenta";
const FUENTES_PAGO: readonly FuentePago[] = ["manual", "demo", "fintoc", "estado_cuenta"];

export type EventoHistorial = { accion: string; en: string; autor: string | null; motivo: string | null; cambio: Record<string, unknown> | null };

export type DetalleCliente = {
  cliente: ClienteVista;
  planes: PlanVista[];
  cargos: CargoDeCliente[];
  pagos: PagoVista[];
  historial: EventoHistorial[];
};

export async function leerCliente(consulta: Consulta, empresaId: string, clienteId: string, hoy: string): Promise<DetalleCliente | null> {
  const r = await aplicarSentencia(consulta, `${SQL_CLIENTES} and k.id = $3`, [empresaId, hoy, clienteId]);
  if (r.rows.length === 0) return null;
  const cliente = clienteVista(registro(r.rows[0]));
  const planes = await aplicarSentencia(
    consulta,
    `select p.id, p.concepto, p.tipo, p.monto_centavos::text as monto, p.periodicidad, p.primer_vencimiento, p.fin, p.estado,
            p.reanudado_el, p.motivo_cancelacion,
            coalesce((select max(c.periodo) + 1 from collection_charges c where c.company_id = p.company_id and c.plan_id = p.id), 0) as siguiente
       from collection_plans p
      where p.company_id = $1 and p.customer_id = $2
      order by (p.estado <> 'cancelado') desc, p.creado_en desc`,
    [empresaId, clienteId],
  );
  const cargos = await aplicarSentencia(
    consulta,
    `select c.id, c.plan_id, c.periodo, c.concepto, p.periodicidad, c.monto_centavos::text as monto, c.pagado_centavos::text as pagado,
            c.vencimiento, c.referencia, c.estado, c.pagado_el, c.motivo,
            coalesce((select json_agg(json_build_object('tipo', m.tipo, 'secuencia', m.secuencia, 'estado', m.estado, 'en', m.intentado_en)
                        order by m.intentado_en)
                        from collection_emails m where m.company_id = c.company_id and m.charge_id = c.id), '[]'::json) as correos
       from collection_charges c
       left join collection_plans p on p.id = c.plan_id and p.company_id = c.company_id
      where c.company_id = $1 and c.customer_id = $2
      order by c.vencimiento desc, c.id
      limit 240`,
    [empresaId, clienteId],
  );
  return {
    cliente,
    planes: planes.rows.map(registro).map((p) => ({
      id: texto(p.id),
      concepto: texto(p.concepto),
      tipo: p.tipo === "variable" ? "variable" : "fijo",
      montoCentavos: centavosONulo(p.monto),
      periodicidad: esPeriodicidad(p.periodicidad) ? p.periodicidad : "mensual",
      primerVencimiento: fechaDe(p.primer_vencimiento),
      fin: p.fin ? fechaDe(p.fin) : null,
      estado: p.estado === "pausado" ? "pausado" : p.estado === "cancelado" ? "cancelado" : "activo",
      reanudadoEl: p.reanudado_el ? fechaDe(p.reanudado_el) : null,
      motivo: textoONulo(p.motivo_cancelacion),
      siguientePeriodo: entero(p.siguiente),
    })),
    cargos: cargos.rows.map(registro).map((c) => {
      const correos = lista(c.correos).map((m) => ({ tipo: texto(m.tipo) as TipoCorreo, secuencia: entero(m.secuencia), estado: texto(m.estado), en: instante(m.en) }));
      const ultimo = correos.at(-1);
      return {
        tipo: "cargo" as const,
        id: texto(c.id),
        planId: textoONulo(c.plan_id),
        periodo: c.periodo === null || c.periodo === undefined ? null : entero(c.periodo),
        clienteId,
        cliente: cliente.nombre,
        rfc: cliente.rfc,
        concepto: texto(c.concepto),
        origen: c.plan_id ? ("plan" as const) : ("unico" as const),
        periodicidad: esPeriodicidad(c.periodicidad) ? c.periodicidad : null,
        montoCentavos: centavosONulo(c.monto),
        pagadoCentavos: centavos(c.pagado),
        vencimiento: fechaDe(c.vencimiento),
        referencia: textoONulo(c.referencia),
        estado: estadoFila(c.estado),
        pagadoEl: c.pagado_el ? fechaDe(c.pagado_el) : null,
        motivo: textoONulo(c.motivo),
        ultimoCorreo: ultimo ? { tipo: ultimo.tipo, estado: ultimo.estado, en: ultimo.en } : null,
        correos,
      };
    }),
    pagos: await leerPagos(consulta, empresaId, { clienteId, soloAbiertos: false }),
    historial: await leerHistorial(consulta, empresaId, clienteId),
  };
}

export async function leerPagos(
  consulta: Consulta,
  empresaId: string,
  filtro: { clienteId: string | null; soloAbiertos: boolean },
): Promise<PagoVista[]> {
  const r = await aplicarSentencia(
    consulta,
    `select p.id, p.fuente, p.monto_centavos::text as monto, p.aplicado_centavos::text as aplicado, p.recibido_el, p.clave_rastreo,
            p.referencia, p.customer_id, k.nombre as cliente, p.estado, p.posible_duplicado, p.document_id, p.motivo_anulacion,
            coalesce((select json_agg(json_build_object('id', a.id, 'cargo', a.charge_id, 'monto', a.monto_centavos::text, 'regla', a.regla,
                                                        'concepto', c.concepto,
                                                        'revertida', exists (select 1 from collection_applications r
                                                                              where r.company_id = a.company_id and r.revierte_a = a.id))
                        order by a.aplicado_en)
                        from collection_applications a
                        join collection_charges c on c.id = a.charge_id and c.company_id = a.company_id
                       where a.company_id = p.company_id and a.payment_id = p.id and a.regla <> 'reversion'), '[]'::json) as aplicaciones
       from collection_payments p
       left join collection_customers k on k.id = p.customer_id and k.company_id = p.company_id
      where p.company_id = $1
        and ($2::uuid is null or p.customer_id = $2::uuid)
        and (not $3::boolean or p.estado = 'abierto')
      order by (p.estado = 'abierto') desc, p.recibido_el desc, p.registrado_en desc, p.id
      limit 200`,
    [empresaId, filtro.clienteId, filtro.soloAbiertos],
  );
  return r.rows.map(registro).map((p) => ({
    id: texto(p.id),
    fuente: FUENTES_PAGO.find((f) => f === p.fuente) ?? "manual",
    montoCentavos: centavos(p.monto),
    aplicadoCentavos: centavos(p.aplicado),
    recibidoEl: fechaDe(p.recibido_el),
    claveRastreo: textoONulo(p.clave_rastreo),
    referencia: textoONulo(p.referencia),
    clienteId: textoONulo(p.customer_id),
    cliente: textoONulo(p.cliente),
    estado: p.estado === "aplicado" ? "aplicado" : p.estado === "anulado" ? "anulado" : "abierto",
    posibleDuplicado: booleano(p.posible_duplicado),
    conComprobante: p.document_id !== null && p.document_id !== undefined,
    documentoId: textoONulo(p.document_id),
    motivo: textoONulo(p.motivo_anulacion),
    aplicaciones: lista(p.aplicaciones).map((a) => ({
      id: texto(a.id), cargoId: texto(a.cargo), montoCentavos: centavos(a.monto), regla: texto(a.regla), concepto: texto(a.concepto), revertida: booleano(a.revertida),
    })),
  }));
}

/** Los eventos de la bitácora del cliente, sus planes, cargos y pagos: lo más reciente primero. */
async function leerHistorial(consulta: Consulta, empresaId: string, clienteId: string): Promise<EventoHistorial[]> {
  const r = await aplicarSentencia(
    consulta,
    `select a.accion, a.ocurrido_en, u.nombre as autor, a.motivo, a.cambio
       from audit_log a
       left join users u on u.id = a.actor_id
      where a.company_id = $1
        and a.identificador in (
          select $2::uuid
          union all select id from collection_plans where company_id = $1 and customer_id = $2
          union all select id from collection_charges where company_id = $1 and customer_id = $2
          union all select id from collection_payments where company_id = $1 and customer_id = $2
          union all select m.id from collection_emails m
                      join collection_charges c on c.id = m.charge_id and c.company_id = m.company_id
                     where m.company_id = $1 and c.customer_id = $2)
        and a.accion <> 'correo_cobranza_entregado'
      order by a.ocurrido_en desc, a.id
      limit 60`,
    [empresaId, clienteId],
  );
  return r.rows.map(registro).map((e) => ({
    accion: texto(e.accion),
    en: instante(e.ocurrido_en),
    autor: textoONulo(e.autor),
    motivo: textoONulo(e.motivo),
    cambio: e.cambio && typeof e.cambio === "object" ? (e.cambio as Record<string, unknown>) : null,
  }));
}

/** Cargos abiertos de la empresa para «Aplicar a…» (los del cliente primero). */
export async function leerCargosAbiertos(consulta: Consulta, empresaId: string): Promise<{ id: string; clienteId: string; cliente: string; concepto: string; saldoCentavos: number; vencimiento: string; referencia: string }[]> {
  const r = await aplicarSentencia(
    consulta,
    `select c.id, c.customer_id, k.nombre, c.concepto, (c.monto_centavos - c.pagado_centavos)::text as saldo, c.vencimiento, c.referencia
       from collection_charges c
       join collection_customers k on k.id = c.customer_id and k.company_id = c.company_id
      where c.company_id = $1 and c.estado = 'emitido'
      order by c.vencimiento, c.id
      limit 300`,
    [empresaId],
  );
  return r.rows.map(registro).map((c) => ({
    id: texto(c.id),
    clienteId: texto(c.customer_id),
    cliente: texto(c.nombre),
    concepto: texto(c.concepto),
    saldoCentavos: centavos(c.saldo),
    vencimiento: fechaDe(c.vencimiento),
    referencia: texto(c.referencia),
  }));
}

export { fechaONula, instanteONulo };
