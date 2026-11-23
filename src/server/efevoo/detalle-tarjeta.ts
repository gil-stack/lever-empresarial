import type { ContextoDePersonal } from "../../nucleo/contexto";
import { basePlataforma } from "../../nucleo/contexto";
import { aplicarSentencia, conContexto } from "../../nucleo/db";
import { instante, registro, texto } from "../flujo/lectura";
import { exigirEnOperacion } from "../operacion/permisos";
import { clienteHttpEfevoo, type ClienteEfevoo, type MovimientoTarjeta } from "./cliente";
import { configEfevoo, type ConfigEfevoo } from "./config";
import { ErrorEfevoo } from "./errores";
import type { AmbienteEfevoo } from "./config";
import { leerTarjetaDelInventario, type TarjetaDelInventario } from "./inventario";

/**
 * El detalle de una tarjeta para la sección «Tarjetas» de Operación: su resumen, sus movimientos en el procesador y
 * lo que Lever hizo con ella. Solo lectura: aquí no hay ninguna acción que mueva saldo.
 *
 * Nunca se lee ni se pinta el número completo ni el CVV (getCardData no existe en el cliente). El correo del titular
 * se pide al procesador solo para leer los movimientos y no sale de la memoria.
 */

const CAPACIDAD = "plataforma.empresa.alta" as const;

export type OperacionDeLaTarjeta = {
  id: string;
  tipo: string;
  estado: string;
  montoCentavos: number | null;
  referencia: string;
  creadaEn: string;
};

export type ResumenMovimientos = { cuantos: number; abonadoCentavos: number; cargadoCentavos: number; ultimo: string | null };

export type DetalleTarjeta = {
  tarjeta: TarjetaDelInventario;
  ambiente: AmbienteEfevoo;
  /** El empleado de la empresa a quien se entregó; nulo si Lever no la entregó a nadie. */
  titular: string | null;
  motivoCancelacion: string | null;
  canceladaEn: string | null;
  /** Nulo si no se pudieron leer (sin conexión, sin titular o el procesador no respondió). */
  movimientos: MovimientoTarjeta[] | null;
  /** Por qué no hay movimientos, si no los hay. */
  sinMovimientos: "sin_titular" | "no_respondio" | null;
  resumen: ResumenMovimientos | null;
  operaciones: OperacionDeLaTarjeta[];
};

type Dependencias = { config?: ConfigEfevoo | null; efevoo?: ClienteEfevoo };

/** Totales de los movimientos: lo que entró (abonos) y lo que salió (cargos). Pura. */
export function resumirMovimientos(movimientos: readonly MovimientoTarjeta[]): ResumenMovimientos {
  let abonadoCentavos = 0;
  let cargadoCentavos = 0;
  for (const m of movimientos) {
    if (m.centavos === null) continue;
    if (m.tipo === "abono") abonadoCentavos += Math.abs(m.centavos);
    if (m.tipo === "cargo") cargadoCentavos += Math.abs(m.centavos);
  }
  const fechas = movimientos.map((m) => m.fechaHora).filter(Boolean).sort();
  return { cuantos: movimientos.length, abonadoCentavos, cargadoCentavos, ultimo: fechas.at(-1) ?? null };
}

/** Del más nuevo al más viejo por su fecha; los que no traen fecha, al final, en el orden en que llegaron. Pura. */
export function ordenarMovimientos(movimientos: readonly MovimientoTarjeta[]): MovimientoTarjeta[] {
  return movimientos
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (b.m.fechaHora || "").localeCompare(a.m.fechaHora || "") || a.i - b.i)
    .map(({ m }) => m);
}

/** El id de la tarjeta en la dirección: un entero positivo. */
export function idDeTarjeta(crudo: unknown): number | null {
  if (typeof crudo !== "string" || !/^[1-9][0-9]{0,9}$/.test(crudo)) return null;
  const n = Number(crudo);
  return Number.isSafeInteger(n) ? n : null;
}

/** Nulo si la tarjeta no está en el inventario (la ventana dice que no se encontró). */
export async function leerDetalleTarjeta(ctx: ContextoDePersonal, idCrudo: unknown, deps?: Dependencias): Promise<DetalleTarjeta | null> {
  exigirEnOperacion(ctx, CAPACIDAD);
  const id = idDeTarjeta(idCrudo);
  if (id === null) return null;
  const config = deps?.config === undefined ? configEfevoo() : deps.config;
  if (!config) return null;
  const efevoo = deps?.efevoo ?? clienteHttpEfevoo(config);
  const tarjeta = await leerTarjetaDelInventario(ctx, config.ambiente, id);
  if (!tarjeta) return null;

  const lever = await conContexto(basePlataforma(ctx), async (consulta) => {
    const fila = (await aplicarSentencia(
      consulta,
      `select id, company_id, employee_id, motivo_cancelacion, cancelada_en from efevoo_tarjetas
        where id_efevoo = $1 and ambiente = $2 limit 1`,
      [id, config.ambiente],
    )).rows[0];
    if (!fila) return null;
    const t = registro(fila);
    let titular: string | null = null;
    if (t.employee_id) {
      const empleado = (await aplicarSentencia(consulta, "select nombre from efevoo_empleados_asignables($1) where id = $2", [texto(t.company_id), texto(t.employee_id)])).rows[0];
      titular = empleado ? texto(registro(empleado).nombre) : "Empleado dado de baja";
    }
    const operaciones = (await aplicarSentencia(
      consulta,
      `select id, tipo, estado, monto_centavos::text as monto_centavos, referencia, creada_en from efevoo_operaciones
        where tarjeta_id = $1 order by creada_en desc, id limit 50`,
      [texto(t.id)],
    )).rows.map(registro).map((o): OperacionDeLaTarjeta => ({
      id: texto(o.id),
      tipo: texto(o.tipo),
      estado: texto(o.estado),
      montoCentavos: o.monto_centavos === null ? null : Number(o.monto_centavos),
      referencia: texto(o.referencia),
      creadaEn: instante(o.creada_en),
    }));
    return {
      titular,
      motivoCancelacion: t.motivo_cancelacion === null ? null : texto(t.motivo_cancelacion),
      canceladaEn: t.cancelada_en === null ? null : instante(t.cancelada_en),
      operaciones,
    };
  });

  let movimientos: MovimientoTarjeta[] | null = null;
  let sinMovimientos: DetalleTarjeta["sinMovimientos"] = null;
  if (tarjeta.clase === "sin_asignar") {
    sinMovimientos = "sin_titular";
  } else {
    try {
      const correo = await efevoo.correoDeTarjeta(id);
      if (!correo) sinMovimientos = "sin_titular";
      else movimientos = ordenarMovimientos(await efevoo.movimientosDeTarjeta(id, correo));
    } catch (error) {
      if (!(error instanceof ErrorEfevoo)) throw error;
      sinMovimientos = "no_respondio";
    }
  }

  return {
    tarjeta,
    ambiente: config.ambiente,
    titular: lever?.titular ?? null,
    motivoCancelacion: lever?.motivoCancelacion ?? null,
    canceladaEn: lever?.canceladaEn ?? null,
    movimientos,
    sinMovimientos,
    resumen: movimientos ? resumirMovimientos(movimientos) : null,
    operaciones: lever?.operaciones ?? [],
  };
}
