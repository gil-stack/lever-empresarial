import { randomUUID } from "node:crypto";

import { basePlataforma, type ContextoDePersonal } from "../../nucleo/contexto";
import { conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Fila69b } from "../../dominio/lista-69b";
import { actorDePersonal, auditar } from "../bitacora/auditar";

export type Snapshot69b = {
  id: string;
  fechaArchivo: string;
  cargadoEn: Date;
  contribuyentes: number;
};

export type Repositorio69b = {
  vigente: () => Promise<Snapshot69b | null>;
  situaciones: (snapshotId: string, rfc: string) => Promise<string[]>;
  guardar: (ctx: ContextoDePersonal, entrada: {
    id: string;
    fechaArchivo: string;
    cargadoEn: Date;
    filas: readonly Fila69b[];
  }) => Promise<void>;
};

const SQL = {
  vigente: `
    select
      s.id,
      s.fecha_archivo::text as fecha,
      s.cargado_en,
      (
        select count(distinct r.rfc)::int
        from lista_69b_rows r
        where r.snapshot_id = s.id
      ) as contribuyentes
    from lista_69b_snapshots s
    order by s.cargado_en desc, s.id desc
    limit 1
  `,
  situaciones: `
    select situacion
    from lista_69b_rows
    where snapshot_id = $1 and rfc = $2
    order by situacion
  `,
  snapshot: `
    insert into lista_69b_snapshots (id, fecha_archivo, cargado_en)
    values ($1, $2::date, $3)
  `,
  filas: `
    insert into lista_69b_rows (snapshot_id, rfc, situacion)
    select $1, fila.rfc, fila.situacion
    from unnest($2::text[], $3::text[]) as fila(rfc, situacion)
  `,
};

const LOTE = 2000;

/** La copia es de la plataforma: cualquier contexto la lee. */
const LECTURA = { rol: "plataforma_cliente" } as const;

export function repositorio69bPg(): Repositorio69b {
  return {
    vigente() {
      return conContexto(LECTURA, async (consulta) => {
        const resultado = await consulta.query(SQL.vigente);
        const fila = resultado.rows[0];
        return fila ? exigirSnapshot(fila) : null;
      });
    },
    async situaciones(snapshotId, rfc) {
      const resultado = await conContexto(LECTURA, (consulta) => consulta.query(SQL.situaciones, [snapshotId, rfc]));
      return resultado.rows.map((fila) => {
        if (!esRegistro(fila) || typeof fila.situacion !== "string" || fila.situacion.length === 0) {
          throw new ErrorDeDominio("base_no_disponible");
        }
        return fila.situacion;
      });
    },
    async guardar(ctx, entrada) {
      await conContexto(basePlataforma(ctx), async (consulta) => {
        await consulta.query(SQL.snapshot, [entrada.id, entrada.fechaArchivo, entrada.cargadoEn]);
        await auditar(consulta, actorDePersonal(ctx), {
          accion: "cargar_lista_69b",
          identificador: entrada.id,
          cambio: {
            fecha_archivo: entrada.fechaArchivo,
            contribuyentes: new Set(entrada.filas.map((fila) => fila.rfc)).size,
          },
        });
        for (let inicio = 0; inicio < entrada.filas.length; inicio += LOTE) {
          const lote = entrada.filas.slice(inicio, inicio + LOTE);
          await consulta.query(SQL.filas, [
            entrada.id,
            lote.map((fila) => fila.rfc),
            lote.map((fila) => fila.situacion),
          ]);
        }
        await consulta.query("select releer_proveedores_69b($1::uuid, $2::timestamptz)", [
          entrada.id,
          entrada.cargadoEn,
        ]);
      });
    },
  };
}

export function idDeCopia(): string {
  return randomUUID();
}

function exigirSnapshot(fila: unknown): Snapshot69b {
  if (!esRegistro(fila)) throw new ErrorDeDominio("base_no_disponible");
  const id = fila.id;
  const fecha = fila.fecha;
  const contribuyentes = typeof fila.contribuyentes === "number" ? fila.contribuyentes : Number(fila.contribuyentes);
  const cargadoEn = fila.cargado_en instanceof Date ? fila.cargado_en : new Date(String(fila.cargado_en ?? ""));
  if (typeof id !== "string" || typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(fecha)) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  if (!Number.isInteger(contribuyentes) || contribuyentes < 0 || Number.isNaN(cargadoEn.getTime())) {
    throw new ErrorDeDominio("base_no_disponible");
  }
  return { id, fechaArchivo: fecha, cargadoEn, contribuyentes };
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}
