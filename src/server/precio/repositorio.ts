import { randomUUID } from "node:crypto";

import { conTransaccion, consultar } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";

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
  actorId: string;
};

export type Aceptacion = {
  companyId: string;
  actorId: string;
  cuando: Date;
};

export type RepositorioPrecios = {
  leerPrecio: () => Promise<FilaPrecio>;
  publicar: (entrada: Publicacion) => Promise<FilaPrecio>;
  leerSuscripcion: (companyId: string) => Promise<FilaSuscripcion | null>;
  aceptar: (entrada: Aceptacion) => Promise<FilaSuscripcion>;
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
  nombreDe: "select nombre from users where id = $1",
  auditar: `
    insert into audit_events (
      id, company_id, actor_id, accion, entidad, identificador, ocurrido_en
    ) values ($1, $2, $3, $4, $5, $6, $7)
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

export function repositorioPg(): RepositorioPrecios {
  return {
    async leerPrecio() {
      const resultado = await consultar(SQL.leerPrecio);
      return mapearPrecioUnico(resultado.rows);
    },
    publicar(entrada) {
      return conTransaccion(async (consulta) => {
        const bloqueo = await consulta.query(SQL.bloquearPrecio);
        const actual = mapearPrecioUnico(bloqueo.rows);
        if (actual.centavos !== null) throw new ErrorDeDominio("precio_ya_publicado");
        const publicado = await consulta.query(SQL.publicar, [entrada.centavos.toString(), entrada.cuando]);
        const fila = mapearPrecioUnico(publicado.rows);
        await consulta.query(SQL.auditar, [
          randomUUID(),
          null,
          entrada.actorId,
          "publicar_precio",
          "platform_pricing",
          fila.filaId,
          entrada.cuando,
        ]);
        return fila;
      });
    },
    async leerSuscripcion(companyId) {
      const resultado = await consultar(SQL.leerSuscripcion, [companyId]);
      const fila = resultado.rows[0] as FilaSuscripcionSql | undefined;
      if (!fila) return null;
      if (resultado.rows.length !== 1) throw new ErrorDeDominio("base_no_disponible");
      return mapearSuscripcion(fila);
    },
    aceptar(entrada) {
      return conTransaccion(async (consulta) => {
        const precio = await consulta.query(SQL.bloquearPrecio);
        const tarifa = mapearPrecioUnico(precio.rows);
        if (tarifa.centavos === null) throw new ErrorDeDominio("precio_no_publicado");
        const bloqueo = await consulta.query(SQL.bloquearSuscripcion, [entrada.companyId]);
        const actual = bloqueo.rows[0] as FilaSuscripcionSql | undefined;
        if (!actual) throw new ErrorDeDominio("suscripcion_ausente");
        if (bloqueo.rows.length !== 1) throw new ErrorDeDominio("base_no_disponible");
        const estado = mapearSuscripcion(actual);
        if (estado.estado !== "recorrido") throw new ErrorDeDominio("suscripcion_ya_aceptada");
        const actualizada = await consulta.query(SQL.aceptar, [
          entrada.companyId,
          entrada.actorId,
          entrada.cuando,
        ]);
        const fila = actualizada.rows[0] as FilaSuscripcionSql | undefined;
        if (!fila || actualizada.rowCount !== 1) throw new ErrorDeDominio("suscripcion_ya_aceptada");
        const nombre = await consulta.query(SQL.nombreDe, [entrada.actorId]);
        const crudo = nombre.rows[0] as { nombre?: unknown } | undefined;
        await consulta.query(SQL.auditar, [
          randomUUID(),
          entrada.companyId,
          entrada.actorId,
          "aceptar_suscripcion",
          "subscriptions",
          entrada.companyId,
          entrada.cuando,
        ]);
        return mapearSuscripcion({
          ...fila,
          aceptada_por_nombre: crudo?.nombre ?? null,
        });
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
