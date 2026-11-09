import { fechaDeCalendario, uuidValido } from "../../dominio/operacion";
import { sinInicioDeFormula } from "../../dominio/pld/layout41";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { exigirEnOperacion } from "../operacion/permisos";
import { conPld, fecha } from "./base";

/** Documentos por página: cada renglón pesa menos de 400 bytes, así que una página queda muy por debajo de 4.5 MB. */
export const DOCUMENTOS_POR_PAGINA = 2000;

export type CursorManifiesto = { despuesEn: Date; despuesId: string } | null;

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
  const pagina = typeof entrada.pagina === "number" && Number.isInteger(entrada.pagina) && entrada.pagina >= 1 ? entrada.pagina : 1;
  const companyId = entrada.companyId;
  const { conteos, documentos } = await conPld(ctx, companyId, async (consulta) => {
    const conteos = (await consulta.query("select tabla, filas from pld_manifiesto_conteos($1, $2, $3, $4, $5)", [
      companyId, desde, hasta, ctx.peticionId, pagina,
    ])).rows as Array<{ tabla: string; filas: string | number }>;
    const documentos = (await consulta.query(
      "select origen, id, cargado_en, nombre_archivo, sha256, clave_blob, tamano_bytes from pld_manifiesto_documentos($1, $2, $3, $4, $5, $6)",
      [companyId, desde, hasta, entrada.cursor?.despuesEn ?? null, entrada.cursor?.despuesId ?? null, DOCUMENTOS_POR_PAGINA + 1],
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
    siguiente: hayMas && ultimo ? { pagina: pagina + 1, despues_en: fecha(ultimo.cargado_en).toISOString(), despues_id: String(ultimo.id) } : null,
  })}\n`;
}
