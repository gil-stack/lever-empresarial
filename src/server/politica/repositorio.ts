import { randomUUID } from "node:crypto";

import { esUuid, puedeEscribirPolitica } from "../../dominio/politica";
import { conTransaccion, consultar, type Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { mapearPolitica } from "./mapear";
import type { DatosPolitica } from "../../dominio/politica";

/**
 * La empresa sale de la membresía del usuario. El id que mande el navegador
 * no es un parámetro de estas consultas.
 */

const CAJONES_JSON = `
  select coalesce(jsonb_agg(ordenado.fila order by ordenado.orden), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'codigo', d.codigo,
      'nombre', d.nombre,
      'saldo', coalesce(sum(p.centavos), 0)::text
    ) as fila,
    case d.codigo
      when 'viaticos' then 1
      when 'proveedores' then 2
      when 'impuestos' then 3
      when 'nomina' then 4
      else 5
    end as orden
    from drawers d
    left join postings p on p.drawer_id = d.id and p.company_id = d.company_id
    where d.company_id = m.company_id
    group by d.id, d.codigo, d.nombre
  ) ordenado
`;

const SIN_CAJON_JSON = `
  select coalesce(sum(p.centavos), 0)::text
  from postings p
  where p.company_id = m.company_id and p.drawer_id is null
`;

export const SQL = {
  leer: `
    select jsonb_build_object(
      'companyId', m.company_id,
      'rol', m.rol,
      'plazo', (
        select jsonb_build_object(
          'dias', p.dias_comprobante,
          'vencidos', p.max_vencidos
        )
        from policies p
        where p.company_id = m.company_id
      ),
      'umbral', (
        select p.umbral_proveedores_centavos::text
        from policies p
        where p.company_id = m.company_id
      ),
      'personas', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'personaId', e.id,
          'nombre', e.nombre,
          'correo', coalesce(u.correo, ''),
          'rol', coalesce(mb.rol, ''),
          'dias', pp.dias_comprobante,
          'vencidos', pp.max_vencidos
        ) order by e.nombre, e.id), '[]'::jsonb)
        from employees e
        left join users u on u.id = e.user_id
        left join memberships mb on mb.user_id = e.user_id and mb.company_id = e.company_id
        left join policy_persons pp
          on pp.company_id = e.company_id and pp.employee_id = e.id
        where e.company_id = m.company_id
      ),
      'categorias', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id,
          'nombre', c.nombre,
          'tope', c.tope_centavos::text
        ) order by c.nombre, c.id), '[]'::jsonb)
        from policy_categories c
        where c.company_id = m.company_id
      ),
      'cajones', (${CAJONES_JSON}),
      'sinCajon', (${SIN_CAJON_JSON})
    ) as vista
    from memberships m
    where m.user_id = $1
  `,
  bloquearMiembro: `
    select company_id, rol
    from memberships
    where user_id = $1
    for update
  `,
  bloquearPolitica: `
    select dias_comprobante, max_vencidos
    from policies
    where company_id = $1
    for update
  `,
  guardarPlazo: `
    update policies
    set dias_comprobante = $2, max_vencidos = $3
    where company_id = $1
  `,
  guardarUmbral: `
    update policies
    set umbral_proveedores_centavos = $2
    where company_id = $1
  `,
  personaDeLaEmpresa: `
    select 1 as presente
    from employees
    where id = $2 and company_id = $1
  `,
  guardarPersona: `
    insert into policy_persons (company_id, employee_id, dias_comprobante, max_vencidos)
    values ($1, $2, $3, $4)
    on conflict (company_id, employee_id) do update
    set dias_comprobante = excluded.dias_comprobante,
        max_vencidos = excluded.max_vencidos
  `,
  quitarPersona: `
    delete from policy_persons
    where company_id = $1 and employee_id = $2
  `,
  crearCategoria: `
    insert into policy_categories (id, company_id, nombre, tope_centavos)
    values ($1, $2, $3, $4)
  `,
  escribirTope: `
    update policy_categories
    set tope_centavos = $3
    where company_id = $1 and id = $2
  `,
  quitarTope: `
    update policy_categories
    set tope_centavos = null
    where company_id = $1 and id = $2
  `,
  borrarCategoria: `
    delete from policy_categories
    where company_id = $1 and id = $2
  `,
  auditar: `
    insert into audit_events (
      id, company_id, actor_id, accion, entidad, identificador, ocurrido_en
    ) values ($1, $2, $3, $4, $5, $6, $7)
  `,
} as const;

const ACCIONES = new Set([
  "editar_politica",
  "editar_umbral",
  "quitar_umbral",
  "editar_politica_persona",
  "quitar_politica_persona",
  "crear_categoria",
  "escribir_tope",
  "quitar_tope",
  "borrar_categoria",
]);

const ENTIDADES = new Set(["policies", "policy_persons", "policy_categories"]);

export type EventoPolitica = {
  accion:
    | "editar_politica"
    | "editar_umbral"
    | "quitar_umbral"
    | "editar_politica_persona"
    | "quitar_politica_persona"
    | "crear_categoria"
    | "escribir_tope"
    | "quitar_tope"
    | "borrar_categoria";
  entidad: "policies" | "policy_persons" | "policy_categories";
  identificador: string;
  ocurridoEn: Date;
};

export type ContextoEscritura = {
  companyId: string;
  rol: string;
  plazo: { diasComprobante: number; maxVencidos: number };
  guardarPlazo: (dias: number, vencidos: number) => Promise<void>;
  guardarUmbral: (centavos: number | null) => Promise<void>;
  guardarPersona: (personaId: string, dias: number, vencidos: number) => Promise<void>;
  quitarPersona: (personaId: string) => Promise<boolean>;
  crearCategoria: (categoria: { id: string; nombre: string; topeCentavos: number | null }) => Promise<void>;
  escribirTope: (categoriaId: string, centavos: number) => Promise<void>;
  quitarTope: (categoriaId: string) => Promise<void>;
  borrarCategoria: (categoriaId: string) => Promise<void>;
  auditar: (evento: EventoPolitica) => Promise<void>;
};

export type RepositorioPolitica = {
  leer: (userId: string) => Promise<DatosPolitica | null>;
  escribir: (userId: string, fn: (ctx: ContextoEscritura) => Promise<void>) => Promise<void>;
};

export function rechazarSiNoEscribe(rol: string): void {
  if (!puedeEscribirPolitica(rol)) throw new ErrorDeDominio("rol_sin_permiso");
}

export function repositorioPg(): RepositorioPolitica {
  return {
    async leer(userId) {
      const resultado = await consultar(SQL.leer, [userId]);
      const fila = resultado.rows[0] as { vista?: unknown } | undefined;
      if (!fila) return null;
      return mapearPolitica(fila.vista);
    },
    escribir(userId, fn) {
      return conTransaccion(async (consulta) => {
        const ctx = await abrirEscritura(consulta, userId);
        await fn(ctx);
      });
    },
  };
}

async function abrirEscritura(consulta: Consulta, userId: string): Promise<ContextoEscritura> {
  const miembro = await consulta.query(SQL.bloquearMiembro, [userId]);
  const fila = miembro.rows[0] as { company_id?: unknown; rol?: unknown } | undefined;
  if (!fila) throw new ErrorDeDominio("sin_empresa");
  if (!esUuid(fila.company_id) || typeof fila.rol !== "string") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  rechazarSiNoEscribe(fila.rol);
  const politica = await consulta.query(SQL.bloquearPolitica, [fila.company_id]);
  const plazo = politica.rows[0] as { dias_comprobante?: unknown; max_vencidos?: unknown } | undefined;
  const dias = leerColumnaEntera(plazo?.dias_comprobante);
  const vencidos = leerColumnaEntera(plazo?.max_vencidos);
  if (!plazo || dias === null || vencidos === null) throw new ErrorDeDominio("politica_ausente");
  return contexto(consulta, {
    companyId: fila.company_id,
    rol: fila.rol,
    actorId: userId,
    plazo: { diasComprobante: dias, maxVencidos: vencidos },
  });
}

function contexto(
  consulta: Consulta,
  ancla: {
    companyId: string;
    rol: string;
    actorId: string;
    plazo: { diasComprobante: number; maxVencidos: number };
  },
): ContextoEscritura {
  const companyId = ancla.companyId;
  return {
    companyId,
    rol: ancla.rol,
    plazo: ancla.plazo,
    async guardarPlazo(dias, vencidos) {
      const resultado = await consulta.query(SQL.guardarPlazo, [companyId, dias, vencidos]);
      if (resultado.rowCount !== 1) throw new ErrorDeDominio("politica_ausente");
    },
    async guardarUmbral(centavos) {
      const resultado = await consulta.query(SQL.guardarUmbral, [companyId, centavos]);
      if (resultado.rowCount !== 1) throw new ErrorDeDominio("politica_ausente");
    },
    async guardarPersona(userId, dias, vencidos) {
      await exigirPersona(consulta, companyId, userId);
      await consulta.query(SQL.guardarPersona, [companyId, userId, dias, vencidos]);
    },
    async quitarPersona(userId) {
      await exigirPersona(consulta, companyId, userId);
      const resultado = await consulta.query(SQL.quitarPersona, [companyId, userId]);
      return resultado.rowCount > 0;
    },
    async crearCategoria(categoria) {
      await consulta.query(SQL.crearCategoria, [
        categoria.id,
        companyId,
        categoria.nombre,
        categoria.topeCentavos,
      ]);
    },
    async escribirTope(categoriaId, centavos) {
      const resultado = await consulta.query(SQL.escribirTope, [companyId, categoriaId, centavos]);
      if (resultado.rowCount !== 1) throw new ErrorDeDominio("categoria_ajena");
    },
    async quitarTope(categoriaId) {
      const resultado = await consulta.query(SQL.quitarTope, [companyId, categoriaId]);
      if (resultado.rowCount !== 1) throw new ErrorDeDominio("categoria_ajena");
    },
    async borrarCategoria(categoriaId) {
      const resultado = await consulta.query(SQL.borrarCategoria, [companyId, categoriaId]);
      if (resultado.rowCount !== 1) throw new ErrorDeDominio("categoria_ajena");
    },
    async auditar(evento) {
      if (!ACCIONES.has(evento.accion) || !ENTIDADES.has(evento.entidad)) {
        throw new ErrorDeDominio("politica_invalida");
      }
      if (!esUuid(evento.identificador) || Number.isNaN(evento.ocurridoEn.getTime())) {
        throw new ErrorDeDominio("politica_invalida");
      }
      await consulta.query(SQL.auditar, [
        randomUUID(),
        companyId,
        ancla.actorId,
        evento.accion,
        evento.entidad,
        evento.identificador,
        evento.ocurridoEn,
      ]);
    },
  };
}

async function exigirPersona(consulta: Consulta, companyId: string, userId: string): Promise<void> {
  if (!esUuid(userId)) throw new ErrorDeDominio("persona_ajena");
  const resultado = await consulta.query(SQL.personaDeLaEmpresa, [companyId, userId]);
  if (resultado.rows.length === 0) throw new ErrorDeDominio("persona_ajena");
}

function leerColumnaEntera(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isSafeInteger(valor)) return valor;
  if (typeof valor === "string" && /^[0-9]+$/.test(valor)) {
    const numero = Number(valor);
    if (Number.isSafeInteger(numero)) return numero;
  }
  return null;
}
