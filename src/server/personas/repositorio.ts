import { clabeEnmascarada } from "../../dominio/clabe";
import { disponibleParaPlaneacion, mensualEstimado, sumarCentavos, type DestinoNomina, type FrecuenciaNomina } from "../../dominio/nomina";
import { rolesLeidos, type RolCliente } from "../../nucleo/capacidades";
import { baseCliente } from "../../nucleo/contexto";
import { bloquearEmpresa, conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type {
  AreaVista,
  CentroVista,
  ClabeHistorialVista,
  DetallePersona,
  FiltrosPersonas,
  HechosLiberacion,
  LecturaMaestro,
  MiembroDeCorreo,
  NominaPersonaVista,
  PersonaBloqueada,
  PersonaVista,
  RepositorioPersonas,
  ResumenPersonas,
  TransaccionMaestro,
} from "./tipos";

export const PERSONAS_POR_PAGINA = 50;

const ROLES_DE = `coalesce((
  select array_agg(r.rol order by r.rol)
  from membership_roles r
  where r.user_id = e.user_id and r.company_id = e.company_id
), '{}')`;

const PERSONAS_BASE = `
  select e.id, e.nombre, e.alta_en, e.baja_en, e.clabe,
         e.presupuesto_mensual_centavos,
         e.jefe_id, j.nombre as jefe_nombre,
         e.cost_center_id, c.nombre as centro_nombre,
         ${ROLES_DE} as roles, mb.estado as membresia, u.correo,
         p.neto_centavos, p.frecuencia, p.proximo_pago_en, p.destino, p.activa as nomina_activa,
         exists (
           select 1 from employee_card_requests tarjeta
           where tarjeta.company_id = e.company_id
             and tarjeta.employee_id = e.id and tarjeta.estado = 'pendiente'
         ) as tarjeta_pendiente
  from employees e
  join cost_centers c on c.id = e.cost_center_id and c.company_id = e.company_id
  left join employees j on j.id = e.jefe_id and j.company_id = e.company_id
  left join users u on u.id = e.user_id
  left join memberships mb on mb.user_id = e.user_id and mb.company_id = e.company_id
  left join employee_payroll_profiles p on p.employee_id = e.id and p.company_id = e.company_id
`;

const PERSONA_BLOQUEADA = `
  select e.id, e.nombre, e.alta_en, e.baja_en, e.user_id, e.clabe, e.cost_center_id,
         e.jefe_id, e.presupuesto_mensual_centavos, ${ROLES_DE} as roles,
         mb.estado as membresia, u.correo
  from employees e
  left join memberships mb on mb.user_id = e.user_id and mb.company_id = e.company_id
  left join users u on u.id = e.user_id
`;

// La empresa es la del contexto. RLS la vuelve a exigir en cada tabla.
// Ninguna lectura del maestro trae password_hash.
export const SQL = {
  centros: `
    select id, nombre, presupuesto_mensual_centavos, es_tesoreria
    from cost_centers
    where company_id = $1
    order by lower(nombre), id
  `,
  personas: `${PERSONAS_BASE}
    where e.company_id = $1
    order by lower(e.nombre), e.id
  `,
  directorio: `${PERSONAS_BASE}
    where e.company_id = $1
      and $2::date is not null
      and ($3 = '' or e.nombre ilike '%' || $3 || '%' escape '\\' or u.correo ilike '%' || $3 || '%' escape '\\')
      and ($4::uuid is null or e.cost_center_id = $4::uuid)
      and (
        $5 = 'todos'
        or ($5 = 'vigentes' and (e.baja_en is null or e.baja_en > $2::date))
        or ($5 = 'bajas' and e.baja_en <= $2::date)
        or ($5 = 'pendientes' and p.employee_id is null)
      )
    order by lower(e.nombre), e.id limit $6 offset $7
  `,
  contarDirectorio: `
    select count(*)::bigint as total
    from employees e
    left join users u on u.id = e.user_id
    left join employee_payroll_profiles p on p.employee_id = e.id and p.company_id = e.company_id
    where e.company_id = $1
      and $2::date is not null
      and ($3 = '' or e.nombre ilike '%' || $3 || '%' escape '\\' or u.correo ilike '%' || $3 || '%' escape '\\')
      and ($4::uuid is null or e.cost_center_id = $4::uuid)
      and (
        $5 = 'todos'
        or ($5 = 'vigentes' and (e.baja_en is null or e.baja_en > $2::date))
        or ($5 = 'bajas' and e.baja_en <= $2::date)
        or ($5 = 'pendientes' and p.employee_id is null)
      )
  `,
  personaPorId: `${PERSONAS_BASE}
    where e.company_id = $1 and e.id = $2
  `,
  planeacion: `
    select e.id, e.cost_center_id, e.presupuesto_mensual_centavos, e.baja_en,
           p.neto_centavos, p.frecuencia, p.proximo_pago_en, p.activa as nomina_activa
    from employees e
    left join employee_payroll_profiles p on p.employee_id = e.id and p.company_id = e.company_id
    where e.company_id = $1
  `,
  autorizados: `
    select u.nombre
    from memberships m
    join membership_roles r on r.user_id = m.user_id and r.company_id = m.company_id and r.rol = 'liberador'
    join users u on u.id = m.user_id
    left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
    where m.company_id = $1
      and m.estado = 'activa'
      and (e.baja_en is null or e.baja_en > $2::date)
    order by u.nombre, u.id
  `,
  centroPorId: `
    select id, nombre, presupuesto_mensual_centavos, es_tesoreria
    from cost_centers
    where id = $1 and company_id = $2
  `,
  centroOcupado: `
    select 1 as presente
    from cost_centers
    where company_id = $1 and lower(nombre) = lower($2)
      and ($3::uuid is null or id <> $3::uuid)
    limit 1
  `,
  jefePorId: `${PERSONA_BLOQUEADA}
    where e.id = $1 and e.company_id = $2
  `,
  bloquearPersona: `${PERSONA_BLOQUEADA}
    where e.id = $1 and e.company_id = $2
    for update of e
  `,
  administradoresVigentes: `
    select count(distinct m.user_id)::int as total
    from memberships m
    join membership_roles r
      on r.user_id = m.user_id and r.company_id = m.company_id and r.rol = 'administrador'
    left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
    where m.company_id = $1 and m.estado = 'activa' and m.user_id <> $2
      and (e.id is null or e.baja_en is null)
  `,
  historialClabe: `
    select h.id, h.clabe, h.vigente_desde, h.vigente_hasta, u.nombre as registrada_por
    from employee_payroll_clabes h
    left join users u on u.id = h.registrada_por
    where h.company_id = $1 and h.employee_id = $2
    order by h.vigente_desde desc, h.id
  `,
  cerrarClabe: `
    update employee_payroll_clabes set vigente_hasta = $3
    where company_id = $1 and employee_id = $2 and vigente_hasta is null
  `,
  insertarClabe: `
    insert into employee_payroll_clabes (
      id, company_id, employee_id, clabe, digito_valido, vigente_desde, registrada_por
    ) values ($1, $2, $3, $4, true, $5, $6)
  `,
  escribirClabe: `
    update employees set clabe = $3, clabe_digito_valido = true
    where id = $1 and company_id = $2
  `,
  aplicarBajasVencidas: "select aplicar_bajas_vencidas_empresa()",
  miembroPorCorreo: `
    select m.user_id as id, m.estado,
           exists (
             select 1 from employees e where e.user_id = m.user_id and e.company_id = m.company_id
           ) as tiene_empleado
    from memberships m
    join users u on u.id = m.user_id
    where m.company_id = $1 and lower(u.correo) = lower($2)
  `,
  rolesDe: `
    select coalesce(array_agg(rol order by rol), '{}') as roles
    from membership_roles
    where user_id = $1 and company_id = $2
  `,
  empleadoPorLlave: "select id, nombre from employees where company_id = $1 and alta_llave = $2",
  jefeCreaCiclo: `
    with recursive cadena as (
      select e.id, e.jefe_id from employees e where e.id = $2 and e.company_id = $1
      union all
      select e.id, e.jefe_id
      from employees e join cadena anterior on e.id = anterior.jefe_id
      where e.company_id = $1
    )
    select exists (select 1 from cadena where id = $3) as ciclo
  `,
  clabeDuplicada: `
    select exists (
      select 1 from employees where company_id = $1 and clabe = $2 and id <> $3
    ) as duplicada
  `,
  insertarCentro: `
    insert into cost_centers (id, company_id, nombre, presupuesto_mensual_centavos, es_tesoreria)
    values ($1, $2, $3, $4, $5)
  `,
  actualizarCentro: `
    update cost_centers
    set nombre = $3, presupuesto_mensual_centavos = $4, es_tesoreria = $5
    where id = $1 and company_id = $2
  `,
  insertarEmpleado: `
    insert into employees (
      id, company_id, user_id, jefe_id, cost_center_id,
      nombre, alta_en, baja_en, clabe, clabe_digito_valido,
      presupuesto_mensual_centavos, alta_llave
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `,
  actualizarEmpleado: `
    update employees
    set jefe_id = $3, cost_center_id = $4, nombre = $5, alta_en = $6::date,
        presupuesto_mensual_centavos = $7
    where id = $1 and company_id = $2
  `,
  insertarNomina: `
    insert into employee_payroll_profiles (
      employee_id, company_id, neto_centavos, frecuencia, proximo_pago_en,
      ancla_dia, destino, activa
    ) values ($1, $2, $3, $4, $5::date, $6, $7, true)
  `,
  proximoPago: "select proximo_pago_en from employee_payroll_profiles where company_id = $1 and employee_id = $2 and activa",
  nominaActiva: "select exists (select 1 from employee_payroll_profiles where company_id = $1 and employee_id = $2 and activa) as activa",
  desactivarNomina: `
    update employee_payroll_profiles set activa = false, actualizado_en = now()
    where company_id = $1 and employee_id = $2 and activa
  `,
  solicitarTarjeta: `
    insert into employee_card_requests (id, company_id, employee_id, solicitada_por)
    values ($1, $2, $3, $4)
  `,
  tarjetasPendientes: "select id from employee_card_requests where company_id = $1 and employee_id = $2 and estado = 'pendiente'",
  cancelarTarjeta: `
    update employee_card_requests set estado = 'cancelada', cancelada_en = now()
    where company_id = $1 and id = $2 and estado = 'pendiente'
  `,
  escribirBaja: `
    update employees
    set baja_en = $3::date
    where id = $1 and company_id = $2
  `,
  quitarLiberador: `
    with quitado as (
      delete from membership_roles
      where user_id = $1 and company_id = $2 and rol = 'liberador'
      returning 1
    )
    insert into membership_roles (user_id, company_id, rol)
    select $1, $2, 'tarjetahabiente'
    where exists (select 1 from quitado)
      and not exists (
        select 1 from membership_roles
        where user_id = $1 and company_id = $2 and rol <> 'liberador'
      )
  `,
  desprovisionar: "select desprovisionar_miembro($1, $2)",
  personaParaInvitacion: `
    select e.user_id, u.nombre, u.correo, ${ROLES_DE} as roles
    from employees e
    join users u on u.id = e.user_id
    join memberships m on m.user_id = e.user_id and m.company_id = e.company_id and m.estado = 'invitada'
    where e.id = $1 and e.company_id = $2 and (e.baja_en is null or e.baja_en > $3::date)
  `,
  jefes: `
    select id, nombre from employees
    where company_id = $1 and id <> $3 and (baja_en is null or baja_en > $2::date)
    order by lower(nombre), id
  `,
  jefesDisponibles: `
    select id, nombre from employees
    where company_id = $1 and (baja_en is null or baja_en > $2::date)
    order by lower(nombre), id
  `,
  actorDeBaja: `
    select exists (
      select 1 from employees e
      where e.user_id = $1 and e.company_id = $2 and e.baja_en is not null and e.baja_en <= $3::date
    ) as de_baja
  `,
} as const;

export function repositorioPg(): RepositorioPersonas {
  return {
    conEmpresa(ctx, fn) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        await bloquearEmpresa(consulta, ctx.empresa.id);
        await consulta.query(SQL.aplicarBajasVencidas);
        return fn(transaccion(consulta, ctx.empresa.id));
      });
    },
    leer(ctx, hoy, filtros) {
      return conContexto(baseCliente(ctx), async (consulta): Promise<LecturaMaestro> => {
        const companyId = ctx.empresa.id;
        await consulta.query(SQL.aplicarBajasVencidas);
        const parametros = parametrosDirectorio(companyId, hoy, filtros);
        const centros = await consulta.query(SQL.centros, [companyId]);
        const personas = await consulta.query(SQL.directorio, [
          ...parametros,
          PERSONAS_POR_PAGINA,
          (filtros.pagina - 1) * PERSONAS_POR_PAGINA,
        ]);
        const autorizados = await consulta.query(SQL.autorizados, [companyId, hoy]);
        const planeacion = await consulta.query(SQL.planeacion, [companyId]);
        const total = await consulta.query(SQL.contarDirectorio, parametros);
        const jefes = await consulta.query(SQL.jefesDisponibles, [companyId, hoy]);
        const centrosVista = centros.rows.map(mapearCentro);
        const lineas = planeacion.rows.map(mapearPlaneacion);
        return {
          centros: centrosVista,
          personas: personas.rows.map(mapearPersona),
          areas: areasDe(centrosVista, lineas, hoy),
          resumen: resumenDe(lineas, hoy),
          autorizados: autorizados.rows.map(mapearNombre),
          jefes: jefes.rows.map(mapearJefe),
          total: contar(total.rows[0]),
          pagina: filtros.pagina,
          porPagina: PERSONAS_POR_PAGINA,
        };
      });
    },
    detalle(ctx, hoy, personaId) {
      return conContexto(baseCliente(ctx), async (consulta): Promise<DetallePersona | null> => {
        const companyId = ctx.empresa.id;
        await consulta.query(SQL.aplicarBajasVencidas);
        const resultado = await consulta.query(SQL.personaPorId, [companyId, personaId]);
        const fila = resultado.rows[0];
        if (!fila) return null;
        const persona = mapearPersona(fila);
        const centros = await consulta.query(SQL.centros, [companyId]);
        const jefes = await consulta.query(SQL.jefes, [companyId, hoy, personaId]);
        const duplicada = persona.clabe
          ? await consulta.query(SQL.clabeDuplicada, [companyId, persona.clabe, personaId])
          : null;
        const historial = await consulta.query(SQL.historialClabe, [companyId, personaId]);
        return {
          persona,
          centros: centros.rows.map(mapearCentro),
          jefes: jefes.rows.map((filaJefe) => {
            const r = filaJefe as { id?: unknown; nombre?: unknown };
            if (typeof r.id !== "string" || typeof r.nombre !== "string") throw new ErrorDeDominio("base_no_disponible");
            return { id: r.id, nombre: r.nombre };
          }),
          clabeDuplicada: duplicada ? booleano((duplicada.rows[0] as { duplicada?: unknown })?.duplicada) : false,
          historialClabe: historial.rows.map(mapearHistorialClabe),
        };
      });
    },
    resumen(ctx, hoy) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const autorizados = await consulta.query(SQL.autorizados, [ctx.empresa.id, hoy]);
        return { nombres: autorizados.rows.map(mapearNombre) };
      });
    },
    hechosLiberacion(ctx, hoy) {
      return conContexto(baseCliente(ctx), async (consulta): Promise<HechosLiberacion> => {
        const baja = await consulta.query(SQL.actorDeBaja, [ctx.persona.id, ctx.empresa.id, hoy]);
        const autorizados = await consulta.query(SQL.autorizados, [ctx.empresa.id, hoy]);
        const deBaja = (baja.rows[0] as { de_baja?: unknown } | undefined)?.de_baja;
        if (typeof deBaja !== "boolean") throw new ErrorDeDominio("base_no_disponible");
        return { actorDeBaja: deBaja, autorizados: autorizados.rows.length };
      });
    },
  };
}

function parametrosDirectorio(companyId: string, hoy: string, filtros: FiltrosPersonas) {
  return [companyId, hoy, escaparComodines(filtros.buscar), filtros.centroId, filtros.estado] as const;
}

/** «%» y «_» se buscan como texto, no como comodines de ILIKE. */
export function escaparComodines(texto: string): string {
  return texto.replace(/[\\%_]/g, (caracter) => `\\${caracter}`);
}

function transaccion(consulta: Consulta, companyId: string): TransaccionMaestro {
  return {
    companyId,
    consulta,
    async centroPorId(id) {
      const resultado = await consulta.query(SQL.centroPorId, [id, companyId]);
      const fila = resultado.rows[0];
      return fila ? mapearCentro(fila) : null;
    },
    async centroOcupado(nombre, exceptoId) {
      const resultado = await consulta.query(SQL.centroOcupado, [companyId, nombre, exceptoId ?? null]);
      return resultado.rows.length > 0;
    },
    async jefePorId(id) {
      const resultado = await consulta.query(SQL.jefePorId, [id, companyId]);
      const fila = resultado.rows[0];
      return fila ? mapearBloqueada(fila) : null;
    },
    async bloquearPersona(id) {
      const resultado = await consulta.query(SQL.bloquearPersona, [id, companyId]);
      const fila = resultado.rows[0];
      return fila ? mapearBloqueada(fila) : null;
    },
    async miembroPorCorreo(correo) {
      const resultado = await consulta.query(SQL.miembroPorCorreo, [companyId, correo]);
      const fila = resultado.rows[0];
      return fila ? mapearMiembro(fila) : null;
    },
    async rolesDe(userId) {
      const resultado = await consulta.query(SQL.rolesDe, [userId, companyId]);
      return rolesDeColumna((resultado.rows[0] as { roles?: unknown } | undefined)?.roles ?? []);
    },
    async empleadoPorLlave(llave) {
      const resultado = await consulta.query(SQL.empleadoPorLlave, [companyId, llave]);
      const fila = resultado.rows[0] as { id?: unknown; nombre?: unknown } | undefined;
      if (!fila) return null;
      if (typeof fila.id !== "string" || typeof fila.nombre !== "string") throw new ErrorDeDominio("base_no_disponible");
      return { id: fila.id, nombre: fila.nombre };
    },
    async jefeCreaCiclo(personaId, jefeId) {
      const resultado = await consulta.query(SQL.jefeCreaCiclo, [companyId, jefeId, personaId]);
      return booleano((resultado.rows[0] as { ciclo?: unknown } | undefined)?.ciclo);
    },
    async clabeDuplicada(clabe, exceptoId) {
      const resultado = await consulta.query(SQL.clabeDuplicada, [companyId, clabe, exceptoId]);
      return booleano((resultado.rows[0] as { duplicada?: unknown } | undefined)?.duplicada);
    },
    async insertarCentro(centro) {
      await consulta.query(SQL.insertarCentro, [centro.id, companyId, centro.nombre, centro.presupuestoCentavos, centro.esTesoreria]);
    },
    async actualizarCentro(centro) {
      const resultado = await consulta.query(SQL.actualizarCentro, [centro.id, companyId, centro.nombre, centro.presupuestoCentavos, centro.esTesoreria]);
      if (resultado.rowCount !== 1) throw new ErrorDeDominio("centro_invalido");
    },
    async insertarEmpleado(empleado) {
      await consulta.query(SQL.insertarEmpleado, [
        empleado.id,
        companyId,
        empleado.userId,
        empleado.jefeId,
        empleado.centroId,
        empleado.nombre,
        empleado.altaEn,
        empleado.bajaEn,
        empleado.clabe,
        empleado.clabe !== null,
        empleado.presupuestoCentavos,
        empleado.altaLlave,
      ]);
    },
    async actualizarEmpleado(empleado) {
      const resultado = await consulta.query(SQL.actualizarEmpleado, [
        empleado.id,
        companyId,
        empleado.jefeId,
        empleado.centroId,
        empleado.nombre,
        empleado.altaEn,
        empleado.presupuestoCentavos,
      ]);
      if (resultado.rowCount !== 1) throw new ErrorDeDominio("persona_ausente");
    },
    async insertarNomina(employeeId, nomina) {
      await consulta.query(SQL.insertarNomina, [
        employeeId,
        companyId,
        nomina.netoCentavos,
        nomina.frecuencia,
        nomina.proximoPagoEn,
        nomina.anclaDia,
        nomina.destino,
      ]);
    },
    async proximoPago(employeeId) {
      const resultado = await consulta.query(SQL.proximoPago, [companyId, employeeId]);
      const fecha = (resultado.rows[0] as { proximo_pago_en?: unknown } | undefined)?.proximo_pago_en;
      return fecha === undefined || fecha === null ? null : fechaDeColumna(fecha);
    },
    async nominaActiva(employeeId) {
      const resultado = await consulta.query(SQL.nominaActiva, [companyId, employeeId]);
      return booleano((resultado.rows[0] as { activa?: unknown } | undefined)?.activa);
    },
    async desactivarNomina(employeeId) {
      await consulta.query(SQL.desactivarNomina, [companyId, employeeId]);
    },
    async solicitarTarjeta(entrada) {
      await consulta.query(SQL.solicitarTarjeta, [entrada.id, companyId, entrada.employeeId, entrada.actorId]);
    },
    async tarjetasPendientes(employeeId) {
      const resultado = await consulta.query(SQL.tarjetasPendientes, [companyId, employeeId]);
      return resultado.rows.map((fila) => {
        const id = (fila as { id?: unknown }).id;
        if (typeof id !== "string") throw new ErrorDeDominio("base_no_disponible");
        return id;
      });
    },
    async cancelarTarjeta(id) {
      await consulta.query(SQL.cancelarTarjeta, [companyId, id]);
    },
    async escribirBaja(id, bajaEn) {
      const resultado = await consulta.query(SQL.escribirBaja, [id, companyId, bajaEn]);
      if (resultado.rowCount < 1) throw new ErrorDeDominio("persona_ausente");
    },
    async administradoresVigentes(exceptoUserId) {
      const resultado = await consulta.query(SQL.administradoresVigentes, [companyId, exceptoUserId]);
      return numeroSeguro((resultado.rows[0] as { total?: unknown } | undefined)?.total ?? 0);
    },
    async cerrarClabe(employeeId, hasta) {
      await consulta.query(SQL.cerrarClabe, [companyId, employeeId, hasta]);
    },
    async insertarClabe(clabe) {
      await consulta.query(SQL.insertarClabe, [clabe.id, companyId, clabe.employeeId, clabe.clabe, clabe.desde, clabe.actorId]);
    },
    async escribirClabe(employeeId, clabe) {
      const resultado = await consulta.query(SQL.escribirClabe, [employeeId, companyId, clabe]);
      if (resultado.rowCount !== 1) throw new ErrorDeDominio("persona_ausente");
    },
    async quitarLiberador(userId) {
      await consulta.query(SQL.quitarLiberador, [userId, companyId]);
    },
    async desprovisionar(userId) {
      await consulta.query(SQL.desprovisionar, [companyId, userId]);
    },
    async personaParaInvitacion(personaId) {
      const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
      const resultado = await consulta.query(SQL.personaParaInvitacion, [personaId, companyId, hoy]);
      const r = resultado.rows[0] as { user_id?: unknown; nombre?: unknown; correo?: unknown; roles?: unknown } | undefined;
      if (!r) return null;
      if (typeof r.user_id !== "string" || typeof r.nombre !== "string" || typeof r.correo !== "string") throw new ErrorDeDominio("base_no_disponible");
      return { userId: r.user_id, nombre: r.nombre, correo: r.correo, roles: rolesDeColumna(r.roles) };
    },
  };
}

function rolesDeColumna(valor: unknown): RolCliente[] {
  if (!Array.isArray(valor)) throw new ErrorDeDominio("base_no_disponible");
  return rolesLeidos(valor);
}

function mapearCentro(fila: unknown): CentroVista {
  const r = fila as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.nombre !== "string" || typeof r.es_tesoreria !== "boolean") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    id: r.id,
    nombre: r.nombre,
    presupuestoCentavos: numeroNullable(r.presupuesto_mensual_centavos),
    esTesoreria: r.es_tesoreria,
  };
}

function mapearNombre(fila: unknown): string {
  const nombre = (fila as { nombre?: unknown }).nombre;
  if (typeof nombre !== "string" || nombre.length === 0) throw new ErrorDeDominio("base_no_disponible");
  return nombre;
}

function mapearJefe(fila: unknown): { id: string; nombre: string } {
  const r = fila as { id?: unknown; nombre?: unknown };
  if (typeof r.id !== "string" || typeof r.nombre !== "string") throw new ErrorDeDominio("base_no_disponible");
  return { id: r.id, nombre: r.nombre };
}

function mapearBloqueada(fila: unknown): PersonaBloqueada {
  const r = fila as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.nombre !== "string" || typeof r.cost_center_id !== "string") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  const membresia = r.membresia === null || r.membresia === undefined ? null : String(r.membresia);
  if (membresia !== null && !["invitada", "activa", "suspendida"].includes(membresia)) throw new ErrorDeDominio("base_no_disponible");
  return {
    id: r.id,
    nombre: r.nombre,
    altaEn: fechaDeColumna(r.alta_en),
    bajaEn: r.baja_en == null ? null : fechaDeColumna(r.baja_en),
    userId: typeof r.user_id === "string" ? r.user_id : null,
    roles: rolesDeColumna(r.roles),
    clabe: typeof r.clabe === "string" ? r.clabe : null,
    centroId: r.cost_center_id,
    jefeId: typeof r.jefe_id === "string" ? r.jefe_id : null,
    presupuestoCentavos: numeroNullable(r.presupuesto_mensual_centavos),
    membresia: membresia as PersonaBloqueada["membresia"],
    correo: typeof r.correo === "string" ? r.correo : null,
  };
}

function mapearHistorialClabe(fila: unknown): ClabeHistorialVista {
  const r = fila as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.clabe !== "string") throw new ErrorDeDominio("base_no_disponible");
  return {
    id: r.id,
    visible: clabeEnmascarada(r.clabe),
    desde: instante(r.vigente_desde),
    hasta: r.vigente_hasta == null ? null : instante(r.vigente_hasta),
    registradaPor: typeof r.registrada_por === "string" ? r.registrada_por : null,
  };
}

function instante(valor: unknown): string {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString();
  if (typeof valor === "string" && !Number.isNaN(Date.parse(valor))) return new Date(valor).toISOString();
  throw new ErrorDeDominio("base_no_disponible");
}

function mapearMiembro(fila: unknown): MiembroDeCorreo {
  const r = fila as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.tiene_empleado !== "boolean" || !["invitada", "activa", "suspendida"].includes(String(r.estado))) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return { id: r.id, tieneEmpleado: r.tiene_empleado, estado: r.estado as MiembroDeCorreo["estado"] };
}

function mapearPersona(fila: unknown): PersonaVista {
  const r = fila as Record<string, unknown>;
  if (
    typeof r.id !== "string" || typeof r.nombre !== "string" ||
    typeof r.cost_center_id !== "string" || typeof r.centro_nombre !== "string" ||
    (r.clabe !== null && typeof r.clabe !== "string") || typeof r.tarjeta_pendiente !== "boolean"
  ) throw new ErrorDeDominio("base_no_disponible");
  const membresia = r.membresia === null || r.membresia === undefined ? null : String(r.membresia);
  if (membresia !== null && !["invitada", "activa", "suspendida"].includes(membresia)) throw new ErrorDeDominio("base_no_disponible");
  return {
    id: r.id,
    nombre: r.nombre,
    altaEn: fechaDeColumna(r.alta_en),
    bajaEn: r.baja_en == null ? null : fechaDeColumna(r.baja_en),
    clabe: typeof r.clabe === "string" ? r.clabe : null,
    clabeFinal: typeof r.clabe === "string" ? r.clabe.slice(-4) : null,
    presupuestoCentavos: numeroNullable(r.presupuesto_mensual_centavos),
    jefeId: typeof r.jefe_id === "string" ? r.jefe_id : null,
    jefeNombre: typeof r.jefe_nombre === "string" ? r.jefe_nombre : null,
    centroId: r.cost_center_id,
    centroNombre: r.centro_nombre,
    roles: rolesDeColumna(r.roles),
    membresia: membresia as PersonaVista["membresia"],
    invitada: membresia === "invitada",
    correo: typeof r.correo === "string" ? r.correo : null,
    nomina: r.neto_centavos === null || r.neto_centavos === undefined ? null : nominaDe(r),
    tarjetaPendiente: r.tarjeta_pendiente,
  };
}

function nominaDe(r: Record<string, unknown>): NominaPersonaVista {
  const frecuencia = String(r.frecuencia);
  const destino = String(r.destino);
  if (!["semanal", "quincenal", "mensual"].includes(frecuencia) || !["clabe", "tarjeta"].includes(destino) || typeof r.nomina_activa !== "boolean") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    netoCentavos: numeroSeguro(r.neto_centavos),
    frecuencia: frecuencia as FrecuenciaNomina,
    proximoPagoEn: fechaDeColumna(r.proximo_pago_en),
    destino: destino as DestinoNomina,
    activa: r.nomina_activa,
  };
}

type LineaPlaneacion = {
  id: string;
  centroId: string;
  presupuesto: number | null;
  bajaEn: string | null;
  nomina: { neto: number; frecuencia: FrecuenciaNomina; proximo: string; activa: boolean } | null;
};

function mapearPlaneacion(fila: unknown): LineaPlaneacion {
  const r = fila as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.cost_center_id !== "string") throw new ErrorDeDominio("base_no_disponible");
  const frecuencia = String(r.frecuencia);
  const nomina = r.neto_centavos === null || r.neto_centavos === undefined ? null : {
    neto: numeroSeguro(r.neto_centavos),
    frecuencia: frecuencia as FrecuenciaNomina,
    proximo: fechaDeColumna(r.proximo_pago_en),
    activa: r.nomina_activa === true,
  };
  if (nomina && !["semanal", "quincenal", "mensual"].includes(nomina.frecuencia)) throw new ErrorDeDominio("base_no_disponible");
  return {
    id: r.id,
    centroId: r.cost_center_id,
    presupuesto: numeroNullable(r.presupuesto_mensual_centavos),
    bajaEn: r.baja_en == null ? null : fechaDeColumna(r.baja_en),
    nomina,
  };
}

function areasDe(centros: CentroVista[], lineas: LineaPlaneacion[], hoy: string): AreaVista[] {
  return centros.map((centro) => {
    const propias = lineas.filter((linea) => linea.centroId === centro.id && (linea.bajaEn === null || linea.bajaEn > hoy));
    const nomina = sumarCentavos(propias.filter((linea) => linea.nomina?.activa).map((linea) => mensualEstimado(linea.nomina?.neto ?? 0, (linea.nomina?.frecuencia ?? "mensual") as FrecuenciaNomina)));
    const individuales = sumarCentavos(propias.map((linea) => linea.presupuesto ?? 0));
    return {
      ...centro,
      personas: propias.length,
      nominaMensualCentavos: nomina,
      presupuestosIndividualesCentavos: individuales,
      disponibleCentavos: disponibleParaPlaneacion(centro.presupuestoCentavos, nomina, individuales),
    };
  });
}

function resumenDe(lineas: LineaPlaneacion[], hoy: string): ResumenPersonas {
  const vigentes = lineas.filter((linea) => linea.bajaEn === null || linea.bajaEn > hoy);
  const elegibles = vigentes.filter((linea) => linea.nomina?.activa && (!linea.bajaEn || linea.nomina.proximo <= linea.bajaEn));
  const proxima = elegibles.length > 0 ? elegibles.map((linea) => linea.nomina?.proximo ?? "").sort()[0] ?? null : null;
  return {
    vigentes: vigentes.length,
    porConfigurar: vigentes.filter((linea) => !linea.nomina).length,
    nominaMensualCentavos: sumarCentavos(vigentes.filter((linea) => linea.nomina?.activa).map((linea) => mensualEstimado(linea.nomina?.neto ?? 0, (linea.nomina?.frecuencia ?? "mensual") as FrecuenciaNomina))),
    proximoPagoEn: proxima,
    proximoPagoCentavos: proxima ? sumarCentavos(elegibles.filter((linea) => linea.nomina?.proximo === proxima).map((linea) => linea.nomina?.neto ?? 0)) : 0,
  };
}

function contar(fila: unknown): number {
  return numeroSeguro((fila as { total?: unknown } | undefined)?.total ?? 0);
}

function numeroNullable(valor: unknown): number | null {
  return valor === null || valor === undefined ? null : numeroSeguro(valor);
}

function numeroSeguro(valor: unknown): number {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" && /^\d+$/.test(valor) ? Number(valor) : Number.NaN;
  if (!Number.isSafeInteger(numero)) throw new ErrorDeDominio("base_no_disponible");
  return numero;
}

function booleano(valor: unknown): boolean {
  if (typeof valor !== "boolean") throw new ErrorDeDominio("base_no_disponible");
  return valor;
}

export function fechaDeColumna(valor: unknown): string {
  if (typeof valor === "string") {
    const coincidencia = /^(\d{4}-\d{2}-\d{2})/.exec(valor);
    if (coincidencia?.[1]) return coincidencia[1];
  }
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    // pg construye DATE como medianoche local. Usar UTC aquí corre el día.
    const anio = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${anio}-${mes}-${dia}`;
  }
  throw new ErrorDeDominio("base_no_disponible");
}
