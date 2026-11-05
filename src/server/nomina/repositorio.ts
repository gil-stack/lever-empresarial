import type { DestinoNomina, FrecuenciaNomina } from "../../dominio/nomina";
import { baseCliente } from "../../nucleo/contexto";
import { bloquearEmpresa, conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { fechaDeColumna } from "../personas/repositorio";
import type {
  EmpleadoNomina,
  LecturaNomina,
  LoteItem,
  LoteResumen,
  PersonaParaPago,
  ProximaNomina,
  RepositorioNomina,
  TransaccionNomina,
} from "./tipos";

export const SQL = {
  proximas: `
    select e.id, e.nombre, c.nombre as area_nombre, p.proximo_pago_en,
           p.neto_centavos, p.destino, e.clabe
    from employee_payroll_profiles p
    join employees e on e.id = p.employee_id and e.company_id = p.company_id
    join cost_centers c on c.id = e.cost_center_id and c.company_id = e.company_id
    where p.company_id = $1 and p.activa
      and p.proximo_pago_en >= $2::date - 365
      and e.alta_en <= p.proximo_pago_en
      and (e.baja_en is null or p.proximo_pago_en <= e.baja_en)
    order by p.proximo_pago_en, lower(e.nombre), e.id
    limit 60
  `,
  lotes: `
    select b.id, b.fecha_pago, b.total_centavos, b.preparada_en,
           count(i.id)::bigint as personas,
           count(i.id) filter (where i.destino_estado = 'pendiente')::bigint as pendientes
    from payroll_batches b
    left join payroll_batch_items i on i.batch_id = b.id and i.company_id = b.company_id
    where b.company_id = $1
    group by b.id, b.fecha_pago, b.total_centavos, b.preparada_en
    order by b.fecha_pago desc, b.preparada_en desc
    limit 30
  `,
  lote: `
    select b.id, b.fecha_pago, b.total_centavos, b.preparada_en,
           count(i.id)::bigint as personas,
           count(i.id) filter (where i.destino_estado = 'pendiente')::bigint as pendientes
    from payroll_batches b
    left join payroll_batch_items i on i.batch_id = b.id and i.company_id = b.company_id
    where b.company_id = $1 and b.id = $2
    group by b.id, b.fecha_pago, b.total_centavos, b.preparada_en
  `,
  items: `
    select id, employee_id, nombre_snapshot, neto_centavos, destino, clabe_snapshot, destino_estado
    from payroll_batch_items
    where company_id = $1 and batch_id = $2
    order by lower(nombre_snapshot), employee_id
  `,
  empleado: "select id, alta_en, baja_en, clabe from employees where company_id = $1 and id = $2 for update",
  perfil: "select neto_centavos, proximo_pago_en from employee_payroll_profiles where company_id = $1 and employee_id = $2",
  actualizarClabe: "update employees set clabe = $3, clabe_digito_valido = true where company_id = $1 and id = $2",
  guardarPerfil: `
    insert into employee_payroll_profiles (
      employee_id, company_id, neto_centavos, frecuencia, proximo_pago_en,
      ancla_dia, destino, activa, actualizado_en
    ) values ($2, $1, $3, $4, $5::date, $6, $7, true, now())
    on conflict (employee_id) do update set
      neto_centavos = excluded.neto_centavos,
      frecuencia = excluded.frecuencia,
      proximo_pago_en = excluded.proximo_pago_en,
      ancla_dia = excluded.ancla_dia,
      destino = excluded.destino,
      activa = true,
      actualizado_en = now()
  `,
  tarjetaPendiente: "select id from employee_card_requests where company_id = $1 and employee_id = $2 and estado = 'pendiente'",
  solicitarTarjeta: `
    insert into employee_card_requests (id, company_id, employee_id, solicitada_por)
    values ($2, $1, $3, $4)
  `,
  lotePorFecha: "select id from payroll_batches where company_id = $1 and fecha_pago = $2::date",
  primeraFechaVencida: `
    select min(p.proximo_pago_en) as fecha
    from employee_payroll_profiles p
    join employees e on e.id = p.employee_id and e.company_id = p.company_id
    where p.company_id = $1 and p.activa and p.proximo_pago_en <= $2::date
      and e.alta_en <= p.proximo_pago_en
      and (e.baja_en is null or p.proximo_pago_en <= e.baja_en)
  `,
  personasParaPago: `
    select e.id, e.nombre, e.clabe, p.neto_centavos, p.frecuencia,
           p.proximo_pago_en, p.ancla_dia, p.destino
    from employee_payroll_profiles p
    join employees e on e.id = p.employee_id and e.company_id = p.company_id
    where p.company_id = $1 and p.activa and p.proximo_pago_en = $2::date
      and e.alta_en <= p.proximo_pago_en
      and (e.baja_en is null or p.proximo_pago_en <= e.baja_en)
    order by lower(e.nombre), e.id
    for update of p, e
  `,
  insertarLote: `
    insert into payroll_batches (id, company_id, fecha_pago, total_centavos, preparada_por)
    values ($2, $1, $3::date, $4, $5)
  `,
  insertarItem: `
    insert into payroll_batch_items (
      id, company_id, batch_id, employee_id, nombre_snapshot, neto_centavos,
      destino, clabe_snapshot, destino_estado
    ) values ($2, $1, $3, $4, $5, $6, $7, $8, $9)
  `,
  avanzarPerfil: `
    update employee_payroll_profiles set proximo_pago_en = $3::date, actualizado_en = now()
    where company_id = $1 and employee_id = $2
  `,
} as const;

export function repositorioPg(): RepositorioNomina {
  return {
    leer(ctx, hoy) {
      return conContexto(baseCliente(ctx), async (consulta): Promise<LecturaNomina> => {
        const proximas = await consulta.query(SQL.proximas, [ctx.empresa.id, hoy]);
        const lotes = await consulta.query(SQL.lotes, [ctx.empresa.id]);
        return { proximas: proximas.rows.map(mapearProxima), lotes: lotes.rows.map(mapearLote) };
      });
    },
    lote(ctx, id) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL.lote, [ctx.empresa.id, id]);
        const fila = resultado.rows[0];
        if (!fila) return null;
        const items = await consulta.query(SQL.items, [ctx.empresa.id, id]);
        return { lote: mapearLote(fila), items: items.rows.map(mapearItem) };
      });
    },
    conEmpresa(ctx, fn) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        await bloquearEmpresa(consulta, ctx.empresa.id);
        return fn(transaccion(consulta, ctx.empresa.id));
      });
    },
  };
}

function transaccion(consulta: Consulta, companyId: string): TransaccionNomina {
  return {
    consulta,
    async bloquearEmpleado(id) {
      const resultado = await consulta.query(SQL.empleado, [companyId, id]);
      const r = resultado.rows[0] as Record<string, unknown> | undefined;
      if (!r) return null;
      if (typeof r.id !== "string") throw new ErrorDeDominio("base_no_disponible");
      const empleado: EmpleadoNomina = {
        id: r.id,
        altaEn: fechaDeColumna(r.alta_en),
        bajaEn: r.baja_en === null ? null : fechaDeColumna(r.baja_en),
        clabe: typeof r.clabe === "string" ? r.clabe : null,
      };
      return empleado;
    },
    async perfilAnterior(id) {
      const resultado = await consulta.query(SQL.perfil, [companyId, id]);
      const fila = resultado.rows[0] as { neto_centavos?: unknown; proximo_pago_en?: unknown } | undefined;
      return fila ? { netoCentavos: numero(fila.neto_centavos), proximoPagoEn: fechaDeColumna(fila.proximo_pago_en) } : null;
    },
    async actualizarClabe(employeeId, clabe) {
      await consulta.query(SQL.actualizarClabe, [companyId, employeeId, clabe]);
    },
    async guardarPerfil(employeeId, nomina) {
      await consulta.query(SQL.guardarPerfil, [
        companyId,
        employeeId,
        nomina.netoCentavos,
        nomina.frecuencia,
        nomina.proximoPagoEn,
        nomina.anclaDia,
        nomina.destino,
      ]);
    },
    async tarjetaPendiente(employeeId) {
      const resultado = await consulta.query(SQL.tarjetaPendiente, [companyId, employeeId]);
      const id = (resultado.rows[0] as { id?: unknown } | undefined)?.id;
      return typeof id === "string" ? id : null;
    },
    async solicitarTarjeta(id, employeeId, actorId) {
      await consulta.query(SQL.solicitarTarjeta, [companyId, id, employeeId, actorId]);
    },
    async lotePorFecha(fecha) {
      const resultado = await consulta.query(SQL.lotePorFecha, [companyId, fecha]);
      const id = (resultado.rows[0] as { id?: unknown } | undefined)?.id;
      return typeof id === "string" ? id : null;
    },
    async primeraFechaVencida(hoy) {
      const resultado = await consulta.query(SQL.primeraFechaVencida, [companyId, hoy]);
      const fecha = (resultado.rows[0] as { fecha?: unknown } | undefined)?.fecha;
      return fecha === null || fecha === undefined ? null : fechaDeColumna(fecha);
    },
    async personasParaPago(fecha) {
      const resultado = await consulta.query(SQL.personasParaPago, [companyId, fecha]);
      return resultado.rows.map(mapearPersonaParaPago);
    },
    async insertarLote(entrada) {
      await consulta.query(SQL.insertarLote, [companyId, entrada.id, entrada.fecha, entrada.total, entrada.actorId]);
    },
    async insertarItem(entrada) {
      await consulta.query(SQL.insertarItem, [
        companyId,
        entrada.id,
        entrada.batchId,
        entrada.employeeId,
        entrada.nombre,
        entrada.neto,
        entrada.destino,
        entrada.clabe,
        entrada.destinoListo ? "listo" : "pendiente",
      ]);
    },
    async avanzarPerfil(employeeId, proximoPagoEn) {
      await consulta.query(SQL.avanzarPerfil, [companyId, employeeId, proximoPagoEn]);
    },
  };
}

function mapearProxima(fila: unknown): ProximaNomina {
  const r = fila as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.nombre !== "string" || typeof r.area_nombre !== "string") throw new ErrorDeDominio("base_no_disponible");
  const destino = destinoDe(r.destino);
  return {
    personaId: r.id,
    nombre: r.nombre,
    areaNombre: r.area_nombre,
    fechaPago: fechaDeColumna(r.proximo_pago_en),
    netoCentavos: numero(r.neto_centavos),
    destino,
    destinoListo: destino === "clabe" && typeof r.clabe === "string",
  };
}

function mapearLote(fila: unknown): LoteResumen {
  const r = fila as Record<string, unknown>;
  if (typeof r.id !== "string") throw new ErrorDeDominio("base_no_disponible");
  return {
    id: r.id,
    fechaPago: fechaDeColumna(r.fecha_pago),
    totalCentavos: numero(r.total_centavos),
    personas: numero(r.personas),
    destinosPendientes: numero(r.pendientes),
    preparadaEn: instante(r.preparada_en),
  };
}

function mapearItem(fila: unknown): LoteItem {
  const r = fila as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.employee_id !== "string" || typeof r.nombre_snapshot !== "string") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    id: r.id,
    personaId: r.employee_id,
    nombre: r.nombre_snapshot,
    netoCentavos: numero(r.neto_centavos),
    destino: destinoDe(r.destino),
    clabe: typeof r.clabe_snapshot === "string" ? r.clabe_snapshot : null,
    destinoListo: r.destino_estado === "listo",
  };
}

function mapearPersonaParaPago(fila: unknown): PersonaParaPago {
  const r = fila as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.nombre !== "string" || !["semanal", "quincenal", "mensual"].includes(String(r.frecuencia))) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    id: r.id,
    nombre: r.nombre,
    netoCentavos: numero(r.neto_centavos),
    frecuencia: String(r.frecuencia) as FrecuenciaNomina,
    proximoPagoEn: fechaDeColumna(r.proximo_pago_en),
    anclaDia: numero(r.ancla_dia),
    destino: destinoDe(r.destino),
    clabe: typeof r.clabe === "string" ? r.clabe : null,
  };
}

function destinoDe(valor: unknown): DestinoNomina {
  if (valor !== "clabe" && valor !== "tarjeta") throw new ErrorDeDominio("base_no_disponible");
  return valor;
}

function numero(valor: unknown): number {
  const salida = typeof valor === "number" ? valor : typeof valor === "string" && /^\d+$/.test(valor) ? Number(valor) : Number.NaN;
  if (!Number.isSafeInteger(salida)) throw new ErrorDeDominio("base_no_disponible");
  return salida;
}

function instante(valor: unknown): string {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString();
  if (typeof valor === "string" && !Number.isNaN(Date.parse(valor))) return new Date(valor).toISOString();
  throw new ErrorDeDominio("base_no_disponible");
}
