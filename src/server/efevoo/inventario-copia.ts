import type { ContextoDePersonal } from "../../nucleo/contexto";
import { basePlataforma } from "../../nucleo/contexto";
import { aplicarSentencia, conContexto } from "../../nucleo/db";
import { instante, registro } from "../flujo/lectura";
import type { ClienteEfevoo, TarjetaEfevoo } from "./cliente";
import type { AmbienteEfevoo } from "./config";
import { ErrorEfevoo } from "./errores";

/**
 * La copia local del inventario del procesador (tarjetas_inventario, 0049). getCardsList solo pagina, sin búsqueda:
 * con decenas de miles de plásticos no se puede leer todo en cada visita. Aquí se lee por vueltas: cada vuelta recorre
 * todas las páginas, por partes y con un tope de tiempo, y guarda en tarjetas_inventario_lectura por cuál va. Al
 * terminar una vuelta se borran los plásticos que el procesador ya no listó.
 *
 * Solo una lectura a la vez por operador y ambiente (ocupada_hasta). Si el procesador falla, se anota el error y la
 * copia anterior se queda como estaba.
 */

/** Plásticos por página de getCardsList. */
export const TAMANO_PAGINA = 100;
/** Cada cuánto se refresca la copia completa. */
export const VIGENCIA_MS = 10 * 60_000;
/** Lo que una lectura retiene la vuelta; si se cae a medias, otra la retoma después. */
const RETENCION_S = 120;

export type EstadoLectura = {
  completaEn: string | null;
  /** Una vuelta a medias: la página que sigue. */
  paginaSiguiente: number | null;
  paginas: number | null;
  total: number | null;
  error: string | null;
  errorEn: string | null;
  ocupadaHasta: string | null;
};

export async function leerEstadoLectura(ctx: ContextoDePersonal, ambiente: AmbienteEfevoo): Promise<EstadoLectura | null> {
  return conContexto(basePlataforma(ctx), async (consulta) => {
    const fila = (await aplicarSentencia(
      consulta,
      `select completa_en, pagina_siguiente, paginas, total, error, error_en, ocupada_hasta
         from tarjetas_inventario_lectura where operator_id = app_operador() and ambiente = $1`,
      [ambiente],
    )).rows[0];
    return fila ? estadoDeFila(registro(fila)) : null;
  });
}

function estadoDeFila(f: Record<string, unknown>): EstadoLectura {
  const fecha = (v: unknown) => (v === null || v === undefined ? null : instante(v));
  const entero = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    completaEn: fecha(f.completa_en),
    paginaSiguiente: entero(f.pagina_siguiente),
    paginas: entero(f.paginas),
    total: entero(f.total),
    error: f.error === null || f.error === undefined ? null : String(f.error),
    errorEn: fecha(f.error_en),
    ocupadaHasta: fecha(f.ocupada_hasta),
  };
}

/** Si hace falta leer: nunca se completó, hay una vuelta a medias o la última ya tiene más de 10 minutos. Pura. */
export function haceFaltaLeer(estado: EstadoLectura | null, ahora: Date): boolean {
  if (!estado) return true;
  // Si el procesador acaba de fallar, se espera un minuto antes de volver a pedirle.
  if (estado.errorEn && ahora.getTime() - new Date(estado.errorEn).getTime() < 60_000) return false;
  if (!estado.completaEn) return true;
  if (estado.paginaSiguiente !== null) return true;
  return ahora.getTime() - new Date(estado.completaEn).getTime() > VIGENCIA_MS;
}

/** Toma la vuelta (o la empieza) si nadie más la tiene. Devuelve la página por leer, o nula si otra lectura la tiene. */
async function tomarVuelta(ctx: ContextoDePersonal, ambiente: AmbienteEfevoo): Promise<number | null> {
  return conContexto(basePlataforma(ctx), async (consulta) => {
    await aplicarSentencia(
      consulta,
      `insert into tarjetas_inventario_lectura (operator_id, ambiente) values (app_operador(), $1)
       on conflict (operator_id, ambiente) do nothing`,
      [ambiente],
    );
    const fila = (await aplicarSentencia(
      consulta,
      `update tarjetas_inventario_lectura
          set ocupada_hasta = now() + make_interval(secs => $2),
              empezada_en = case when pagina_siguiente is null then now() else empezada_en end,
              pagina_siguiente = coalesce(pagina_siguiente, 1)
        where operator_id = app_operador() and ambiente = $1
          and (ocupada_hasta is null or ocupada_hasta < now())
        returning pagina_siguiente`,
      [ambiente, RETENCION_S],
    )).rows[0];
    return fila ? Number(registro(fila).pagina_siguiente) : null;
  });
}

/** El nombre de los clientes del procesador que no son empresas de Lever. Si no responde, sin nombres (y no se vuelve a pedir en esta lectura). */
async function nombresDeClientes(efevoo: ClienteEfevoo, ids: number[], cache: Map<number, string | null>, apagado: { valor: boolean }): Promise<void> {
  const faltan = ids.filter((id) => !cache.has(id));
  if (faltan.length === 0 || apagado.valor) return;
  try {
    const clientes = await efevoo.listarClientes(faltan);
    for (const c of clientes) if (c.nombre?.trim()) cache.set(c.idepCliente, c.nombre.trim().slice(0, 200));
    for (const id of faltan) if (!cache.has(id)) cache.set(id, null);
  } catch (error) {
    if (!(error instanceof ErrorEfevoo)) throw error;
    apagado.valor = true;
  }
}

async function guardarPagina(
  ctx: ContextoDePersonal,
  ambiente: AmbienteEfevoo,
  pagina: number,
  tarjetas: readonly TarjetaEfevoo[],
  nombres: ReadonlyMap<number, string | null>,
  paginaFinal: number,
  total: number,
): Promise<boolean> {
  const validas = tarjetas.filter((t) => t.id > 0 && /^[0-9]{4}$/.test(t.terminacion));
  const ultima = pagina >= paginaFinal || tarjetas.length === 0;
  return conContexto(basePlataforma(ctx), async (consulta) => {
    // Si otra lectura retomó la vuelta (esta se tardó más de la retención), no se pisa su avance.
    const sigue = (await aplicarSentencia(
      consulta,
      `select 1 from tarjetas_inventario_lectura
        where operator_id = app_operador() and ambiente = $1 and pagina_siguiente = $2 for update`,
      [ambiente, pagina],
    )).rows.length === 1;
    if (!sigue) return false;
    if (validas.length > 0) {
      await aplicarSentencia(
        consulta,
        `insert into tarjetas_inventario (operator_id, ambiente, id_tarjeta, terminacion, estado, saldo_centavos, idep_cliente, nombre_cliente, con_titular, vista_en)
         select app_operador(), $1, x.id, x.terminacion, x.estado, x.saldo, x.idep, x.nombre, x.titular, now()
           from unnest($2::int[], $3::text[], $4::text[], $5::bigint[], $6::int[], $7::text[], $8::boolean[])
                as x (id, terminacion, estado, saldo, idep, nombre, titular)
         on conflict (operator_id, ambiente, id_tarjeta) do update
            set terminacion = excluded.terminacion, estado = excluded.estado, saldo_centavos = excluded.saldo_centavos,
                idep_cliente = excluded.idep_cliente,
                nombre_cliente = coalesce(excluded.nombre_cliente, tarjetas_inventario.nombre_cliente),
                con_titular = excluded.con_titular, vista_en = excluded.vista_en`,
        [
          ambiente,
          validas.map((t) => t.id),
          validas.map((t) => t.terminacion),
          validas.map((t) => t.estado),
          validas.map((t) => t.saldoCentavos),
          validas.map((t) => Math.max(0, t.idepCliente)),
          validas.map((t) => (t.idepCliente > 0 ? (nombres.get(t.idepCliente) ?? null) : null)),
          validas.map((t) => t.conTitular),
        ],
      );
    }
    if (ultima) {
      await aplicarSentencia(
        consulta,
        `delete from tarjetas_inventario i using tarjetas_inventario_lectura l
          where l.operator_id = app_operador() and l.ambiente = $1
            and i.operator_id = l.operator_id and i.ambiente = l.ambiente and i.vista_en < l.empezada_en`,
        [ambiente],
      );
      await aplicarSentencia(
        consulta,
        `update tarjetas_inventario_lectura
            set pagina_siguiente = null, paginas = $2, total = $3, completa_en = now(), error = null, error_en = null, ocupada_hasta = null
          where operator_id = app_operador() and ambiente = $1`,
        [ambiente, paginaFinal, total],
      );
    } else {
      await aplicarSentencia(
        consulta,
        `update tarjetas_inventario_lectura
            set pagina_siguiente = $2, paginas = $3, ocupada_hasta = now() + make_interval(secs => $4)
          where operator_id = app_operador() and ambiente = $1`,
        [ambiente, pagina + 1, paginaFinal, RETENCION_S],
      );
    }
    return true;
  });
}

async function soltar(ctx: ContextoDePersonal, ambiente: AmbienteEfevoo, error: string | null): Promise<void> {
  await conContexto(basePlataforma(ctx), (consulta) =>
    aplicarSentencia(
      consulta,
      `update tarjetas_inventario_lectura
          set ocupada_hasta = null,
              error = coalesce($2, error), error_en = case when $2::text is null then error_en else now() end
        where operator_id = app_operador() and ambiente = $1`,
      [ambiente, error],
    ),
  );
}

export type ResultadoLectura = "completa" | "a_medias" | "ocupada" | "error";

/**
 * Lee páginas del procesador hasta terminar la vuelta o agotar el presupuesto de tiempo. Lo llama la página de
 * Tarjetas (en línea la primera vez, después en segundo plano). Nunca lanza por un error del procesador: lo anota.
 */
export async function refrescarCopia(
  ctx: ContextoDePersonal,
  efevoo: ClienteEfevoo,
  ambiente: AmbienteEfevoo,
  opciones: { presupuestoMs: number; deLever: ReadonlySet<number>; reloj?: () => number },
): Promise<ResultadoLectura> {
  const reloj = opciones.reloj ?? Date.now;
  const limite = reloj() + opciones.presupuestoMs;
  let pagina = await tomarVuelta(ctx, ambiente);
  if (pagina === null) return "ocupada";
  const nombres = new Map<number, string | null>();
  const sinNombres = { valor: false };
  try {
    for (;;) {
      const lista = await efevoo.listarTarjetas({ estados: "todas", pagina, tamano: TAMANO_PAGINA });
      const ajenos = [...new Set(lista.tarjetas.map((t) => t.idepCliente).filter((id) => id > 0 && !opciones.deLever.has(id)))];
      await nombresDeClientes(efevoo, ajenos, nombres, sinNombres);
      const paginaFinal = Math.max(1, lista.paginaFinal);
      const siguio = await guardarPagina(ctx, ambiente, pagina, lista.tarjetas, nombres, paginaFinal, lista.total);
      if (!siguio) return "ocupada";
      if (pagina >= paginaFinal || lista.tarjetas.length === 0) return "completa";
      pagina += 1;
      if (reloj() >= limite) {
        await soltar(ctx, ambiente, null);
        return "a_medias";
      }
    }
  } catch (error) {
    if (!(error instanceof ErrorEfevoo)) {
      await soltar(ctx, ambiente, null).catch(() => undefined);
      throw error;
    }
    await soltar(ctx, ambiente, error.codigo.slice(0, 80));
    return "error";
  }
}
