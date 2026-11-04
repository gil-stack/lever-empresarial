import { baseCliente, basePlataforma, type ContextoConEmpresa, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDePersonal, auditar } from "../bitacora/auditar";

export type FilaPrecio = {
  filaId: string;
  centavos: bigint | null;
  publicadoEn: Date | null;
};

export type FilaSuscripcion = {
  companyId: string;
  estado: "recorrido" | "aceptada";
  recorridoInicio: Date;
  aceptadaEn: Date | null;
  aceptadaPorNombre: string | null;
};

export type Publicacion = {
  centavos: bigint;
  cuando: Date;
};

export type Aceptacion = {
  companyId: string;
  cuando: Date;
};

export type RepositorioPrecios = {
  leerPrecio: () => Promise<FilaPrecio>;
  /** El precio es de la plataforma: lo publica el personal del operador. */
  publicar: (ctx: ContextoDePersonal, entrada: Publicacion) => Promise<FilaPrecio>;
  leerSuscripcion: (ctx: ContextoConEmpresa) => Promise<FilaSuscripcion | null>;
  aceptar: (ctx: ContextoDePersonal, entrada: Aceptacion) => Promise<FilaSuscripcion>;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SQL = {
  leerPrecio: `
    select fila_id, suscripcion_centavos, publicado_en
    from platform_pricing
    where singleton
  `,
  bloquearPrecio: `
    select fila_id, suscripcion_centavos, publicado_en
    from platform_pricing
    where singleton
    for update
  `,
  publicar: `
    update platform_pricing
    set suscripcion_centavos = $1, publicado_en = $2
    where singleton and suscripcion_centavos is null
    returning fila_id, suscripcion_centavos, publicado_en
  `,
  leerSuscripcion: `
    select s.company_id, s.estado, s.recorrido_inicio, s.aceptada_en, u.nombre as aceptada_por_nombre
    from subscriptions s
    left join users u on u.id = s.aceptada_por
    where s.company_id = $1
  `,
  bloquearSuscripcion: `
    select company_id, estado, recorrido_inicio, aceptada_en
    from subscriptions
    where company_id = $1
    for update
  `,
  aceptar: `
    update subscriptions
    set estado = 'aceptada', aceptada_por = $2, aceptada_en = $3
    where company_id = $1 and estado = 'recorrido'
    returning company_id, estado, recorrido_inicio, aceptada_en
  `,
} as const;

type FilaPrecioSql = {
  fila_id: unknown;
  suscripcion_centavos: unknown;
  publicado_en: unknown;
};

type FilaSuscripcionSql = {
  company_id: unknown;
  estado: unknown;
  recorrido_inicio: unknown;
  aceptada_en: unknown;
  aceptada_por_nombre?: unknown;
};

const LECTURA = { rol: "plataforma_cliente" } as const;

export function repositorioPg(): RepositorioPrecios {
  return {
    leerPrecio() {
      return conContexto(LECTURA, async (consulta) => {
        const resultado = await consulta.query(SQL.leerPrecio);
        return mapearPrecioUnico(resultado.rows);
      });
    },
    publicar(ctx, entrada) {
      return conContexto(basePlataforma(ctx), async (consulta) => {
        const bloqueo = await consulta.query(SQL.bloquearPrecio);
        const actual = mapearPrecioUnico(bloqueo.rows);
        if (actual.centavos !== null) throw new ErrorDeDominio("precio_ya_publicado");
        const publicado = await consulta.query(SQL.publicar, [entrada.centavos.toString(), entrada.cuando]);
        const fila = mapearPrecioUnico(publicado.rows);
        await auditar(consulta, actorDePersonal(ctx), {
          accion: "publicar_precio",
          identificador: fila.filaId,
          cambio: { centavos: entrada.centavos.toString() },
        });
        return fila;
      });
    },
    leerSuscripcion(ctx) {
      return conContexto(baseCliente(ctx), async (consulta) => {
        const resultado = await consulta.query(SQL.leerSuscripcion, [ctx.empresa.id]);
        const fila = resultado.rows[0] as FilaSuscripcionSql | undefined;
        if (!fila) return null;
        if (resultado.rows.length !== 1) throw new ErrorDeDominio("base_no_disponible");
        return mapearSuscripcion(fila);
      });
    },
    aceptar(ctx, entrada) {
      return conContexto(basePlataforma(ctx, entrada.companyId), async (consulta) => {
        const precio = await consulta.query(SQL.bloquearPrecio);
        const tarifa = mapearPrecioUnico(precio.rows);
        if (tarifa.centavos === null) throw new ErrorDeDominio("precio_no_publicado");
        const bloqueo = await consulta.query(SQL.bloquearSuscripcion, [entrada.companyId]);
        const actual = bloqueo.rows[0] as FilaSuscripcionSql | undefined;
        if (!actual) throw new ErrorDeDominio("suscripcion_ausente");
        if (bloqueo.rows.length !== 1) throw new ErrorDeDominio("base_no_disponible");
        const estado = mapearSuscripcion(actual);
        if (estado.estado !== "recorrido") throw new ErrorDeDominio("suscripcion_ya_aceptada");
        const actualizada = await consulta.query(SQL.aceptar, [entrada.companyId, ctx.persona.id, entrada.cuando]);
        const fila = actualizada.rows[0] as FilaSuscripcionSql | undefined;
        if (!fila || actualizada.rowCount !== 1) throw new ErrorDeDominio("suscripcion_ya_aceptada");
        await auditar(consulta, actorDePersonal(ctx, entrada.companyId, "comando"), {
          accion: "aceptar_suscripcion",
          identificador: entrada.companyId,
        });
        return mapearSuscripcion({ ...fila, aceptada_por_nombre: ctx.persona.nombre });
      });
    },
  };
}

function mapearPrecioUnico(filas: unknown[]): FilaPrecio {
  if (filas.length !== 1) throw new ErrorDeDominio("base_no_disponible");
  return mapearPrecio(filas[0]);
}

export function mapearPrecio(fila: unknown): FilaPrecio {
  if (!esRegistro(fila)) throw new ErrorDeDominio("base_no_disponible");
  if (typeof fila.fila_id !== "string" || !UUID.test(fila.fila_id)) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  const centavos = leerCentavos(fila.suscripcion_centavos);
  const publicadoEn = leerInstante(fila.publicado_en);
  if ((centavos === null) !== (publicadoEn === null)) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return { filaId: fila.fila_id, centavos, publicadoEn };
}

export function mapearSuscripcion(fila: FilaSuscripcionSql): FilaSuscripcion {
  if (typeof fila.company_id !== "string" || !UUID.test(fila.company_id)) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  if (fila.estado !== "recorrido" && fila.estado !== "aceptada") {
    throw new ErrorDeDominio("base_no_disponible");
  }
  const recorridoInicio = leerInstante(fila.recorrido_inicio);
  const aceptadaEn = leerInstante(fila.aceptada_en);
  if (!recorridoInicio) throw new ErrorDeDominio("base_no_disponible");
  const nombre = leerNombre(fila.aceptada_por_nombre);
  if (fila.estado === "recorrido" && aceptadaEn !== null) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  if (fila.estado === "aceptada" && aceptadaEn === null) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return {
    companyId: fila.company_id,
    estado: fila.estado,
    recorridoInicio,
    aceptadaEn,
    aceptadaPorNombre: nombre,
  };
}

function leerCentavos(valor: unknown): bigint | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "bigint") {
    if (valor <= BigInt(0)) throw new ErrorDeDominio("base_no_disponible");
    return valor;
  }
  if (typeof valor === "number" && Number.isSafeInteger(valor) && valor > 0) {
    return BigInt(valor);
  }
  if (typeof valor === "string" && /^[1-9]\d*$/.test(valor)) return BigInt(valor);
  throw new ErrorDeDominio("base_no_disponible");
}

function leerInstante(valor: unknown): Date | null {
  if (valor === null || valor === undefined) return null;
  const fecha = valor instanceof Date ? valor : typeof valor === "string" ? new Date(valor) : null;
  if (!fecha || Number.isNaN(fecha.getTime())) throw new ErrorDeDominio("base_no_disponible");
  return fecha;
}

function leerNombre(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string") throw new ErrorDeDominio("base_no_disponible");
  const nombre = valor.trim();
  if (nombre.length === 0 || nombre.length > 200) throw new ErrorDeDominio("base_no_disponible");
  return nombre;
}

function esRegistro(valor: unknown): valor is FilaPrecioSql {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}
