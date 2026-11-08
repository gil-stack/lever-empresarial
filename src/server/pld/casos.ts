import { createHash, randomUUID } from "node:crypto";

import { TOPE_ARCHIVO_BYTES } from "../../dominio/archivos";
import { hoyEnMexico, textoMultilinea, textoOperativo, uuidValido } from "../../dominio/operacion";
import { PROPUESTAS, REGLAS, type Propuesta, type Regla } from "../../dominio/pld/etiquetas";
import { diasNaturales } from "../../dominio/pld/plazos";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import type { Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { motivoEscrito, unaVezPorFormulario } from "../operacion/formulario";
import { exigirEnOperacion } from "../operacion/permisos";
import { leerPrivado, type AlmacenConstancia } from "../proveedores/constancia";
import { auditarPld } from "./auditar";
import { conPld, dia, diaOpcional, fecha, fechaOpcional } from "./base";

export type AlertaPld = {
  id: string;
  regla: Regla;
  disposicion: string;
  companyId: string | null;
  razonSocial: string | null;
  tipoOperacion: "pago_proveedor" | "nomina" | null;
  observado: Record<string, unknown>;
  creadaEn: Date;
  venceEl: string;
  /** Días naturales que quedan (negativo: ya pasó). */
  diasRestantes: number;
  fueraDePlazo: boolean;
  casoId: string | null;
  avisoId: string | null;
};

const LEER_ALERTAS = `
  select a.id, a.regla, a.disposicion, a.company_id, c.razon_social, a.observado, a.creada_en, a.vence_el::text as vence_el,
         o.tipo as tipo_operacion, ca.caso_id, a.aviso_id
  from pld_alertas a
  left join companies c on c.id = a.company_id
  left join pld_operaciones o on o.id = a.operacion_id
  left join pld_caso_alertas ca on ca.alerta_id = a.id`;

function aAlerta(fila: Record<string, unknown>, hoy: string): AlertaPld {
  const venceEl = dia(fila.vence_el);
  const restantes = diasNaturales(hoy, venceEl);
  return {
    id: String(fila.id),
    regla: (REGLAS as readonly string[]).includes(String(fila.regla)) ? (fila.regla as Regla) : "aviso_manual",
    disposicion: String(fila.disposicion),
    companyId: typeof fila.company_id === "string" ? fila.company_id : null,
    razonSocial: typeof fila.razon_social === "string" ? fila.razon_social : null,
    tipoOperacion: fila.tipo_operacion === "nomina" ? "nomina" : fila.tipo_operacion === "pago_proveedor" ? "pago_proveedor" : null,
    observado: (fila.observado ?? {}) as Record<string, unknown>,
    creadaEn: fecha(fila.creada_en),
    venceEl,
    diasRestantes: restantes,
    fueraDePlazo: restantes < 0,
    casoId: typeof fila.caso_id === "string" ? fila.caso_id : null,
    avisoId: typeof fila.aviso_id === "string" ? fila.aviso_id : null,
  };
}

/** Alertas de PLD (54ª). Las ven Cumplimiento y Auditoría; la persona excluida de un aviso no ve la suya (60ª). */
export async function listarAlertasPld(ctx: ContextoDePersonal, opciones: { ahora?: Date; soloSinCaso?: boolean } = {}): Promise<AlertaPld[]> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  const hoy = hoyEnMexico(opciones.ahora ?? new Date());
  return conPld(ctx, null, async (consulta) => {
    const filas = await consulta.query(
      `${LEER_ALERTAS} ${opciones.soloSinCaso ? "where ca.caso_id is null" : ""} order by a.vence_el, a.creada_en limit 500`,
      [],
    );
    return (filas.rows as Array<Record<string, unknown>>).map((fila) => aAlerta(fila, hoy));
  });
}

export type CasoPld = {
  id: string;
  companyId: string | null;
  razonSocial: string | null;
  abiertoEn: Date;
  abiertoPor: string;
  venceEl: string | null;
  venceEn: Date | null;
  diasRestantes: number | null;
  fueraDePlazo: boolean;
  alertas: AlertaPld[];
  avisos: Array<{ id: string; tipo: string; descripcion: string; recibidoEn: Date }>;
  marca24h: { motivo: string; marcadaEn: Date; marcadaPor: string } | null;
  notas: Array<{ id: string; texto: string; autor: string; en: Date }>;
  documentos: Array<{ id: string; nombre: string; tipo: string; tamano: number; sha256: string; autor: string; en: Date }>;
  propuestas: Array<{ id: string; propuesta: Propuesta; justificacion: string; autor: string; en: Date }>;
  dictamen: {
    id: string;
    resultado: Propuesta;
    justificacion: string;
    via: "comite" | "oficial";
    sesionId: string | null;
    dictaminadoEl: string;
    fueraDePlazo: boolean;
    reporteVenceEl: string | null;
    reporteVenceEn: Date | null;
    autor: string;
  } | null;
  reporte: { id: string; tipoReporte: "2" | "3"; folio: string; periodo: string; recibidoEn: Date; registros: number; fueraDePlazo: boolean } | null;
  /** Alertas sin caso de la misma empresa: se pueden sumar como serie relacionada (40ª). */
  sumables: AlertaPld[];
};

/** Abre un caso para analizarlo. Leerlo deja su evento en la bitácora. */
export async function leerCaso(ctx: ContextoDePersonal, casoId: unknown, opciones: { ahora?: Date } = {}): Promise<CasoPld | null> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  if (!uuidValido(casoId)) return null;
  const ahora = opciones.ahora ?? new Date();
  const hoy = hoyEnMexico(ahora);
  return conPld(ctx, null, async (consulta) => {
    const filaCaso = (await consulta.query(
      `select k.id, k.company_id, c.razon_social, k.registrado_en, u.nombre, pld_caso_vence(k.id)::text as vence_el
       from pld_casos k left join companies c on c.id = k.company_id join users u on u.id = k.registrado_por where k.id = $1`,
      [casoId],
    )).rows[0] as Record<string, unknown> | undefined;
    if (!filaCaso) return null;
    const companyId = typeof filaCaso.company_id === "string" ? filaCaso.company_id : null;
    await auditarPld(consulta, ctx, { companyId, accion: "pld_caso_consultado", identificador: casoId, ocurridoEn: new Date() });
    const alertas = (await consulta.query(`${LEER_ALERTAS} where ca.caso_id = $1 order by a.creada_en`, [casoId])).rows as Array<Record<string, unknown>>;
    const avisos = (await consulta.query(
      `select v.id, v.tipo, v.descripcion, v.registrado_en from pld_avisos v
       join pld_alertas a on a.aviso_id = v.id join pld_caso_alertas ca on ca.alerta_id = a.id where ca.caso_id = $1`,
      [casoId],
    )).rows as Array<Record<string, unknown>>;
    const marca = (await consulta.query(
      "select m.motivo, m.registrado_en, u.nombre from pld_casos_24h m join users u on u.id = m.registrado_por where m.caso_id = $1",
      [casoId],
    )).rows[0] as Record<string, unknown> | undefined;
    const notas = (await consulta.query(
      "select n.id, n.texto, n.registrado_en, u.nombre from pld_notas n join users u on u.id = n.registrado_por where n.caso_id = $1 order by n.registrado_en",
      [casoId],
    )).rows as Array<Record<string, unknown>>;
    const documentos = (await consulta.query(
      `select d.id, d.nombre_archivo, d.tipo_contenido, d.tamano_bytes, d.sha256, d.registrado_en, u.nombre
       from pld_documentos d join users u on u.id = d.registrado_por where d.caso_id = $1 order by d.registrado_en`,
      [casoId],
    )).rows as Array<Record<string, unknown>>;
    const propuestas = (await consulta.query(
      `select p.id, p.propuesta, p.justificacion, p.registrado_en, u.nombre
       from pld_propuestas p join users u on u.id = p.registrado_por where p.caso_id = $1 order by p.registrado_en desc, p.id desc`,
      [casoId],
    )).rows as Array<Record<string, unknown>>;
    const dictamen = (await consulta.query(
      `select d.id, d.resultado, d.justificacion, d.via, d.sesion_id, d.dictaminado_el::text as dictaminado_el, d.fuera_de_plazo,
              d.reporte_vence_el::text as reporte_vence_el, d.reporte_vence_en, u.nombre
       from pld_dictamenes d join users u on u.id = d.registrado_por where d.caso_id = $1`,
      [casoId],
    )).rows[0] as Record<string, unknown> | undefined;
    const reporte = (await consulta.query(
      "select id, tipo_reporte, folio, periodo, recibido_en, registros, fuera_de_plazo from pld_reportes where caso_id = $1",
      [casoId],
    )).rows[0] as Record<string, unknown> | undefined;
    const sumables = dictamen
      ? []
      : ((await consulta.query(
          `${LEER_ALERTAS} where ca.caso_id is null and a.company_id is not distinct from $1 order by a.creada_en`,
          [companyId],
        )).rows as Array<Record<string, unknown>>);
    const venceEn = marca ? new Date(fecha(marca.registrado_en).getTime() + 24 * 3_600_000) : null;
    const venceEl = marca ? null : diaOpcional(filaCaso.vence_el);
    const diasRestantes = venceEl ? diasNaturales(hoy, venceEl) : null;
    return {
      id: String(filaCaso.id),
      companyId,
      razonSocial: typeof filaCaso.razon_social === "string" ? filaCaso.razon_social : null,
      abiertoEn: fecha(filaCaso.registrado_en),
      abiertoPor: String(filaCaso.nombre),
      venceEl,
      venceEn,
      diasRestantes,
      fueraDePlazo: venceEn ? ahora.getTime() > venceEn.getTime() : diasRestantes !== null && diasRestantes < 0,
      alertas: alertas.map((fila) => aAlerta(fila, hoy)),
      avisos: avisos.map((fila) => ({ id: String(fila.id), tipo: String(fila.tipo), descripcion: String(fila.descripcion), recibidoEn: fecha(fila.registrado_en) })),
      marca24h: marca ? { motivo: String(marca.motivo), marcadaEn: fecha(marca.registrado_en), marcadaPor: String(marca.nombre) } : null,
      notas: notas.map((fila) => ({ id: String(fila.id), texto: String(fila.texto), autor: String(fila.nombre), en: fecha(fila.registrado_en) })),
      documentos: documentos.map((fila) => ({
        id: String(fila.id), nombre: String(fila.nombre_archivo), tipo: String(fila.tipo_contenido), tamano: Number(fila.tamano_bytes),
        sha256: String(fila.sha256), autor: String(fila.nombre), en: fecha(fila.registrado_en),
      })),
      propuestas: propuestas.map((fila) => ({
        id: String(fila.id), propuesta: fila.propuesta as Propuesta, justificacion: String(fila.justificacion),
        autor: String(fila.nombre), en: fecha(fila.registrado_en),
      })),
      dictamen: dictamen
        ? {
            id: String(dictamen.id),
            resultado: dictamen.resultado as Propuesta,
            justificacion: String(dictamen.justificacion),
            via: dictamen.via === "oficial" ? "oficial" : "comite",
            sesionId: typeof dictamen.sesion_id === "string" ? dictamen.sesion_id : null,
            dictaminadoEl: dia(dictamen.dictaminado_el),
            fueraDePlazo: dictamen.fuera_de_plazo === true,
            reporteVenceEl: diaOpcional(dictamen.reporte_vence_el),
            reporteVenceEn: fechaOpcional(dictamen.reporte_vence_en),
            autor: String(dictamen.nombre),
          }
        : null,
      reporte: reporte
        ? {
            id: String(reporte.id), tipoReporte: reporte.tipo_reporte === "3" ? "3" : "2", folio: String(reporte.folio),
            periodo: String(reporte.periodo), recibidoEn: fecha(reporte.recibido_en), registros: Number(reporte.registros),
            fueraDePlazo: reporte.fuera_de_plazo === true,
          }
        : null,
      sumables: sumables.map((fila) => aAlerta(fila, hoy)),
    };
  });
}

/** Cumplimiento abre el caso de una alerta. Un doble clic deja un solo caso. */
export async function abrirCaso(
  ctx: ContextoDePersonal,
  entrada: { formId: unknown; alertaId: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<string> {
  exigirEnOperacion(ctx, "plataforma.pld.analizar");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  if (!uuidValido(entrada.alertaId)) throw new ErrorDeDominio("alerta_no_existe");
  const ahora = deps.ahora?.() ?? new Date();
  return unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    const previo = await consulta.query("select id from pld_casos where id = $1", [entrada.formId]);
    if (previo.rows.length > 0) return entrada.formId as string;
    const alerta = (await consulta.query(
      "select a.company_id, ca.caso_id from pld_alertas a left join pld_caso_alertas ca on ca.alerta_id = a.id where a.id = $1",
      [entrada.alertaId],
    )).rows[0] as { company_id: string | null; caso_id: string | null } | undefined;
    if (!alerta) throw new ErrorDeDominio("alerta_no_existe");
    if (alerta.caso_id) return alerta.caso_id;
    await consulta.query("insert into pld_casos (id, operator_id, company_id, registrado_por) values ($1, $2, $3, $4)", [
      entrada.formId, ctx.personal.operadorId, alerta.company_id, ctx.persona.id,
    ]);
    await consulta.query("insert into pld_caso_alertas (caso_id, alerta_id, operator_id, registrado_por) values ($1, $2, $3, $4)", [
      entrada.formId, entrada.alertaId, ctx.personal.operadorId, ctx.persona.id,
    ]);
    await auditarPld(consulta, ctx, {
      companyId: alerta.company_id, accion: "pld_caso_abierto", identificador: entrada.formId as string, ocurridoEn: ahora,
    });
    return entrada.formId as string;
  }), "alerta_no_existe");
}

/** 40ª: una serie relacionada del mismo cliente va en un solo reporte. Se suma antes del dictamen. */
export async function sumarAlertaAlCaso(
  ctx: ContextoDePersonal,
  entrada: { casoId: unknown; alertaId: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.analizar");
  if (!uuidValido(entrada.casoId)) throw new ErrorDeDominio("caso_no_existe");
  if (!uuidValido(entrada.alertaId)) throw new ErrorDeDominio("alerta_no_existe");
  const ahora = deps.ahora?.() ?? new Date();
  await conPld(ctx, null, async (consulta) => {
    const ya = await consulta.query("select caso_id from pld_caso_alertas where alerta_id = $1", [entrada.alertaId]);
    if (ya.rows.length > 0) {
      if ((ya.rows[0] as { caso_id: string }).caso_id === entrada.casoId) return;
      throw new ErrorDeDominio("alerta_ya_en_caso");
    }
    const caso = (await consulta.query("select company_id from pld_casos where id = $1", [entrada.casoId])).rows[0] as
      | { company_id: string | null }
      | undefined;
    if (!caso) throw new ErrorDeDominio("caso_no_existe");
    await consulta.query("insert into pld_caso_alertas (caso_id, alerta_id, operator_id, registrado_por) values ($1, $2, $3, $4)", [
      entrada.casoId, entrada.alertaId, ctx.personal.operadorId, ctx.persona.id,
    ]);
    await auditarPld(consulta, ctx, {
      companyId: caso.company_id, accion: "pld_caso_alerta_agregada", identificador: entrada.casoId as string, ocurridoEn: ahora,
      cambio: { alerta: entrada.alertaId as string },
    });
  });
}

async function empresaDelCaso(consulta: Consulta, casoId: string): Promise<string | null> {
  const fila = (await consulta.query("select company_id from pld_casos where id = $1", [casoId])).rows[0] as
    | { company_id: string | null }
    | undefined;
  if (!fila) throw new ErrorDeDominio("caso_no_existe");
  return fila.company_id;
}

/** 41ª: el análisis consta por escrito. Las notas no se editan ni se borran. */
export async function agregarNota(
  ctx: ContextoDePersonal,
  entrada: { casoId: unknown; formId: unknown; texto: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.analizar");
  if (!uuidValido(entrada.casoId)) throw new ErrorDeDominio("caso_no_existe");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const texto = textoMultilinea(entrada.texto, 4000);
  if (!texto || [...texto].length < 2) throw new ErrorDeDominio("dato_invalido_texto");
  const ahora = deps.ahora?.() ?? new Date();
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    const previo = await consulta.query("select caso_id from pld_notas where id = $1", [entrada.formId]);
    if (previo.rows.length > 0) return;
    const companyId = await empresaDelCaso(consulta, entrada.casoId as string);
    await consulta.query("insert into pld_notas (id, caso_id, operator_id, texto, registrado_por) values ($1, $2, $3, $4, $5)", [
      entrada.formId, entrada.casoId, ctx.personal.operadorId, texto, ctx.persona.id,
    ]);
    await auditarPld(consulta, ctx, { companyId, accion: "pld_nota_agregada", identificador: entrada.formId as string, ocurridoEn: ahora });
  }), "caso_no_existe");
}

/** 40ª y 45ª: la propuesta de reportar o no, con su justificación. La vigente es la última. */
export async function registrarPropuesta(
  ctx: ContextoDePersonal,
  entrada: { casoId: unknown; formId: unknown; propuesta: unknown; justificacion: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.analizar");
  if (!uuidValido(entrada.casoId)) throw new ErrorDeDominio("caso_no_existe");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  if (!(PROPUESTAS as readonly unknown[]).includes(entrada.propuesta)) throw new ErrorDeDominio("dato_invalido_propuesta");
  const justificacion = motivoEscrito(entrada.justificacion, 4000);
  const ahora = deps.ahora?.() ?? new Date();
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    const previo = await consulta.query("select 1 from pld_propuestas where id = $1", [entrada.formId]);
    if (previo.rows.length > 0) return;
    const companyId = await empresaDelCaso(consulta, entrada.casoId as string);
    await consulta.query(
      "insert into pld_propuestas (id, caso_id, operator_id, propuesta, justificacion, registrado_por) values ($1, $2, $3, $4, $5, $6)",
      [entrada.formId, entrada.casoId, ctx.personal.operadorId, entrada.propuesta, justificacion, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, {
      companyId, accion: "pld_propuesta_registrada", identificador: entrada.formId as string, ocurridoEn: ahora,
      cambio: { propuesta: entrada.propuesta as string },
    });
  }), "caso_no_existe");
}

/** 44ª: el caso pasa a 24 horas desde que Cumplimiento conoce la información. */
export async function marcarVeinticuatroHoras(
  ctx: ContextoDePersonal,
  entrada: { casoId: unknown; motivo: unknown },
  deps: { ahora?: () => Date } = {},
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.analizar");
  if (!uuidValido(entrada.casoId)) throw new ErrorDeDominio("caso_no_existe");
  const motivo = motivoEscrito(entrada.motivo, 1000);
  const ahora = deps.ahora?.() ?? new Date();
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    const previo = await consulta.query("select 1 from pld_casos_24h where caso_id = $1", [entrada.casoId]);
    if (previo.rows.length > 0) return;
    const companyId = await empresaDelCaso(consulta, entrada.casoId as string);
    await consulta.query("insert into pld_casos_24h (caso_id, operator_id, motivo, registrado_por) values ($1, $2, $3, $4)", [
      entrada.casoId, ctx.personal.operadorId, motivo, ctx.persona.id,
    ]);
    await auditarPld(consulta, ctx, { companyId, accion: "pld_caso_24_horas", identificador: entrada.casoId as string, ocurridoEn: ahora });
  }), "caso_no_existe");
}

const LIMITE_DOCUMENTO = TOPE_ARCHIVO_BYTES;

function tipoDeContenido(bytes: Uint8Array): { tipo: string; extension: string } | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return { tipo: "application/pdf", extension: "pdf" };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { tipo: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { tipo: "image/jpeg", extension: "jpg" };
  return null;
}

/** Lee el archivo del formulario. Un campo vacío llega como File sin bytes: es «falta el archivo». */
export async function archivoDelFormulario(archivo: unknown): Promise<{ nombre: string; bytes: Uint8Array } | null> {
  if (!(archivo instanceof File) || archivo.size === 0) return null;
  if (archivo.size > LIMITE_DOCUMENTO) throw new ErrorDeDominio("archivo_demasiado_grande");
  return { nombre: archivo.name, bytes: new Uint8Array(await archivo.arrayBuffer()) };
}

/**
 * Documento de soporte del análisis: Blob privado, 4 MiB, SHA-256 y descarga
 * auditada. Un doble clic no sube dos veces: el id es el del formulario. Lever
 * nunca borra un documento de PLD (61ª).
 */
export async function cargarDocumentoPld(
  ctx: ContextoDePersonal,
  entrada: { casoId: unknown; formId: unknown; archivo: { nombre: string; bytes: Uint8Array } | null },
  deps: { almacen: AlmacenConstancia; ahora?: () => Date },
): Promise<void> {
  exigirEnOperacion(ctx, "plataforma.pld.analizar");
  if (!uuidValido(entrada.casoId)) throw new ErrorDeDominio("caso_no_existe");
  if (!uuidValido(entrada.formId)) throw new ErrorDeDominio("formulario_invalido");
  const archivo = entrada.archivo;
  if (!archivo || archivo.bytes.byteLength === 0) throw new ErrorDeDominio("dato_invalido_archivo");
  if (archivo.bytes.byteLength > LIMITE_DOCUMENTO) throw new ErrorDeDominio("archivo_demasiado_grande");
  const contenido = tipoDeContenido(archivo.bytes);
  if (!contenido) throw new ErrorDeDominio("archivo_no_admitido");
  const nombre = textoOperativo(archivo.nombre.replace(/[\\/]/g, "_"), 200) ?? `soporte.${contenido.extension}`;
  const sha256 = createHash("sha256").update(archivo.bytes).digest("hex");
  const ahora = deps.ahora?.() ?? new Date();
  const id = entrada.formId as string;
  const yaEsta = await conPld(ctx, null, async (consulta) => {
    const previo = await consulta.query("select caso_id from pld_documentos where id = $1", [id]);
    if (previo.rows.length > 0) return true;
    await empresaDelCaso(consulta, entrada.casoId as string);
    return false;
  });
  if (yaEsta) return;
  const guardado = await deps.almacen.guardar({
    clave: `pld/${ctx.personal.operadorId}/${entrada.casoId as string}/${id}-${randomUUID().slice(0, 8)}.${contenido.extension}`,
    bytes: archivo.bytes,
    tipo: contenido.tipo,
  });
  await unaVezPorFormulario(() => conPld(ctx, null, async (consulta) => {
    const previo = await consulta.query("select 1 from pld_documentos where id = $1", [id]);
    if (previo.rows.length > 0) return;
    const companyId = await empresaDelCaso(consulta, entrada.casoId as string);
    await consulta.query(
      `insert into pld_documentos (id, caso_id, operator_id, nombre_archivo, tipo_contenido, tamano_bytes, sha256, clave_blob, registrado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, entrada.casoId, ctx.personal.operadorId, nombre, contenido.tipo, archivo.bytes.byteLength, sha256, guardado.clave, ctx.persona.id],
    );
    await auditarPld(consulta, ctx, { companyId, accion: "pld_documento_cargado", identificador: id, ocurridoEn: ahora, cambio: { tipo: contenido.tipo } });
  }), "caso_no_existe");
}

/** Descarga auditada: la base deja el evento y entrega la ruta; el archivo se compara con su SHA-256. */
export async function descargarDocumentoPld(
  ctx: ContextoDePersonal,
  documentoId: unknown,
  deps: { leer?: (clave: string) => Promise<ReadableStream<Uint8Array>> } = {},
): Promise<{ bytes: Uint8Array; nombre: string; tipo: string }> {
  exigirEnOperacion(ctx, "plataforma.pld.ver");
  if (!uuidValido(documentoId)) throw new ErrorDeDominio("documento_no_existe");
  const fila = await conPld(ctx, null, async (consulta) =>
    (await consulta.query("select clave_blob, nombre_archivo, tipo_contenido, sha256 from pld_documento_para_descarga($1, $2)", [
      documentoId, ctx.peticionId,
    ])).rows[0] as { clave_blob: string; nombre_archivo: string; tipo_contenido: string; sha256: string } | undefined,
  );
  if (!fila) throw new ErrorDeDominio("documento_no_existe");
  const bytes = new Uint8Array(await new Response(await (deps.leer ?? leerPrivado)(fila.clave_blob)).arrayBuffer());
  if (bytes.byteLength > LIMITE_DOCUMENTO || createHash("sha256").update(bytes).digest("hex") !== fila.sha256) {
    console.error(JSON.stringify({ evento: "pld_documento_alterado", documentoId, peticionId: ctx.peticionId }));
    throw new ErrorDeDominio("archivo_no_disponible");
  }
  return { bytes, nombre: fila.nombre_archivo, tipo: fila.tipo_contenido };
}
