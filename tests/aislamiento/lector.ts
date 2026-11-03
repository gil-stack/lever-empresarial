import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import {
  col,
  desde,
  ident,
  literal,
  mapearColumnas,
  predicadoId,
  predicadoToken,
  predicadoVigente,
  type ColumnaFisica,
  type FilaDeColumna,
  type Mapa,
  type TablaMapeada,
} from "./columnas.ts";
import { evaluarEsquema } from "./esquema.ts";
import type { Empresa, EventoDeAuditoria, LecturaDeNegocio, LibroSinFiltro, Sesion } from "./interfaz.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable } from "./postgres.ts";

const RFC_A = "ALA010101AAA";
const RFC_B = "BETA010101B12";
const RAZON_A = "Razón Social Alfa";
const RAZON_B = "Razón Social Beta";
const ALTA = "2026-11-03T15:00:00Z";
const VIGENTE = "2099-01-01T00:00:00Z";
const VENCIDA = "2000-01-01T00:00:00Z";

export type ContextoAislamiento = {
  lectura: LecturaDeNegocio;
  libroSinFiltro: LibroSinFiltro;
  ids: {
    empresaA: string;
    empresaB: string;
    rfcA: string;
    rfcB: string;
    razonA: string;
    razonB: string;
    eventoA: string;
    eventoB: string;
    eventoOperador: string | null;
    sesionA: Sesion;
    sesionAVencida: Sesion;
    sesionB: Sesion;
    sesionSinMembresia: Sesion;
    sesionFalsa: Sesion;
  };
};

/**
 * Aplica las migraciones en una base nueva, siembra dos cuentas y entrega la
 * interfaz de lectura. Al terminar borra esa base.
 */
export async function conEscenario(
  directorioMigraciones: string,
  fn: (ctx: ContextoAislamiento) => Promise<void>,
): Promise<void> {
  const esquema = evaluarEsquema(directorioMigraciones);
  if (esquema.pendiente) throw new Error(esquema.motivo);

  const urlAdmin = exigirBaseDesechable();
  await conBaseDesechable(urlAdmin, async (url) => {
    for (const archivo of esquema.archivos) {
      try {
        aplicarArchivo(url, archivo);
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        throw new Error(`No se pudo aplicar ${path.basename(archivo)}.\n${detalle}`);
      }
    }

    const filas = consultarJson<FilaDeColumna[]>(url, SQL_COLUMNAS);
    const mapa = mapearColumnas(filas);
    const ids = sembrar(url, mapa);
    const leer = <T>(sql: string) => consultarJson<T>(url, sql);
    await fn({
      lectura: crearLectura(mapa, leer),
      libroSinFiltro: crearLibroSinFiltro(mapa, leer),
      ids,
    });
  });
}

const SQL_COLUMNAS = `
select coalesce(json_agg(json_build_object(
  'esquema', c.table_schema,
  'tabla', c.table_name,
  'nombre', c.column_name,
  'dataType', c.data_type,
  'udtName', c.udt_name,
  'nullable', c.is_nullable = 'YES',
  'tieneDefault', c.column_default is not null,
  'generada', c.is_generated = 'ALWAYS',
  'identidad', c.is_identity = 'YES'
) order by c.table_schema, c.table_name, c.ordinal_position), '[]'::json)::text
from information_schema.columns c
join information_schema.tables t
  on t.table_schema = c.table_schema
 and t.table_name = c.table_name
where t.table_type = 'BASE TABLE'
  and c.table_name in ('companies', 'users', 'sessions', 'memberships', 'audit_events')
  and c.table_schema not in ('pg_catalog', 'information_schema')
`;

function crearLectura(mapa: Mapa, leer: <T>(sql: string) => T): LecturaDeNegocio {
  return {
    async leerEmpresa(sesion, companyIdPedido) {
      return leer<Empresa | null>(sqlLeerEmpresa(mapa, sesion, companyIdPedido));
    },
    async listarEmpresas(sesion) {
      return leer<Empresa[]>(sqlListarEmpresas(mapa, sesion));
    },
    async listarAuditoria(sesion, companyIdPedido) {
      return leer<EventoDeAuditoria[]>(sqlListarAuditoria(mapa, sesion, companyIdPedido));
    },
  };
}

function crearLibroSinFiltro(mapa: Mapa, leer: <T>(sql: string) => T): LibroSinFiltro {
  return {
    async leerEmpresa(id) {
      return leer<Empresa | null>(sqlEmpresaSinFiltro(mapa, id));
    },
    async existeEvento(id) {
      const fila = leer<{ existe: boolean }>(sqlExisteEvento(mapa, id));
      return fila.existe;
    },
  };
}

/**
 * La membresía de la sesión autoriza. El id pedido se compara además, para
 * que un id de otra empresa no ensanche la lectura.
 */
function sqlLeerEmpresa(mapa: Mapa, sesion: Sesion, companyIdPedido: string): string {
  const empresas = mapa.companies;
  const sesiones = mapa.sessions;
  const membresias = mapa.memberships;
  return `
    select coalesce((
      select json_build_object(
        'id', btrim(${col("c", empresas.campos.id)}::text),
        'rfc', btrim(${col("c", empresas.campos.rfc)}::text),
        'razonSocial', btrim(${col("c", empresas.campos.razonSocial)}::text)
      )::text
      from ${desde(sesiones)} s
      join ${desde(membresias)} m
        on ${col("m", membresias.campos.userId)}::text = ${col("s", sesiones.campos.userId)}::text
      join ${desde(empresas)} c
        on ${col("c", empresas.campos.id)}::text = ${col("m", membresias.campos.companyId)}::text
      where ${predicadoToken("s", sesiones.campos.tokenHash, sesion.tokenHash)}
        and ${predicadoVigente("s", sesiones.campos.vence)}
        and ${predicadoId("c", empresas.campos.id, companyIdPedido)}
      limit 1
    ), 'null')
  `;
}

function sqlListarEmpresas(mapa: Mapa, sesion: Sesion): string {
  const empresas = mapa.companies;
  const sesiones = mapa.sessions;
  const membresias = mapa.memberships;
  return `
    select coalesce((
      select json_agg(json_build_object(
        'id', id,
        'rfc', rfc,
        'razonSocial', "razonSocial"
      ) order by id)::text
      from (
        select distinct
          btrim(${col("c", empresas.campos.id)}::text) as id,
          btrim(${col("c", empresas.campos.rfc)}::text) as rfc,
          btrim(${col("c", empresas.campos.razonSocial)}::text) as "razonSocial"
        from ${desde(sesiones)} s
        join ${desde(membresias)} m
          on ${col("m", membresias.campos.userId)}::text = ${col("s", sesiones.campos.userId)}::text
        join ${desde(empresas)} c
          on ${col("c", empresas.campos.id)}::text = ${col("m", membresias.campos.companyId)}::text
        where ${predicadoToken("s", sesiones.campos.tokenHash, sesion.tokenHash)}
          and ${predicadoVigente("s", sesiones.campos.vence)}
      ) filas
    ), '[]')
  `;
}

function sqlListarAuditoria(
  mapa: Mapa,
  sesion: Sesion,
  companyIdPedido: string | null,
): string {
  const sesiones = mapa.sessions;
  const membresias = mapa.memberships;
  const auditoria = mapa.audit_events;
  const filtroPedido = companyIdPedido
    ? `and ${predicadoId("e", auditoria.campos.companyId, companyIdPedido)}`
    : "";
  return `
    select coalesce((
      select json_agg(json_build_object(
        'id', id,
        'companyId', "companyId",
        'accion', accion
      ) order by id)::text
      from (
        select distinct
          btrim(${col("e", auditoria.campos.id)}::text) as id,
          btrim(${col("e", auditoria.campos.companyId)}::text) as "companyId",
          btrim(${col("e", auditoria.campos.accion)}::text) as accion
        from ${desde(sesiones)} s
        join ${desde(membresias)} m
          on ${col("m", membresias.campos.userId)}::text = ${col("s", sesiones.campos.userId)}::text
        join ${desde(auditoria)} e
          on ${col("e", auditoria.campos.companyId)}::text = ${col("m", membresias.campos.companyId)}::text
        where ${predicadoToken("s", sesiones.campos.tokenHash, sesion.tokenHash)}
          and ${predicadoVigente("s", sesiones.campos.vence)}
          ${filtroPedido}
      ) filas
    ), '[]')
  `;
}

function sqlEmpresaSinFiltro(mapa: Mapa, id: string): string {
  const empresas = mapa.companies;
  return `
    select coalesce((
      select json_build_object(
        'id', btrim(${col("c", empresas.campos.id)}::text),
        'rfc', btrim(${col("c", empresas.campos.rfc)}::text),
        'razonSocial', btrim(${col("c", empresas.campos.razonSocial)}::text)
      )::text
      from ${desde(empresas)} c
      where ${predicadoId("c", empresas.campos.id, id)}
      limit 1
    ), 'null')
  `;
}

function sqlExisteEvento(mapa: Mapa, id: string): string {
  const auditoria = mapa.audit_events;
  return `
    select json_build_object(
      'existe', exists (
        select 1 from ${desde(auditoria)} e
        where ${predicadoId("e", auditoria.campos.id, id)}
      )
    )::text
  `;
}

type Ids = ContextoAislamiento["ids"] & {
  usuarioA: string;
  usuarioB: string;
  usuarioC: string;
};

function sembrar(url: string, mapa: Mapa): ContextoAislamiento["ids"] {
  const ids = crearIds();
  const hashA = "$2b$10$aislamientoFase1HashQueNoEsClaveRealDeAlfa00";
  const hashB = "$2b$10$aislamientoFase1HashQueNoEsClaveRealDeBeta00";
  const hashC = "$2b$10$aislamientoFase1HashQueNoEsClaveRealDeVisit0";

  insertar(url, mapa.companies, {
    id: ids.empresaA,
    rfc: ids.rfcA,
    razonSocial: ids.razonA,
    codigoPostal: "06000",
    regimen: "601",
    usoCfdi: "G03",
    alta: ALTA,
  });
  insertar(url, mapa.companies, {
    id: ids.empresaB,
    rfc: ids.rfcB,
    razonSocial: ids.razonB,
    codigoPostal: "44100",
    regimen: "612",
    usoCfdi: "G01",
    alta: ALTA,
  });

  insertar(url, mapa.users, {
    id: ids.usuarioA,
    nombre: "Persona Alfa",
    correo: "alfa@empresa-a.test",
    passwordHash: hashA,
  });
  insertar(url, mapa.users, {
    id: ids.usuarioB,
    nombre: "Persona Beta",
    correo: "beta@empresa-b.test",
    passwordHash: hashB,
  });
  insertar(url, mapa.users, {
    id: ids.usuarioC,
    nombre: "Persona Sin Membresía",
    correo: "sin-membresia@nadie.test",
    passwordHash: hashC,
  });

  insertar(url, mapa.memberships, {
    userId: ids.usuarioA,
    companyId: ids.empresaA,
    rol: "administrador",
  });
  insertar(url, mapa.memberships, {
    userId: ids.usuarioB,
    companyId: ids.empresaB,
    rol: "contador",
  });

  insertar(url, mapa.sessions, {
    id: randomUUID(),
    userId: ids.usuarioA,
    tokenHash: ids.sesionA.tokenHash,
    vence: VIGENTE,
  });
  insertar(url, mapa.sessions, {
    id: randomUUID(),
    userId: ids.usuarioA,
    tokenHash: ids.sesionAVencida.tokenHash,
    vence: VENCIDA,
  });
  insertar(url, mapa.sessions, {
    id: randomUUID(),
    userId: ids.usuarioB,
    tokenHash: ids.sesionB.tokenHash,
    vence: VIGENTE,
  });
  insertar(url, mapa.sessions, {
    id: randomUUID(),
    userId: ids.usuarioC,
    tokenHash: ids.sesionSinMembresia.tokenHash,
    vence: VIGENTE,
  });

  insertar(url, mapa.audit_events, {
    id: ids.eventoA,
    companyId: ids.empresaA,
    actor: ids.usuarioA,
    accion: "alta_empresa",
    entidad: "companies",
    identificador: ids.empresaA,
    hora: ALTA,
  });
  insertar(url, mapa.audit_events, {
    id: ids.eventoB,
    companyId: ids.empresaB,
    actor: ids.usuarioB,
    accion: "alta_empresa",
    entidad: "companies",
    identificador: ids.empresaB,
    hora: ALTA,
  });

  const companyId = mapa.audit_events.campos.companyId;
  let eventoOperador: string | null = null;
  if (companyId?.nullable) {
    eventoOperador = randomUUID();
    insertar(url, mapa.audit_events, {
      id: eventoOperador,
      companyId: null,
      actor: ids.usuarioC,
      accion: "acto_operador",
      entidad: "platform_pricing",
      identificador: randomUUID(),
      hora: ALTA,
    });
  }

  return { ...ids, eventoOperador };
}

function crearIds(): Ids {
  return {
    empresaA: randomUUID(),
    empresaB: randomUUID(),
    usuarioA: randomUUID(),
    usuarioB: randomUUID(),
    usuarioC: randomUUID(),
    rfcA: RFC_A,
    rfcB: RFC_B,
    razonA: RAZON_A,
    razonB: RAZON_B,
    eventoA: randomUUID(),
    eventoB: randomUUID(),
    eventoOperador: null,
    sesionA: { tokenHash: token() },
    sesionAVencida: { tokenHash: token() },
    sesionB: { tokenHash: token() },
    sesionSinMembresia: { tokenHash: token() },
    sesionFalsa: { tokenHash: token() },
  };
}

function token(): string {
  return randomBytes(32).toString("hex");
}

function insertar(url: string, tabla: TablaMapeada, logicos: Record<string, string | null>): void {
  const valores = new Map<string, { columna: ColumnaFisica; valor: string | null }>();
  for (const [logico, valor] of Object.entries(logicos)) {
    const columna = tabla.campos[logico];
    if (!columna || columna.generada) continue;
    if (valor === null && !columna.nullable) {
      throw new Error(`La columna ${tabla.nombre}.${columna.nombre} no acepta vacío.`);
    }
    valores.set(columna.nombre, { columna, valor });
  }

  for (const columna of tabla.columnas) {
    if (valores.has(columna.nombre) || columna.generada || columna.tieneDefault || columna.nullable) {
      continue;
    }
    if (columna.nombre.toLowerCase() === "id") {
      valores.set(columna.nombre, { columna, valor: randomUUID() });
      continue;
    }
    throw new Error(
      `La tabla ${tabla.nombre} tiene la columna ${columna.nombre} ` +
        `(${columna.dataType}, obligatoria, sin default) y la siembra de aislamiento no tiene un valor para ella.`,
    );
  }

  if (valores.size === 0) {
    throw new Error(`La siembra no armó columnas para ${tabla.nombre}.`);
  }

  const nombres: string[] = [];
  const literales: string[] = [];
  for (const { columna, valor } of valores.values()) {
    nombres.push(ident(columna.nombre));
    literales.push(literal(valor, columna));
  }
  const sql = `insert into ${desde(tabla)} (${nombres.join(", ")}) values (${literales.join(", ")})`;
  try {
    ejecutar(url, sql);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo sembrar ${tabla.nombre}.\n${sql}\n${detalle}`);
  }
}
