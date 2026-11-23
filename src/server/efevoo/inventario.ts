import type { ContextoDePersonal } from "../../nucleo/contexto";
import { basePlataforma } from "../../nucleo/contexto";
import { aplicarSentencia, conContexto } from "../../nucleo/db";
import { instante, registro, texto } from "../flujo/lectura";
import { exigirEnOperacion } from "../operacion/permisos";
import { clienteHttpEfevoo, type ClienteEfevoo, type TarjetaEfevoo } from "./cliente";
import { configEfevoo, type ConfigEfevoo } from "./config";
import { ErrorEfevoo } from "./errores";

/**
 * El inventario de tarjetas de toda la cartera, para la sección «Tarjetas» de
 * Operación (solo Administración de la plataforma, la misma capacidad que la
 * sección de Efevoo de la ficha del cliente).
 *
 * La fuente de verdad del stock y de los saldos es Efevoo (getCardsList, por
 * páginas). Lever pone a qué empresa va cada tarjeta y su nombre. Sin conexión
 * con Efevoo (entorno sin EFEVOO_* o Efevoo sin responder) se pinta lo que hay
 * en Lever: tarjetas entregadas, sin stock ni saldos.
 */

const CAPACIDAD = "plataforma.empresa.alta" as const;
/** Tope de páginas de getCardsList (40 × 50 = 2000 plásticos), el mismo que usa buscarTarjeta. */
const PAGINAS = 40;
const TAMANO = 50;

/**
 * La clase de una tarjeta en el tablero. «sin_asignar» es stock libre: en Efevoo,
 * en inventario, sin titular y sin cliente. «asignada» ya tiene dueño pero aún
 * no se activa. Una activa se parte en «con saldo» y «sin saldo».
 */
export type ClaseTarjeta = "sin_asignar" | "asignada" | "activa_con_saldo" | "activa_sin_saldo" | "bloqueada" | "cancelada";

export type TarjetaDelInventario = {
  /** El id de Efevoo; el de Lever si solo se conoce por Lever. */
  clave: string;
  idEfevoo: number | null;
  terminacion: string;
  clase: ClaseTarjeta;
  saldoCentavos: number | null;
  /** La empresa de Lever a la que va, si la hay. */
  empresa: { id: string; razonSocial: string } | null;
  /** El cliente de Efevoo cuando no es una empresa de Lever (el sandbox es compartido). */
  idepClienteAjeno: number | null;
  nombreTarjeta: string | null;
  entregadaEn: string | null;
};

export type Conteos = {
  /** Todos los plásticos, sin los cancelados. */
  stock: number;
  sinAsignar: number;
  asignadas: number;
  activas: number;
  conSaldo: number;
  sinSaldo: number;
  bloqueadas: number;
  canceladas: number;
  /** Suma de los saldos de las activas y bloqueadas. Nulo si no se leyó Efevoo. */
  saldoTotalCentavos: number | null;
};

export type InventarioTarjetas = {
  /** efevoo: leído de Efevoo; lever: solo lo de Lever (sin conexión o Efevoo no respondió). */
  fuente: "efevoo" | "lever";
  ambiente: "sandbox" | "produccion" | null;
  /** El código si Efevoo no respondió; nulo si leyó bien o si el entorno no tiene Efevoo. */
  errorEfevoo: string | null;
  /** La lectura de Efevoo se cortó en el tope de páginas. */
  incompleto: boolean;
  conteos: Conteos;
  tarjetas: TarjetaDelInventario[];
};

export type FilaLever = {
  id: string;
  idEfevoo: number;
  terminacion: string;
  nombreTarjeta: string;
  estado: "asignada" | "activa" | "bloqueada" | "cancelada";
  companyId: string;
  razonSocial: string;
  creadaEn: string;
};

export type Vinculo = { idepCliente: number; companyId: string; razonSocial: string };

function claseDeEfevoo(t: TarjetaEfevoo, enLever: FilaLever | undefined): ClaseTarjeta {
  if (t.estado === "cancelled") return "cancelada";
  if (t.estado === "blocked") return "bloqueada";
  if (t.estado === "active") return (t.saldoCentavos ?? 0) > 0 ? "activa_con_saldo" : "activa_sin_saldo";
  return t.conTitular || t.idepCliente !== 0 || enLever ? "asignada" : "sin_asignar";
}

function claseDeLever(estado: FilaLever["estado"]): ClaseTarjeta {
  // Sin Efevoo no hay saldo: una activa se cuenta como activa «sin saldo leído» (clase sin saldo, saldo nulo).
  return estado === "activa" ? "activa_sin_saldo" : estado;
}

export function contar(tarjetas: readonly TarjetaDelInventario[], conSaldos: boolean): Conteos {
  const de = (clase: ClaseTarjeta) => tarjetas.filter((t) => t.clase === clase).length;
  const conSaldo = de("activa_con_saldo");
  const sinSaldo = de("activa_sin_saldo");
  const canceladas = de("cancelada");
  return {
    stock: tarjetas.length - canceladas,
    sinAsignar: de("sin_asignar"),
    asignadas: de("asignada"),
    activas: conSaldo + sinSaldo,
    conSaldo,
    sinSaldo,
    bloqueadas: de("bloqueada"),
    canceladas,
    saldoTotalCentavos: conSaldos
      ? tarjetas.filter((t) => t.clase !== "cancelada").reduce((suma, t) => suma + (t.saldoCentavos ?? 0), 0)
      : null,
  };
}

/** Junta lo de Efevoo (si se leyó) con lo de Lever. Pura: la prueban sin red ni base. */
export function armarInventario(
  entrada: {
    efevoo: TarjetaEfevoo[] | null;
    lever: readonly FilaLever[];
    vinculos: readonly Vinculo[];
    ambiente: "sandbox" | "produccion" | null;
    errorEfevoo: string | null;
    incompleto: boolean;
  },
): InventarioTarjetas {
  const porIdEfevoo = new Map(entrada.lever.map((f) => [f.idEfevoo, f]));
  const porIdep = new Map(entrada.vinculos.map((v) => [v.idepCliente, v]));
  let tarjetas: TarjetaDelInventario[];
  if (entrada.efevoo) {
    tarjetas = entrada.efevoo.map((t) => {
      const enLever = porIdEfevoo.get(t.id);
      const vinculo = t.idepCliente !== 0 ? porIdep.get(t.idepCliente) : undefined;
      const empresa = enLever ? { id: enLever.companyId, razonSocial: enLever.razonSocial } : vinculo ? { id: vinculo.companyId, razonSocial: vinculo.razonSocial } : null;
      return {
        clave: `e${t.id}`,
        idEfevoo: t.id,
        terminacion: t.terminacion,
        clase: claseDeEfevoo(t, enLever),
        saldoCentavos: t.saldoCentavos,
        empresa,
        idepClienteAjeno: !empresa && t.idepCliente !== 0 ? t.idepCliente : null,
        nombreTarjeta: enLever?.nombreTarjeta ?? null,
        entregadaEn: enLever?.creadaEn ?? null,
      };
    });
  } else {
    tarjetas = entrada.lever.map((f) => ({
      clave: `l${f.id}`,
      idEfevoo: f.idEfevoo,
      terminacion: f.terminacion,
      clase: claseDeLever(f.estado),
      saldoCentavos: null,
      empresa: { id: f.companyId, razonSocial: f.razonSocial },
      idepClienteAjeno: null,
      nombreTarjeta: f.nombreTarjeta,
      entregadaEn: f.creadaEn,
    }));
  }
  return {
    fuente: entrada.efevoo ? "efevoo" : "lever",
    ambiente: entrada.ambiente,
    errorEfevoo: entrada.errorEfevoo,
    incompleto: entrada.incompleto,
    conteos: contar(tarjetas, entrada.efevoo !== null),
    tarjetas,
  };
}

type Dependencias = { config?: ConfigEfevoo | null; efevoo?: ClienteEfevoo };

async function leerEfevoo(efevoo: ClienteEfevoo): Promise<{ tarjetas: TarjetaEfevoo[]; incompleto: boolean }> {
  const tarjetas: TarjetaEfevoo[] = [];
  for (let pagina = 1; pagina <= PAGINAS; pagina++) {
    const lista = await efevoo.listarTarjetas({ estados: "todas", pagina, tamano: TAMANO });
    tarjetas.push(...lista.tarjetas);
    if (pagina >= lista.paginaFinal || lista.tarjetas.length === 0) return { tarjetas, incompleto: false };
  }
  return { tarjetas, incompleto: true };
}

export async function leerInventarioTarjetas(ctx: ContextoDePersonal, deps?: Dependencias): Promise<InventarioTarjetas> {
  exigirEnOperacion(ctx, CAPACIDAD);
  const config = deps?.config === undefined ? configEfevoo() : deps.config;
  const efevoo = deps?.efevoo ?? (config ? clienteHttpEfevoo(config) : null);
  const ambiente = config?.ambiente ?? null;
  const { lever, vinculos } = await conContexto(basePlataforma(ctx), async (consulta) => {
    const tarjetas = (await aplicarSentencia(
      consulta,
      `select t.id, t.id_efevoo, t.terminacion, t.nombre_tarjeta, t.estado, t.company_id, c.razon_social, t.creada_en
         from efevoo_tarjetas t join companies c on c.id = t.company_id
        where ($1::text is null or t.ambiente = $1)
        order by t.creada_en desc, t.id`,
      [ambiente],
    )).rows.map(registro);
    const clientes = (await aplicarSentencia(
      consulta,
      `select v.idep_cliente, v.company_id, c.razon_social
         from efevoo_clientes v join companies c on c.id = v.company_id
        where ($1::text is null or v.ambiente = $1)`,
      [ambiente],
    )).rows.map(registro);
    return {
      lever: tarjetas.map((t): FilaLever => ({
        id: texto(t.id),
        idEfevoo: Number(t.id_efevoo),
        terminacion: texto(t.terminacion),
        nombreTarjeta: texto(t.nombre_tarjeta),
        estado: texto(t.estado) as FilaLever["estado"],
        companyId: texto(t.company_id),
        razonSocial: texto(t.razon_social),
        creadaEn: instante(t.creada_en),
      })),
      vinculos: clientes.map((v): Vinculo => ({ idepCliente: Number(v.idep_cliente), companyId: texto(v.company_id), razonSocial: texto(v.razon_social) })),
    };
  });
  if (!efevoo) return armarInventario({ efevoo: null, lever, vinculos, ambiente, errorEfevoo: null, incompleto: false });
  try {
    const leido = await leerEfevoo(efevoo);
    return armarInventario({ efevoo: leido.tarjetas, lever, vinculos, ambiente, errorEfevoo: null, incompleto: leido.incompleto });
  } catch (error) {
    if (!(error instanceof ErrorEfevoo)) throw error;
    return armarInventario({ efevoo: null, lever, vinculos, ambiente, errorEfevoo: error.codigo, incompleto: false });
  }
}
