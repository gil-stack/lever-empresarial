import {
  capacidadesDe,
  esRolPlataforma,
  rolesLeidos,
  type RolCliente,
  type RolPlataforma,
  type Superficie,
} from "../../nucleo/capacidades";
import type { ContextoDeTenant, EmpresaDelContexto } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Sesion } from "../session/tipos";

export type MembresiaLeida = EmpresaDelContexto & { roles: RolCliente[] };

export type Pertenencia = {
  membresias: MembresiaLeida[];
  personal: { operadorId: string; roles: RolPlataforma[] } | null;
};

export type RepositorioTenencia = {
  pertenencia: (userId: string) => Promise<Pertenencia>;
};

/**
 * ruta: la empresa vino en la ruta y la persona es miembro activo.
 * unica: no vino en la ruta y la persona tiene una sola.
 * pendiente: no vino en la ruta y tiene varias; hay que elegir.
 * ajena: la ruta nombra una empresa donde la persona no es miembro activo.
 * ninguna: la persona no tiene membresías activas.
 */
export type Eleccion = "ruta" | "unica" | "pendiente" | "ajena" | "ninguna";

export type ContextoResuelto = { ctx: ContextoDeTenant; eleccion: Eleccion };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Solo una empresa activa da roles y capacidades. El resto no actúa. */

export async function resolverContexto(
  entrada: {
    sesion: Sesion;
    empresaPedida: string | null;
    peticionId: string | null;
    superficie: Superficie;
  },
  deps?: { repositorio?: RepositorioTenencia },
): Promise<ContextoResuelto> {
  const { sesion } = entrada;
  if (!sesion.segundoFactor) throw new ErrorDeDominio("segundo_factor_pendiente");
  const repositorio = deps?.repositorio ?? repositorioPg();
  const pertenencia = await repositorio.pertenencia(sesion.usuario.id);
  const pedida = entrada.empresaPedida && UUID.test(entrada.empresaPedida) ? entrada.empresaPedida.toLowerCase() : null;

  let elegida: MembresiaLeida | null = null;
  let eleccion: Eleccion;
  if (entrada.empresaPedida) {
    elegida = pedida ? (pertenencia.membresias.find((m) => m.id.toLowerCase() === pedida) ?? null) : null;
    eleccion = elegida ? "ruta" : "ajena";
  } else if (pertenencia.membresias.length === 1) {
    elegida = pertenencia.membresias[0] ?? null;
    eleccion = "unica";
  } else {
    eleccion = pertenencia.membresias.length === 0 ? "ninguna" : "pendiente";
  }

  if (pertenencia.personal) {
    elegida = null;
    eleccion = "ninguna";
  }
  const rolesCliente = elegida?.estado === "activa" ? elegida.roles : [];
  const rolesPlataforma = pertenencia.personal?.roles ?? [];
  const empresa: EmpresaDelContexto | null = elegida
    ? {
        id: elegida.id,
        rfc: elegida.rfc,
        razonSocial: elegida.razonSocial,
        operadorId: elegida.operadorId,
        estado: elegida.estado,
        demostracion: elegida.demostracion,
      }
    : null;

  return {
    eleccion,
    ctx: {
      sesionId: sesion.id,
      peticionId: entrada.peticionId && UUID.test(entrada.peticionId) ? entrada.peticionId : null,
      superficie: entrada.superficie,
      persona: { ...sesion.usuario },
      segundoFactor: sesion.segundoFactor.metodo,
      empresa,
      roles: rolesCliente,
      personal: pertenencia.personal,
      empresas: (pertenencia.personal ? [] : pertenencia.membresias).map((m) => ({
        id: m.id,
        razonSocial: m.razonSocial,
      })),
      capacidades: capacidadesDe({ rolesCliente, rolesPlataforma }),
    },
  };
}

export const SQL = {
  membresias: `
    select c.id, c.rfc, c.razon_social, c.operator_id, c.estado, c.demostracion,
           coalesce(array_agg(r.rol order by r.rol) filter (where r.rol is not null), '{}') as roles
    from memberships m
    join companies c on c.id = m.company_id
    left join membership_roles r on r.user_id = m.user_id and r.company_id = m.company_id
    where m.user_id = $1 and m.estado = 'activa'
    group by c.id
    order by c.razon_social, c.id
  `,
  personal: `
    select s.operator_id,
           coalesce(array_agg(r.rol order by r.rol) filter (where r.rol is not null), '{}') as roles
    from platform_staff s
    left join platform_staff_roles r on r.operator_id = s.operator_id and r.user_id = s.user_id
    where s.user_id = $1 and s.estado = 'activo'
    group by s.operator_id
    order by s.operator_id
    limit 1
  `,
} as const;

export function repositorioPg(): RepositorioTenencia {
  return {
    pertenencia(userId) {
      return conContexto({ rol: "plataforma_cliente", userId }, async (consulta) => {
        const membresias = await consulta.query(SQL.membresias, [userId]);
        const personal = await consulta.query(SQL.personal, [userId]);
        const filaPersonal = personal.rows[0] as { operator_id?: unknown; roles?: unknown } | undefined;
        return {
          membresias: membresias.rows.map(mapearMembresia),
          personal:
            filaPersonal && typeof filaPersonal.operator_id === "string"
              ? {
                  operadorId: filaPersonal.operator_id,
                  roles: (Array.isArray(filaPersonal.roles) ? filaPersonal.roles : []).filter(esRolPlataforma),
                }
              : null,
        };
      });
    },
  };
}

function mapearMembresia(fila: unknown): MembresiaLeida {
  const r = fila as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.rfc !== "string" ||
    typeof r.razon_social !== "string" ||
    typeof r.operator_id !== "string" ||
    typeof r.estado !== "string" ||
    typeof r.demostracion !== "boolean" ||
    !Array.isArray(r.roles)
  ) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    id: r.id,
    rfc: r.rfc,
    razonSocial: r.razon_social,
    operadorId: r.operator_id,
    estado: r.estado,
    demostracion: r.demostracion,
    roles: rolesLeidos(r.roles),
  };
}
