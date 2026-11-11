import { fechaDeCalendario, uuidValido } from "../../dominio/operacion";
import { sinInicioDeFormula } from "../../dominio/pld/layout41";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { exigirEnOperacion } from "../operacion/permisos";
import { conPld, fecha } from "./base";

/** Documentos por página: cada renglón pesa menos de 400 bytes, así que una página queda muy por debajo de 4.5 MB. */
export const DOCUMENTOS_POR_PAGINA = 2000;

/**
 * r2-serv-N23: el cursor es el texto exacto del último documento de la página (`siguiente.despues_en`), con sus
 * microsegundos; no pasa por Date, que los corta a milisegundos y repetía documentos del mismo milisegundo.
 */
export type CursorManifiesto = { despuesEn: string; despuesId: string } | null;

/** Un instante en UTC como lo escribe `siguiente.despues_en`: fecha, hora y hasta 6 decimales. */
const INSTANTE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?Z$/;
/** Muy por arriba de cualquier manifiesto real y dentro del entero de la base. */
const PAGINA_MAXIMA = 999_999_999;

/**
 * r2-serv-N24: la página y el cursor se revisan antes de la base. La página 1 va sin cursor y de la 2 en adelante
 * con los dos valores de «siguiente». Cada rechazo es del campo que lo causó en Conservación.
 */
function paginaYCursor(pagina: unknown, cursor: CursorManifiesto): { pagina: number; cursor: CursorManifiesto } {
  if (typeof pagina !== "number" || !Number.isInteger(pagina) || pagina < 1 || pagina > PAGINA_MAXIMA) throw new ErrorDeDominio("manifiesto_pagina_invalida");
  if (pagina === 1) {
    if (cursor !== null) throw new ErrorDeDominio("manifiesto_pagina_invalida");
    return { pagina, cursor };
  }
  const dia = cursor ? INSTANTE.exec(cursor.despuesEn)?.[1] : undefined;
  if (!cursor || !dia || !fechaDeCalendario(dia)) throw new ErrorDeDominio("manifiesto_despues_en_invalido");
  if (!uuidValido(cursor.despuesId)) throw new ErrorDeDominio("manifiesto_despues_id_invalido");
  return { pagina, cursor };
}

/**
 * 61ª: manifiesto verificable de conservación de una empresa en un periodo.
 * Página 1: conteo de filas por tabla. Todas: la huella SHA-256, la ruta y el
 * tamaño de cada documento, en orden estable. Cada página deja su evento en la
 * bitácora y se entrega en streaming, renglón por renglón (NDJSON).
 */
export async function* manifiestoDeConservacion(
  ctx: ContextoDePersonal,
  entrada: { companyId: unknown; desde: unknown; hasta: unknown; pagina: unknown; cursor: CursorManifiesto },
): AsyncGenerator<string> {
  exigirEnOperacion(ctx, "plataforma.pld.manifiesto");
  if (!uuidValido(entrada.companyId)) throw new ErrorDeDominio("cliente_ausente");
  const desde = typeof entrada.desde === "string" ? entrada.desde : "";
  const hasta = typeof entrada.hasta === "string" ? entrada.hasta : "";
  if (!fechaDeCalendario(desde) || !fechaDeCalendario(hasta) || hasta < desde) throw new ErrorDeDominio("periodo_invalido");
  const { pagina, cursor } = paginaYCursor(entrada.pagina, entrada.cursor);
  const companyId = entrada.companyId;
  const { conteos, documentos } = await conPld(ctx, companyId, async (consulta) => {
    // C: las empresas de demostración no entran a PLD; tampoco su manifiesto.
    const empresa = await consulta.query("select 1 from companies where id = $1 and not demostracion", [companyId]);
    if (empresa.rows.length !== 1) throw new ErrorDeDominio("cliente_ausente");
    const conteos = (await consulta.query("select tabla, filas from pld_manifiesto_conteos($1, $2, $3, $4, $5)", [
      companyId, desde, hasta, ctx.peticionId, pagina,
    ])).rows as Array<{ tabla: string; filas: string | number }>;
    const documentos = (await consulta.query(
      `select origen, id, cargado_en, to_char(cargado_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cargado_en_exacto,
              nombre_archivo, sha256, clave_blob, tamano_bytes
       from pld_manifiesto_documentos($1, $2, $3, $4::timestamptz, $5, $6)`,
      [companyId, desde, hasta, cursor?.despuesEn ?? null, cursor?.despuesId ?? null, DOCUMENTOS_POR_PAGINA + 1],
    )).rows as Array<Record<string, unknown>>;
    return { conteos, documentos };
  });
  const hayMas = documentos.length > DOCUMENTOS_POR_PAGINA;
  const visibles = documentos.slice(0, DOCUMENTOS_POR_PAGINA);
  const ultimo = visibles[visibles.length - 1];
  yield `${JSON.stringify({
    manifiesto: "conservacion-61a",
    empresa: companyId,
    desde,
    hasta,
    pagina,
    generado_en: new Date().toISOString(),
    nota: "Conteos de filas por tabla y huella SHA-256 de cada documento. El destino de la exportación de 10 años está pendiente.",
  })}\n`;
  if (pagina === 1) {
    for (const conteo of conteos) yield `${JSON.stringify({ tabla: conteo.tabla, filas: Number(conteo.filas) })}\n`;
  }
  for (const documento of visibles) {
    yield `${JSON.stringify({
      documento: String(documento.id),
      origen: String(documento.origen),
      cargado_en: fecha(documento.cargado_en).toISOString(),
      // r2-base-N16: el nombre del archivo es texto libre; no abre como fórmula.
      nombre: sinInicioDeFormula(String(documento.nombre_archivo)),
      sha256: String(documento.sha256),
      ruta: String(documento.clave_blob),
      bytes: Number(documento.tamano_bytes),
    })}\n`;
  }
  yield `${JSON.stringify({
    fin_de_pagina: pagina,
    documentos: visibles.length,
    siguiente: hayMas && ultimo ? { pagina: pagina + 1, despues_en: String(ultimo.cargado_en_exacto), despues_id: String(ultimo.id) } : null,
  })}\n`;
}
