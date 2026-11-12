import { createHash, randomBytes, randomUUID } from "node:crypto";

import { periodosPorGenerar } from "../../dominio/cobranza/periodos";
import { CONSECUTIVO_INICIAL, referenciaDe } from "../../dominio/cobranza/referencia";
import { esPeriodicidad } from "../../dominio/cobranza/periodos";
import { hoyEnMexico } from "../../dominio/personas";
import { aplicarSentencia, type Consulta, type ContextoDeBase } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import type { Actor, Auditar } from "../bitacora/auditar";
import { centavosONulo, entero, registro, texto, unaFila } from "../flujo/lectura";
import { fechaDe } from "./repositorio";

/**
 * Piezas que comparten la consola, el cron y la página del pagador. La
 * generación de cargos es una sola: la usan el alta de un plan (con la persona
 * como autora) y la tarea programada (con el sistema como autor).
 */

export type Reloj = { ahora?: () => Date };

export function hoyDe(deps?: Reloj): string {
  return hoyEnMexico((deps?.ahora ?? (() => new Date()))());
}

/** El sistema actúa con la empresa en el contexto y sin persona: RLS normal, autor vacío. */
export function baseDeSistema(empresaId: string, operadorId: string): ContextoDeBase {
  return { rol: "plataforma_cliente", companyId: empresaId, operadorId };
}

export function actorDeSistema(empresaId: string, operadorId: string, origen: "tarea" | "pagador"): Actor {
  return { operadorId, companyId: empresaId, actorTipo: "sistema", actorId: null, superficie: "cliente", peticionId: null, origen };
}

/** El autor que va en las columnas *_por: la persona o nada (el sistema). */
export function autorDe(actor: Actor): string | null {
  return actor.actorTipo === "miembro" ? actor.actorId : null;
}

/** Token del enlace del pagador: 32 bytes al azar. La base guarda solo su SHA-256. */
export function nuevoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashDeToken(token) };
}

export function hashDeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * El último consecutivo de referencia de la empresa (el siguiente es este + 1).
 * Sin cargos, 99999: el primero es el 100000 y ninguna referencia empieza con
 * cero (r63-N2). Va con la empresa bloqueada (bloquearEmpresa).
 */
export async function ultimoConsecutivo(consulta: Consulta, empresaId: string): Promise<number> {
  const fila = unaFila(await aplicarSentencia(
    consulta,
    "select coalesce(max(substr(referencia, 1, 6)::integer), $2) as n from collection_charges where company_id = $1",
    [empresaId, CONSECUTIVO_INICIAL - 1],
  ));
  return entero(fila.n);
}

export const MOTIVO_PAUSA = "El plan estaba en pausa en este periodo.";
/** Planes por empresa en una corrida: la siguiente toma los que falten. */
export const PLANES_POR_CORRIDA = 200;

export type CargoGenerado = { id: string; estado: "emitido" | "por_emitir" | "omitido" };

/**
 * Genera los cargos que faltan de los planes activos de la empresa (o solo de
 * `planIds`), hasta hoy + `emitirDiasAntes`. La llave (plan, periodo) hace que
 * repetirla no cree nada. Va con la empresa bloqueada.
 */
export async function generarCargos(
  consulta: Consulta,
  actor: Actor,
  auditar: Auditar,
  empresaId: string,
  hoy: string,
  emitirDiasAntes: number,
  planIds: readonly string[] | null = null,
): Promise<CargoGenerado[]> {
  const planes = await aplicarSentencia(
    consulta,
    `select p.id, p.customer_id, p.concepto, p.tipo, p.monto_centavos::text as monto, p.periodicidad,
            p.primer_vencimiento, p.fin, p.reanudado_el,
            coalesce((select max(c.periodo) + 1 from collection_charges c where c.company_id = p.company_id and c.plan_id = p.id), 0) as siguiente
       from collection_plans p
      where p.company_id = $1 and p.estado = 'activo' and ($2::uuid[] is null or p.id = any($2::uuid[]))
      order by p.id
      limit ${PLANES_POR_CORRIDA}`,
    [empresaId, planIds],
  );
  const autor = autorDe(actor);
  let consecutivo = await ultimoConsecutivo(consulta, empresaId);
  const generados: CargoGenerado[] = [];
  for (const fila of planes.rows.map(registro)) {
    if (!esPeriodicidad(fila.periodicidad)) throw new ErrorDeDominio("base_no_disponible");
    const tipo = fila.tipo === "variable" ? "variable" : "fijo";
    const monto = centavosONulo(fila.monto);
    const periodos = periodosPorGenerar(
      {
        primerVencimiento: fechaDe(fila.primer_vencimiento),
        periodicidad: fila.periodicidad,
        fin: fila.fin ? fechaDe(fila.fin) : null,
        reanudadoEl: fila.reanudado_el ? fechaDe(fila.reanudado_el) : null,
      },
      entero(fila.siguiente),
      hoy,
      emitirDiasAntes,
    );
    for (const periodo of periodos) {
      const estado = periodo.omitido ? "omitido" : tipo === "fijo" ? "emitido" : "por_emitir";
      consecutivo += 1;
      const id = randomUUID();
      const insertado = await aplicarSentencia(
        consulta,
        `insert into collection_charges
           (id, company_id, customer_id, plan_id, periodo, concepto, monto_centavos, vencimiento, referencia, estado,
            emitido_en, emitido_por, motivo, resuelto_por, resuelto_en, creado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10,
                 case when $10 = 'emitido' then now() end, case when $10 = 'emitido' then $11::uuid end,
                 case when $10 = 'omitido' then $12 end, case when $10 = 'omitido' then $11::uuid end,
                 case when $10 = 'omitido' then now() end, $11::uuid)
         on conflict (plan_id, periodo) do nothing
         returning id`,
        [id, empresaId, texto(fila.customer_id), texto(fila.id), periodo.periodo, texto(fila.concepto),
          estado === "emitido" ? monto : null, periodo.vencimiento, referenciaDe(consecutivo), estado, autor, MOTIVO_PAUSA],
      );
      if (insertado.rows.length === 0) continue;
      await auditar(consulta, actor, {
        accion: "generar_cargo",
        identificador: id,
        cambio: { periodo: periodo.periodo, vencimiento: periodo.vencimiento, monto_centavos: estado === "emitido" ? monto : null, estado },
      });
      generados.push({ id, estado });
    }
  }
  return generados;
}
