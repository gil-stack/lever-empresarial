import { conTransaccion, consultar, type Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { ROLES, type Rol } from "../session/tipos";
import type {
  CentroVista,
  ContextoMaestro,
  HechosLiberacion,
  LecturaMaestro,
  PersonaBloqueada,
  PersonaVista,
  RepositorioPersonas,
  UsuarioDeCorreo,
} from "./tipos";

// El company_id sale de la membresía del usuario, nunca de un dato del navegador.
// Ninguna lectura del maestro trae password_hash.
export const SQL = {
  bloquearEmpresa: `
    select m.company_id, m.rol
    from memberships m
    join companies c on c.id = m.company_id
    where m.user_id = $1
    for update of c
  `,
  puerta: "select rol from memberships where user_id = $1",
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
           mb.rol, u.correo
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
    join users u on u.id = m.user_id
    left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
    where m.company_id = $1
      and m.rol = 'liberador'
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
    select id, alta_en, baja_en
    from employees
    where id = $1 and company_id = $2
  `,
  bloquearPersona: `
    select id, alta_en, baja_en
    from employees
    where id = $1 and company_id = $2
    for update
  `,
  usuarioPorCorreo: `
    select u.id,
           m.company_id,
           exists (select 1 from employees e where e.user_id = u.id) as tiene_empleado
    from users u
    left join memberships m on m.user_id = u.id
    where lower(u.correo) = lower($1)
  `,
  insertarCentro: "insert into cost_centers (id, company_id, nombre) values ($1, $2, $3)",
  insertarUsuario: "insert into users (id, nombre, correo, password_hash) values ($1, $2, $3, $4)",
  insertarMembresia: "insert into memberships (user_id, company_id, rol) values ($1, $2, $3)",
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
  hechos: `
    select m.rol,
           coalesce(
             (
               select e.baja_en is not null and e.baja_en <= $2::date
               from employees e
               where e.user_id = m.user_id and e.company_id = m.company_id
             ),
             false
           ) as actor_de_baja,
           (
             select count(*)::int
             from memberships ml
             left join employees el on el.user_id = ml.user_id and el.company_id = ml.company_id
             where ml.company_id = m.company_id
               and ml.rol = 'liberador'
               and (el.baja_en is null or el.baja_en > $2::date)
           ) as autorizados
    from memberships m
    where m.user_id = $1
  `,
} as const;

export function repositorioPg(): RepositorioPersonas {
  return {
    conEmpresa(userId, fn) {
      return conTransaccion(async (consulta) => {
        const puerta = await consulta.query(SQL.bloquearEmpresa, [userId]);
        const fila = puerta.rows[0] as { company_id?: unknown; rol?: unknown } | undefined;
        if (!fila || typeof fila.company_id !== "string") throw new ErrorDeDominio("sin_empresa");
        const rol = rolLeido(fila.rol);
        if (!rol) throw new ErrorDeDominio("base_no_disponible");
        return fn(contexto(consulta, fila.company_id, rol));
      });
    },
    async puerta(userId) {
      const resultado = await consultar(SQL.puerta, [userId]);
      const fila = resultado.rows[0] as { rol?: unknown } | undefined;
      if (!fila) return null;
      const rol = rolLeido(fila.rol);
      if (!rol) throw new ErrorDeDominio("base_no_disponible");
      return { rol };
    },
    async leer(userId, hoy) {
      const puerta = await consultar(SQL.puerta, [userId]);
      const miembro = puerta.rows[0] as { rol?: unknown } | undefined;
      if (!miembro) return null;
      const rol = rolLeido(miembro.rol);
      if (!rol) throw new ErrorDeDominio("base_no_disponible");
      const empresa = await consultar(
        "select company_id from memberships where user_id = $1",
        [userId],
      );
      const companyId = (empresa.rows[0] as { company_id?: unknown } | undefined)?.company_id;
      if (typeof companyId !== "string") return null;
      const [centros, personas, autorizados] = await Promise.all([
        consultar(SQL.centros, [companyId]),
        consultar(SQL.personas, [companyId]),
        consultar(SQL.autorizados, [companyId, hoy]),
      ]);
      return {
        rol,
        centros: centros.rows.map((fila) => mapearCentro(fila)),
        personas: personas.rows.map((fila) => mapearPersona(fila)),
        autorizados: autorizados.rows.map((fila) => mapearNombre(fila)),
      };
    },
    async resumen(userId, hoy) {
      const empresa = await consultar(
        "select company_id from memberships where user_id = $1",
        [userId],
      );
      const companyId = (empresa.rows[0] as { company_id?: unknown } | undefined)?.company_id;
      if (typeof companyId !== "string") return null;
      const autorizados = await consultar(SQL.autorizados, [companyId, hoy]);
      return { nombres: autorizados.rows.map((fila) => mapearNombre(fila)) };
    },
    async hechosLiberacion(userId, hoy) {
      const resultado = await consultar(SQL.hechos, [userId, hoy]);
      const fila = resultado.rows[0] as
        | { rol?: unknown; actor_de_baja?: unknown; autorizados?: unknown }
        | undefined;
      if (!fila) return null;
      return mapearHechos(fila);
    },
  };
}

function contexto(consulta: Consulta, companyId: string, rol: Rol): ContextoMaestro {
  return {
    companyId,
    rol,
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
    async usuarioPorCorreo(correo) {
      const resultado = await consulta.query(SQL.usuarioPorCorreo, [correo]);
      const fila = resultado.rows[0];
      return fila ? mapearUsuario(fila) : null;
    },
    async insertarCentro(centro) {
      await consulta.query(SQL.insertarCentro, [centro.id, companyId, centro.nombre]);
    },
    async insertarUsuario(usuario) {
      await consulta.query(SQL.insertarUsuario, [
        usuario.id,
        usuario.nombre,
        usuario.correo,
        usuario.passwordHash,
      ]);
    },
    async insertarMembresia(userId, rolNuevo) {
      await consulta.query(SQL.insertarMembresia, [userId, companyId, rolNuevo]);
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
  };
}

function rolLeido(valor: unknown): Rol | null {
  return ROLES.find((rol) => rol === valor) ?? null;
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
  const registro = fila as { id?: unknown; alta_en?: unknown; baja_en?: unknown };
  if (typeof registro.id !== "string") throw new ErrorDeDominio("base_no_disponible");
  return {
    id: registro.id,
    altaEn: fechaDeColumna(registro.alta_en),
    bajaEn: registro.baja_en == null ? null : fechaDeColumna(registro.baja_en),
  };
}

function mapearUsuario(fila: unknown): UsuarioDeCorreo {
  const registro = fila as { id?: unknown; company_id?: unknown; tiene_empleado?: unknown };
  if (typeof registro.id !== "string" || typeof registro.tiene_empleado !== "boolean") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    id: registro.id,
    companyId: typeof registro.company_id === "string" ? registro.company_id : null,
    tieneEmpleado: registro.tiene_empleado,
  };
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
    rol?: unknown;
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
  const rol = registro.rol == null ? null : rolLeido(registro.rol);
  if (registro.rol != null && !rol) throw new ErrorDeDominio("base_no_disponible");
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
    rol,
    correo: typeof registro.correo === "string" ? registro.correo : null,
  };
}

function mapearHechos(fila: {
  rol?: unknown;
  actor_de_baja?: unknown;
  autorizados?: unknown;
}): HechosLiberacion {
  const rol = rolLeido(fila.rol);
  if (!rol || typeof fila.actor_de_baja !== "boolean" || typeof fila.autorizados !== "number") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return { rol, actorDeBaja: fila.actor_de_baja, autorizados: fila.autorizados };
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

export type { LecturaMaestro };
