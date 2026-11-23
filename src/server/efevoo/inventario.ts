import { after } from "next/server";

import type { ContextoDePersonal } from "../../nucleo/contexto";
import { basePlataforma } from "../../nucleo/contexto";
import { aplicarSentencia, conContexto, type Consulta } from "../../nucleo/db";
import { CLASE_DEL_ESTADO, ESTADOS, SIN_EMPRESA, busquedaDe, type ClaseTarjeta, type EstadoFiltro } from "../../dominio/tarjetas/inventario";
import { instanteONulo, registro, texto } from "../flujo/lectura";
import { exigirEnOperacion } from "../operacion/permisos";
import { clienteHttpEfevoo, type ClienteEfevoo } from "./cliente";
import { configEfevoo, type AmbienteEfevoo, type ConfigEfevoo } from "./config";
import { haceFaltaLeer, leerEstadoLectura, refrescarCopia, type EstadoLectura } from "./inventario-copia";

export type { ClaseTarjeta } from "../../dominio/tarjetas/inventario";

/**
 * Operación → Tarjetas: el inventario de plásticos de toda la cartera (solo Administración de la plataforma, la misma
 * capacidad que la sección de tarjetas de la ficha del cliente).
 *
 * El stock, el estado y el saldo vienen del procesador, por medio de la copia local (inventario-copia.ts). Lever pone
 * a qué empresa va cada tarjeta y el nombre del plástico. Buscar, filtrar, contar y paginar se hace en la base, así
 * que la pantalla responde igual con 15 tarjetas que con 100 mil.
 */

const CAPACIDAD = "plataforma.empresa.alta" as const;
export const POR_PAGINA = 50;
/** Tope de empresas en el selector; con más, se encuentran escribiendo en el buscador. */
const EMPRESAS_EN_SELECTOR = 300;

export type EmpresaDeTarjeta = { clave: string; nombre: string; companyId: string | null };

export type TarjetaDelInventario = {
  id: number;
  terminacion: string;
  clase: ClaseTarjeta;
  saldoCentavos: number | null;
  /** La empresa por la que se afilió: una de Lever o un cliente del procesador que no es de Lever. Nula si está disponible. */
  empresa: EmpresaDeTarjeta | null;
  /** El nombre impreso en el plástico, si Lever lo entregó. */
  nombreTarjeta: string | null;
  entregadaEn: string | null;
};

export type Resumen = {
  total: number;
  activas: number;
  conSaldo: number;
  porActivar: number;
  disponibles: number;
  bloqueadas: number;
  canceladas: number;
  saldoCentavos: number;
};

export type FiltroTarjetas = { q: string; estado: EstadoFiltro; empresa: string | null; pagina: number };

export type VistaTarjetas = {
  /** sin_conexion: el entorno no tiene el procesador configurado. */
  conexion: "lista" | "sin_conexion";
  ambiente: AmbienteEfevoo | null;
  lectura: EstadoLectura | null;
  /** De todo el inventario, sin filtros. */
  resumen: Resumen;
  /** Cuántas hay en cada estado con la búsqueda y la empresa elegidas (para los botones de estado). */
  porEstado: Record<EstadoFiltro, number>;
  empresas: (EmpresaDeTarjeta & { tarjetas: number })[];
  empresaElegida: EmpresaDeTarjeta | null;
  filtro: FiltroTarjetas;
  /** Cuántas cumplen todos los filtros. */
  total: number;
  tarjetas: TarjetaDelInventario[];
};

/**
 * Cada plástico de la copia con su clase y su empresa. $1 es el ambiente. La política de RLS deja solo los del
 * operador. Una tarjeta que Lever entregó lleva la empresa de Lever aunque el procesador no la ligue a un cliente.
 */
const BASE = `
  with base as (
    select i.id_tarjeta, i.terminacion, i.saldo_centavos, i.idep_cliente,
           t.nombre_tarjeta, t.creada_en as entregada_en,
           coalesce(t.company_id, v.company_id) as company_id,
           case
             when coalesce(t.company_id, v.company_id) is not null then coalesce(t.company_id, v.company_id)::text
             when i.idep_cliente <> 0 then 'p' || i.idep_cliente
             else '${SIN_EMPRESA}'
           end as empresa_clave,
           case
             when coalesce(t.company_id, v.company_id) is not null then coalesce(ct.razon_social, cv.razon_social)
             when i.idep_cliente <> 0 then coalesce(nullif(btrim(i.nombre_cliente), ''), 'Cliente externo ' || i.idep_cliente)
           end as empresa_nombre,
           case
             when i.estado = 'cancelled' then 'cancelada'
             when i.estado = 'blocked' then 'bloqueada'
             when i.estado = 'inactive' then 'asignada'
             when i.estado = 'active' and coalesce(i.saldo_centavos, 0) > 0 then 'activa_con_saldo'
             when i.estado = 'active' then 'activa_sin_saldo'
             when i.con_titular or i.idep_cliente <> 0 or t.id is not null then 'asignada'
             else 'sin_asignar'
           end as clase
      from tarjetas_inventario i
      left join efevoo_tarjetas t on t.ambiente = i.ambiente and t.id_efevoo = i.id_tarjeta
      left join companies ct on ct.id = t.company_id
      left join efevoo_clientes v on i.idep_cliente <> 0 and v.ambiente = i.ambiente and v.idep_cliente = i.idep_cliente
      left join companies cv on cv.id = v.company_id
     where i.ambiente = $1
  )`;

/** La condición de la búsqueda y la empresa, con sus parámetros a partir de $desde. Pura: la prueban sin base. */
export function condicion(filtro: Pick<FiltroTarjetas, "q" | "empresa">, desde: number): { sql: string; params: unknown[] } {
  const partes: string[] = [];
  const params: unknown[] = [];
  const p = (valor: unknown) => {
    params.push(valor);
    return `$${desde + params.length - 1}`;
  };
  const b = busquedaDe(filtro.q);
  if (b.tipo === "terminacion") {
    const d = p(b.digitos);
    partes.push(`(terminacion like '%' || ${d} or id_tarjeta::text = ${d})`);
  } else if (b.tipo === "numero") {
    partes.push(`id_tarjeta::text = ${p(b.digitos)}`);
  } else if (b.tipo === "texto") {
    const t = p(`%${b.texto.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    partes.push(`(empresa_nombre ilike ${t} or nombre_tarjeta ilike ${t})`);
  }
  if (filtro.empresa) partes.push(`empresa_clave = ${p(filtro.empresa)}`);
  return { sql: partes.length ? partes.join(" and ") : "true", params };
}

function tarjetaDeFila(f: Record<string, unknown>): TarjetaDelInventario {
  const clave = texto(f.empresa_clave);
  return {
    id: Number(f.id_tarjeta),
    terminacion: texto(f.terminacion),
    clase: texto(f.clase) as ClaseTarjeta,
    saldoCentavos: f.saldo_centavos === null ? null : Number(f.saldo_centavos),
    empresa: clave === SIN_EMPRESA ? null : { clave, nombre: texto(f.empresa_nombre), companyId: f.company_id === null ? null : texto(f.company_id) },
    nombreTarjeta: f.nombre_tarjeta === null ? null : texto(f.nombre_tarjeta),
    entregadaEn: instanteONulo(f.entregada_en),
  };
}

const COLUMNAS = "id_tarjeta, terminacion, saldo_centavos, nombre_tarjeta, entregada_en, company_id, empresa_clave, empresa_nombre, clase";

async function consultarVista(consulta: Consulta, ambiente: AmbienteEfevoo, filtro: FiltroTarjetas) {
  const c = condicion(filtro, 2);
  const conteos = (await aplicarSentencia(
    consulta,
    `${BASE}
     select clase, count(*)::int as todas, (count(*) filter (where ${c.sql}))::int as filtradas,
            coalesce(sum(saldo_centavos) filter (where clase <> 'cancelada'), 0)::text as saldo
       from base group by clase`,
    [ambiente, ...c.params],
  )).rows.map(registro);
  const deClase = (clase: ClaseTarjeta, campo: "todas" | "filtradas") => Number(conteos.find((f) => f.clase === clase)?.[campo] ?? 0);
  const resumen: Resumen = {
    total: conteos.reduce((s, f) => s + Number(f.todas), 0),
    activas: deClase("activa_con_saldo", "todas") + deClase("activa_sin_saldo", "todas"),
    conSaldo: deClase("activa_con_saldo", "todas"),
    porActivar: deClase("asignada", "todas"),
    disponibles: deClase("sin_asignar", "todas"),
    bloqueadas: deClase("bloqueada", "todas"),
    canceladas: deClase("cancelada", "todas"),
    saldoCentavos: conteos.reduce((s, f) => s + Number(f.saldo), 0),
  };
  const porEstado = Object.fromEntries(
    ESTADOS.map((e) => [e, e === "todas" ? conteos.reduce((s, f) => s + Number(f.filtradas), 0) : deClase(CLASE_DEL_ESTADO[e], "filtradas")]),
  ) as Record<EstadoFiltro, number>;
  const total = porEstado[filtro.estado];

  const conEstado = filtro.estado === "todas" ? c.sql : `${c.sql} and clase = $${2 + c.params.length}`;
  const paramsLista = filtro.estado === "todas" ? [ambiente, ...c.params] : [ambiente, ...c.params, CLASE_DEL_ESTADO[filtro.estado]];
  const n = paramsLista.length;
  const tarjetas = (await aplicarSentencia(
    consulta,
    `${BASE}
     select ${COLUMNAS} from base where ${conEstado}
      order by saldo_centavos desc nulls last, id_tarjeta
      limit $${n + 1} offset $${n + 2}`,
    [...paramsLista, POR_PAGINA, (filtro.pagina - 1) * POR_PAGINA],
  )).rows.map(registro).map(tarjetaDeFila);

  const empresas = (await aplicarSentencia(
    consulta,
    `${BASE}
     select empresa_clave, min(empresa_nombre) as empresa_nombre, min(company_id::text) as company_id, count(*)::int as tarjetas
       from base where empresa_clave <> '${SIN_EMPRESA}' and clase <> 'cancelada'
      group by empresa_clave order by count(*) desc, min(empresa_nombre) limit ${EMPRESAS_EN_SELECTOR}`,
    [ambiente],
  )).rows.map(registro).map((f) => ({
    clave: texto(f.empresa_clave),
    nombre: texto(f.empresa_nombre),
    companyId: f.company_id === null ? null : texto(f.company_id),
    tarjetas: Number(f.tarjetas),
  }));

  let empresaElegida: EmpresaDeTarjeta | null = null;
  if (filtro.empresa === SIN_EMPRESA) empresaElegida = { clave: SIN_EMPRESA, nombre: "Sin empresa", companyId: null };
  else if (filtro.empresa) {
    empresaElegida = empresas.find((e) => e.clave === filtro.empresa) ?? null;
    if (!empresaElegida) {
      const fila = (await aplicarSentencia(
        consulta,
        `${BASE} select empresa_clave, empresa_nombre, company_id from base where empresa_clave = $2 limit 1`,
        [ambiente, filtro.empresa],
      )).rows[0];
      if (fila) {
        const f = registro(fila);
        empresaElegida = { clave: texto(f.empresa_clave), nombre: texto(f.empresa_nombre), companyId: f.company_id === null ? null : texto(f.company_id) };
      }
    }
  }
  return { resumen, porEstado, total, tarjetas, empresas, empresaElegida };
}

type Dependencias = { config?: ConfigEfevoo | null; efevoo?: ClienteEfevoo; ahora?: Date; enSegundoPlano?: (tarea: () => Promise<void>) => void };

const VACIO: Resumen = { total: 0, activas: 0, conSaldo: 0, porActivar: 0, disponibles: 0, bloqueadas: 0, canceladas: 0, saldoCentavos: 0 };

async function clientesDeLever(ctx: ContextoDePersonal, ambiente: AmbienteEfevoo): Promise<Set<number>> {
  return conContexto(basePlataforma(ctx), async (consulta) =>
    new Set((await aplicarSentencia(consulta, "select idep_cliente from efevoo_clientes where ambiente = $1", [ambiente])).rows.map((f) => Number(registro(f).idep_cliente))),
  );
}

/**
 * Refresca la copia si hace falta: la primera vez en línea (para no pintar una lista vacía), después en segundo
 * plano, para que la pantalla no espere al procesador.
 */
async function refrescarSiHaceFalta(ctx: ContextoDePersonal, efevoo: ClienteEfevoo, ambiente: AmbienteEfevoo, deps?: Dependencias): Promise<EstadoLectura | null> {
  const ahora = deps?.ahora ?? new Date();
  const estado = await leerEstadoLectura(ctx, ambiente);
  if (!haceFaltaLeer(estado, ahora)) return estado;
  const deLever = await clientesDeLever(ctx, ambiente);
  if (!estado?.completaEn) {
    const resultado = await refrescarCopia(ctx, efevoo, ambiente, { presupuestoMs: 20_000, deLever });
    if (resultado === "a_medias") enSegundoPlano(deps, () => refrescarCopia(ctx, efevoo, ambiente, { presupuestoMs: 45_000, deLever }).then(() => undefined));
    return leerEstadoLectura(ctx, ambiente);
  }
  enSegundoPlano(deps, () => refrescarCopia(ctx, efevoo, ambiente, { presupuestoMs: 45_000, deLever }).then(() => undefined));
  return estado;
}

function enSegundoPlano(deps: Dependencias | undefined, tarea: () => Promise<void>): void {
  const correr = () => tarea().catch((error: unknown) => console.error("[tarjetas] la copia del inventario no se refrescó", error instanceof Error ? error.name : "error"));
  if (deps?.enSegundoPlano) deps.enSegundoPlano(correr);
  else after(correr);
}

export async function leerTarjetas(ctx: ContextoDePersonal, filtro: FiltroTarjetas, deps?: Dependencias): Promise<VistaTarjetas> {
  exigirEnOperacion(ctx, CAPACIDAD);
  const config = deps?.config === undefined ? configEfevoo() : deps.config;
  if (!config) {
    return {
      conexion: "sin_conexion", ambiente: null, lectura: null, resumen: VACIO,
      porEstado: Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<EstadoFiltro, number>,
      empresas: [], empresaElegida: null, filtro, total: 0, tarjetas: [],
    };
  }
  const efevoo = deps?.efevoo ?? clienteHttpEfevoo(config);
  const lectura = await refrescarSiHaceFalta(ctx, efevoo, config.ambiente, deps);
  const vista = await conContexto(basePlataforma(ctx), (consulta) => consultarVista(consulta, config.ambiente, filtro));
  return { conexion: "lista", ambiente: config.ambiente, lectura, filtro, ...vista };
}

/** Una tarjeta de la copia, por su número en el procesador. Nula si no está. */
export async function leerTarjetaDelInventario(ctx: ContextoDePersonal, ambiente: AmbienteEfevoo, id: number): Promise<TarjetaDelInventario | null> {
  exigirEnOperacion(ctx, CAPACIDAD);
  return conContexto(basePlataforma(ctx), async (consulta) => {
    const fila = (await aplicarSentencia(consulta, `${BASE} select ${COLUMNAS} from base where id_tarjeta = $2`, [ambiente, id])).rows[0];
    return fila ? tarjetaDeFila(registro(fila)) : null;
  });
}
