import { mensualEstimado, sumarCentavos, type FrecuenciaNomina } from "../nomina";
import { fechasDeSerie, primeroDelMes, siguienteObligacion, ultimoDelMes, type FrecuenciaObligacion } from "./fechas";

/**
 * Presupuestos vivos del mes en curso (hora de México). El gasto de un área es:
 * - la nómina neta de sus personas, prorrateada al mes según su frecuencia;
 * - los pagos a proveedores del área (no rechazados ni cancelados) con fecha
 *   programada en el mes;
 * - las obligaciones recurrentes del área que caen en el mes.
 * El gasto de una persona son los pagos a proveedores que ella solicitó en el
 * mes; su nómina no cuenta contra su bolsa (son presupuestos separados).
 */

export const UMBRAL_ATENCION = 0.8;

export type EstadoPresupuesto = "sin_presupuesto" | "en_rango" | "atencion" | "excedido";

export type FuentesPresupuesto = {
  hoy: string;
  areas: readonly { id: string; nombre: string; presupuestoCentavos: number | null }[];
  nomina: readonly { areaId: string | null; netoCentavos: number; frecuencia: FrecuenciaNomina }[];
  /** Suma del mes por área, ya filtrada por estado y fecha programada. */
  pagosPorArea: readonly { areaId: string; centavos: number }[];
  obligaciones: readonly {
    areaId: string | null;
    montoCentavos: number;
    frecuencia: FrecuenciaObligacion;
    proximaFecha: string;
    anclaDia: number;
  }[];
  personas: readonly { id: string; nombre: string; areaNombre: string | null; presupuestoCentavos: number; pagosCentavos: number }[];
};

export type LineaPresupuesto = {
  tipo: "area" | "persona";
  id: string;
  nombre: string;
  presupuestoCentavos: number | null;
  gastoCentavos: number;
  estado: EstadoPresupuesto;
  /** Solo en áreas: de dónde sale el gasto. */
  desglose?: { nominaCentavos: number; proveedoresCentavos: number; obligacionesCentavos: number };
  detalle?: string | null;
};

export type Presupuestos = {
  mes: { desde: string; hasta: string };
  areas: LineaPresupuesto[];
  personas: LineaPresupuesto[];
  alertas: LineaPresupuesto[];
};

export function estadoDe(gasto: number, presupuesto: number | null): EstadoPresupuesto {
  if (presupuesto === null) return "sin_presupuesto";
  if (presupuesto === 0) return gasto > 0 ? "excedido" : "en_rango";
  if (gasto >= presupuesto) return "excedido";
  // Entero: el 80 % exacto ya es atención, sin errores de punto flotante.
  if (gasto * 10 >= presupuesto * 8) return "atencion";
  return "en_rango";
}

export function calcularPresupuestos(fuentes: FuentesPresupuesto): Presupuestos {
  const desde = primeroDelMes(fuentes.hoy);
  const hasta = ultimoDelMes(fuentes.hoy);
  const areas = fuentes.areas.map((area) => {
    const nominaCentavos = sumarCentavos(
      fuentes.nomina.filter((perfil) => perfil.areaId === area.id).map((perfil) => mensualEstimado(perfil.netoCentavos, perfil.frecuencia)),
    );
    const proveedoresCentavos = sumarCentavos(
      fuentes.pagosPorArea.filter((pago) => pago.areaId === area.id).map((pago) => pago.centavos),
    );
    const obligacionesCentavos = sumarCentavos(
      fuentes.obligaciones
        .filter((obligacion) => obligacion.areaId === area.id)
        .flatMap((obligacion) =>
          fechasDeSerie(
            obligacion.proximaFecha,
            (fecha) => siguienteObligacion(fecha, obligacion.frecuencia, obligacion.anclaDia),
            desde,
            hasta,
          ).map(() => obligacion.montoCentavos),
        ),
    );
    const gastoCentavos = sumarCentavos([nominaCentavos, proveedoresCentavos, obligacionesCentavos]);
    return {
      tipo: "area",
      id: area.id,
      nombre: area.nombre,
      presupuestoCentavos: area.presupuestoCentavos,
      gastoCentavos,
      estado: estadoDe(gastoCentavos, area.presupuestoCentavos),
      desglose: { nominaCentavos, proveedoresCentavos, obligacionesCentavos },
    } satisfies LineaPresupuesto;
  });
  const personas = fuentes.personas.map((persona) => ({
    tipo: "persona",
    id: persona.id,
    nombre: persona.nombre,
    presupuestoCentavos: persona.presupuestoCentavos,
    gastoCentavos: persona.pagosCentavos,
    estado: estadoDe(persona.pagosCentavos, persona.presupuestoCentavos),
    detalle: persona.areaNombre,
  }) satisfies LineaPresupuesto);
  const alertas = [...areas, ...personas]
    .filter((linea) => linea.estado === "atencion" || linea.estado === "excedido")
    .sort((a, b) => (a.estado === b.estado ? a.nombre.localeCompare(b.nombre, "es") : a.estado === "excedido" ? -1 : 1));
  return { mes: { desde, hasta }, areas, personas, alertas };
}

export const ETIQUETA_ESTADO_PRESUPUESTO: Record<EstadoPresupuesto, string> = {
  sin_presupuesto: "Sin presupuesto",
  en_rango: "En rango",
  atencion: "Atención",
  excedido: "Excedido",
};

/** El porcentaje entero que se muestra junto a la barra. */
export function porcentaje(gasto: number, presupuesto: number | null): number | null {
  if (presupuesto === null || presupuesto === 0) return null;
  return Math.floor((gasto * 100) / presupuesto);
}
