import { rolesLeidos } from "../../nucleo/capacidades";
import { baseCliente } from "../../nucleo/contexto";
import { bloquearEmpresa, conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type {
  CentroVista,
  HechosLiberacion,
  LecturaMaestro,
  MiembroDeCorreo,
  PersonaBloqueada,
  PersonaVista,
  RepositorioPersonas,
  TransaccionMaestro,
} from "./tipos";

const ROLES_DE = `coalesce((
  select array_agg(r.rol order by r.rol)
  from membership_roles r
  where r.user_id = e.user_id and r.company_id = e.company_id
), '{}')`;

// La empresa es la del contexto. RLS la vuelve a exigir en cada tabla.
// Ninguna lectura del maestro trae password_hash.
export const SQL = {
  centros: `
    select id, nombre
    from cost_centers
    where company_id = $1
    order by lower(nombre), id
  `,
  personas: `
    select e.id, e.nombre, e.alta_en, e.baja_en, e.clabe,
           e.jefe_id, j.nombre as jefe_nombre,
           e.cost_center_id, c.nombre as centro_nombre,
           ${ROLES_DE} as roles, mb.estado as membresia, u.correo
    from employees e
    join cost_centers c on c.id = e.cost_center_id and c.company_id = e.company_id
    left join employees j on j.id = e.jefe_id and j.company_id = e.company_id
    left join users u on u.id = e.user_id
    left join memberships mb on mb.user_id = e.user_id and mb.company_id = e.company_id
    where e.company_id = $1
    order by e.nombre, e.id
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
    select id, nombre
    from cost_centers
    where id = $1 and company_id = $2
  `,
  centroOcupado: `
    select 1 as presente
    from cost_centers
    where company_id = $1 and lower(nombre) = lower($2)
    limit 1
  `,
  jefePorId: `
    select e.id, e.alta_en, e.baja_en, e.user_id, ${ROLES_DE} as roles
    from employees e
    where e.id = $1 and e.company_id = $2
  `,
  bloquearPersona: `
    select e.id, e.alta_en, e.baja_en, e.user_id, ${ROLES_DE} as roles
    from employees e
    where e.id = $1 and e.company_id = $2
    for update of e
  `,
  miembroPorCorreo: `
    select m.user_id as id,
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
  insertarCentro: "insert into cost_centers (id, company_id, nombre) values ($1, $2, $3)",
  insertarEmpleado: `
    insert into employees (
      id, company_id, user_id, jefe_id, cost_center_id,
      nombre, alta_en, baja_en, clabe, clabe_digito_valido
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
  `,
  escribirBaja: `
    update employees
    set baja_en = $3::date
    where id = $1 and company_id = $2
  `,
  // Si no le queda otro rol, conserva tarjetahabiente, como el trigger de la baja.
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
        return fn(transaccion(consulta, ctx.empresa.id));
      });
    },
    leer(ctx, hoy) {
      return conContexto(baseCliente(ctx), async (consulta): Promise<LecturaMaestro> => {
        const companyId = ctx.empresa.id;
        const centros = await consulta.query(SQL.centros, [companyId]);
        const personas = await consulta.query(SQL.personas, [companyId]);
        const autorizados = await consulta.query(SQL.autorizados, [companyId, hoy]);
        return {
          centros: centros.rows.map(mapearCentro),
          personas: personas.rows.map(mapearPersona),
          autorizados: autorizados.rows.map(mapearNombre),
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

function transaccion(consulta: Consulta, companyId: string): TransaccionMaestro {
  return {
    companyId,
    consulta,
    async centroPorId(id) {
      const resultado = await consulta.query(SQL.centroPorId, [id, companyId]);
      const fila = resultado.rows[0];
      return fila ? mapearCentro(fila) : null;
    },
    async centroOcupado(nombre) {
      const resultado = await consulta.query(SQL.centroOcupado, [companyId, nombre]);
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
    async insertarCentro(centro) {
      await consulta.query(SQL.insertarCentro, [centro.id, companyId, centro.nombre]);
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
      ]);
    },
    async escribirBaja(id, bajaEn) {
      const resultado = await consulta.query(SQL.escribirBaja, [id, companyId, bajaEn]);
      if (resultado.rowCount < 1) throw new ErrorDeDominio("persona_ausente");
    },
    async quitarLiberador(userId) {
      await consulta.query(SQL.quitarLiberador, [userId, companyId]);
    },
  };
}

function rolesDeColumna(valor: unknown) {
  if (!Array.isArray(valor)) throw new ErrorDeDominio("base_no_disponible");
  return rolesLeidos(valor);
}

function mapearCentro(fila: unknown): CentroVista {
  const registro = fila as { id?: unknown; nombre?: unknown };
  if (typeof registro.id !== "string" || typeof registro.nombre !== "string") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return { id: registro.id, nombre: registro.nombre };
}

function mapearNombre(fila: unknown): string {
  const nombre = (fila as { nombre?: unknown }).nombre;
  if (typeof nombre !== "string" || nombre.length === 0) throw new ErrorDeDominio("base_no_disponible");
  return nombre;
}

function mapearBloqueada(fila: unknown): PersonaBloqueada {
  const registro = fila as { id?: unknown; alta_en?: unknown; baja_en?: unknown; user_id?: unknown; roles?: unknown };
  if (typeof registro.id !== "string") throw new ErrorDeDominio("base_no_disponible");
  return {
    id: registro.id,
    altaEn: fechaDeColumna(registro.alta_en),
    bajaEn: registro.baja_en == null ? null : fechaDeColumna(registro.baja_en),
    userId: typeof registro.user_id === "string" ? registro.user_id : null,
    roles: rolesDeColumna(registro.roles),
  };
}

function mapearMiembro(fila: unknown): MiembroDeCorreo {
  const registro = fila as { id?: unknown; tiene_empleado?: unknown };
  if (typeof registro.id !== "string" || typeof registro.tiene_empleado !== "boolean") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return { id: registro.id, tieneEmpleado: registro.tiene_empleado };
}

function mapearPersona(fila: unknown): PersonaVista {
  const registro = fila as {
    id?: unknown;
    nombre?: unknown;
    alta_en?: unknown;
    baja_en?: unknown;
    clabe?: unknown;
    jefe_id?: unknown;
    jefe_nombre?: unknown;
    cost_center_id?: unknown;
    centro_nombre?: unknown;
    roles?: unknown;
    membresia?: unknown;
    correo?: unknown;
  };
  if (
    typeof registro.id !== "string" ||
    typeof registro.nombre !== "string" ||
    typeof registro.clabe !== "string" ||
    typeof registro.cost_center_id !== "string" ||
    typeof registro.centro_nombre !== "string"
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  if (!/^[0-9]{18}$/.test(registro.clabe)) throw new ErrorDeDominio("base_no_disponible");
  return {
    id: registro.id,
    nombre: registro.nombre,
    altaEn: fechaDeColumna(registro.alta_en),
    bajaEn: registro.baja_en == null ? null : fechaDeColumna(registro.baja_en),
    clabe: registro.clabe,
    jefeId: typeof registro.jefe_id === "string" ? registro.jefe_id : null,
    jefeNombre: typeof registro.jefe_nombre === "string" ? registro.jefe_nombre : null,
    centroId: registro.cost_center_id,
    centroNombre: registro.centro_nombre,
    roles: rolesDeColumna(registro.roles),
    invitada: registro.membresia === "invitada",
    correo: typeof registro.correo === "string" ? registro.correo : null,
  };
}

export function fechaDeColumna(valor: unknown): string {
  if (typeof valor === "string") {
    const coincidencia = /^(\d{4}-\d{2}-\d{2})/.exec(valor);
    if (coincidencia?.[1]) return coincidencia[1];
  }
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const anio = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${anio}-${mes}-${dia}`;
  }
  throw new ErrorDeDominio("base_no_disponible");
}
